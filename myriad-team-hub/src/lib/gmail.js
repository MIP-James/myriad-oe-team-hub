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
 * Gmail URL 또는 ID 에서 Gmail API 가 받는 messageId 추출.
 *
 * Gmail 의 ID 체계는 두 가지가 공존:
 *   (A) **API ID** — 16자리 hex (예: `196b1d8a8e4c0c0e`). messages.get 에 직접 사용.
 *   (B) **웹 UI ID** — `FMfcgzQVx...` 같은 32자 영숫자. 웹 주소창 #inbox/... 에 표시.
 *       이건 API 가 직접 받지 못함 → "Invalid id value (400)" 발생.
 *
 * 변환 가능한 한 가지 경로: 메일 우측 상단 ⋮ → "원본 보기" 클릭 시 열리는 새 탭의
 *   URL 에 `permmsgid=msg-f:1812345678901234567` 형식이 있음. 이 십진수를 hex 로
 *   변환하면 그게 곧 API ID.
 *
 * 따라서 추출 우선순위:
 *   1. permmsgid=msg-f:<decimal>  → hex 변환 (가장 신뢰)
 *   2. URL ?th=<hex> 또는 ?msg=<hex>  (간혹 노출)
 *   3. 사용자가 hex ID 만 붙여넣음
 *   4. (마지막) #inbox/<webid> 형식 — API 거부 가능. throw 신호 위해 prefix 부착.
 */
export function extractGmailId(url) {
  if (!url) return null
  const s = String(url).trim()

  // 1. permmsgid 형식 (원본 보기 URL) — 가장 정확
  //    예: ...?permmsgid=msg-f:1812345678901234567 또는 msg-a:r123...
  const permF = s.match(/permmsgid=msg-[fa]:(\d+)/i)
  if (permF) {
    try {
      const dec = BigInt(permF[1])
      return dec.toString(16)
    } catch { /* fall through */ }
  }

  // 2. URL 쿼리 파라미터 ?th=<id> ?msg=<id>
  try {
    const u = new URL(s)
    const th = u.searchParams.get('th')
    const msg = u.searchParams.get('msg') || u.searchParams.get('message_id')
    if (msg && /^[0-9a-f]{8,32}$/i.test(msg)) return msg
    if (th && /^[0-9a-f]{8,32}$/i.test(th)) return th
  } catch { /* ignore */ }

  // 3. 사용자가 hex ID 만 붙여넣은 경우
  const hexOnly = s.match(/^([0-9a-f]{14,32})$/i)
  if (hexOnly) return hexOnly[1]

  // 4. #inbox/<id> 형식 — 웹 UI ID 일 가능성 높음 (FMfcgz... 등)
  //    이건 API 가 거부함. 시도라도 해보되 실패 시 사용자에게 친절한 안내.
  const hashMatch = s.match(/#[^/]+(?:\/[^/]*)*\/([A-Za-z0-9_-]{16,})/)
  if (hashMatch) {
    const candidate = hashMatch[1]
    // hex 면 API ID 일 가능성 → 그대로
    if (/^[0-9a-f]+$/i.test(candidate) && candidate.length <= 32) return candidate
    // 아니면 웹 UI ID — 표식 prefix 로 호출자가 안내 메시지 띄울 수 있게
    return '__WEB_UI_ID__' + candidate
  }

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

  // 웹 UI ID 가 들어온 경우 → API 가 받지 못함. 즉시 안내.
  if (id.startsWith('__WEB_UI_ID__')) {
    throw new Error(
      '이 URL 은 Gmail 웹 전용 형식이라 API 로 가져올 수 없습니다.\n\n' +
      '대신 다음 방법으로 진행해주세요:\n' +
      '  1) 가져올 메일 열기\n' +
      '  2) 메일 우측 상단 ⋮ (더보기) → "원본 보기" 클릭\n' +
      '  3) 새로 열린 탭의 주소창 URL 을 그대로 붙여넣기'
    )
  }

  let data
  try {
    data = await _fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`,
      token
    )
  } catch (e) {
    // 404 또는 400 (Invalid id) — thread.get 으로 폴백 시도
    if (/404|400|Invalid id/i.test(e.message)) {
      try {
        const threadData = await _fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(id)}?format=full`,
          token
        )
        data = threadData?.messages?.[threadData.messages.length - 1]
        if (!data) throw new Error('thread 에 메시지 없음')
      } catch (innerErr) {
        throw new Error(
          '메일을 찾을 수 없습니다. URL 형식을 확인해주세요.\n\n' +
          '권장: 메일 → ⋮ → "원본 보기" → 새 탭의 URL 을 사용\n' +
          '(원본 URL 은 ?permmsgid=msg-f:... 형식을 포함합니다)'
        )
      }
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
