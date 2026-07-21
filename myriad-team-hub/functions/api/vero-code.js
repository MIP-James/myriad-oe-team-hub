/**
 * Cloudflare Pages Function — eBay VeRO 포털 인증코드 조회 (온디맨드).
 *
 *   GET /api/vero-code?after=<ISO8601>
 *
 * - 팀허브에 로그인한 사용자면 누구나 호출 가능 (VeRO 계정 팀 공유가 요청 의도).
 * - 서버가 James 님(VeRO reader, purpose='vero') Gmail 을 대신 읽어
 *   noreply-vero@ebay.com 이 보낸 최신 인증코드 메일에서 8자리 코드를 추출.
 * - `after` = 이 사용자가 "VeRO 로그인 시작"을 누른 시각(락 started_at).
 *   그 시각 이후 도착한 코드만 조회 → 과거 코드/이전 사용자 코드 배제.
 *   (클럭 스큐 대비 30초 버퍼)
 * - 어떤 것도 저장하지 않음(코드 자체 미보관). 상시 폴링 없음 → 한도 무영향.
 *
 * 환경변수:
 *   - SUPABASE_URL / SUPABASE_ANON_KEY (JWT 검증)
 *   - SUPABASE_SERVICE_ROLE_KEY (reader 토큰 조회/갱신)
 *   - GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET (refresh_token 갱신)
 */
import { createClient } from '@supabase/supabase-js'

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me'
const VERO_SENDER = 'noreply-vero@ebay.com'
// 코드 만료(10분) — 카운트다운 표시용
const CODE_TTL_MS = 10 * 60 * 1000
// 클럭 스큐 버퍼 (started_at 이 브라우저 시각이라 약간의 오차 허용)
const AFTER_BUFFER_MS = 30 * 1000

export async function onRequestGet(context) {
  const { request, env } = context
  try {
    // ── 인증 (로그인한 팀원 누구나) ──────────────────────────
    const authHeader = request.headers.get('Authorization') || ''
    const jwt = authHeader.replace(/^Bearer\s+/i, '')
    if (!jwt) return json({ error: '로그인이 필요합니다.' }, 401)

    const sb = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false }
    })
    const { data: { user }, error: authErr } = await sb.auth.getUser()
    if (authErr || !user) return json({ error: '인증 실패' }, 401)

    if (!env.SUPABASE_SERVICE_ROLE_KEY) {
      return json({ error: 'SUPABASE_SERVICE_ROLE_KEY 누락' }, 500)
    }
    const adminSb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    })

    // ── VeRO reader (James) 조회 ─────────────────────────────
    const { data: reader } = await adminSb
      .from('inbound_reader_tokens')
      .select('*')
      .eq('purpose', 'vero')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!reader) {
      // 아직 James 님 메일함 연동 전 → 프론트가 "연동 필요" 안내
      return json({ connected: false })
    }

    // ── access_token 갱신 (만료/임박 시) ─────────────────────
    let accessToken = reader.access_token
    const expiresAt = reader.expires_at ? new Date(reader.expires_at).getTime() : 0
    if (!accessToken || Date.now() + 60_000 >= expiresAt) {
      try {
        const refreshed = await refreshAccessToken(reader.refresh_token, env)
        accessToken = refreshed.access_token
        await adminSb
          .from('inbound_reader_tokens')
          .update({
            access_token: accessToken,
            expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
          })
          .eq('user_id', reader.user_id)
      } catch (e) {
        return json({
          connected: true,
          error: 'token_expired',
          detail: 'James 님 Gmail 토큰 갱신 실패 — 재연동이 필요할 수 있습니다.'
        }, 200)
      }
    }

    // ── Gmail 검색 쿼리 구성 ─────────────────────────────────
    const afterParam = new URL(request.url).searchParams.get('after')
    let afterEpoch = null
    if (afterParam) {
      const t = Date.parse(afterParam)
      if (!Number.isNaN(t)) afterEpoch = Math.floor((t - AFTER_BUFFER_MS) / 1000)
    }
    // from + 제목 + 최근 1시간 안전망(+ after 가 있으면 그 시각 이후)
    let q = `from:${VERO_SENDER} subject:"verification code for the VeRO Portal" newer_than:1h`
    if (afterEpoch) q += ` after:${afterEpoch}`

    const listRes = await fetch(
      `${GMAIL_API}/messages?${new URLSearchParams({ q, maxResults: '5' })}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    if (!listRes.ok) {
      const text = await listRes.text().catch(() => '')
      return json({ connected: true, error: 'gmail_list', detail: `${listRes.status}: ${text.slice(0, 150)}` }, 200)
    }
    const listData = await listRes.json()
    const messages = listData.messages || []
    if (messages.length === 0) {
      // 아직 코드 메일 도착 전
      return json({ connected: true, code: null })
    }

    // Gmail list 는 최신순 → 첫 번째가 가장 최근 코드
    const msgId = messages[0].id
    const fullRes = await fetch(
      `${GMAIL_API}/messages/${msgId}?format=full`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    if (!fullRes.ok) {
      return json({ connected: true, error: 'gmail_get', detail: String(fullRes.status) }, 200)
    }
    const full = await fullRes.json()

    const bodyText = extractPlainText(full)
    const code = extractVeroCode(bodyText) || extractVeroCode(full.snippet || '')
    const receivedAt = full.internalDate
      ? new Date(Number(full.internalDate)).toISOString()
      : null

    if (!code) {
      return json({ connected: true, code: null, detail: '코드 형식을 인식하지 못했습니다.' })
    }

    return json({
      connected: true,
      code,
      receivedAt,
      expiresAt: receivedAt ? new Date(new Date(receivedAt).getTime() + CODE_TTL_MS).toISOString() : null,
      messageId: msgId
    })
  } catch (e) {
    return json({ error: '서버 오류: ' + (e?.message || String(e)) }, 500)
  }
}

// "Verification code: 14837348" → "14837348"
function extractVeroCode(text) {
  if (!text) return null
  const m = text.match(/verification code[:\s]*\**\s*<?b?>?\s*(\d{4,10})/i)
  if (m) return m[1]
  // 폴백 — "code" 근처 4~10자리 숫자
  const m2 = text.match(/code[^\d]{0,25}(\d{4,10})/i)
  return m2 ? m2[1] : null
}

// message.payload 트리에서 text/plain 우선 추출, 없으면 html→text
function extractPlainText(msg) {
  const plain = []
  const html = []
  collect(msg.payload, plain, html)
  if (plain.length) return plain.join('\n')
  if (html.length) return htmlToText(html.join('\n'))
  return msg.snippet || ''
}

function collect(part, plain, html) {
  if (!part) return
  if (part.mimeType === 'text/plain' && part.body?.data) plain.push(decodeB64Url(part.body.data))
  else if (part.mimeType === 'text/html' && part.body?.data) html.push(decodeB64Url(part.body.data))
  if (part.parts) for (const p of part.parts) collect(p, plain, html)
}

function decodeB64Url(data) {
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
  return (html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

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
