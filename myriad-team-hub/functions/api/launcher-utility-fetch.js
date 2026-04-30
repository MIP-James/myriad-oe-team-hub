/**
 * Cloudflare Pages Function — Launcher 가 유틸 메타 조회 (자동 설치용).
 *
 *   POST /api/launcher-utility-fetch
 *   Authorization: Bearer <opaque launcher token>
 *   Body: { slug: string }
 *
 * 응답: { utility: { slug, name, download_url, current_version, entry_exe, utility_type } | null }
 */
import { createClient } from '@supabase/supabase-js'

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
      return json({ error: 'JSON body 파싱 실패' }, 400)
    }
    const slug = (body?.slug || '').toString().trim()
    if (!slug) return json({ error: 'slug 필수' }, 400)

    const { data, error } = await adminSb
      .from('utilities')
      .select('slug, name, download_url, current_version, entry_exe, utility_type')
      .eq('slug', slug)
      .maybeSingle()
    if (error) return json({ error: 'utility 조회 실패: ' + error.message }, 500)
    return json({ utility: data || null })
  } catch (e) {
    return json({ error: '서버 오류: ' + (e?.message || String(e)) }, 500)
  }
}

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
  if (error) return { ok: false, status: 500, error: 'token 조회 실패: ' + error.message }
  if (!data) return { ok: false, status: 401, error: '토큰을 찾을 수 없음' }
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
