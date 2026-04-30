/**
 * Cloudflare Pages Function — Launcher heartbeat (30초 주기).
 *
 *   POST /api/launcher-heartbeat
 *   Authorization: Bearer <opaque launcher token>
 *   Body: {
 *     status?: string,        // optional — 트레이 표시용
 *     last_job_info?: string  // optional — 마지막 작업 요약
 *   }
 *
 * 응답: { ok: true }
 *
 * device 가 페어링되지 않은 토큰으로 호출하면 400 (먼저 /api/launcher-poll 으로 페어링 필요).
 */
import { createClient } from '@supabase/supabase-js'

export async function onRequestPost(context) {
  const { request, env } = context
  try {
    const auth = await validateLauncherToken(request, env)
    if (!auth.ok) return json({ error: auth.error }, auth.status)
    const { device_id, adminSb } = auth

    if (!device_id) {
      return json({ error: '디바이스 미페어링 — /api/launcher-poll 먼저 호출' }, 400)
    }

    let body
    try {
      body = await request.json()
    } catch {
      body = {}
    }
    // offline=true 로 호출하면 graceful shutdown — is_online=false 로 박음.
    // 평상시 heartbeat 는 is_online=true 갱신.
    const goingOffline = body?.offline === true

    await adminSb
      .from('launcher_devices')
      .update({
        last_seen_at: new Date().toISOString(),
        is_online: !goingOffline
      })
      .eq('id', device_id)

    return json({ ok: true })
  } catch (e) {
    return json({ error: '서버 오류: ' + (e?.message || String(e)) }, 500)
  }
}

// =============================================================
// 토큰 검증 헬퍼 (poll/heartbeat/job-update/utility-fetch 공유)
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
