/**
 * 팀 프로젝트 데이터 액세스 (Phase 23).
 * projects / project_sections / project_posts(+attachments, comments)
 * / project_metrics_monthly / project_campaigns / project_brands / project_resources
 * + Storage bucket 'project-files'
 */
import { supabase } from './supabase'
import { logActivity } from './community'

const BUCKET = 'project-files'

// ───── 상수 ─────────────────────────────────────────────────────

export const ISSUE_STATUS = [
  { key: 'open', label: '접수', cls: 'bg-rose-100 text-rose-700' },
  { key: 'in_progress', label: '처리 중', cls: 'bg-amber-100 text-amber-800' },
  { key: 'done', label: '완료', cls: 'bg-emerald-100 text-emerald-700' }
]
export const ISSUE_STATUS_MAP = Object.fromEntries(ISSUE_STATUS.map((s) => [s.key, s]))

export const SEVERITY = [
  { key: 'info', label: '일반', cls: 'bg-sky-100 text-sky-700' },
  { key: 'important', label: '중요', cls: 'bg-amber-100 text-amber-800' },
  { key: 'urgent', label: '긴급', cls: 'bg-rose-100 text-rose-700' }
]
export const SEVERITY_MAP = Object.fromEntries(SEVERITY.map((s) => [s.key, s]))

export const CAMPAIGN_STATUS = {
  planned: { label: '예정', cls: 'bg-slate-100 text-slate-600' },
  active: { label: '진행 중', cls: 'bg-myriad-primary/30 text-myriad-ink' },
  done: { label: '완료', cls: 'bg-emerald-100 text-emerald-700' }
}

export const MONITORING_STATUS = [
  { key: 'pending', label: '착수 전', cls: 'bg-slate-100 text-slate-600' },
  { key: 'active', label: '모니터링 중', cls: 'bg-myriad-primary/30 text-myriad-ink' },
  { key: 'paused', label: '보류', cls: 'bg-amber-100 text-amber-800' },
  { key: 'done', label: '종료', cls: 'bg-emerald-100 text-emerald-700' }
]
export const MONITORING_STATUS_MAP = Object.fromEntries(MONITORING_STATUS.map((s) => [s.key, s]))

// ───── 날짜 유틸 ────────────────────────────────────────────────

/** 'YYYY-MM-01' */
export function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
export function monthLabel(key) {
  if (!key) return ''
  const [y, m] = key.split('-')
  return `${y}년 ${Number(m)}월`
}
export function shortMonthLabel(key) {
  if (!key) return ''
  return `${Number(key.split('-')[1])}월`
}
/** starts~ends 사이의 월 키 목록 (오름차순). ends 없으면 오늘까지. */
export function monthRange(startsOn, endsOn) {
  const out = []
  if (!startsOn) return out
  const s = new Date(startsOn)
  const e = endsOn ? new Date(endsOn) : new Date()
  const cur = new Date(s.getFullYear(), s.getMonth(), 1)
  const last = new Date(e.getFullYear(), e.getMonth(), 1)
  while (cur <= last && out.length < 36) {
    out.push(monthKey(cur))
    cur.setMonth(cur.getMonth() + 1)
  }
  return out
}
export function fmtDate(d, opts = { month: '2-digit', day: '2-digit' }) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('ko-KR', opts)
}
export function daysUntil(d) {
  if (!d) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const t = new Date(d); t.setHours(0, 0, 0, 0)
  return Math.round((t - today) / 86400000)
}

// ───── Projects / Sections ─────────────────────────────────────

export async function listProjects() {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function getProjectBySlug(slug) {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('slug', slug)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function listSections(projectId) {
  const { data, error } = await supabase
    .from('project_sections')
    .select('*')
    .eq('project_id', projectId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
  if (error) throw error
  return data ?? []
}

// ───── Posts ────────────────────────────────────────────────────

/**
 * @param {Object} f  sectionId(필수), periodMonth, campaignId, status, search, limit
 */
export async function listPosts({ sectionId, periodMonth = null, campaignId = null, status = null, search = null, limit = 200 }) {
  let q = supabase
    .from('project_posts')
    .select('*')
    .eq('section_id', sectionId)
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)
  if (periodMonth) q = q.eq('period_month', periodMonth)
  if (campaignId) q = q.eq('campaign_id', campaignId)
  if (status) q = q.eq('status', status)
  if (search && search.trim()) {
    const pat = `%${search.trim()}%`
    q = q.or(`title.ilike.${pat},body_text.ilike.${pat}`)
  }
  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

export async function getPost(id) {
  const { data, error } = await supabase
    .from('project_posts')
    .select('*, section:project_sections(id,key,label,kind), project:projects(id,slug,name,short_name)')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function createPost(payload, userId) {
  const row = {
    project_id: payload.projectId,
    section_id: payload.sectionId,
    title: (payload.title || '').trim(),
    body_html: payload.bodyHtml || '',
    body_text: payload.bodyText || '',
    period_month: payload.periodMonth || null,
    campaign_id: payload.campaignId || null,
    category: payload.category?.trim() || null,
    status: payload.status || 'none',
    due_on: payload.dueOn || null,
    assignee_id: payload.assigneeId || null,
    pinned: !!payload.pinned,
    severity: payload.severity || 'info',
    created_by: userId,
    updated_by: userId
  }
  const { data, error } = await supabase.from('project_posts').insert(row).select().single()
  if (error) throw error
  await logActivity('project_post_created', {
    target_type: 'project_post',
    target_id: data.id,
    payload: { title: data.title, project_id: data.project_id }
  })
  return data
}

export async function updatePost(id, payload, userId) {
  const row = {
    title: (payload.title || '').trim(),
    body_html: payload.bodyHtml || '',
    body_text: payload.bodyText || '',
    period_month: payload.periodMonth || null,
    campaign_id: payload.campaignId || null,
    category: payload.category?.trim() || null,
    status: payload.status || 'none',
    due_on: payload.dueOn || null,
    assignee_id: payload.assigneeId || null,
    pinned: !!payload.pinned,
    severity: payload.severity || 'info',
    updated_by: userId
  }
  const { data, error } = await supabase.from('project_posts').update(row).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function patchPost(id, patch) {
  const { error } = await supabase.from('project_posts').update(patch).eq('id', id)
  if (error) throw error
}

export async function deletePost(id) {
  const { data: atts } = await supabase
    .from('project_post_attachments')
    .select('storage_path')
    .eq('post_id', id)
  const paths = (atts ?? []).map((a) => a.storage_path).filter(Boolean)
  if (paths.length) {
    await supabase.storage.from(BUCKET).remove(paths).catch((e) =>
      console.warn('[deletePost] storage cleanup:', e?.message))
  }
  const { error } = await supabase.from('project_posts').delete().eq('id', id)
  if (error) throw error
}

// ───── Attachments ──────────────────────────────────────────────

export async function listAttachments(postId) {
  const { data, error } = await supabase
    .from('project_post_attachments')
    .select('*')
    .eq('post_id', postId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

/** 여러 게시글의 첨부 수 — 목록 표시용 */
export async function countAttachments(postIds) {
  if (!postIds?.length) return {}
  const { data, error } = await supabase
    .from('project_post_attachments')
    .select('post_id')
    .in('post_id', postIds)
  if (error) return {}
  const map = {}
  for (const r of data ?? []) map[r.post_id] = (map[r.post_id] || 0) + 1
  return map
}

export async function countComments(postIds) {
  if (!postIds?.length) return {}
  const { data, error } = await supabase
    .from('project_post_comments')
    .select('post_id')
    .in('post_id', postIds)
  if (error) return {}
  const map = {}
  for (const r of data ?? []) map[r.post_id] = (map[r.post_id] || 0) + 1
  return map
}

function safeExt(name) {
  const ext = name.split('.').pop()?.toLowerCase() || 'bin'
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : 'bin'
}

/**
 * 파일 업로드. postId 가 null 이면 'tmp/' 에 올리고 commitTmpAttachments 로 마무리.
 * 모든 파일 타입 허용 (xlsx/hwp/docx/pdf/이미지).
 */
export async function uploadAttachment(file, postId, userId) {
  if (!file) throw new Error('파일이 없습니다.')
  const path = `${postId ?? 'tmp'}/${crypto.randomUUID()}.${safeExt(file.name)}`
  const up = await supabase.storage.from(BUCKET).upload(path, file, { cacheControl: '3600', upsert: false })
  if (up.error) throw up.error
  const meta = { storage_path: path, file_name: file.name, mime_type: file.type || null, size_bytes: file.size }
  if (!postId) return { tmp: true, ...meta }
  const { data, error } = await supabase
    .from('project_post_attachments')
    .insert({ post_id: postId, uploaded_by: userId, ...meta })
    .select().single()
  if (error) throw error
  return data
}

export async function commitTmpAttachments(tmpList, postId, userId) {
  const out = []
  for (const t of tmpList ?? []) {
    const newPath = `${postId}/${t.storage_path.split('/').pop()}`
    const mv = await supabase.storage.from(BUCKET).move(t.storage_path, newPath)
    const finalPath = mv.error ? t.storage_path : newPath
    const { data, error } = await supabase
      .from('project_post_attachments')
      .insert({
        post_id: postId, storage_path: finalPath, file_name: t.file_name,
        mime_type: t.mime_type, size_bytes: t.size_bytes, uploaded_by: userId
      })
      .select().single()
    if (!error) out.push(data)
  }
  return out
}

export async function deleteAttachment(att) {
  if (att.storage_path) {
    await supabase.storage.from(BUCKET).remove([att.storage_path]).catch(() => {})
  }
  const { error } = await supabase.from('project_post_attachments').delete().eq('id', att.id)
  if (error) throw error
}

export async function removeTmpFile(path) {
  await supabase.storage.from(BUCKET).remove([path]).catch(() => {})
}

export async function signedUrl(path, expiresIn = 60 * 60) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresIn)
  if (error) throw error
  return data.signedUrl
}

export async function signedUrls(paths, expiresIn = 60 * 60) {
  if (!paths?.length) return {}
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, expiresIn)
  if (error) return {}
  const map = {}
  for (const it of data ?? []) if (it.signedUrl && it.path) map[it.path] = it.signedUrl
  return map
}

export function fmtBytes(n) {
  if (!n && n !== 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

// ───── Comments ─────────────────────────────────────────────────

export async function listComments(postId) {
  const { data, error } = await supabase
    .from('project_post_comments')
    .select('*')
    .eq('post_id', postId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}
export async function addComment(postId, body, userId) {
  const { data, error } = await supabase
    .from('project_post_comments')
    .insert({ post_id: postId, body: body.trim(), created_by: userId })
    .select().single()
  if (error) throw error
  return data
}
export async function deleteComment(id) {
  const { error } = await supabase.from('project_post_comments').delete().eq('id', id)
  if (error) throw error
}

// ───── 월별 KOIPA 확정 인정 건수 ────────────────────────────────
// 플랫폼별 세부 실적표는 M-Bridge 정본. 여기는 월 1행.

export async function listMonthSummary(projectId) {
  const { data, error } = await supabase
    .from('project_month_summary')
    .select('*')
    .eq('project_id', projectId)
    .order('month', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function upsertMonthSummary(projectId, month, patch, userId) {
  const row = { project_id: projectId, month, updated_by: userId }
  for (const k of ['confirmed_blocked', 'reported', 'copyright_sent', 'copyright_blocked']) {
    if (patch[k] !== undefined) row[k] = toInt(patch[k])
  }
  if (patch.note !== undefined) row.note = patch.note?.trim() || null
  const { data, error } = await supabase
    .from('project_month_summary')
    .upsert(row, { onConflict: 'project_id,month' })
    .select().single()
  if (error) throw error
  return data
}
function toInt(v) {
  const n = parseInt(String(v ?? '').replace(/[^\d-]/g, ''), 10)
  return Number.isFinite(n) ? n : 0
}

/** 대시보드 집계 — 확정 차단 누계 / 보고 누계 / 저작권 */
export function summarize(rows) {
  const out = { blocked: 0, reported: 0, copyrightSent: 0, copyrightBlocked: 0, byMonth: [] }
  let cum = 0
  for (const r of [...rows].sort((a, b) => a.month.localeCompare(b.month))) {
    out.blocked += r.confirmed_blocked || 0
    out.reported += r.reported || 0
    out.copyrightSent += r.copyright_sent || 0
    out.copyrightBlocked += r.copyright_blocked || 0
    cum += r.confirmed_blocked || 0
    out.byMonth.push({ ...r, cumulative: cum })
  }
  return out
}

// ───── Campaigns ────────────────────────────────────────────────

export async function listCampaigns(projectId, kind = null) {
  let q = supabase.from('project_campaigns').select('*').eq('project_id', projectId)
  if (kind) q = q.eq('kind', kind)
  const { data, error } = await q.order('sort_order', { ascending: true }).order('round_no', { ascending: true })
  if (error) throw error
  return data ?? []
}
export async function saveCampaign(row, userId) {
  const payload = {
    project_id: row.project_id,
    kind: row.kind,
    round_no: row.round_no ?? null,
    title: row.title.trim(),
    theme: row.theme?.trim() || null,
    brands: (row.brands || []).map((s) => s.trim()).filter(Boolean),
    starts_on: row.starts_on || null,
    ends_on: row.ends_on || null,
    status: row.status || 'planned',
    deliverables: row.deliverables || [],
    note: row.note?.trim() || null,
    sort_order: row.sort_order ?? 0
  }
  if (row.id) {
    const { data, error } = await supabase.from('project_campaigns').update(payload).eq('id', row.id).select().single()
    if (error) throw error
    return data
  }
  const { data, error } = await supabase.from('project_campaigns').insert({ ...payload, created_by: userId }).select().single()
  if (error) throw error
  return data
}
export async function deleteCampaign(id) {
  const { error } = await supabase.from('project_campaigns').delete().eq('id', id)
  if (error) throw error
}

// ───── Brands ───────────────────────────────────────────────────

export async function listBrands(projectId) {
  const { data, error } = await supabase
    .from('project_brands')
    .select('*')
    .eq('project_id', projectId)
    .order('wave', { ascending: true })
    .order('company', { ascending: true })
  if (error) throw error
  return data ?? []
}
export async function saveBrand(row) {
  const payload = {
    project_id: row.project_id,
    company: row.company.trim(),
    brand_names: (row.brand_names || []).map((s) => s.trim()).filter(Boolean),
    brand_count: row.brand_count === '' || row.brand_count == null ? null : Number(row.brand_count),
    wave: Number(row.wave) || 1,
    category: row.category?.trim() || null,
    assignee_id: row.assignee_id || null,
    monitoring_status: row.monitoring_status || 'pending',
    note: row.note?.trim() || null,
    is_active: row.is_active ?? true
  }
  if (row.id) {
    const { data, error } = await supabase.from('project_brands').update(payload).eq('id', row.id).select().single()
    if (error) throw error
    return data
  }
  const { data, error } = await supabase.from('project_brands').insert(payload).select().single()
  if (error) throw error
  return data
}
export async function patchBrand(id, patch) {
  const { error } = await supabase.from('project_brands').update(patch).eq('id', id)
  if (error) throw error
}
export async function deleteBrand(id) {
  const { error } = await supabase.from('project_brands').delete().eq('id', id)
  if (error) throw error
}

// ───── Resources ────────────────────────────────────────────────

export async function listResources(projectId) {
  const { data, error } = await supabase
    .from('project_resources')
    .select('*')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}
export async function saveResource(row, userId) {
  const payload = {
    project_id: row.project_id,
    kind: row.kind,
    label: row.label.trim(),
    url: row.url?.trim() || null,
    storage_path: row.storage_path || null,
    file_name: row.file_name || null,
    size_bytes: row.size_bytes ?? null,
    org: row.org?.trim() || null,
    role: row.role?.trim() || null,
    email: row.email?.trim() || null,
    phone: row.phone?.trim() || null,
    note: row.note?.trim() || null,
    group_label: row.group_label?.trim() || null,
    sort_order: row.sort_order ?? 0
  }
  if (row.id) {
    const { data, error } = await supabase.from('project_resources').update(payload).eq('id', row.id).select().single()
    if (error) throw error
    return data
  }
  const { data, error } = await supabase.from('project_resources').insert({ ...payload, created_by: userId }).select().single()
  if (error) throw error
  return data
}
export async function deleteResource(res) {
  if (res.storage_path) await supabase.storage.from(BUCKET).remove([res.storage_path]).catch(() => {})
  const { error } = await supabase.from('project_resources').delete().eq('id', res.id)
  if (error) throw error
}
/** 자료실 파일 업로드 — resources/<uuid>.<ext> */
export async function uploadResourceFile(file) {
  const path = `resources/${crypto.randomUUID()}.${safeExt(file.name)}`
  const up = await supabase.storage.from(BUCKET).upload(path, file, { cacheControl: '3600', upsert: false })
  if (up.error) throw up.error
  return { storage_path: path, file_name: file.name, size_bytes: file.size }
}

// ───── 대시보드용 요약 ──────────────────────────────────────────

export async function countOpenIssues(projectId) {
  const { count, error } = await supabase
    .from('project_posts')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .in('status', ['open', 'in_progress'])
  if (error) return 0
  return count ?? 0
}

export async function listUpcomingIssues(projectId, limit = 6) {
  const { data, error } = await supabase
    .from('project_posts')
    .select('id,title,status,due_on,section_id,assignee_id')
    .eq('project_id', projectId)
    .in('status', ['open', 'in_progress'])
    .order('due_on', { ascending: true, nullsFirst: false })
    .limit(limit)
  if (error) return []
  return data ?? []
}

// ───── 월별 마감 체크리스트 ─────────────────────────────────────

export async function listMonthChecks(projectId, month) {
  const { data, error } = await supabase
    .from('project_month_checks')
    .select('*')
    .eq('project_id', projectId)
    .eq('month', month)
  if (error) return {}
  return Object.fromEntries((data ?? []).map((r) => [r.key, r]))
}

export async function setMonthCheck(projectId, month, key, done, userId) {
  const { error } = await supabase
    .from('project_month_checks')
    .upsert({
      project_id: projectId, month, key, done,
      done_by: done ? userId : null,
      done_at: done ? new Date().toISOString() : null
    }, { onConflict: 'project_id,month,key' })
  if (error) throw error
}

// ───── 신규 프로젝트 (관리자) ────────────────────────────────────

const DEFAULT_SECTIONS = [
  { key: 'notice', label: '공지·규칙', icon: 'Megaphone', kind: 'notice', description: '팀 내부 규칙·필독. 바뀌지 않는 원칙은 상단 고정(핀).' },
  { key: 'dashboard', label: '팀 현황', icon: 'Gauge', kind: 'dashboard', description: '이번 주 마감 · 내 할 일 · 라운드 일정 · 브랜드 담당.' },
  { key: 'monthly', label: '월별 운영', icon: 'CalendarRange', kind: 'monthly', description: '월 단위 마감 체크리스트 + 확정 건수 + 내부 기록·유선 협의 메모.' },
  { key: 'campaign', label: '기획 모니터링', icon: 'Target', kind: 'campaign', description: '차수별 기획 모니터링 진행 기록.' },
  { key: 'brands', label: '브랜드 & 담당', icon: 'Building2', kind: 'brands', description: '브랜드사별 담당 팀원·착수 상태·특이사항.' },
  { key: 'issues', label: '할 일', icon: 'ListTodo', kind: 'issues', description: '팀 내부 액션 (담당자·기한).' },
  { key: 'library', label: '가이드 & 연락처', icon: 'Library', kind: 'library', description: '실무 가이드 + 링크 + 연락처.' }
]

/** 프로젝트 + 기본 섹션 생성. 마감 사이클 설정은 첫 프로젝트(정렬 최상위) 것을 복사. */
export async function createProjectWithDefaults(form, userId) {
  const { data: tmpl } = await supabase.from('projects').select('config').order('sort_order').limit(1).maybeSingle()
  const config = {
    goal_count: form.goal_count ?? null,
    report_cycle: tmpl?.config?.report_cycle ?? []
  }
  const { data: p, error } = await supabase
    .from('projects')
    .insert({
      slug: form.slug, name: form.name.trim(), short_name: form.short_name?.trim() || null,
      client: form.client?.trim() || null, description: form.description?.trim() || null,
      starts_on: form.starts_on || null, ends_on: form.ends_on || null,
      config, created_by: userId, sort_order: 100
    })
    .select().single()
  if (error) throw error
  const { error: e2 } = await supabase
    .from('project_sections')
    .insert(DEFAULT_SECTIONS.map((s, i) => ({ ...s, project_id: p.id, sort_order: i })))
  if (e2) throw e2
  return p
}

export async function listMyOpenIssues(projectId, userId, limit = 8) {
  if (!userId) return []
  const { data, error } = await supabase
    .from('project_posts')
    .select('id,title,status,due_on,section_id,assignee_id')
    .eq('project_id', projectId)
    .eq('assignee_id', userId)
    .in('status', ['open', 'in_progress'])
    .order('due_on', { ascending: true, nullsFirst: false })
    .limit(limit)
  if (error) return []
  return data ?? []
}

/** 팀원 프로필 목록 (담당자 선택용) — profiles 는 authenticated 전원 select 가능 */
export async function listTeamProfiles() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id,email,full_name,avatar_url')
    .order('full_name', { ascending: true })
  if (error) return []
  return data ?? []
}
export function profileName(p) {
  return p?.full_name || p?.email?.split('@')[0] || '—'
}
