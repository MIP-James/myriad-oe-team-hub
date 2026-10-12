/**
 * 공용 PC 원격 접속 (Phase 24) — 사용 현황 조회 + .rdp 파일 생성 + 관리자 CRUD.
 *
 * shared_pcs.sessions 는 공용 PC 의 런처 에이전트(--shared-pc-agent)가 보고.
 * 에이전트는 변경 시 + 15분 keepalive 로만 보고 → reported_at 이 오래되면 '확인 불가'.
 */
import { supabase } from './supabase'

// keepalive 15분 × 2 + 마진. 이보다 오래되면 PC 꺼짐/네트워크 끊김으로 간주.
export const SHARED_PC_STALE_MS = 35 * 60 * 1000

export function isReportFresh(pc) {
  if (!pc?.reported_at) return false
  return Date.now() - new Date(pc.reported_at).getTime() < SHARED_PC_STALE_MS
}

/** 활성 공용 PC + 계정 매핑(+프로필 이름) */
export async function listSharedPcs({ includeInactive = false } = {}) {
  let q = supabase
    .from('shared_pcs')
    .select('*, shared_pc_accounts(id, windows_username, user_id)')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (!includeInactive) q = q.eq('is_active', true)
  const { data, error } = await q
  if (error) throw error
  const pcs = data ?? []

  const userIds = [...new Set(pcs.flatMap((p) => (p.shared_pc_accounts ?? []).map((a) => a.user_id)))]
  let names = {}
  if (userIds.length) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', userIds)
    for (const p of profs ?? []) names[p.id] = p.full_name || p.email?.split('@')[0]
  }
  return pcs.map((p) => ({
    ...p,
    accounts: (p.shared_pc_accounts ?? []).map((a) => ({ ...a, display_name: names[a.user_id] || a.windows_username }))
  }))
}

/** 세션의 윈도우 계정명 → 허브 표시명 */
export function sessionDisplayName(pc, winUser) {
  const acc = (pc.accounts ?? []).find(
    (a) => a.windows_username.toLowerCase() === (winUser || '').toLowerCase()
  )
  return acc?.display_name || winUser
}

/** '사용 중' 시작 시각 — RDP 는 연결 시각, 콘솔은 로그온이 더 최근일 수 있음 */
export function sessionSince(s) {
  const times = [s.connected_at, s.logon_at].filter(Boolean).map((t) => new Date(t).getTime())
  return times.length ? new Date(Math.max(...times)) : null
}

export function myAccount(pc, userId) {
  return (pc.accounts ?? []).find((a) => a.user_id === userId) || null
}

/**
 * .rdp 파일 생성 후 다운로드 → 사용자가 열면 원격 데스크톱 연결 창.
 * 주소 = 에이전트가 보고한 최신 사내 IP (없으면 컴퓨터 이름).
 * 비밀번호는 다루지 않음 — 첫 접속 때 윈도우 창에서 입력 + '기억하기'.
 */
export function downloadRdpFile(pc, windowsUsername) {
  const address = pc.lan_ip || pc.hostname
  // 로컬 계정은 'PC이름\계정' 으로 지정해야 도메인/MS 계정과 헷갈리지 않음. 이메일형(MS 계정)은 그대로.
  const username = windowsUsername
    ? (windowsUsername.includes('@') || windowsUsername.includes('\\')
        ? windowsUsername
        : `${pc.hostname}\\${windowsUsername}`)
    : ''
  const lines = [
    `full address:s:${address}`,
    username ? `username:s:${username}` : null,
    'prompt for credentials:i:0',
    'authentication level:i:2',
    'screen mode id:i:2',
    'use multimon:i:0',
    'dynamic resolution:i:1',
    'smart sizing:i:1',
    'redirectclipboard:i:1',
    'audiomode:i:0',
    'autoreconnection enabled:i:1'
  ].filter(Boolean)
  const blob = new Blob([lines.join('\r\n') + '\r\n'], { type: 'application/x-rdp' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${pc.name || pc.hostname}.rdp`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ───── 관리자 ─────────────────────────────────

export async function createSharedPc({ name, hostname }) {
  const { error } = await supabase
    .from('shared_pcs')
    .insert({ name: name.trim(), hostname: hostname.trim().toUpperCase() })
  if (error) throw error
}

export async function updateSharedPc(id, patch) {
  const row = { ...patch }
  if (row.hostname) row.hostname = row.hostname.trim().toUpperCase()
  if (row.name) row.name = row.name.trim()
  const { error } = await supabase.from('shared_pcs').update(row).eq('id', id)
  if (error) throw error
}

export async function deleteSharedPc(id) {
  const { error } = await supabase.from('shared_pcs').delete().eq('id', id)
  if (error) throw error
}

export async function addSharedPcAccount(pcId, windowsUsername, userId) {
  const { error } = await supabase
    .from('shared_pc_accounts')
    .insert({ pc_id: pcId, windows_username: windowsUsername.trim(), user_id: userId })
  if (error) throw error
}

export async function removeSharedPcAccount(id) {
  const { error } = await supabase.from('shared_pc_accounts').delete().eq('id', id)
  if (error) throw error
}
