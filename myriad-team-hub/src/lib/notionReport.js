/**
 * 노션 주간 보고서 자동 생성 — 프론트 클라이언트.
 *
 * Cloudflare Pages Function `/api/notion-weekly-report` 호출.
 * 인증은 Supabase JWT 를 Authorization 헤더로 전달.
 */
import { supabase } from './supabase'

const ENDPOINT = '/api/notion-weekly-report'

async function getAuthHeader() {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('로그인이 필요합니다.')
  return { Authorization: `Bearer ${token}` }
}

/**
 * 미리보기 텍스트 생성 (DB write X).
 * @param weekStartDate "YYYY-MM-DD" — 그 주 월요일
 * @returns { preview: { 기준주차, 금주주요업무, 차주우선업무, 금주기록수, 차주계획수 } }
 */
export async function previewNotionReport(weekStartDate) {
  const headers = {
    'Content-Type': 'application/json',
    ...(await getAuthHeader())
  }
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({ weekStartDate, dryRun: true })
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `미리보기 실패 (${res.status})`)
  return data
}

/**
 * 실제 노션 페이지 생성.
 * @returns { ok, url, pageId, preview }
 */
export async function createNotionReport(weekStartDate) {
  const headers = {
    'Content-Type': 'application/json',
    ...(await getAuthHeader())
  }
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({ weekStartDate, dryRun: false })
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `보고서 생성 실패 (${res.status})`)
  return data
}
