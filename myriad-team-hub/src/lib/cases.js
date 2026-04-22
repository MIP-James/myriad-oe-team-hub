/**
 * 케이스 관리 게시판 데이터 액세스 (Phase 8).
 * - cases / case_comments / case_attachments + Supabase Storage (case-attachments)
 * - 활동 피드(activity_events) 자동 로깅
 */
import { supabase } from './supabase'
import { logActivity } from './community'

export const PLATFORMS = [
  '11st', 'SmartStore', 'Gmarket', 'Auction', 'Coupang',
  'NaverBand', 'KakaoStory', 'Instagram', '독립몰', '기타'
]

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

// ───── Case CRUD ────────────────────────────────────────────────

/**
 * 케이스 목록. 필터 파라미터 선택적.
 * @param {Object} opts
 *   - brand, platform, infringementType, status, search (제목/본문/브랜드 ILIKE)
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
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (brand) q = q.eq('brand', brand)
  if (platform) q = q.eq('platform', platform)
  if (infringementType) q = q.eq('infringement_type', infringementType)
  if (status) q = q.eq('status', status)
  if (search && search.trim()) {
    const pat = `%${search.trim()}%`
    q = q.or(`title.ilike.${pat},body_text.ilike.${pat},brand.ilike.${pat}`)
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
    .select('id,title,brand,platform,platform_other,infringement_type,status,created_at,created_by')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data ?? []
}

export async function createCase(payload, userId) {
  const row = {
    title: (payload.title || '').trim(),
    brand: (payload.brand || '').trim(),
    platform: payload.platform,
    platform_other: payload.platform === '기타' ? (payload.platformOther || null) : null,
    post_url: payload.postUrl ? payload.postUrl.trim() : null,
    infringement_type: payload.infringementType,
    status: payload.status || 'share',
    body_html: payload.bodyHtml || '',
    body_text: payload.bodyText || '',
    gmail_message_id: payload.gmailMessageId || null,
    gmail_thread_url: payload.gmailThreadUrl || null,
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
    payload: { title: data.title, brand: data.brand, platform: data.platform }
  })
  return data
}

export async function updateCase(id, payload, userId) {
  const row = {
    title: (payload.title || '').trim(),
    brand: (payload.brand || '').trim(),
    platform: payload.platform,
    platform_other: payload.platform === '기타' ? (payload.platformOther || null) : null,
    post_url: payload.postUrl ? payload.postUrl.trim() : null,
    infringement_type: payload.infringementType,
    body_html: payload.bodyHtml || '',
    body_text: payload.bodyText || '',
    gmail_message_id: payload.gmailMessageId || null,
    gmail_thread_url: payload.gmailThreadUrl || null,
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
    payload: { title: data.title, brand: data.brand }
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

// ───── Brand autocomplete ───────────────────────────────────────

/**
 * 브랜드 제안 목록 — cases.brand 와 brand_reports.brand_name 을 합쳐서 고유값 반환.
 */
export async function listBrandSuggestions() {
  const [casesRes, reportsRes] = await Promise.all([
    supabase.from('cases').select('brand').limit(500),
    supabase.from('brand_reports').select('brand_name').limit(500)
  ])
  const set = new Set()
  for (const r of casesRes.data ?? []) if (r.brand) set.add(r.brand)
  for (const r of reportsRes.data ?? []) if (r.brand_name) set.add(r.brand_name)
  return [...set].sort((a, b) => a.localeCompare(b, 'ko'))
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
