/**
 * Cloudflare Pages Function — Launcher 작업 상태/출력 갱신.
 *
 *   POST /api/launcher-job-update
 *   Authorization: Bearer <opaque launcher token>
 *   Body: {
 *     job_id: uuid,           // 필수
 *     status?: string,        // pending|dispatched|running|done|error|cancelled
 *     output?: string,        // 누적 출력 (최대 8000 자, 클라이언트가 truncate)
 *     output_append?: string, // 짧은 한 줄 — 서버에서 기존 output 에 append
 *     error_message?: string,
 *     exit_code?: int,
 *     dispatched_at?: timestamptz,
 *     started_at?: timestamptz,
 *     finished_at?: timestamptz
 *   }
 *
 * 응답: { ok: true }
 *
 * 보안: job 의 user_id 가 토큰의 user_id 와 일치해야 함 (남의 job 변경 차단).
 */
import { createClient } from '@supabase/supabase-js'

const MAX_OUTPUT_CHARS = 8000

export async function onRequestPost(context) {
  const { request, env } = context
  try {
    const auth = await validateLauncherToken(request, env)
    if (!auth.ok) return json({ error: auth.error }, auth.status)
    const { user_id, device_id, adminSb } = auth

    let body
    try {
      body = await request.json()
    } catch {
      return json({ error: 'JSON body 파싱 실패' }, 400)
    }

    const jobId = body?.job_id
    if (!jobId || typeof jobId !== 'string') {
      return json({ error: 'job_id 필수' }, 400)
    }

    // job 소유 검증
    const { data: existing, error: fetchErr } = await adminSb
      .from('launcher_jobs')
      .select('id, user_id, output, status')
      .eq('id', jobId)
      .maybeSingle()
    if (fetchErr) {
      return json({ error: 'job 조회 실패: ' + fetchErr.message }, 500)
    }
    if (!existing) {
      return json({ error: 'job 을 찾을 수 없음' }, 404)
    }
    if (existing.user_id !== user_id) {
      return json({ error: '권한 없음' }, 403)
    }

    const updates = {}
    if (typeof body.status === 'string') updates.status = body.status
    if (typeof body.error_message === 'string') updates.error_message = body.error_message
    if (typeof body.exit_code === 'number') updates.exit_code = body.exit_code
    if (typeof body.dispatched_at === 'string') updates.dispatched_at = body.dispatched_at
    if (typeof body.started_at === 'string') updates.started_at = body.started_at
    if (typeof body.finished_at === 'string') updates.finished_at = body.finished_at

    // dispatched 마킹 시 device_id 도 같이 박기 (기존 RLS 직접 접근 시 launcher 가 했던 것)
    if (body.status === 'dispatched' && device_id) {
      updates.device_id = device_id
    }

    // output 처리:
    //   - body.output 이 있으면 통째 교체 (마지막 단계 — done/error 시)
    //   - body.output_append 가 있으면 기존 output 에 append (진행 중 push)
    if (typeof body.output === 'string') {
      updates.output = body.output.slice(-MAX_OUTPUT_CHARS)
    } else if (typeof body.output_append === 'string' && body.output_append.length > 0) {
      const ts = new Date().toLocaleTimeString('ko-KR', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
      const line = `[${ts}] ${body.output_append}`
      const existingOutput = existing.output || ''
      const combined = (existingOutput + (existingOutput ? '\n' : '') + line).slice(-MAX_OUTPUT_CHARS)
      updates.output = combined
    }

    if (Object.keys(updates).length === 0) {
      return json({ ok: true, noop: true })
    }

    const { error: upErr } = await adminSb
      .from('launcher_jobs')
      .update(updates)
      .eq('id', jobId)
    if (upErr) {
      return json({ error: 'job UPDATE 실패: ' + upErr.message }, 500)
    }

    return json({ ok: true })
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
