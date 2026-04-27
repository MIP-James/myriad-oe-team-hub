/**
 * 케이스 관리 게시판 데이터 액세스 (Phase 8).
 * - cases / case_comments / case_attachments + Supabase Storage (case-attachments)
 * - 활동 피드(activity_events) 자동 로깅
 */
import { supabase } from './supabase'
import { logActivity } from './community'
import { PLATFORM_LIST, BRAND_LIST } from './platformBrandLists'

// 자동완성 드롭다운용 — 마스터 리스트 그대로 노출.
// 자유 입력 허용이므로 사용자가 신규 값 타이핑해도 OK.
export const PLATFORMS = PLATFORM_LIST

export const INFRINGEMENT_TYPES = [
  '상표권 침해', '위조품', '저작권', '디자인권', '기타'
]

export const STATUS_OPTIONS = [
  { key: 'share', label: '이슈 공유' },
  { key: 'action_needed', label: '조치 필요' },
  { key: 'resolved', label: '조치 완료' }
]

export const STATUS_LABELS = Object.fromEntries(
  STATUS_OPTIONS.map((o) => [o.key, o.label])
)

export const STATUS_COLORS = {
  share: 'bg-sky-100 text-sky-700',
  action_needed: 'bg-amber-100 text-amber-800',
  resolved: 'bg-emerald-100 text-emerald-700'
}

// 침해 유형별 색상 — 게시판 리스트에서 시각적으로 구분
export const INFRINGEMENT_COLORS = {
  '상표권 침해': 'bg-rose-100 text-rose-700',
  '위조품':       'bg-orange-100 text-orange-700',
  '저작권':       'bg-purple-100 text-purple-700',
  '디자인권':     'bg-cyan-100 text-cyan-700',
  '기타':         'bg-slate-100 text-slate-600'
}

// ───── Case CRUD ────────────────────────────────────────────────

/**
 * 케이스 목록. 필터 파라미터 선택적.
 * @param {Object} opts
 *   - brand, platform, infringementType: 단일값 — 케이스의 다중값 배열 안에 포함되면 매치 (.contains)
 *   - status, search (제목/본문 ILIKE)
 *   - limit, offset
 */
export async function listCases({
  brand = null,
  platform = null,
  infringementType = null,
  status = null,
  search = null,
  limit = 30,
  offset = 0
} = {}) {
  let q = supabase
    .from('cases')
    .select('*', { count: 'exact' })
    // action_needed(sort_priority=0) 가 항상 최상단. 동일 우선순위 안에선 최신순.
    .order('sort_priority', { ascending: true })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (brand) q = q.contains('brands', [brand])
  if (platform) q = q.contains('platforms', [platform])
  if (infringementType) q = q.contains('infringement_types', [infringementType])
  if (status) q = q.eq('status', status)
  if (search && search.trim()) {
    const pat = `%${search.trim()}%`
    q = q.or(`title.ilike.${pat},body_text.ilike.${pat}`)
  }

  const { data, error, count } = await q
  if (error) throw error
  return { rows: data ?? [], total: count ?? 0 }
}

export async function getCase(id) {
  const { data, error } = await supabase
    .from('cases')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function listRecentCases(limit = 5) {
  const { data, error } = await supabase
    .from('cases')
    .select('id,title,brand,brands,platform,platform_other,platforms,infringement_type,infringement_types,status,created_at,created_by')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data ?? []
}

/**
 * payload 에는 다중값 배열을 보내야 함:
 *   brands, platforms, infringementTypes, postUrls (각각 string[])
 * 기존 단일 컬럼 (brand/platform/infringement_type/post_url) 도 1번째 값으로
 * 함께 채워서 deprecated 경로(목록 폴백 표시 등)와의 호환을 유지.
 */
export async function createCase(payload, userId) {
  const brands = sanitizeStringArray(payload.brands)
  const platforms = sanitizeStringArray(payload.platforms)
  const infringementTypes = sanitizeStringArray(payload.infringementTypes)
  const postUrls = sanitizeStringArray(payload.postUrls)

  const row = {
    title: (payload.title || '').trim(),
    brands,
    platforms,
    infringement_types: infringementTypes,
    post_urls: postUrls,
    // deprecated 단일 컬럼 — 첫 값으로 미러링 (구 코드 폴백용)
    brand: brands[0] || '',
    platform: platforms[0] || '',
    platform_other: null,
    post_url: postUrls[0] || null,
    infringement_type: infringementTypes[0] || null,
    status: payload.status || 'share',
    body_html: payload.bodyHtml || '',
    body_text: payload.bodyText || '',
    gmail_message_id: payload.gmailMessageId || null,
    gmail_thread_url: payload.gmailThreadUrl || null,
    gmail_subject: payload.gmailSubject || null,
    gmail_from: payload.gmailFrom || null,
    gmail_date: payload.gmailDate || null,
    gmail_body_text: payload.gmailBodyText || null,
    created_by: userId,
    updated_by: userId
  }
  const { data, error } = await supabase
    .from('cases')
    .insert(row)
    .select()
    .single()
  if (error) throw error

  await logActivity('case_created', {
    target_type: 'case',
    target_id: data.id,
    payload: { title: data.title, brand: brands[0] || '', platform: platforms[0] || '' }
  })
  return data
}

export async function updateCase(id, payload, userId) {
  const brands = sanitizeStringArray(payload.brands)
  const platforms = sanitizeStringArray(payload.platforms)
  const infringementTypes = sanitizeStringArray(payload.infringementTypes)
  const postUrls = sanitizeStringArray(payload.postUrls)

  const row = {
    title: (payload.title || '').trim(),
    brands,
    platforms,
    infringement_types: infringementTypes,
    post_urls: postUrls,
    brand: brands[0] || '',
    platform: platforms[0] || '',
    platform_other: null,
    post_url: postUrls[0] || null,
    infringement_type: infringementTypes[0] || null,
    body_html: payload.bodyHtml || '',
    body_text: payload.bodyText || '',
    gmail_message_id: payload.gmailMessageId || null,
    gmail_thread_url: payload.gmailThreadUrl || null,
    gmail_subject: payload.gmailSubject || null,
    gmail_from: payload.gmailFrom || null,
    gmail_date: payload.gmailDate || null,
    gmail_body_text: payload.gmailBodyText || null,
    updated_by: userId
  }
  const { data, error } = await supabase
    .from('cases')
    .update(row)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error

  await logActivity('case_updated', {
    target_type: 'case',
    target_id: data.id,
    payload: { title: data.title, brand: brands[0] || '' }
  })
  return data
}

export async function changeCaseStatus(id, nextStatus, userId, currentCase = null) {
  const updates = {
    status: nextStatus,
    updated_by: userId
  }
  if (nextStatus === 'resolved') {
    updates.resolved_at = new Date().toISOString()
    updates.resolved_by = userId
  } else {
    updates.resolved_at = null
    updates.resolved_by = null
  }
  const { data, error } = await supabase
    .from('cases')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error

  await logActivity('case_status_changed', {
    target_type: 'case',
    target_id: id,
    payload: {
      title: currentCase?.title ?? data.title,
      to: nextStatus,
      status_label: STATUS_LABELS[nextStatus] ?? nextStatus
    }
  })
  return data
}

export async function deleteCase(id) {
  // attachments 도 cascade 로 DB 에선 삭제되지만 Storage 는 별도 — 먼저 파일 삭제
  const { data: atts } = await supabase
    .from('case_attachments')
    .select('storage_path')
    .eq('case_id', id)
  const paths = (atts ?? []).map((a) => a.storage_path).filter(Boolean)
  if (paths.length > 0) {
    await supabase.storage.from('case-attachments').remove(paths).catch((e) => {
      console.warn('[deleteCase] storage cleanup failed:', e?.message)
    })
  }

  const { error } = await supabase.from('cases').delete().eq('id', id)
  if (error) throw error
}

// ───── Comments ─────────────────────────────────────────────────

export async function listCaseComments(caseId) {
  const { data, error } = await supabase
    .from('case_comments')
    .select('*')
    .eq('case_id', caseId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function createCaseComment(caseId, body, userId, caseTitle) {
  const { data, error } = await supabase
    .from('case_comments')
    .insert({
      case_id: caseId,
      author_id: userId,
      body: body.trim()
    })
    .select()
    .single()
  if (error) throw error

  await logActivity('case_comment_posted', {
    target_type: 'case',
    target_id: caseId,
    payload: { title: caseTitle || '', preview: body.trim().slice(0, 80) }
  })
  return data
}

export async function updateCaseComment(id, body) {
  const { error } = await supabase
    .from('case_comments')
    .update({ body: body.trim() })
    .eq('id', id)
  if (error) throw error
}

export async function deleteCaseComment(id) {
  const { error } = await supabase
    .from('case_comments')
    .delete()
    .eq('id', id)
  if (error) throw error
}

// ───── Attachments (Storage + DB) ────────────────────────────────

const BUCKET = 'case-attachments'

/**
 * 이미지 업로드 — Supabase Storage 에 저장 + case_attachments 행 생성.
 * caseId 가 null 이면 임시 'tmp/<uuid>' 경로에 저장 (케이스 생성 후 commit 단계에서 이동/연결).
 */
export async function uploadCaseAttachment(file, caseId, userId) {
  if (!file) throw new Error('파일이 없습니다.')
  const ext = file.name.split('.').pop()?.toLowerCase() || 'bin'
  const safeExt = /^[a-z0-9]+$/.test(ext) ? ext : 'bin'
  const fileKey = `${crypto.randomUUID()}.${safeExt}`
  const folder = caseId ?? 'tmp'
  const path = `${folder}/${fileKey}`

  const up = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: false })
  if (up.error) throw up.error

  // 이미지 크기 추출 (브라우저에서 Image 로드)
  const dims = await readImageSize(file).catch(() => null)

  if (caseId) {
    const { data, error } = await supabase
      .from('case_attachments')
      .insert({
        case_id: caseId,
        storage_path: path,
        file_name: file.name,
        mime_type: file.type,
        size_bytes: file.size,
        width: dims?.w ?? null,
        height: dims?.h ?? null,
        uploaded_by: userId
      })
      .select()
      .single()
    if (error) throw error
    return data
  }
  // tmp 업로드는 DB row 미생성 — 케이스 저장 시 commitTmpAttachments 로 마무리
  return {
    tmp: true,
    storage_path: path,
    file_name: file.name,
    mime_type: file.type,
    size_bytes: file.size,
    width: dims?.w ?? null,
    height: dims?.h ?? null
  }
}

/**
 * 새 케이스 저장 직후 호출 — tmp 경로의 파일들을 케이스 폴더로 옮기고 DB row 삽입.
 */
export async function commitTmpAttachments(tmpList, caseId, userId) {
  if (!tmpList?.length) return []
  const results = []
  for (const t of tmpList) {
    const newPath = `${caseId}/${t.storage_path.split('/').pop()}`
    const mv = await supabase.storage.from(BUCKET).move(t.storage_path, newPath)
    if (mv.error) {
      console.warn('[commitTmp] move failed, keeping tmp path:', mv.error?.message)
    }
    const finalPath = mv.error ? t.storage_path : newPath
    const { data, error } = await supabase
      .from('case_attachments')
      .insert({
        case_id: caseId,
        storage_path: finalPath,
        file_name: t.file_name,
        mime_type: t.mime_type,
        size_bytes: t.size_bytes,
        width: t.width,
        height: t.height,
        uploaded_by: userId
      })
      .select()
      .single()
    if (error) {
      console.warn('[commitTmp] insert failed:', error.message)
      continue
    }
    results.push(data)
  }
  return results
}

export async function listCaseAttachments(caseId) {
  const { data, error } = await supabase
    .from('case_attachments')
    .select('*')
    .eq('case_id', caseId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function deleteCaseAttachment(attachment) {
  // Storage 파일 먼저
  if (attachment.storage_path) {
    await supabase.storage.from(BUCKET).remove([attachment.storage_path]).catch((e) => {
      console.warn('[deleteAttachment] storage:', e?.message)
    })
  }
  const { error } = await supabase
    .from('case_attachments')
    .delete()
    .eq('id', attachment.id)
  if (error) throw error
}

/** Signed URL 생성 — 이미지 표시용 (bucket 이 private 이라 public URL 불가). */
export async function getAttachmentSignedUrl(path, expiresIn = 60 * 60) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, expiresIn)
  if (error) throw error
  return data.signedUrl
}

/** 여러 첨부파일에 대해 signed URL 일괄 생성. */
export async function getAttachmentSignedUrls(paths, expiresIn = 60 * 60) {
  if (!paths?.length) return {}
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(paths, expiresIn)
  if (error) {
    console.warn('signed urls:', error.message)
    return {}
  }
  const map = {}
  for (const item of data ?? []) {
    if (item.signedUrl && item.path) map[item.path] = item.signedUrl
  }
  return map
}

// ───── Help requests (Phase 11a) ────────────────────────────────

/** 케이스의 현재 도움 요청 목록 (개별 수신자 + team_all). */
export async function listCaseHelpRequests(caseId) {
  const { data, error } = await supabase
    .from('case_help_requests')
    .select('*')
    .eq('case_id', caseId)
    .order('requested_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

/**
 * 도움 요청 추가.
 * @param {string} caseId
 * @param {string} target — 팀원 UUID 또는 'team_all' 문자열
 * @param {string} userId — 요청자(현재 로그인 유저)
 */
export async function addCaseHelpRequest(caseId, target, userId) {
  const row = target === 'team_all'
    ? { case_id: caseId, recipient_id: null, is_team_all: true, requested_by: userId }
    : { case_id: caseId, recipient_id: target, is_team_all: false, requested_by: userId }
  const { data, error } = await supabase
    .from('case_help_requests')
    .insert(row)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function removeCaseHelpRequest(id) {
  const { error } = await supabase.from('case_help_requests').delete().eq('id', id)
  if (error) throw error
}

// ───── Status log / history ─────────────────────────────────────

export async function listCaseStatusLog(caseId) {
  const { data, error } = await supabase
    .from('case_status_log')
    .select('*')
    .eq('case_id', caseId)
    .order('changed_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

// ───── Tasks (Phase 11b) ────────────────────────────────────────

export async function listCaseTasks(caseId) {
  const { data, error } = await supabase
    .from('case_tasks')
    .select('*')
    .eq('case_id', caseId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function createCaseTask(caseId, content, assigneeId, userId, sortOrder = 0) {
  const { data, error } = await supabase
    .from('case_tasks')
    .insert({
      case_id: caseId,
      content: content.trim(),
      assignee_id: assigneeId || null,
      sort_order: sortOrder,
      created_by: userId
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateCaseTask(id, patch) {
  const allowed = {}
  if ('content' in patch) allowed.content = patch.content.trim()
  if ('assignee_id' in patch) allowed.assignee_id = patch.assignee_id || null
  if ('status' in patch) allowed.status = patch.status
  if ('sort_order' in patch) allowed.sort_order = patch.sort_order
  const { error } = await supabase.from('case_tasks').update(allowed).eq('id', id)
  if (error) throw error
}

export async function toggleCaseTask(id, nextStatus) {
  const { error } = await supabase
    .from('case_tasks')
    .update({ status: nextStatus })
    .eq('id', id)
  if (error) throw error
}

export async function deleteCaseTask(id) {
  const { error } = await supabase.from('case_tasks').delete().eq('id', id)
  if (error) throw error
}

/**
 * 여러 케이스의 태스크 집계 — 목록에서 "3/5 완료" 표시용.
 * @param {string[]} caseIds
 * @returns {Object<caseId, { total, done }>}
 */
export async function listTaskSummaries(caseIds) {
  if (!caseIds?.length) return {}
  const { data, error } = await supabase
    .from('case_tasks')
    .select('case_id, status')
    .in('case_id', caseIds)
  if (error) throw error
  const map = {}
  for (const r of data ?? []) {
    const s = map[r.case_id] ?? { total: 0, done: 0 }
    s.total += 1
    if (r.status === 'done') s.done += 1
    map[r.case_id] = s
  }
  return map
}

// ───── Workflow notes (Phase 11b) ───────────────────────────────

export async function getCaseWorkflowNotes(caseId) {
  const { data, error } = await supabase
    .from('case_workflow_notes')
    .select('*')
    .eq('case_id', caseId)
    .maybeSingle()
  if (error) throw error
  return data || null
}

export async function upsertCaseWorkflowNotes(caseId, bodyHtml, bodyText, userId) {
  const { error } = await supabase
    .from('case_workflow_notes')
    .upsert({
      case_id: caseId,
      body_html: bodyHtml || '',
      body_text: bodyText || '',
      updated_by: userId,
      updated_at: new Date().toISOString()
    }, { onConflict: 'case_id' })
  if (error) throw error
}

// ───── Brand autocomplete ───────────────────────────────────────

/**
 * 브랜드 제안 목록 — 마스터 리스트(엑셀) + cases.brands(배열) + brand_reports.brand_name 통합.
 * 자유 입력 허용이라 마스터에 없는 신규 값도 사용자가 직접 타이핑 가능.
 */
export async function listBrandSuggestions() {
  const [casesRes, reportsRes] = await Promise.all([
    // brand(deprecated 단일) + brands(배열) 둘 다 가져와서 폴백 호환
    supabase.from('cases').select('brand,brands').limit(500),
    supabase.from('brand_reports').select('brand_name').limit(500)
  ])
  const set = new Set(BRAND_LIST)        // 마스터 시작점
  for (const r of casesRes.data ?? []) {
    if (Array.isArray(r.brands)) {
      for (const b of r.brands) if (b) set.add(b)
    } else if (r.brand) {
      set.add(r.brand)
    }
  }
  for (const r of reportsRes.data ?? []) if (r.brand_name) set.add(r.brand_name)
  return [...set].sort((a, b) => a.localeCompare(b, 'ko'))
}

// ───── Multi-value helpers (Phase 14, 2026-04-27) ────────────────

/**
 * 사용자 입력 배열을 정규화: trim, 빈 값 제거, 중복 제거, 순서 보존.
 * 신규 케이스 INSERT / UPDATE 시 사용.
 */
export function sanitizeStringArray(arr) {
  if (!arr) return []
  if (typeof arr === 'string') arr = [arr]   // 단일값 호환
  const seen = new Set()
  const out = []
  for (const v of arr) {
    if (v == null) continue
    const t = String(v).trim()
    if (!t) continue
    if (seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

/**
 * DB 행에서 "표시용" 다중값 배열을 안전하게 추출.
 * - 새 컬럼(brands/platforms/...) 우선
 * - 비어 있으면 deprecated 단일 컬럼(brand/platform/...) 으로 폴백
 *   (마이그레이션 전 데이터 또는 구버전 클라이언트가 단일값만 넣은 경우)
 */
export function getCaseBrands(row) {
  if (Array.isArray(row?.brands) && row.brands.length > 0) return row.brands
  if (row?.brand) return [row.brand]
  return []
}
export function getCasePlatforms(row) {
  if (Array.isArray(row?.platforms) && row.platforms.length > 0) return row.platforms
  if (row?.platform) return [row.platform]
  if (row?.platform_other) return [row.platform_other]
  return []
}
export function getCaseInfringementTypes(row) {
  if (Array.isArray(row?.infringement_types) && row.infringement_types.length > 0) {
    return row.infringement_types
  }
  if (row?.infringement_type) return [row.infringement_type]
  return []
}
export function getCasePostUrls(row) {
  if (Array.isArray(row?.post_urls) && row.post_urls.length > 0) return row.post_urls
  if (row?.post_url) return [row.post_url]
  return []
}


// ───── helpers ──────────────────────────────────────────────────

function readImageSize(file) {
  return new Promise((resolve, reject) => {
    if (!file.type?.startsWith('image/')) {
      resolve(null)
      return
    }
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      resolve({ w: img.naturalWidth, h: img.naturalHeight })
      URL.revokeObjectURL(url)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('image load failed'))
    }
    img.src = url
  })
}
