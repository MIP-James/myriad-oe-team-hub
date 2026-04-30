/**
 * Cloudflare Pages Function — Inbound Gmail polling + 자동 케이스 생성.
 *
 *   POST /api/inbound-poll
 *
 * 호출 방식 2가지:
 *   1. 외부 cron (Supabase pg_cron / GitHub Actions / cron-job.org) 이 5분마다 호출
 *      → Authorization: Bearer ${INBOUND_CRON_SECRET}
 *   2. 관리자가 모니터링 페이지에서 "지금 폴링" 수동 클릭
 *      → Authorization: Bearer <jwt>  (admin 필수)
 *
 * 흐름 (활성 reader 별로):
 *   1. inbound_reader_tokens 에서 활성 reader 조회
 *   2. refresh_token 으로 access_token 갱신 (만료됐거나 60초 이내 임박)
 *   3. Gmail API list (`in:inbox newer_than:1d -label:trash`) 최대 50건 1차 필터
 *   4. 각 메시지마다:
 *      - inbound_processed_messages 중복 체크
 *      - Gmail messages.get format=metadata 로 헤더만 1차 조회 (가벼움)
 *      - 매칭 룰 적용 (sender_email > sender_domain > to_pattern > thread)
 *      - 룰 매칭 + 키워드 필요시 본문까지 fetch 후 키워드 검사
 *      - 통과 시 → 본문 + thread_id → 케이스 생성 (또는 기존 case 댓글 추가)
 *      - inbound_processed_messages 에 기록
 *   5. reader 상태 갱신
 *
 * 환경변수:
 *   - SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 *   - GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET (refresh_token 갱신용)
 *   - INBOUND_CRON_SECRET (외부 cron 인증용)
 */
import { createClient } from '@supabase/supabase-js'

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me'
// 받은편지함이 시간당 5~10건 들어오는 환경 기준, 5분 주기 폴링이라도
// 일시적 트래픽 폭증/재처리 등 상황에서 50건은 부족 → 200건 + pagination 으로 안전망.
const MAX_MESSAGES_PER_PAGE = 200
const MAX_PAGES_PER_POLL = 5     // 최대 1000건까지 거슬러 올라감 (대부분 1페이지에서 종료)
// `in:inbox` 빼고 sent/drafts/trash/spam/chats 만 명시 제외.
// 사용자가 forward 직후 아카이브하거나 자동 필터로 인박스에서 빠진 메일도 잡힘.
// `inbound_processed_messages.message_id` 가 PK 라 중복 처리 자동 방지.
const SEARCH_QUERY = 'newer_than:1d -in:sent -in:drafts -in:trash -in:spam -in:chats'

export async function onRequestPost(context) {
  const { request, env } = context
  const startedAt = Date.now()

  try {
    // ── 인증 — cron secret 또는 admin JWT ─────────────────────
    const authHeader = request.headers.get('Authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '')
    if (!token) return json({ error: '인증 토큰 누락' }, 401)

    const isCron = env.INBOUND_CRON_SECRET && token === env.INBOUND_CRON_SECRET
    let isAdmin = false

    if (!isCron) {
      // JWT 검증 + admin 확인
      const sb = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false }
      })
      const { data: { user }, error } = await sb.auth.getUser()
      if (error || !user) return json({ error: '인증 실패' }, 401)
      const { data: profile } = await sb
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle()
      isAdmin = profile?.role === 'admin'
      if (!isAdmin) return json({ error: '관리자 권한 필요' }, 403)
    }

    // ── service role client (RLS 우회) ────────────────────────
    if (!env.SUPABASE_SERVICE_ROLE_KEY) {
      return json({ error: 'SUPABASE_SERVICE_ROLE_KEY 누락' }, 500)
    }
    const adminSb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    })

    // ── 활성 reader 조회 ─────────────────────────────────────
    const { data: readers } = await adminSb
      .from('inbound_reader_tokens')
      .select('*')
      .eq('is_active', true)
    if (!readers || readers.length === 0) {
      return json({ ok: true, message: '활성 reader 없음', processed: 0 })
    }

    // ── 매핑 룰 + 키워드 1회 조회 (모든 reader 공유) ─────────
    const { data: mappings } = await adminSb
      .from('inbound_mappings')
      .select('*')
      .eq('is_active', true)
      .order('priority', { ascending: true })
    const { data: keywordRows } = await adminSb
      .from('inbound_keywords')
      .select('keyword')
      .eq('is_active', true)
    const keywords = (keywordRows || []).map((r) => r.keyword)

    if (!mappings || mappings.length === 0) {
      // reader 들 상태만 갱신하고 종료
      for (const reader of readers) {
        await adminSb
          .from('inbound_reader_tokens')
          .update({
            last_polled_at: new Date().toISOString(),
            last_poll_status: 'no_active_mappings',
            last_poll_error: null,
            last_poll_count: 0
          })
          .eq('user_id', reader.user_id)
      }
      return json({ ok: true, message: '활성 매핑 룰 없음', processed: 0 })
    }

    // ── 각 reader 별로 polling 실행 ─────────────────────────
    const results = []
    for (const reader of readers) {
      const result = await pollForReader({
        reader,
        mappings,
        keywords,
        adminSb,
        env
      })
      results.push(result)
    }

    return json({
      ok: true,
      duration_ms: Date.now() - startedAt,
      readers: results
    })
  } catch (e) {
    return json({ error: '서버 오류: ' + (e?.message || String(e)) }, 500)
  }
}

// =============================================================
// 한 reader 의 inbox polling
// =============================================================
async function pollForReader({ reader, mappings, keywords, adminSb, env }) {
  const result = {
    user_id: reader.user_id,
    email: reader.email,
    processed: 0,
    skipped: 0,
    errors: 0,
    status: 'ok'
  }

  // 1) access_token 갱신 (만료됐거나 60초 이내)
  let accessToken = reader.access_token
  const expiresAt = reader.expires_at ? new Date(reader.expires_at).getTime() : 0
  const needsRefresh = !accessToken || Date.now() + 60_000 >= expiresAt

  if (needsRefresh) {
    try {
      const refreshed = await refreshAccessToken(reader.refresh_token, env)
      accessToken = refreshed.access_token
      const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
      await adminSb
        .from('inbound_reader_tokens')
        .update({ access_token: accessToken, expires_at: newExpiresAt })
        .eq('user_id', reader.user_id)
    } catch (e) {
      await adminSb
        .from('inbound_reader_tokens')
        .update({
          last_polled_at: new Date().toISOString(),
          last_poll_status: 'token_expired',
          last_poll_error: String(e?.message || e).slice(0, 500),
          last_poll_count: 0
        })
        .eq('user_id', reader.user_id)
      result.status = 'token_expired'
      result.errors = 1
      return result
    }
  }

  // 2) Gmail messages.list — 최근 1일 inbox, 페이지네이션
  // 한 페이지(200건) 의 모든 메시지가 이미 처리됐으면 즉시 종료(이전 영역 진입 의미 없음).
  // 한 페이지에 미처리 메시지가 있으면 다음 페이지도 조회 — 트래픽 폭증/재처리 케이스 대응.
  let allMessageIds = []
  let pageToken = null
  try {
    for (let page = 0; page < MAX_PAGES_PER_POLL; page++) {
      const params = new URLSearchParams({
        q: SEARCH_QUERY,
        maxResults: String(MAX_MESSAGES_PER_PAGE)
      })
      if (pageToken) params.set('pageToken', pageToken)
      const res = await fetch(`${GMAIL_API}/messages?${params.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`list ${res.status}: ${text.slice(0, 200)}`)
      }
      const listData = await res.json()
      const pageIds = (listData.messages || []).map((m) => m.id)
      if (pageIds.length === 0) break
      allMessageIds.push(...pageIds)

      // 페이지 전체가 이미 처리된 메시지면 중단(이전 페이지 = 더 오래된 메일이라 의미 없음)
      const { data: processedThisPage } = await adminSb
        .from('inbound_processed_messages')
        .select('message_id')
        .in('message_id', pageIds)
      const processedThisPageCount = processedThisPage?.length || 0
      if (processedThisPageCount === pageIds.length) break

      pageToken = listData.nextPageToken
      if (!pageToken) break
    }
  } catch (e) {
    await adminSb
      .from('inbound_reader_tokens')
      .update({
        last_polled_at: new Date().toISOString(),
        last_poll_status: 'api_error',
        last_poll_error: String(e?.message || e).slice(0, 500),
        last_poll_count: 0
      })
      .eq('user_id', reader.user_id)
    result.status = 'api_error'
    result.errors = 1
    return result
  }

  const messageIds = allMessageIds
  if (messageIds.length === 0) {
    await adminSb
      .from('inbound_reader_tokens')
      .update({
        last_polled_at: new Date().toISOString(),
        last_poll_status: 'ok',
        last_poll_error: null,
        last_poll_count: 0
      })
      .eq('user_id', reader.user_id)
    return result
  }

  // 3) 이미 처리한 메시지 제외
  const { data: processed } = await adminSb
    .from('inbound_processed_messages')
    .select('message_id')
    .in('message_id', messageIds)
  const processedSet = new Set((processed || []).map((p) => p.message_id))
  const unprocessedIds = messageIds.filter((id) => !processedSet.has(id))

  // 4) 각 메시지 처리
  for (const messageId of unprocessedIds) {
    try {
      const r = await processMessage({
        messageId,
        accessToken,
        mappings,
        keywords,
        reader,
        adminSb
      })
      if (r === 'created' || r === 'comment_added') {
        result.processed++
      } else {
        result.skipped++
      }
    } catch (e) {
      result.errors++
      console.error('processMessage error:', messageId, e?.message)
      // 에러도 processed_messages 에 기록 — 같은 메시지 재시도 무한 루프 방지
      await adminSb.from('inbound_processed_messages').upsert({
        message_id: messageId,
        match_reason: 'error',
        received_at: null,
        processed_at: new Date().toISOString()
      })
    }
  }

  // 5) reader 상태 갱신
  await adminSb
    .from('inbound_reader_tokens')
    .update({
      last_polled_at: new Date().toISOString(),
      last_poll_status: result.errors > 0 ? 'partial_error' : 'ok',
      last_poll_error: null,
      last_poll_count: result.processed,
      total_processed_count: (reader.total_processed_count || 0) + result.processed
    })
    .eq('user_id', reader.user_id)

  return result
}

// =============================================================
// 한 메시지 처리 — 매칭 + 케이스 생성/스레드 매칭
// =============================================================
async function processMessage({ messageId, accessToken, mappings, keywords, reader, adminSb }) {
  // 헤더만 먼저 가져옴 (메타데이터 — 빠름)
  const metaRes = await fetch(
    `${GMAIL_API}/messages/${messageId}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  if (!metaRes.ok) throw new Error(`meta ${metaRes.status}`)
  const meta = await metaRes.json()
  const headers = parseHeaders(meta.payload?.headers || [])
  const threadId = meta.threadId

  const fromEmail = extractEmail(headers.from)
  const fromDomain = fromEmail.split('@')[1]?.toLowerCase()
  const toEmails = parseEmailList(headers.to)
  const ccEmails = parseEmailList(headers.cc)
  const allRecipients = [...toEmails, ...ccEmails]
  // RFC 2047 (MIME encoded-word) 디코딩 — 한국 기업메일 서버는 한글 제목을
  // =?UTF-8?B?...?= 로 인코딩해서 보내는데 Gmail API 는 raw 헤더를 그대로 줌.
  // 디코딩 안 하면 keyword.includes() 가 인코딩 문자열에서 탐색해서 무조건 fail.
  const subject = decodeMimeWords(headers.subject || '')
  const fromDisplay = decodeMimeWords(headers.from || '')
  const dateStr = headers.date
  const receivedAt = dateStr ? new Date(dateStr).toISOString() : null

  // ── 매칭 시도 ──────────────────────────────────────────
  let matched = null    // matched mapping
  let matchReason = null

  // 1순위: sender_emails 정확 매칭
  for (const m of mappings) {
    if (m.sender_emails?.some((e) => e.toLowerCase() === fromEmail.toLowerCase())) {
      matched = m
      matchReason = 'sender_email'
      break
    }
  }
  // 2순위: sender_domains 매칭
  if (!matched && fromDomain) {
    for (const m of mappings) {
      if (m.sender_domains?.some((d) => d.toLowerCase() === fromDomain)) {
        matched = m
        matchReason = 'sender_domain'
        break
      }
    }
  }
  // 3순위: to_patterns 매칭 (그룹 메일)
  if (!matched) {
    for (const m of mappings) {
      const hits = m.to_patterns?.some((p) =>
        allRecipients.some((r) => r.toLowerCase() === p.toLowerCase())
      )
      if (hits) {
        matched = m
        matchReason = 'to_pattern'
        break
      }
    }
  }

  // 4순위: 회신 thread 매칭 (Re:/Fwd: + 기존 케이스 매칭)
  let parentCase = null
  if (!matched && /^(Re:|Fwd:|RE:|FW:|회신:|답장:|전달:)/i.test(subject.trim())) {
    if (threadId) {
      const { data: prevMsg } = await adminSb
        .from('inbound_processed_messages')
        .select('case_id, brand')
        .eq('thread_id', threadId)
        .not('case_id', 'is', null)
        .order('processed_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (prevMsg?.case_id) {
        parentCase = prevMsg
        matchReason = 'thread_match'
      }
    }
  }

  // 매칭 실패 → skip 기록 후 종료
  if (!matched && !parentCase) {
    await adminSb.from('inbound_processed_messages').insert({
      message_id: messageId,
      thread_id: threadId,
      match_reason: 'skipped',
      received_at: receivedAt
    })
    return 'skipped'
  }

  // ── 본문 가져오기 (full format) ────────────────────────
  // 키워드 매칭 필요한 경우 + 케이스 본문 채우기 위함
  const needsBody = parentCase || matched?.require_keyword_match || true   // 항상 본문 필요 (케이스 body 용)
  let body = null
  if (needsBody) {
    body = await fetchFullBody(messageId, accessToken)
  }

  // ── 키워드 검사 (옵션 B — require_keyword_match) ─────
  if (matched && matched.require_keyword_match && keywords.length > 0) {
    const haystack = `${subject}\n${body?.text || ''}`.toLowerCase()
    const hit = keywords.some((kw) => haystack.includes(kw.toLowerCase()))
    if (!hit) {
      await adminSb.from('inbound_processed_messages').insert({
        message_id: messageId,
        thread_id: threadId,
        brand: matched.brand,
        matched_mapping_id: matched.id,
        match_reason: 'skipped_no_keyword',
        received_at: receivedAt
      })
      return 'skipped'
    }
  }

  // ── 회신 thread 매칭 → 기존 케이스에 댓글 추가 ────────
  if (parentCase) {
    const commentBody = `📧 **회신 메일 자동 첨부**\n\n` +
      `From: ${fromDisplay || '(unknown)'}\n` +
      `Date: ${headers.date || ''}\n` +
      `Subject: ${subject}\n\n` +
      `---\n\n${body?.text || ''}`
    await adminSb.from('case_comments').insert({
      case_id: parentCase.case_id,
      author_id: reader.user_id,           // reader (skylar) 가 작성한 것으로 기록
      body: commentBody.slice(0, 8000)
    })
    await adminSb.from('inbound_processed_messages').insert({
      message_id: messageId,
      thread_id: threadId,
      case_id: parentCase.case_id,
      brand: parentCase.brand,
      match_reason: 'thread_match',
      received_at: receivedAt
    })
    return 'comment_added'
  }

  // ── 새 케이스 생성 ─────────────────────────────────────
  const assigneeId = matched.default_assignee_id || matched.secondary_assignee_id || reader.user_id
  const caseRow = {
    title: subject || '(제목 없음)',
    brands: [matched.brand],
    platforms: [],
    infringement_types: [],
    post_urls: [],
    brand: matched.brand,
    platform: '',
    platform_other: null,
    post_url: null,
    infringement_type: null,
    // 신고 메일 자동 케이스는 처음부터 조치 필요 → 실무자 우선 처리 신호.
    // sort_priority 는 generated column (status='action_needed' → 0 자동) 이라 직접 박지 않음.
    status: 'action_needed',
    body_html: body?.html || '',
    body_text: body?.text || '',
    gmail_message_id: messageId,
    gmail_thread_url: threadId ? `https://mail.google.com/mail/u/0/#all/${threadId}` : null,
    gmail_subject: subject,
    gmail_from: fromDisplay || '',
    gmail_date: receivedAt,
    gmail_body_text: body?.text || '',
    source: 'inbound_email',
    created_by: assigneeId,    // 자동 생성 케이스의 author = 담당자
    updated_by: assigneeId
  }

  const { data: newCase, error: caseErr } = await adminSb
    .from('cases')
    .insert(caseRow)
    .select()
    .single()
  if (caseErr) throw caseErr

  // 알림 — 담당자에게.
  // notifications 스키마: recipient_id / actor_id / link / payload (mig 020).
  // 옛 컬럼명 (user_id / target_type / target_id / created_by) 으로 박으면
  // 무한 silent fail (catch 가 삼킴). 정정 — Phase 17 push 알림 트리거 작동 위해 필수.
  if (matched.default_assignee_id) {
    await adminSb.from('notifications').insert({
      recipient_id: matched.default_assignee_id,
      type: 'case_inbound_assigned',
      title: `[${matched.brand}] 신규 신고 메일 자동 등록`,
      body: subject.slice(0, 200),
      link: `/cases/${newCase.id}`,
      actor_id: reader.user_id,
      payload: { case_id: newCase.id, brand: matched.brand }
    }).then(() => {}).catch(() => {})
  }

  // 처리 기록
  await adminSb.from('inbound_processed_messages').insert({
    message_id: messageId,
    thread_id: threadId,
    case_id: newCase.id,
    brand: matched.brand,
    matched_mapping_id: matched.id,
    match_reason: matchReason,
    received_at: receivedAt
  })

  return 'created'
}

// =============================================================
// Gmail message full body fetch + 파트 디코딩
// =============================================================
async function fetchFullBody(messageId, accessToken) {
  const res = await fetch(
    `${GMAIL_API}/messages/${messageId}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  if (!res.ok) throw new Error(`full ${res.status}`)
  const data = await res.json()

  const plainParts = []
  const htmlParts = []
  if (data.payload) {
    if (data.payload.mimeType === 'text/plain' && data.payload.body?.data) {
      plainParts.push(decodeBase64Url(data.payload.body.data))
    } else if (data.payload.mimeType === 'text/html' && data.payload.body?.data) {
      htmlParts.push(decodeBase64Url(data.payload.body.data))
    }
    collectPartsByMime(data.payload, 'text/plain', plainParts)
    collectPartsByMime(data.payload, 'text/html', htmlParts)
  }

  const text = plainParts.join('\n\n').trim() || htmlToText(htmlParts.join('\n')).trim() || data.snippet || ''
  return {
    text,
    // Gmail 본문 HTML 은 발신자 메일 클라이언트가 만든 외부 입력 — sanitize 필수.
    // <style> / <script> / on*= 이벤트 / javascript: 모두 제거 (XSS 차단 + 페이지 전역 CSS 오염 차단)
    html: sanitizeExternalHtml(htmlParts.join('\n').trim()),
    snippet: data.snippet || ''
  }
}

/**
 * 외부 HTML (Gmail 메일 본문 등) 의 위험/오염 요소 제거.
 * - <style>, <script>, <link rel="stylesheet"> → 전역 CSS 오염 + XSS
 * - on* 이벤트 핸들러 (onclick 등) → XSS
 * - javascript: URL → XSS
 * - <iframe>, <object>, <embed>, <form> → 외부 콘텐츠 임베드 차단
 *
 * 본문의 인라인 style 속성 (<div style="color:red">) 은 보존 — 본문 영역 한정 영향이라 OK.
 * 표 / 이미지 / 링크 / 서명 / 폰트 색 등 시각 요소는 그대로 유지.
 */
function sanitizeExternalHtml(html) {
  if (!html) return ''
  return html
    // 글로벌 영향 태그 통째 제거
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<link\b[^>]*>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
    .replace(/<embed\b[^>]*>/gi, '')
    .replace(/<form\b[^<]*(?:(?!<\/form>)<[^<]*)*<\/form>/gi, '')
    // on* 이벤트 핸들러 제거 (onclick, onerror, onload 등)
    .replace(/\s+on\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\s+on\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\s+on\w+\s*=\s*[^\s>]+/gi, '')
    // javascript: URL 제거
    .replace(/javascript\s*:/gi, 'about:blank#')
    // <meta http-equiv="refresh" ...> 같은 페이지 redirect 차단
    .replace(/<meta\b[^>]*>/gi, '')
}

function collectPartsByMime(part, mime, out) {
  if (!part) return
  if (part.mimeType === mime && part.body?.data) {
    out.push(decodeBase64Url(part.body.data))
  }
  if (part.parts) {
    for (const sub of part.parts) collectPartsByMime(sub, mime, out)
  }
}

function decodeBase64Url(data) {
  try {
    const s = data.replace(/-/g, '+').replace(/_/g, '/')
    const padded = s + '==='.slice((s.length + 3) % 4)
    const bin = atob(padded)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new TextDecoder('utf-8').decode(bytes)
  } catch {
    return ''
  }
}

function htmlToText(html) {
  if (!html) return ''
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// =============================================================
// RFC 2047 MIME encoded-word 디코딩
// =============================================================
/**
 * 한국 기업 메일 서버 (NHN Works, Naver Works, Daum Smartwork 등) 는 한글 제목을
 * =?UTF-8?B?7Iqk7Yag7Ja0IOyLoOqzoA==?= (Base64) 또는
 * =?UTF-8?Q?=EC=8A=A4=ED=86=A0=EC=96=B4_=EC=8B=A0=EA=B3=A0?= (Quoted-Printable)
 * 형식으로 인코딩해서 보냄. Gmail API 는 raw 헤더를 그대로 주므로 직접 디코딩 필요.
 * - B 인코딩: Base64
 * - Q 인코딩: Quoted-Printable (= 가 escape, _ 는 공백)
 * - 인접한 encoded-word 사이의 공백은 RFC 2047 규정상 제거 (decoded 결과에는 영향 없음)
 */
function decodeMimeWords(str) {
  if (!str) return ''
  if (!str.includes('=?')) return str    // fast path — ASCII subject 는 그대로
  return str
    // 인접한 encoded-word 사이 whitespace 제거 (RFC 2047)
    .replace(/(\?=)\s+(=\?)/g, '$1$2')
    .replace(
      /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
      (match, charset, encoding, text) => {
        try {
          let bytes
          if (encoding.toUpperCase() === 'B') {
            const padded = text + '==='.slice((text.length + 3) % 4)
            const bin = atob(padded)
            bytes = new Uint8Array(bin.length)
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
          } else {
            // Q encoding: _ = space, =XX = hex byte
            const qDecoded = text
              .replace(/_/g, ' ')
              .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) =>
                String.fromCharCode(parseInt(hex, 16))
              )
            bytes = new Uint8Array(qDecoded.length)
            for (let i = 0; i < qDecoded.length; i++) {
              bytes[i] = qDecoded.charCodeAt(i)
            }
          }
          return new TextDecoder(charset.toLowerCase()).decode(bytes)
        } catch {
          return match
        }
      }
    )
}

// =============================================================
// 헤더/이메일 파싱
// =============================================================
function parseHeaders(headers) {
  const out = {}
  for (const h of headers) {
    out[h.name.toLowerCase()] = h.value
  }
  return out
}

function extractEmail(headerValue) {
  if (!headerValue) return ''
  // "James <james@myriadip.com>" → "james@myriadip.com"
  // "james@myriadip.com" → "james@myriadip.com"
  const match = headerValue.match(/<([^>]+)>/)
  if (match) return match[1].trim().toLowerCase()
  const trimmed = headerValue.trim().toLowerCase()
  if (/^[^\s@]+@[^\s@]+$/.test(trimmed)) return trimmed
  return ''
}

function parseEmailList(headerValue) {
  if (!headerValue) return []
  // 쉼표 구분, 각 항목에서 이메일 추출
  return headerValue.split(',')
    .map((p) => extractEmail(p))
    .filter((e) => e)
}

// =============================================================
// Google OAuth refresh_token 으로 access_token 갱신
// =============================================================
async function refreshAccessToken(refreshToken, env) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`refresh ${res.status}: ${txt.slice(0, 200)}`)
  }
  return res.json()
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  })
}
