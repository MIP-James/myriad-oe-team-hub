/**
 * 다나와 최저가 모니터링 (Phase 25, mig 043) — 클라이언트 헬퍼.
 *
 * - 감시 상품: danawa_products (팀원 누구나 추가/일시중지/삭제)
 * - 확인 기록: danawa_snapshots (서버 함수만 기록)
 * - 설정: danawa_settings (관리자만 수정, 웹훅 주소는 화면에 안 내려옴 → has_webhook 만)
 * - 확인 실행: /api/danawa-check (서버가 다나와·쇼핑몰 조회 + 구글 챗 알림)
 */
import { supabase } from './supabase'

const SETTINGS_COLS = 'id, enabled, interval_hours, daily_summary, has_webhook, last_tick_at, updated_at'

async function authHeader() {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('로그인이 필요합니다.')
  return { Authorization: `Bearer ${token}` }
}

async function callCheck(body) {
  const res = await fetch('/api/danawa-check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(body)
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`)
  return data
}

/** 다나와 주소(또는 숫자)에서 pcode 추출 */
export function extractPcode(input) {
  const s = String(input || '').trim()
  if (/^\d{4,12}$/.test(s)) return s
  const m = s.match(/[?&]pcode=(\d{4,12})/)
  return m ? m[1] : null
}

export function danawaUrl(pcode) {
  return `https://prod.danawa.com/info/?pcode=${pcode}`
}

export async function listProducts() {
  const { data, error } = await supabase
    .from('danawa_products')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true })
  if (error) throw error
  return data || []
}

export async function addProduct({ url, brand, userId }) {
  const pcode = extractPcode(url)
  if (!pcode) throw new Error('다나와 상품 주소(…/info/?pcode=숫자) 를 넣어주세요.')
  const { data: last } = await supabase
    .from('danawa_products').select('sort_order').order('sort_order', { ascending: false }).limit(1)
  const { data, error } = await supabase
    .from('danawa_products')
    .insert({ pcode, brand: brand?.trim() || null, created_by: userId || null, sort_order: (last?.[0]?.sort_order || 0) + 1 })
    .select()
    .single()
  if (error) {
    if (error.code === '23505') throw new Error('이미 감시 중인 상품입니다.')
    throw error
  }
  return data
}

export async function updateProduct(id, patch) {
  const { error } = await supabase.from('danawa_products').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteProduct(id) {
  const { error } = await supabase.from('danawa_products').delete().eq('id', id)
  if (error) throw error
}

/** 상품 1개 지금 확인 (바뀌었으면 챗 알림도 감) */
export function runCheck(productId) {
  return callCheck({ productId })
}

/** 변경·오류 기록만 (최근순) */
export async function listHistory(productId, limit = 20) {
  const { data, error } = await supabase
    .from('danawa_snapshots')
    .select('id, checked_at, lowest_price, listings, changed, notified, source, error')
    .eq('product_id', productId)
    .or('changed.eq.true,error.not.is.null')
    .order('checked_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data || []
}

export async function getSettings() {
  const { data, error } = await supabase.from('danawa_settings').select(SETTINGS_COLS).eq('id', 1).maybeSingle()
  if (error) throw error
  return data
}

/** 관리자 — webhookUrl 은 새로 넣을 때만 전달 (빈 값이면 기존 유지) */
export async function saveSettings({ enabled, intervalHours, dailySummary, webhookUrl, userId }) {
  const patch = {
    enabled,
    interval_hours: intervalHours,
    daily_summary: dailySummary,
    updated_at: new Date().toISOString(),
    updated_by: userId || null
  }
  const wh = (webhookUrl || '').trim()
  if (wh) {
    if (!/^https:\/\/chat\.googleapis\.com\/v1\/spaces\/[^/]+\/messages\?/.test(wh)) {
      throw new Error('구글 챗 웹훅 주소(https://chat.googleapis.com/v1/spaces/…) 형식이 아닙니다.')
    }
    patch.webhook_url = wh
  }
  const { error } = await supabase.from('danawa_settings').update(patch).eq('id', 1)
  if (error) throw error
}

export function sendTestMessage() {
  return callCheck({ mode: 'test' })
}

export function sendSummaryNow() {
  return callCheck({ mode: 'summary' })
}
