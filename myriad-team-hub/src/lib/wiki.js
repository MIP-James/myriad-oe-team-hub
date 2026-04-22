/**
 * 위키 페이지 CRUD + 검색 + 활동 이벤트 로깅.
 *
 * 설계:
 * - 카테고리: '브랜드' / '플랫폼' / '프로세스' / '기타' (자유 추가 가능)
 * - 태그: text[] (자유)
 * - 전문 검색: to_tsvector GIN (migration 011) — 실패 시 ILIKE 폴백
 * - 삭제는 관리자만 (RLS 로 강제)
 */
import { supabase } from './supabase'
import { logActivity } from './community'

export const DEFAULT_CATEGORIES = ['브랜드', '플랫폼', '프로세스', '기타']

// 카테고리별 템플릿 프리필 (새 페이지 생성 시 body 초기값)
export const CATEGORY_TEMPLATES = {
  브랜드: `## 담당자

## 특이사항

## 자주 쓰는 링크

## 과거 이슈
`,
  플랫폼: `## VeRO 계정

## 자주 쓰는 URL

## 주의사항
`,
  프로세스: `## 목적

## 절차

## 자주 하는 실수

## 관련 문서
`,
  기타: ''
}

// ───── List / search ────────────────────────────────────────────

export async function listWikiPages({ category = null, tag = null } = {}) {
  let q = supabase
    .from('wiki_pages')
    .select('id,title,category,tags,pinned,icon,created_by,updated_by,created_at,updated_at')
    .order('pinned', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(500)

  if (category) q = q.eq('category', category)
  if (tag) q = q.contains('tags', [tag])

  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

/**
 * 전문 검색. 기본은 textSearch('simple') — 매우 관대(접두사 매칭 'pre:*').
 * 실패하면 ILIKE 폴백 — 한국어도 적당히 잡힘.
 */
export async function searchWikiPages(query) {
  const q = query.trim()
  if (!q) return []

  // 1차: textSearch (영문/숫자/일부 한국어)
  try {
    const tsQuery = q
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => `${t}:*`)
      .join(' & ')
    const { data, error } = await supabase
      .from('wiki_pages')
      .select('id,title,category,tags,pinned,updated_at,updated_by')
      .textSearch('title', tsQuery, { config: 'simple' })
      .limit(100)
    if (!error && data && data.length > 0) return data
  } catch {
    // ignore
  }

  // 2차: ILIKE (제목 + 본문) — 한국어 친화적
  const pattern = `%${q}%`
  const { data, error } = await supabase
    .from('wiki_pages')
    .select('id,title,category,tags,pinned,updated_at,updated_by')
    .or(`title.ilike.${pattern},body.ilike.${pattern}`)
    .order('updated_at', { ascending: false })
    .limit(100)
  if (error) throw error
  return data ?? []
}

// ───── Single page ──────────────────────────────────────────────

export async function getWikiPage(id) {
  const { data, error } = await supabase
    .from('wiki_pages')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data
}

// ───── Create / update / delete ─────────────────────────────────

export async function createWikiPage(payload, userId) {
  const row = {
    title: payload.title.trim(),
    body: payload.body ?? '',
    category: payload.category || null,
    tags: payload.tags ?? [],
    pinned: payload.pinned ?? false,
    icon: payload.icon || null,
    created_by: userId,
    updated_by: userId
  }
  const { data, error } = await supabase
    .from('wiki_pages')
    .insert(row)
    .select()
    .single()
  if (error) throw error

  await logActivity('wiki_page_created', {
    target_type: 'wiki_page',
    target_id: data.id,
    payload: { title: data.title, category: data.category }
  })
  return data
}

export async function updateWikiPage(id, payload, userId) {
  const row = {
    title: payload.title.trim(),
    body: payload.body ?? '',
    category: payload.category || null,
    tags: payload.tags ?? [],
    pinned: payload.pinned ?? false,
    icon: payload.icon || null,
    updated_by: userId
  }
  const { data, error } = await supabase
    .from('wiki_pages')
    .update(row)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error

  await logActivity('wiki_page_updated', {
    target_type: 'wiki_page',
    target_id: data.id,
    payload: { title: data.title, category: data.category }
  })
  return data
}

export async function deleteWikiPage(id) {
  const { error } = await supabase.from('wiki_pages').delete().eq('id', id)
  if (error) throw error
}

// ───── Dashboard helpers ─────────────────────────────────────────

export async function listRecentWikiPages(limit = 5) {
  const { data, error } = await supabase
    .from('wiki_pages')
    .select('id,title,category,updated_at,updated_by')
    .order('updated_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data ?? []
}

// 태그 집계 — 실제 작성된 태그만 노출
export async function listAllTags() {
  const { data, error } = await supabase
    .from('wiki_pages')
    .select('tags')
  if (error) throw error
  const counts = new Map()
  for (const row of data ?? []) {
    for (const t of row.tags ?? []) {
      if (!t) continue
      counts.set(t, (counts.get(t) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([tag, count]) => ({ tag, count }))
}
