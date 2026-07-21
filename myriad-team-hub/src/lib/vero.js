/**
 * eBay VeRO 인증코드 공유 — 클라이언트 헬퍼.
 *
 * - 코드 조회: /api/vero-code (서버가 James 님 Gmail 대신 읽음, 온디맨드)
 * - 소프트 락: vero_lock (한 번에 한 명) — claim/release RPC + 실시간 상태 구독
 * - James 님 메일함 연동: /api/vero-oauth-start (관리자)
 */
import { supabase } from './supabase'

async function authHeader() {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('로그인이 필요합니다.')
  return { Authorization: `Bearer ${token}` }
}

// ── 코드 조회 ──────────────────────────────────────────────
/**
 * @param {string|null} after ISO8601 — 이 시각 이후 도착한 코드만 (보통 락 started_at)
 * @returns {{connected:boolean, code?:string|null, receivedAt?:string, expiresAt?:string, error?:string, detail?:string}}
 */
export async function fetchVeroCode(after = null) {
  const params = after ? `?after=${encodeURIComponent(after)}` : ''
  const res = await fetch(`/api/vero-code${params}`, { headers: await authHeader() })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `코드 조회 실패 (${res.status})`)
  return data
}

// ── James 님 메일함 연동 시작 (관리자) ─────────────────────
export async function startVeroConnect() {
  const res = await fetch('/api/vero-oauth-start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) }
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `연동 시작 실패 (${res.status})`)
  if (!data.url) throw new Error('연동 URL 을 받지 못했습니다.')
  window.location.href = data.url
}

// ── 소프트 락 ──────────────────────────────────────────────
export async function getVeroLock() {
  const { data, error } = await supabase.from('vero_lock').select('*').eq('id', 1).maybeSingle()
  if (error) throw error
  return data
}

/** 락 점유 시도. 성공 시 반환된 row.holder_id === 내 uid. */
export async function claimVeroLock({ name, email, force = false }) {
  const { data, error } = await supabase.rpc('claim_vero_lock', {
    p_name: name || email || '(이름없음)',
    p_email: email || '',
    p_force: force
  })
  if (error) throw error
  // rpc 는 단일 row 또는 배열 반환 가능성 → 정규화
  return Array.isArray(data) ? data[0] : data
}

export async function releaseVeroLock() {
  const { error } = await supabase.rpc('release_vero_lock')
  if (error) throw error
}

/** 락 상태 실시간 구독 — 콜백에 최신 lock row 전달. cleanup 함수 반환. */
export function subscribeVeroLock(onChange) {
  const channel = supabase
    .channel('vero-lock')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'vero_lock', filter: 'id=eq.1' },
      (payload) => onChange(payload.new || null)
    )
    .subscribe()
  return () => supabase.removeChannel(channel)
}

/** 락이 현재 유효하게 점유돼 있는지 (만료 고려) */
export function isLockActive(lock) {
  if (!lock || !lock.holder_id) return false
  if (!lock.expires_at) return true
  return new Date(lock.expires_at).getTime() > Date.now()
}
