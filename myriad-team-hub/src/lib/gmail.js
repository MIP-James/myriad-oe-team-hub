/**
 * Gmail API v1 래퍼 — 메일 한 통의 제목 + 본문(text/plain 우선, text/html 폴백) 가져오기.
 *
 * 사용 시나리오 (Phase 8 케이스 관리):
 *   1. 사용자가 Gmail 에서 메일 열고 주소창 URL 복사
 *      예: https://mail.google.com/mail/u/0/#inbox/FMfcgzQVxZHvXXXXXXXXXXXXXXX
 *   2. 케이스 에디터에 붙여넣기 → extractMessageId(url) → fetchMessage(token, id)
 *   3. 제목 → 케이스 제목, 본문 → 케이스 body 에 붙여넣기
 *
 * 주의:
 *   - Google OAuth scope 에 `gmail.readonly` 있어야 함 (AuthContext 에서 추가됨).
 *   - scope 가 누락된 기존 세션은 재로그인 필요 → 401 발생 시 GoogleAuthRequiredError.
 *   - Gmail URL 의 ID 는 thread ID 가 섞여 있을 수 있어서 여러 패턴 대응.
 */

import { GoogleAuthRequiredError } from './googleDrive'

async function _fetch(url, token) {
  if (!token) throw new GoogleAuthRequiredError()
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (resp.status === 401 || resp.status === 403) {
    let body = ''
    try { body = await resp.text() } catch {}
    if (resp.status === 401 || /invalid_token|expired|insufficient/i.test(body)) {
      throw new GoogleAuthRequiredError(
        'Gmail 접근 권한이 없거나 만료됐습니다.\n로그아웃 후 다시 로그인하여 Gmail 권한을 허용해주세요.'
      )
    }
    throw new Error(`Gmail API ${resp.status}: ${body}`)
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`Gmail API ${resp.status}: ${text}`)
  }
  return resp.json()
}

/**
 * Gmail URL 에서 메시지 ID 추출.
 * 실제 Gmail 웹 UI URL 은 16진수/Base64 혼합의 긴 ID(예: FMfcgzQV... or 18a1b2c3d4e5f6g7)
 * 를 쓰고, 이게 thread ID 일 수 있음. Gmail API 는 messageId 를 받지만,
 * thread ID 로 조회하려면 별도 `threads.get` 을 써야 함.
 * 일단 URL 에서 마지막 세그먼트를 추출 — messages.get 이 실패하면 threads.get 으로 폴백.
 */
export function extractGmailId(url) {
  if (!url) return null
  const s = String(url).trim()

  // 케이스 1: 일반 Gmail 웹 URL — https://mail.google.com/mail/u/<n>/#<label>/<id>
  //           또는 #all/<id>, #search/<q>/<id>, #label/<name>/<id>
  // 마지막 '/' 뒤의 영숫자 덩어리를 ID 후보로.
  const hashMatch = s.match(/#[^/]+(?:\/[^/]*)*\/([A-Za-z0-9_-]{16,})\b/)
  if (hashMatch) return hashMatch[1]

  // 케이스 2: 이미 ID 만 붙여넣은 경우
  const idOnly = s.match(/^([A-Za-z0-9_-]{16,})$/)
  if (idOnly) return idOnly[1]

  // 케이스 3: 쿼리 파라미터에 ?message_id= 가 있는 경우 (드문 편)
  try {
    const u = new URL(s)
    const mid = u.searchParams.get('message_id') || u.searchParams.get('msg')
    if (mid) return mid
  } catch { /* ignore */ }

  return null
}

/**
 * MIME 파트 트리에서 가장 적합한 본문 추출.
 * 우선 text/plain → 없으면 text/html 추출 후 HTML 태그 제거.
 */
function decodeBase64Url(data) {
  if (!data) return ''
  // Gmail 은 base64url 사용 (- → +, _ → /)
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/')
  try {
    // URL decode 후 UTF-8 decode
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new TextDecoder('utf-8').decode(bytes)
  } catch {
    return ''
  }
}

function collectPartsByMime(part, mime, out) {
  if (!part) return
  if (part.mimeType === mime && part.body?.data) {
    out.push(decodeBase64Url(part.body.data))
  }
  if (part.parts) {
    for (const p of part.parts) collectPartsByMime(p, mime, out)
  }
}

function htmlToText(html) {
  // 아주 단순한 HTML → 텍스트 변환 (DOMParser 사용)
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    // <br>, <p>, <div> 에 줄바꿈 추가
    doc.querySelectorAll('br').forEach((br) => br.replaceWith('\n'))
    doc.querySelectorAll('p, div').forEach((el) => el.insertAdjacentText('beforeend', '\n'))
    const txt = (doc.body?.textContent || '').replace(/\n{3,}/g, '\n\n').trim()
    return txt
  } catch {
    return html.replace(/<[^>]+>/g, '').trim()
  }
}

/**
 * messageId 로 메일 한 통 가져오기. format=full 로 헤더 + 파트 트리 전체.
 * thread ID 가 들어오면 자동 폴백.
 *
 * 반환:
 *   {
 *     id, threadId,
 *     subject, from, to, date (Date),
 *     snippet,            // 미리보기
 *     bodyText, bodyHtml, // 원본 파트
 *     text               // 최종 추천 본문 (text > html→text)
 *   }
 */
export async function fetchMessage(token, id) {
  if (!token) throw new GoogleAuthRequiredError()
  if (!id) throw new Error('메시지 ID 가 비어있습니다.')

  let data
  try {
    data = await _fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`,
      token
    )
  } catch (e) {
    // thread ID 로 잘못 들어온 경우 폴백
    if (/404/.test(e.message)) {
      const threadData = await _fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(id)}?format=full`,
        token
      )
      data = threadData?.messages?.[threadData.messages.length - 1]
      if (!data) throw new Error('메일을 찾을 수 없습니다. URL 을 다시 확인해주세요.')
    } else {
      throw e
    }
  }

  const headers = {}
  for (const h of data.payload?.headers ?? []) {
    headers[h.name.toLowerCase()] = h.value
  }

  // 본문 파트 수집
  const plainParts = []
  const htmlParts = []
  if (data.payload) {
    // 최상위 body 도 포함 (simple mail)
    if (data.payload.mimeType === 'text/plain' && data.payload.body?.data) {
      plainParts.push(decodeBase64Url(data.payload.body.data))
    } else if (data.payload.mimeType === 'text/html' && data.payload.body?.data) {
      htmlParts.push(decodeBase64Url(data.payload.body.data))
    }
    collectPartsByMime(data.payload, 'text/plain', plainParts)
    collectPartsByMime(data.payload, 'text/html', htmlParts)
  }

  const bodyText = plainParts.join('\n\n').trim()
  const bodyHtml = htmlParts.join('\n').trim()
  const text = bodyText || (bodyHtml ? htmlToText(bodyHtml) : '') || data.snippet || ''

  return {
    id: data.id,
    threadId: data.threadId,
    subject: headers.subject || '(제목 없음)',
    from: headers.from || '',
    to: headers.to || '',
    date: headers.date ? new Date(headers.date) : null,
    snippet: data.snippet || '',
    bodyText,
    bodyHtml,
    text
  }
}

/** Gmail 웹에서 해당 스레드를 바로 열 수 있는 URL 생성 (사용자 참고용). */
export function gmailThreadUrl(threadId) {
  return threadId ? `https://mail.google.com/mail/u/0/#all/${threadId}` : null
}
