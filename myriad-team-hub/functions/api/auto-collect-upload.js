/**
 * Cloudflare Pages Function — 자동 수집 결과 업로드 (mig 040).
 *
 *   POST /api/auto-collect-upload
 *   Authorization: Bearer <opaque launcher token>
 *   Body: {
 *     run: { started_at, finished_at, counts: {A,B,C,X,...}, summary: [...] },
 *     items: [{ platform, product_id, url, title, price, seller, image, img_hash,
 *               keyword, model_type, product_type, tier, score, reasons, img_dist, review_match }],
 *     registered: [{ platform, product_id }]   // 예전에 올린 것 중 BPM 에 등록된 것
 *   }
 *
 * 응답: { run_id, upserted, registered, excluded_hashes: [img_hash...], review_hashes: [img_hash...] }
 *   excluded_hashes = 실무자가 '제외'한 상품의 사진 지문 → 실행기가 다음 자동 수집에서 같은 사진을 자동 제외.
 *   review_hashes   = '상세 확인 필요'로 넘긴 사진 지문 → 다음 자동 수집에서 같은 사진은 빼지 않고 review_match 표시 (mig 041).
 *
 * 보관 기간: 처음 본 날로부터 KEEP_DAYS(7일) 지난 미처리('new') 상품과 실행 기록은 업로드 때마다 삭제
 *   (Supabase 무료 용량 보호). '제외'·'상세 확인' 행은 사진 지문이 필요하므로 남김.
 *
 * 노트북(자동 수집 실행기)은 런처 기기 토큰만 가짐 — 관리자 키는 이 함수(service role)에만.
 */
import { createClient } from '@supabase/supabase-js'

const TIERS = new Set(['A', 'B', 'C', 'X'])
const MAX_ITEMS = 20000
const CHUNK = 500
const KEEP_DAYS = 7

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

    const run = body?.run || {}
    const { data: runRow, error: runErr } = await adminSb
      .from('patrol_runs')
      .insert({
        started_at: isoOrNull(run.started_at),
        finished_at: isoOrNull(run.finished_at),
        uploaded_by: auth.user_id,
        device_id: auth.device_id,
        counts: run.counts ?? null,
        summary: Array.isArray(run.summary) ? run.summary.slice(0, 2000) : null
      })
      .select('id')
      .single()
    if (runErr) return json({ error: 'patrol_runs 기록 실패: ' + runErr.message }, 500)

    const items = (Array.isArray(body?.items) ? body.items : [])
      .slice(0, MAX_ITEMS)
      .map((it) => clean(it, runRow.id))
      .filter(Boolean)

    // 같은 (플랫폼, 상품번호)가 한 번에 두 번 오면 upsert 가 실패 → 마지막 것만
    const uniq = new Map(items.map((it) => [it.platform + '\u0000' + it.product_id, it]))
    const rows = [...uniq.values()]
    for (let i = 0; i < rows.length; i += CHUNK) {
      // status / first_seen / excluded_* 는 보내지 않음 → 이미 있던 행의 제외 처리·처음 본 날 유지
      const { error } = await adminSb
        .from('patrol_items')
        .upsert(rows.slice(i, i + CHUNK), { onConflict: 'platform,product_id' })
      if (error) return json({ error: 'patrol_items 저장 실패: ' + error.message, run_id: runRow.id }, 500)
    }

    // BPM 에 등록된 것 표시 (BPM 동기화 결과를 실행기가 알려 줌)
    let registered = 0
    const byPlatform = {}
    for (const r of Array.isArray(body?.registered) ? body.registered.slice(0, 50000) : []) {
      const p = str(r?.platform, 20), id = str(r?.product_id, 64)
      if (p && id) (byPlatform[p] ||= []).push(id)
    }
    for (const [platform, ids] of Object.entries(byPlatform)) {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const { data, error } = await adminSb
          .from('patrol_items')
          .update({ bpm_registered: true, bpm_checked_at: new Date().toISOString() })
          .eq('platform', platform)
          .eq('bpm_registered', false)
          .in('product_id', ids.slice(i, i + CHUNK))
          .select('id')
        if (!error) registered += data?.length || 0
      }
    }

    const purged = await purgeOld(adminSb)

    const { data: marked } = await adminSb
      .from('patrol_items')
      .select('img_hash, status')
      .in('status', ['excluded', 'review'])
      .not('img_hash', 'is', null)
      .limit(40000)
    const hashesOf = (st) => [...new Set((marked ?? []).filter((r) => r.status === st).map((r) => r.img_hash))]

    return json({
      run_id: runRow.id,
      upserted: rows.length,
      registered,
      purged,
      excluded_hashes: hashesOf('excluded'),
      review_hashes: hashesOf('review')
    })
  } catch (e) {
    return json({ error: '서버 오류: ' + (e?.message || String(e)) }, 500)
  }
}

/** 보관 기간 지난 미처리 상품·실행 기록 삭제 → { items, runs } (실패해도 업로드는 성공 처리) */
async function purgeOld(adminSb) {
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86400000)
  // first_seen 은 한국 날짜 → 한국 시각 기준으로 자른 날짜와 비교
  const cutoffDay = new Date(cutoff.getTime() + 9 * 3600000).toISOString().slice(0, 10)
  const { count: items } = await adminSb
    .from('patrol_items')
    .delete({ count: 'exact' })
    .eq('status', 'new')
    .lt('first_seen', cutoffDay)
  const { count: runs } = await adminSb
    .from('patrol_runs')
    .delete({ count: 'exact' })
    .lt('created_at', cutoff.toISOString())
  return { items: items ?? 0, runs: runs ?? 0 }
}

function clean(it, runId) {
  const platform = str(it?.platform, 20)
  const product_id = str(it?.product_id, 64)
  const url = str(it?.url, 1000)
  const tier = TIERS.has(it?.tier) ? it.tier : null
  if (!platform || !product_id || !url || !tier) return null
  return {
    platform,
    product_id,
    url,
    title: str(it?.title, 500),
    price: Number.isFinite(+it?.price) && it?.price !== null && it?.price !== '' ? Math.round(+it.price) : null,
    seller: str(it?.seller, 200),
    image: str(it?.image, 1000),
    img_hash: str(it?.img_hash, 40),
    keyword: str(it?.keyword, 100),
    model_type: str(it?.model_type, 100),
    product_type: str(it?.product_type, 100),
    tier,
    score: Number.isFinite(+it?.score) ? Math.round(+it.score) : null,
    reasons: str(it?.reasons, 1000),
    img_dist: Number.isFinite(+it?.img_dist) && it?.img_dist !== null ? Math.round(+it.img_dist) : null,
    review_match: it?.review_match === true,
    last_run_id: runId
  }
}

function str(v, max) {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s ? s.slice(0, max) : null
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
