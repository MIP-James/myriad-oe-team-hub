/**
 * Inbound Gmail Reader 클라이언트 헬퍼.
 *
 * - reader 등록/해제 (Google OAuth)
 * - 상태 조회
 * - 매핑 룰 CRUD (RLS 가 admin 만 허용 — 직접 supabase 사용)
 * - 키워드 CRUD
 * - 수동 폴링 트리거 (관리자 디버그)
 */
import { supabase } from './supabase'

const START_ENDPOINT = '/api/inbound-reader-oauth-start'
const STATUS_ENDPOINT = '/api/inbound-reader-status'
const DISCONNECT_ENDPOINT = '/api/inbound-reader-disconnect'
const POLL_ENDPOINT = '/api/inbound-poll'

async function getAuthHeader() {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('로그인이 필요합니다.')
  return { Authorization: `Bearer ${token}` }
}

// ── Reader OAuth ──────────────────────────────────────────

/**
 * Google OAuth 동의 페이지로 이동 (Gmail readonly + offline access).
 * 동의 후 /admin/inbound-status?inbound=connected 또는 ?inbound=error 로 복귀.
 */
export async function startInboundReaderConnect() {
  const headers = {
    'Content-Type': 'application/json',
    ...(await getAuthHeader())
  }
  const res = await fetch(START_ENDPOINT, { method: 'POST', headers })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `연동 시작 실패 (${res.status})`)
  if (!data.url) throw new Error('연동 URL 을 받지 못했습니다.')
  window.location.href = data.url
}

export async function disconnectInboundReader(userId = null) {
  const headers = {
    'Content-Type': 'application/json',
    ...(await getAuthHeader())
  }
  const res = await fetch(DISCONNECT_ENDPOINT, {
    method: 'DELETE',
    headers,
    body: userId ? JSON.stringify({ userId }) : undefined
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `해제 실패 (${res.status})`)
  return data
}

export async function getInboundReaderStatus() {
  const headers = await getAuthHeader()
  const res = await fetch(STATUS_ENDPOINT, { headers })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `상태 조회 실패 (${res.status})`)
  return data
}

/** 관리자 수동 폴링 트리거 (디버그/즉시 처리용) */
export async function triggerInboundPoll() {
  const headers = {
    'Content-Type': 'application/json',
    ...(await getAuthHeader())
  }
  const res = await fetch(POLL_ENDPOINT, { method: 'POST', headers })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `폴링 실패 (${res.status})`)
  return data
}

// ── Mappings CRUD (RLS — admin only) ──────────────────────

export async function listInboundMappings() {
  const { data, error } = await supabase
    .from('inbound_mappings')
    .select('*, default_assignee:profiles!inbound_mappings_default_assignee_id_fkey(id, full_name, email), secondary_assignee:profiles!inbound_mappings_secondary_assignee_id_fkey(id, full_name, email)')
    .order('priority', { ascending: true })
  if (error) throw error
  return data ?? []
}

/**
 * @param payload {
 *   brand, sender_emails[], sender_domains[], to_patterns[],
 *   default_assignee_id, secondary_assignee_id,
 *   require_keyword_match, priority, is_active
 * }
 */
export async function createInboundMapping(payload) {
  const row = sanitizeMappingPayload(payload)
  const { data, error } = await supabase
    .from('inbound_mappings')
    .insert(row)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateInboundMapping(id, payload) {
  const row = sanitizeMappingPayload(payload)
  const { data, error } = await supabase
    .from('inbound_mappings')
    .update(row)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteInboundMapping(id) {
  const { error } = await supabase
    .from('inbound_mappings')
    .delete()
    .eq('id', id)
  if (error) throw error
}

function sanitizeMappingPayload(p) {
  return {
    brand: (p.brand || '').trim(),
    sender_emails: Array.isArray(p.sender_emails)
      ? p.sender_emails.map((s) => s.trim().toLowerCase()).filter(Boolean)
      : [],
    sender_domains: Array.isArray(p.sender_domains)
      ? p.sender_domains.map((s) => s.trim().toLowerCase().replace(/^@/, '')).filter(Boolean)
      : [],
    to_patterns: Array.isArray(p.to_patterns)
      ? p.to_patterns.map((s) => s.trim().toLowerCase()).filter(Boolean)
      : [],
    default_assignee_id: p.default_assignee_id || null,
    secondary_assignee_id: p.secondary_assignee_id || null,
    require_keyword_match: p.require_keyword_match !== false,
    priority: Number.isFinite(p.priority) ? p.priority : 100,
    is_active: p.is_active !== false
  }
}

// ── Keywords CRUD (RLS — admin only) ──────────────────────

export async function listInboundKeywords() {
  const { data, error } = await supabase
    .from('inbound_keywords')
    .select('*')
    .order('keyword')
  if (error) throw error
  return data ?? []
}

export async function createInboundKeyword(keyword) {
  const { data, error } = await supabase
    .from('inbound_keywords')
    .insert({ keyword: keyword.trim() })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function toggleInboundKeyword(id, isActive) {
  const { error } = await supabase
    .from('inbound_keywords')
    .update({ is_active: isActive })
    .eq('id', id)
  if (error) throw error
}

export async function deleteInboundKeyword(id) {
  const { error } = await supabase
    .from('inbound_keywords')
    .delete()
    .eq('id', id)
  if (error) throw error
}

// ── 최근 처리 메일 목록 ───────────────────────────────────

export async function listRecentInboundMessages(limit = 30) {
  const { data, error } = await supabase
    .from('inbound_processed_messages')
    .select('*, case:cases(id, title, status)')
    .order('processed_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data ?? []
}

// ── 팀원 dropdown 용 ───────────────────────────────────────

export async function listProfilesForAssignee() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .order('full_name')
  if (error) throw error
  return data ?? []
}
