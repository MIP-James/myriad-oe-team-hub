/**
 * Cloudflare Pages Function — 다나와 최저가 확인 + 구글 챗 알림 (Phase 25, mig 043).
 *
 *   POST /api/danawa-check
 *     { productId, source? }   → 상품 1개 확인 (최저가 판매자 바뀌면 챗 알림)
 *     { mode: 'summary' }      → 감시 중 상품 전체 현황 요약을 챗으로 (매일 09:00 KST)
 *     { mode: 'test' }         → 웹훅 연결 시험 메시지 (관리자)
 *
 * 호출:
 *   1. Supabase pg_cron (trigger_danawa_check) — Authorization: INBOUND_CRON_SECRET (mig 029 값 재사용)
 *   2. 허브 탭의 '지금 확인' — Authorization: Bearer <로그인 JWT>
 *
 * 환경변수: SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY / INBOUND_CRON_SECRET
 */
import { createClient } from '@supabase/supabase-js'
import { checkDanawaProduct, enrichListing } from './_lib/danawa.js'
import { postChat, buildChangeMessage, buildSummaryMessage } from './_lib/danawaChat.js'

const KEEP_DAYS = 90

export async function onRequestPost(context) {
  const { request, env } = context
  try {
    // ── 인증 ──────────────────────────────────────────────
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim()
    if (!token) return json({ error: '인증 토큰 누락' }, 401)
    const isCron = !!env.INBOUND_CRON_SECRET && token === env.INBOUND_CRON_SECRET
    let user = null
    let isAdmin = false
    if (!isCron) {
      const sb = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false }
      })
      const { data, error } = await sb.auth.getUser()
      if (error || !data?.user) return json({ error: '인증 실패' }, 401)
      user = data.user
      const { data: profile } = await sb.from('profiles').select('role').eq('id', user.id).maybeSingle()
      isAdmin = profile?.role === 'admin'
    }

    if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY 누락' }, 500)
    const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    })

    const body = await request.json().catch(() => ({}))
    const hubUrl = new URL(request.url).origin + '/danawa'

    const { data: settings } = await admin.from('danawa_settings').select('*').eq('id', 1).maybeSingle()
    const webhook = settings?.webhook_url || null

    // ── 웹훅 시험 ─────────────────────────────────────────
    if (body.mode === 'test') {
      if (!isCron && !isAdmin) return json({ error: '관리자 권한 필요' }, 403)
      if (!webhook) return json({ error: '웹훅 주소가 아직 등록되지 않았습니다.' }, 400)
      await postChat(webhook, {
        text: '✅ 다나와 최저가 모니터링 봇이 연결되었습니다. 최저가 판매자가 바뀌면 이 스페이스로 알려드립니다.'
      })
      return json({ ok: true })
    }

    // ── 판매자 조회 점검 (관리자/예약 전용) — 서버(Cloudflare)에서 몰별 조회가 되는지 확인용 ──
    //   { mode: 'probe', rows: [{ bridgeUrl, mallCode, mallName, danawaSeller? }] }  (최대 8줄)
    if (body.mode === 'probe') {
      if (!isCron && !isAdmin) return json({ error: '관리자 권한 필요' }, 403)
      const rows = (Array.isArray(body.rows) ? body.rows : []).slice(0, 8)
      const results = []
      for (const r of rows) {
        const linkPcode = (String(r.bridgeUrl || '').match(/[?&]link_pcode=([^&]+)/) || [])[1] || ''
        const t0 = Date.now()
        const out = await enrichListing({
          key: `${r.mallCode}:${linkPcode}`,
          mallCode: r.mallCode,
          mallName: r.mallName,
          isMarketSeller: !!r.danawaSeller,
          danawaSeller: r.danawaSeller || null,
          bridgeUrl: r.bridgeUrl,
          linkPcode
        })
        results.push({
          mallCode: r.mallCode,
          mallName: r.mallName,
          ms: Date.now() - t0,
          sellerStatus: out.sellerStatus,
          sellerVia: out.sellerVia || null,
          sellerError: out.sellerError || null,
          seller: out.seller,
          productUrl: out.productUrl
        })
      }
      return json({ ok: true, results })
    }

    // ── 하루 요약 ─────────────────────────────────────────
    if (body.mode === 'summary') {
      if (!isCron && !isAdmin) return json({ error: '관리자 권한 필요' }, 403)
      const { data: products } = await admin
        .from('danawa_products').select('*').eq('active', true)
        .order('sort_order').order('id')
      // 오래된 기록 정리
      await admin.from('danawa_snapshots').delete()
        .lt('checked_at', new Date(Date.now() - KEEP_DAYS * 86400000).toISOString())
      if (!webhook || !products?.length) return json({ ok: true, sent: false })
      await postChat(webhook, buildSummaryMessage(products, hubUrl))
      return json({ ok: true, sent: true, count: products.length })
    }

    // ── 상품 1개 확인 ─────────────────────────────────────
    const productId = Number(body.productId)
    if (!productId) return json({ error: 'productId 필요' }, 400)
    const source = isCron ? 'cron' : 'manual'

    const { data: product, error: pErr } = await admin
      .from('danawa_products').select('*').eq('id', productId).maybeSingle()
    if (pErr) throw pErr
    if (!product) return json({ error: '상품을 찾을 수 없습니다.' }, 404)

    const now = new Date().toISOString()
    let result
    try {
      result = await checkDanawaProduct(product.pcode, { previousListings: product.last_listings || [] })
    } catch (e) {
      const msg = String(e.message || e)
      await admin.from('danawa_products').update({ last_error: msg, last_error_at: now, last_checked_at: now }).eq('id', productId)
      await admin.from('danawa_snapshots').insert({ product_id: productId, source, error: msg })
      return json({ ok: false, error: msg }, 200)
    }

    const prevListings = product.last_listings || []
    const prevKeys = new Set(prevListings.map((l) => l.key))
    const firstCheck = !product.last_checked_at || product.last_lowest_price == null
    const priceChanged = result.lowestPrice !== product.last_lowest_price

    // 구버전 다나와 페이지는 쇼핑몰별 1곳만 보여줌 → 가격이 그대로면 직전 동일가 판매처를 유지
    // (신/구 페이지가 번갈아 와서 생기는 가짜 '판매처 변경' 알림 방지)
    let current = result.listings
    if (result.layout === 'legacy' && !priceChanged) {
      const keys = new Set(current.map((l) => l.key))
      current = [...current, ...prevListings.filter((l) => !keys.has(l.key) && l.price === result.lowestPrice)]
    }

    // 알림 기준: 최저가가 바뀌었거나, 최저가에 새 판매처가 등장했을 때
    const hasNewSeller = current.some((l) => !prevKeys.has(l.key))
    const changed = firstCheck || priceChanged || hasNewSeller

    // 새로 등장한 판매처 표시 (첫 확인 때는 표시 안 함)
    const listings = current.map((l) => ({ ...l, isNew: !firstCheck && !prevKeys.has(l.key) }))

    const productPatch = {
      name: result.name || product.name,
      image_url: result.imageUrl || product.image_url,
      last_checked_at: now,
      last_lowest_price: result.lowestPrice,
      last_listings: listings,
      last_error: null,
      last_error_at: null
    }
    if (changed) productPatch.last_changed_at = now
    await admin.from('danawa_products').update(productPatch).eq('id', productId)

    let notified = false
    if (changed && webhook && settings?.enabled !== false) {
      try {
        await postChat(webhook, buildChangeMessage({
          product: { ...product, ...productPatch },
          listings,
          prevPrice: firstCheck ? null : product.last_lowest_price,
          firstCheck,
          hubUrl
        }))
        notified = true
      } catch (e) {
        console.error('[danawa] 챗 전송 실패', e)
      }
    }

    await admin.from('danawa_snapshots').insert({
      product_id: productId,
      lowest_price: result.lowestPrice,
      listings,
      changed,
      notified,
      source
    })

    return json({ ok: true, changed, notified, lowestPrice: result.lowestPrice, count: listings.length })
  } catch (e) {
    console.error('[danawa-check]', e)
    return json({ error: String(e.message || e) }, 500)
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  })
}
