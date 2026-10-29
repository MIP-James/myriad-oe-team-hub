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
 * 응답: { run_id, upserted, registered, excluded_hashes: [img_hash...], review_hashes: [img_hash...], sent_hashes,
 *         handled: [{ platform, product_id }] }
 *   excluded_hashes = 실무자가 '제외'한 상품의 사진 지문 → 실행기가 다음 자동 수집에서 같은 사진을 자동 제외.
 *                     같은 사진이 'BPM 전송 완료'·'상세 확인'에도 있으면 빠짐 (전송·상세 확인이 우선).
 *   sent_hashes     = 'BPM 전송 완료' 사진 지문 → 실행기가 누적. 이 사진과 거의 같은(거리 ≤4) 제외 사진은 자동 제외 안 함
 *                     (위 excluded_hashes 정리는 완전히 같은 지문만 — 거리 비교는 CPU 10ms 한도 때문에 실행기 몫, 2026-10-29).
 *   review_hashes   = '상세 확인 필요'로 넘긴 사진 지문 → 다음 자동 수집에서 같은 사진은 빼지 않고 review_match 표시 (mig 041).
 *   handled         = 실무자가 판정한(제외·상세 확인·BPM 전송 완료) 상품번호 → 실행기가 로컬에 누적.
 *                     판정 없이 보관 기간이 지나 지워진 상품은 실행기가 다시 올려 허브에 다시 보이게 함 (2026-10-28).
 *
 *   GET /api/auto-collect-upload  (같은 토큰) → { excluded_hashes, review_hashes, sent_hashes, handled } 만 돌려줌.
 *     실행기가 수집 '시작 전'에 최신 판정을 받아 감 — 업로드 응답만 쓰면 어제 판정이 오늘 등급에 안 들어가고
 *     하루 늦게 반영됨 (2026-10-28).
 *
 * 보관 기간: 처음 본 날로부터 KEEP_DAYS(7일) 지난 미처리('new')·BPM 전송 완료('sent') 상품과 실행 기록은 업로드 때마다 삭제
 *   (Supabase 무료 용량 보호). '제외'·'상세 확인' 행은 사진 지문이 필요하므로 남김.
 *   '전송 완료' 중 같은 사진이 '제외'에도 있는 행도 남김 (전송 우선 판정을 유지하려고).
 *   삭제를 저장보다 먼저 함 → 다시 올라온 미처리 상품이 지워질 옛 행에 덮이지 않고 새 행(처음 본 날 = 오늘)으로 들어감.
 *
 * 노트북(자동 수집 실행기)은 런처 기기 토큰만 가짐 — 관리자 키는 이 함수(service role)에만.
 */
import { createClient } from '@supabase/supabase-js'

const TIERS = new Set(['A', 'B', 'C', 'X'])
const MAX_ITEMS = 20000
const CHUNK = 500
const KEEP_DAYS = 7

export async function onRequestGet(context) {
  try {
    const auth = await validateLauncherToken(context.request, context.env)
    if (!auth.ok) return json({ error: auth.error }, auth.status)
    return json(await judgedPayload(auth.adminSb))
  } catch (e) {
    return json({ error: '서버 오류: ' + (e?.message || String(e)) }, 500)
  }
}

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

    const purged = await purgeOld(adminSb)

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
      for (let i = 0; i < ids.length; i += 200) {
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

    return json({
      run_id: runRow.id,
      upserted: rows.length,
      registered,
      purged,
      ...(await judgedPayload(adminSb))
    })
  } catch (e) {
    return json({ error: '서버 오류: ' + (e?.message || String(e)) }, 500)
  }
}

/** 실무자 판정 → { excluded_hashes, review_hashes, sent_hashes, handled } (GET·POST 공통) */
async function judgedPayload(adminSb) {
  const marked = await fetchHandled(adminSb)
  const hashesOf = (st) => [...new Set(marked.filter((r) => r.status === st && r.img_hash).map((r) => r.img_hash))]
  // 같은 사진을 다른 상품에선 BPM 으로 보냈거나 상세 확인으로 넘겼으면 자동 제외 지문에서 뺌
  // → 위반 사진을 '제외'로 잘못 눌러도 그 사진의 침해 상품이 다음 수집에서 통째로 빠지지 않게 (2026-10-29)
  const keep = new Set([...hashesOf('sent'), ...hashesOf('review')])
  return {
    excluded_hashes: hashesOf('excluded').filter((h) => !keep.has(h)),
    review_hashes: hashesOf('review'),
    sent_hashes: hashesOf('sent'),
    handled: marked.map((r) => ({ platform: r.platform, product_id: r.product_id }))
  }
}

/** 판정된(제외·상세 확인·BPM 전송 완료) 행 전부 — Supabase 는 한 번에 1,000행까지만 주므로 나눠 읽음 */
async function fetchHandled(adminSb) {
  const out = []
  for (let from = 0; from < 200000; from += 1000) {
    const { data, error } = await adminSb
      .from('patrol_items')
      .select('id, platform, product_id, img_hash, status')
      .in('status', ['excluded', 'review', 'sent'])
      .order('id')
      .range(from, from + 999)
    if (error || !data?.length) break
    out.push(...data)
    if (data.length < 1000) break
  }
  return out
}

/** 보관 기간 지난 미처리·전송 완료 상품·실행 기록 삭제 → { items, runs } (실패해도 업로드는 성공 처리) */
async function purgeOld(adminSb) {
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86400000)
  // first_seen 은 한국 날짜 → 한국 시각 기준으로 자른 날짜와 비교
  const cutoffDay = new Date(cutoff.getTime() + 9 * 3600000).toISOString().slice(0, 10)
  const { count: newCount } = await adminSb
    .from('patrol_items')
    .delete({ count: 'exact' })
    .eq('status', 'new')
    .lt('first_seen', cutoffDay)
  const sentCount = await purgeOldSent(adminSb, cutoffDay)
  const items = (newCount ?? 0) + sentCount
  const { count: runs } = await adminSb
    .from('patrol_runs')
    .delete({ count: 'exact' })
    .lt('created_at', cutoff.toISOString())
  return { items, runs: runs ?? 0 }
}

/**
 * 보관 기간 지난 'BPM 전송 완료' 삭제 — 단, 같은 사진이 '제외'에도 있는 행은 남김.
 * 이 행이 있어야 judgedPayload 가 그 사진을 자동 제외 지문에서 계속 빼 줌 (지우면 7일 뒤 다시 자동 제외됨, 2026-10-29).
 */
async function purgeOldSent(adminSb, cutoffDay) {
  const { data: old, error } = await adminSb
    .from('patrol_items')
    .select('id, img_hash')
    .eq('status', 'sent')
    .lt('first_seen', cutoffDay)
    .limit(5000)
  if (error || !old?.length) return 0
  const hashes = [...new Set(old.map((r) => r.img_hash).filter(Boolean))]
  const guarded = new Set()
  for (let i = 0; i < hashes.length; i += 200) { // 주소 길이 제한 → 200개씩
    const { data } = await adminSb
      .from('patrol_items')
      .select('img_hash')
      .eq('status', 'excluded')
      .in('img_hash', hashes.slice(i, i + 200))
    for (const r of data || []) guarded.add(r.img_hash)
  }
  const ids = old.filter((r) => !guarded.has(r.img_hash)).map((r) => r.id)
  let n = 0
  for (let i = 0; i < ids.length; i += 200) {
    const { count } = await adminSb
      .from('patrol_items')
      .delete({ count: 'exact' })
      .in('id', ids.slice(i, i + 200))
    n += count ?? 0
  }
  return n
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
