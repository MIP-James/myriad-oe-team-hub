/**
 * Cloudflare Pages Function — Launcher 폴링 (job fetch + 최초 pairing).
 *
 *   POST /api/launcher-poll
 *   Authorization: Bearer <opaque launcher token>
 *   Body: {
 *     device_name?: string,        // 첫 호출 시 device 생성/이름 갱신
 *     platform?: string,           // win32 / darwin / linux
 *     launcher_version?: string    // 예: "2026-04-30"
 *   }
 *
 * 응답:
 *   { device_id: uuid, jobs: [...launcher_jobs row], paired_now: bool }
 *
 * 흐름:
 *   1. 토큰 hash 검증 → user_id 추출
 *   2. 토큰에 device_id 가 NULL 이면 launcher_devices INSERT 후 토큰에 link
 *      (= 최초 1회 pairing)
 *   3. device 의 last_seen / is_online / version / platform / name 업데이트
 *   4. 해당 user 의 pending job 1건 반환
 */
import { createClient } from '@supabase/supabase-js'

export async function onRequestPost(context) {
  const { request, env } = context
  try {
    const auth = await validateLauncherToken(request, env)
    if (!auth.ok) return json({ error: auth.error }, auth.status)
    const { user_id, token_id, device_id, adminSb } = auth

    let body
    try {
      body = await request.json()
    } catch {
      body = {}
    }
    const deviceName = (body?.device_name || '').toString().trim().slice(0, 60)
    const platform = (body?.platform || '').toString().trim().slice(0, 20)
    const launcherVersion = (body?.launcher_version || '').toString().trim().slice(0, 30)

    let activeDeviceId = device_id
    let pairedNow = false

    // ─ 최초 pairing — device row 생성 + 토큰에 device_id link ─────────
    if (!activeDeviceId) {
      const { data: dev, error: devErr } = await adminSb
        .from('launcher_devices')
        .insert({
          user_id,
          name: deviceName || 'Unnamed Device',
          platform: platform || null,
          launcher_version: launcherVersion || null,
          last_seen_at: new Date().toISOString(),
          is_online: true
        })
        .select('id')
        .single()
      if (devErr) {
        return json({ error: 'device 등록 실패: ' + devErr.message }, 500)
      }
      activeDeviceId = dev.id
      await adminSb
        .from('launcher_device_tokens')
        .update({ device_id: activeDeviceId })
        .eq('id', token_id)
      pairedNow = true
    } else {
      // 기존 device — heartbeat 성격 업데이트
      const updates = {
        last_seen_at: new Date().toISOString(),
        is_online: true
      }
      if (deviceName) updates.name = deviceName
      if (platform) updates.platform = platform
      if (launcherVersion) updates.launcher_version = launcherVersion
      await adminSb
        .from('launcher_devices')
        .update(updates)
        .eq('id', activeDeviceId)
    }

    // ─ pending job 1건 fetch ─────────────────────────────────────────
    const { data: jobs } = await adminSb
      .from('launcher_jobs')
      .select('*')
      .eq('user_id', user_id)
      .eq('status', 'pending')
      .order('requested_at', { ascending: true })
      .limit(1)

    return json({
      device_id: activeDeviceId,
      paired_now: pairedNow,
      jobs: jobs || []
    })
  } catch (e) {
    return json({ error: '서버 오류: ' + (e?.message || String(e)) }, 500)
  }
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
