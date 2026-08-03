/**
 * Cloudflare Pages Function — 크롬 확장이 화이트리스트를 내려받는 엔드포인트.
 *
 *   GET /api/whitelist-fetch
 *   Authorization: Bearer myrwl_<64hex>
 *
 * 응답:
 *   { version, count, clients: [{id,name}], sellers: [{...매칭에 필요한 필드만}] }
 *
 * 설계 메모:
 *  - 인증을 붙인 이유: 화이트리스트는 고객사의 "공식 유통망" 정보라 사내 자료다.
 *    무인증 공개 엔드포인트로 두면 URL 만 알면 누구나 읽을 수 있어서 안 됨.
 *  - 전량을 한 번에 내려줌 (수백~수천 행 = 수백 KB). 확장이 chrome.storage 에 캐시하고
 *    주기적으로만 갱신 → 요청 수가 매우 적어 Cloudflare 한도에 영향 없음 (gotcha #38).
 *  - CORS: 확장의 service worker 에서 호출하므로 Origin 이 chrome-extension:// 이다.
 *    토큰 인증이 있으니 ACAO * 로 열어도 안전.
 */
import { createClient } from '@supabase/supabase-js'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type'
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function onRequestGet(context) {
  const { request, env } = context
  try {
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim()
    if (!token) return json({ error: '토큰이 없습니다. 확장 설정에서 토큰을 입력하세요.' }, 401)

    if (!env.SUPABASE_SERVICE_ROLE_KEY) {
      return json({ error: 'SUPABASE_SERVICE_ROLE_KEY 누락' }, 500)
    }
    const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    })

    const tokenHash = await sha256Hex(token)
    const { data: tok, error: tokErr } = await sb
      .from('whitelist_ext_tokens')
      .select('id, user_id, revoked_at')
      .eq('token_hash', tokenHash)
      .is('revoked_at', null)
      .maybeSingle()
    if (tokErr) return json({ error: '토큰 조회 실패: ' + tokErr.message }, 500)
    if (!tok) return json({ error: '토큰이 유효하지 않습니다. 팀 허브에서 재발급하세요.' }, 401)

    // 사용 기록 — 누가/언제 받아갔는지 감사 추적. 실패해도 본 응답은 계속 진행.
    sb.from('whitelist_ext_tokens')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', tok.id)
      .then(() => {}, () => {})

    const { data: clients, error: cErr } = await sb
      .from('whitelist_clients')
      .select('id, name')
      .eq('is_active', true)
    if (cErr) return json({ error: '고객사 조회 실패: ' + cErr.message }, 500)

    const activeIds = (clients ?? []).map((c) => c.id)
    let sellers = []
    if (activeIds.length) {
      // 매칭에 쓰는 컬럼만 — 응답 크기를 줄이고 불필요한 내부 메모 노출도 막는다.
      const { data, error: sErr } = await sb
        .from('whitelist_sellers')
        .select('id, client_id, store_name, aliases, urls, amazon_seller_name, amazon_seller_id, region')
        .in('client_id', activeIds)
        .eq('is_active', true)
      if (sErr) return json({ error: '셀러 조회 실패: ' + sErr.message }, 500)
      sellers = data ?? []
    }

    const clientNames = {}
    for (const c of clients ?? []) clientNames[c.id] = c.name

    return json({
      version: new Date().toISOString(),
      count: sellers.length,
      clients: clientNames,
      sellers
    })
  } catch (e) {
    return json({ error: '서버 오류: ' + (e?.message || String(e)) }, 500)
  }
}

async function sha256Hex(str) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS }
  })
}
