/**
 * 노션 주간 보고서 자동 생성 — 프론트 클라이언트.
 *
 * 백엔드: Cloudflare Pages Functions (`/api/notion-*`)
 * 인증:   Supabase JWT 를 Authorization 헤더로 전달
 */
import { supabase } from './supabase'

const REPORT_ENDPOINT = '/api/notion-weekly-report'
const STATUS_ENDPOINT = '/api/notion-status'
const START_ENDPOINT = '/api/notion-oauth-start'
const DISCONNECT_ENDPOINT = '/api/notion-disconnect'
const RECHECK_ENDPOINT = '/api/notion-recheck-access'

async function getAuthHeader() {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('로그인이 필요합니다.')
  return { Authorization: `Bearer ${token}` }
}

// ── 보고서 ─────────────────────────────────────────────────

/**
 * 미리보기 텍스트 생성 (Notion 호출 X — 연동 안 돼도 가능).
 */
export async function previewNotionReport(weekStartDate) {
  const headers = {
    'Content-Type': 'application/json',
    ...(await getAuthHeader())
  }
  const res = await fetch(REPORT_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({ weekStartDate, dryRun: true })
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `미리보기 실패 (${res.status})`)
  return data
}

/**
 * 실제 노션 페이지 생성. 사용자 OAuth 토큰 필요.
 *
 * @returns { ok, url, pageId, preview } 성공 시
 * @throws  Error — `cause: 'not-connected'` 면 OAuth 미연동 상태
 */
export async function createNotionReport(weekStartDate) {
  const headers = {
    'Content-Type': 'application/json',
    ...(await getAuthHeader())
  }
  const res = await fetch(REPORT_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({ weekStartDate, dryRun: false })
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || `보고서 생성 실패 (${res.status})`)
    if (data?.notConnected) err.cause = 'not-connected'
    if (data?.requiresShare) err.cause = 'requires-share'
    throw err
  }
  return data
}

// ── OAuth 연동 관리 ────────────────────────────────────────

/** 본인 연동 상태 조회 — { connected: boolean, workspace_name, ... } */
export async function getNotionStatus() {
  const headers = await getAuthHeader()
  const res = await fetch(STATUS_ENDPOINT, { headers })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `연동 상태 조회 실패 (${res.status})`)
  return data
}

/**
 * OAuth 연동 시작 — 노션 동의 페이지로 이동.
 * 동의 후 /schedules?notion=connected 또는 ?notion=error 로 복귀.
 */
export async function startNotionConnect() {
  const headers = {
    'Content-Type': 'application/json',
    ...(await getAuthHeader())
  }
  const res = await fetch(START_ENDPOINT, { method: 'POST', headers })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `연동 시작 실패 (${res.status})`)
  if (!data.url) throw new Error('연동 URL 을 받지 못했습니다.')
  // 노션 동의 페이지로 이동 (앱 내 페이지 X — 외부 redirect)
  window.location.href = data.url
}

/** 연동 해제 — DB row 삭제. 노션 측 토큰은 사용자가 노션에서 직접 회수. */
export async function disconnectNotion() {
  const headers = await getAuthHeader()
  const res = await fetch(DISCONNECT_ENDPOINT, { method: 'DELETE', headers })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `해제 실패 (${res.status})`)
  return data
}

/**
 * "주간 업무 Snapshot" DB 접근 권한 재확인.
 * 관리자가 노션에서 권한을 변경한 뒤 OAuth 재연결 없이 바로 검증할 때 사용.
 *
 * @returns { db_accessible: boolean }
 * @throws  Error — `cause: 'not-connected'` 면 토큰 만료
 */
export async function recheckNotionAccess() {
  const headers = {
    'Content-Type': 'application/json',
    ...(await getAuthHeader())
  }
  const res = await fetch(RECHECK_ENDPOINT, { method: 'POST', headers })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || `재확인 실패 (${res.status})`)
    if (data?.notConnected) err.cause = 'not-connected'
    throw err
  }
  return data
}
