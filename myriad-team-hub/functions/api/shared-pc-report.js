/**
 * Cloudflare Pages Function — 공용 PC 세션 상태 보고 (Phase 24).
 *
 *   POST /api/shared-pc-report
 *   Authorization: Bearer <opaque launcher token>
 *   Body: {
 *     hostname: string,          // 컴퓨터 이름 (shared_pcs.hostname 과 매칭, 대소문자 무시)
 *     lan_ip?: string,           // 사내 IP
 *     sessions: [{ win_user, state, via, connected_at, disconnected_at, logon_at }],
 *     agent_version?: string
 *   }
 *
 * 응답: { registered: bool }
 *   registered=false → 허브에 등록 안 된 PC. 에이전트는 10분마다 재확인만 함.
 *
 * 호출 주기: 공용 PC 에이전트가 세션 변경 시 + 15분 keepalive 만 호출
 * (30초 확인은 PC 로컬에서만 → Cloudflare 요청 거의 없음).
 */
import { createClient } from '@supabase/supabase-js'

const MAX_SESSIONS = 20
const STATES = new Set(['active', 'disconnected'])
const VIAS = new Set(['rdp', 'console'])

export async function onRequestPost(context) {
  const { request, env } = context
  try {
    const auth = await validateLauncherToken(request, env)
    if (!auth.ok) return json({ error: auth.error }, auth.status)
    const { adminSb } = auth

    let body
    try {
      body = await request.json()
    } catch {
      return json({ error: 'JSON 파싱 실패' }, 400)
    }
    const hostname = (body?.hostname || '').toString().trim().toUpperCase().slice(0, 64)
    if (!hostname) return json({ error: 'hostname 누락' }, 400)

    const { data: pc, error: pcErr } = await adminSb
      .from('shared_pcs')
      .select('id')
      .eq('hostname', hostname)
      .eq('is_active', true)
      .maybeSingle()
    if (pcErr) return json({ error: 'shared_pcs 조회 실패: ' + pcErr.message }, 500)
    if (!pc) return json({ registered: false })

    const sessions = (Array.isArray(body?.sessions) ? body.sessions : [])
      .slice(0, MAX_SESSIONS)
      .map((s) => ({
        win_user: (s?.win_user || '').toString().slice(0, 64),
        state: STATES.has(s?.state) ? s.state : 'disconnected',
        via: VIAS.has(s?.via) ? s.via : 'rdp',
        connected_at: isoOrNull(s?.connected_at),
        disconnected_at: isoOrNull(s?.disconnected_at),
        logon_at: isoOrNull(s?.logon_at)
      }))
      .filter((s) => s.win_user)

    const lanIp = (body?.lan_ip || '').toString().trim()
    const { error: upErr } = await adminSb
      .from('shared_pcs')
      .update({
        sessions,
        lan_ip: /^[0-9a-fA-F.:]{3,45}$/.test(lanIp) ? lanIp : null,
        agent_version: (body?.agent_version || '').toString().slice(0, 30) || null,
        reported_at: new Date().toISOString()
      })
      .eq('id', pc.id)
    if (upErr) return json({ error: 'shared_pcs 갱신 실패: ' + upErr.message }, 500)

    return json({ registered: true })
  } catch (e) {
    return json({ error: '서버 오류: ' + (e?.message || String(e)) }, 500)
  }
}

function isoOrNull(v) {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
// =============================================================
// 토큰 검증 헬퍼 — 모든 Bearer 엔드포인트 공통 (각 파일에 복붙)
// =============================================================
async function validateLauncherToken(request, env) {
  const authHeader = request.headers.get('Authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return { ok: false, status: 401, error: '토큰 누락' }
  if (!token.startsWith('myrlnch_')) {
    return { ok: false, status: 401, error: '잘못된 토큰 형식' }
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, status: 500, error: 'SUPABASE_SERVICE_ROLE_KEY 누락' }
  }
  const adminSb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  })
  const tokenHash = await sha256Hex(token)
  const { data, error } = await adminSb
    .from('launcher_device_tokens')
    .select('id, user_id, device_id, revoked_at')
    .eq('token_hash', tokenHash)
    .maybeSingle()
  if (error) {
    return { ok: false, status: 500, error: 'token 조회 실패: ' + error.message }
  }
  if (!data) {
    return { ok: false, status: 401, error: '토큰을 찾을 수 없음' }
  }
  if (data.revoked_at) {
    return { ok: false, status: 401, error: '토큰이 회수됨 — 재발급 필요' }
  }
  // last_used_at 업데이트는 fire-and-forget (실패해도 요청 처리에 영향 없음)
  adminSb
    .from('launcher_device_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)
    .then(() => {})
  return {
    ok: true,
    user_id: data.user_id,
    device_id: data.device_id,
    token_id: data.id,
    adminSb
  }
}

async function sha256Hex(str) {
  const data = new TextEncoder().encode(str)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  })
}
