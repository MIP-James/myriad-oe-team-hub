/**
 * 케이스 상세 페이지 (/community/cases/:id)
 *  - 신규 (/community/cases/new) 는 props.mode="new"
 *  - 뷰 모드: 메타데이터 + 본문(TipTap HTML 렌더) + 갤러리 + 댓글 + 상태 변경
 *  - 편집 모드: CaseEditor 재사용
 *  - 권한: 작성자/관리자만 편집·삭제
 */
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TiptapLink from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import {
  ArrowLeft, Edit3, Loader2, Briefcase, Tag as TagIcon, Globe, Link as LinkIcon,
  Mail, Clock, Circle, CheckCircle2, Send, Trash2, MessageSquare, ExternalLink,
  ChevronDown, AlertCircle, LifeBuoy, Users, X as XIcon, Plus, History,
  UserPlus, UserMinus, MessageCircle, ListChecks, NotebookPen, Save
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import {
  getCase, createCase, updateCase, deleteCase, changeCaseStatus,
  listCaseAttachments, commitTmpAttachments, getAttachmentSignedUrls,
  listCaseComments, createCaseComment, updateCaseComment, deleteCaseComment,
  listCaseHelpRequests, addCaseHelpRequest, removeCaseHelpRequest,
  listCaseStatusLog,
  listCaseTasks, createCaseTask, updateCaseTask, toggleCaseTask, deleteCaseTask,
  getCaseWorkflowNotes, upsertCaseWorkflowNotes,
  getCaseBrands, getCasePlatforms, getCaseInfringementTypes, getCasePostUrls,
  STATUS_OPTIONS, STATUS_LABELS, STATUS_COLORS, INFRINGEMENT_COLORS
} from '../lib/cases'
import { getProfileShort } from '../lib/community'
import { listAllProfiles } from '../lib/users'
import CaseEditor from '../components/CaseEditor'

export default function CaseDetail({ mode }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, isAdmin } = useAuth()
  const isNew = mode === 'new'

  const [caseData, setCaseData] = useState(null)
  const [attachments, setAttachments] = useState([])
  const [attachmentUrls, setAttachmentUrls] = useState({})
  const [comments, setComments] = useState([])
  const [profiles, setProfiles] = useState({})
  const [helpRequests, setHelpRequests] = useState([])
  const [statusLog, setStatusLog] = useState([])
  const [members, setMembers] = useState([])
  const [tasks, setTasks] = useState([])
  const [wfNotes, setWfNotes] = useState(null)
  const [loading, setLoading] = useState(!isNew)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(isNew)
  const [saving, setSaving] = useState(false)
  const [statusMenuOpen, setStatusMenuOpen] = useState(false)

  useEffect(() => {
    if (isNew) return
    load()
  }, [id])

  useEffect(() => {
    if (isNew || !id) return
    const ch = supabase
      .channel(`case-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'case_comments', filter: `case_id=eq.${id}` }, () => loadComments())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cases', filter: `id=eq.${id}` }, () => { loadCase(); loadStatusLog() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'case_attachments', filter: `case_id=eq.${id}` }, () => loadAttachments())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'case_help_requests', filter: `case_id=eq.${id}` }, () => loadHelpRequests())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'case_tasks', filter: `case_id=eq.${id}` }, () => loadTasks())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'case_workflow_notes', filter: `case_id=eq.${id}` }, () => loadWfNotes())
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [id, isNew])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      await Promise.all([
        loadCase(), loadAttachments(), loadComments(),
        loadHelpRequests(), loadStatusLog(), loadMembers(),
        loadTasks(), loadWfNotes()
      ])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function loadTasks() {
    try {
      const list = await listCaseTasks(id)
      setTasks(list)
      const ids = [
        ...list.map((t) => t.assignee_id).filter(Boolean),
        ...list.map((t) => t.created_by).filter(Boolean),
        ...list.map((t) => t.completed_by).filter(Boolean)
      ]
      await loadProfiles(ids)
    } catch (e) {
      console.warn('[tasks] load failed:', e)
    }
  }

  async function loadWfNotes() {
    try {
      const row = await getCaseWorkflowNotes(id)
      setWfNotes(row)
      if (row?.updated_by) await loadProfiles([row.updated_by])
    } catch (e) {
      console.warn('[wfNotes] load failed:', e)
    }
  }

  async function loadHelpRequests() {
    try {
      const list = await listCaseHelpRequests(id)
      setHelpRequests(list)
      const ids = list.map((h) => h.recipient_id).filter(Boolean)
      const reqIds = list.map((h) => h.requested_by).filter(Boolean)
      await loadProfiles([...ids, ...reqIds])
    } catch (e) {
      console.warn('[helpRequests] load failed:', e)
    }
  }

  async function loadStatusLog() {
    try {
      const list = await listCaseStatusLog(id)
      setStatusLog(list)
      await loadProfiles(list.map((s) => s.changed_by).filter(Boolean))
    } catch (e) {
      console.warn('[statusLog] load failed:', e)
    }
  }

  async function loadMembers() {
    try {
      const list = await listAllProfiles()
      setMembers(list)
    } catch (e) {
      console.warn('[members] load failed:', e)
    }
  }

  async function loadCase() {
    const c = await getCase(id)
    if (!c) {
      setError('케이스를 찾을 수 없습니다.')
      setCaseData(null)
      return
    }
    setCaseData(c)
    // 작성자/수정자 프로필
    const ids = [c.created_by, c.updated_by].filter(Boolean)
    await loadProfiles(ids)
  }

  async function loadAttachments() {
    const list = await listCaseAttachments(id)
    setAttachments(list)
    const paths = list.map((a) => a.storage_path).filter(Boolean)
    if (paths.length > 0) {
      const urls = await getAttachmentSignedUrls(paths, 60 * 60)
      setAttachmentUrls(urls)
    } else {
      setAttachmentUrls({})
    }
  }

  async function loadComments() {
    const list = await listCaseComments(id)
    setComments(list)
    const ids = [...new Set(list.map((c) => c.author_id).filter(Boolean))]
    await loadProfiles(ids)
  }

  async function loadProfiles(ids) {
    const pmap = { ...profiles }
    const toFetch = ids.filter((i) => i && !pmap[i])
    await Promise.all(
      toFetch.map(async (i) => { pmap[i] = await getProfileShort(i) })
    )
    setProfiles(pmap)
  }

  // ── Save (신규/수정 공통) ─────────────────────────────

  async function handleSubmit(payload) {
    setSaving(true)
    try {
      if (isNew) {
        const created = await createCase(payload, user.id)
        // tmp 첨부 commit
        if (payload._tmpAttachments?.length) {
          await commitTmpAttachments(payload._tmpAttachments, created.id, user.id)
        }
        // 뷰 모드로 즉시 전환 + 새 ID 의 상세 페이지로 이동.
        // (React 가 컴포넌트를 재사용할 수 있어서 setEditing(false) 명시 필수 —
        //  안 그러면 새 URL 인데 여전히 편집 화면 노출)
        setEditing(false)
        setCaseData(created)
        navigate(`/community/cases/${created.id}`, { replace: true })
        // 새 ID 의 첨부/댓글 (방금 commit 된 tmp 포함) 다시 로드
        try {
          const [a, cm] = await Promise.all([
            listCaseAttachments(created.id),
            listCaseComments(created.id)
          ])
          setAttachments(a)
          if (a.length > 0) {
            const urls = await getAttachmentSignedUrls(
              a.map((x) => x.storage_path).filter(Boolean), 60 * 60
            )
            setAttachmentUrls(urls)
          }
          setComments(cm)
        } catch (e) {
          console.warn('[handleSubmit] post-create reload failed:', e?.message)
        }
      } else {
        await updateCase(id, payload, user.id)
        setEditing(false)
        await load()
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!window.confirm('이 케이스를 삭제할까요? 댓글/첨부 이미지까지 모두 지워지며 복구할 수 없습니다.')) return
    try {
      await deleteCase(id)
      navigate('/community?tab=cases')
    } catch (e) {
      alert('삭제 실패: ' + e.message)
    }
  }

  async function handleStatusChange(next) {
    if (!caseData || next === caseData.status) {
      setStatusMenuOpen(false)
      return
    }
    try {
      await changeCaseStatus(id, next, user.id, caseData)
      setStatusMenuOpen(false)
    } catch (e) {
      alert('상태 변경 실패: ' + e.message)
    }
  }

  // ── Render ────────────────────────────────────────────

  if (loading) {
    return (
      <div className="p-8 max-w-5xl mx-auto py-20 text-center text-sm text-slate-400 flex items-center justify-center gap-2">
        <Loader2 size={14} className="animate-spin" /> 불러오는 중...
      </div>
    )
  }

  if (!isNew && !caseData) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <Link to="/community?tab=cases" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-myriad-ink">
          <ArrowLeft size={13} /> 케이스 목록
        </Link>
        <div className="mt-6 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg p-4 text-sm">
          {error || '케이스를 찾을 수 없습니다.'}
        </div>
      </div>
    )
  }

  const canEdit = isNew || caseData?.created_by === user?.id || isAdmin

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <Link to="/community?tab=cases" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-myriad-ink">
          <ArrowLeft size={13} /> 케이스 목록
        </Link>
        <span className="text-slate-300">/</span>
        <span className="text-sm font-semibold text-slate-700 inline-flex items-center gap-1">
          <Briefcase size={13} /> {isNew ? '새 케이스' : (caseData?.title || '케이스')}
        </span>
      </div>

      {editing ? (
        <CaseEditor
          initial={isNew ? null : {
            id: caseData.id,
            title: caseData.title,
            // migration 025 — 새 배열 컬럼 우선, 비어있으면 deprecated 단일값으로 폴백
            brands: getCaseBrands(caseData),
            platforms: getCasePlatforms(caseData),
            postUrls: getCasePostUrls(caseData),
            infringementTypes: getCaseInfringementTypes(caseData),
            status: caseData.status,
            bodyHtml: caseData.body_html,
            bodyText: caseData.body_text,
            gmailMessageId: caseData.gmail_message_id,
            gmailThreadUrl: caseData.gmail_thread_url,
            gmailSubject: caseData.gmail_subject,
            gmailFrom: caseData.gmail_from,
            gmailDate: caseData.gmail_date,
            gmailBodyText: caseData.gmail_body_text
          }}
          saving={saving}
          onSubmit={handleSubmit}
          onCancel={() => isNew ? navigate('/community?tab=cases') : setEditing(false)}
          onDelete={isNew || !canEdit ? null : handleDelete}
          existingAttachments={isNew ? [] : attachments}
          onRefreshAttachments={loadAttachments}
        />
      ) : (
        <ViewMode
          caseData={caseData}
          attachments={attachments}
          attachmentUrls={attachmentUrls}
          comments={comments}
          profiles={profiles}
          helpRequests={helpRequests}
          statusLog={statusLog}
          members={members}
          tasks={tasks}
          wfNotes={wfNotes}
          onEdit={() => setEditing(true)}
          canEdit={canEdit}
          statusMenuOpen={statusMenuOpen}
          setStatusMenuOpen={setStatusMenuOpen}
          onStatusChange={handleStatusChange}
          user={user}
          isAdmin={isAdmin}
          onCommentsChanged={loadComments}
          onHelpRequestsChanged={loadHelpRequests}
          onTasksChanged={loadTasks}
          onWfNotesChanged={loadWfNotes}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────
// View Mode
// ─────────────────────────────────────────────────────

function ViewMode({
  caseData, attachments, attachmentUrls, comments, profiles,
  helpRequests, statusLog, members, tasks, wfNotes,
  onEdit, canEdit, statusMenuOpen, setStatusMenuOpen, onStatusChange,
  user, isAdmin, onCommentsChanged, onHelpRequestsChanged,
  onTasksChanged, onWfNotesChanged
}) {
  const c = caseData
  const createdProfile = profiles[c.created_by]
  const createdName = createdProfile?.full_name || createdProfile?.email?.split('@')[0] || '—'
  // migration 025 — 다중값 배열. 빈 경우 deprecated 단일 컬럼으로 폴백.
  const brands = getCaseBrands(c)
  const platforms = getCasePlatforms(c)
  const infringementTypes = getCaseInfringementTypes(c)
  const postUrls = getCasePostUrls(c)

  return (
    <>
      {/* 헤더 카드 */}
      <article className="bg-white border border-slate-200 rounded-2xl p-6 md:p-8 mb-4">
        <div className="flex items-start gap-3 mb-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-3">
              {/* 상태 드롭다운 */}
              <div className="relative">
                <button
                  onClick={() => setStatusMenuOpen(!statusMenuOpen)}
                  disabled={!canEdit}
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded-full inline-flex items-center gap-1 ${STATUS_COLORS[c.status]} ${canEdit ? 'hover:brightness-95' : ''}`}
                >
                  <Circle size={7} className="fill-current" />
                  {STATUS_LABELS[c.status]}
                  {canEdit && <ChevronDown size={10} />}
                </button>
                {statusMenuOpen && canEdit && (
                  <div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-10 min-w-[140px]">
                    {STATUS_OPTIONS.map((s) => (
                      <button
                        key={s.key}
                        onClick={() => onStatusChange(s.key)}
                        className={`w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 flex items-center gap-2 ${c.status === s.key ? 'bg-slate-50 font-semibold' : ''}`}
                      >
                        <span className={`w-2 h-2 rounded-full ${STATUS_COLORS[s.key]?.split(' ')[0] || 'bg-slate-400'}`} />
                        {s.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {brands.map((b) => (
                <span key={`b-${b}`} className="text-xs font-bold bg-myriad-primary/25 text-myriad-ink px-2.5 py-1 rounded-md flex items-center gap-1">
                  <TagIcon size={11} /> {b}
                </span>
              ))}
              {platforms.map((p) => (
                <span key={`p-${p}`} className="text-xs font-bold bg-sky-100 text-sky-800 px-2.5 py-1 rounded-md flex items-center gap-1">
                  <Globe size={11} /> {p}
                </span>
              ))}
              {infringementTypes.map((t) => (
                <span
                  key={`t-${t}`}
                  className={`text-xs font-bold px-2.5 py-1 rounded-md flex items-center gap-1 ${INFRINGEMENT_COLORS[t] || 'bg-slate-100 text-slate-700'}`}
                >
                  <AlertCircle size={11} /> {t}
                </span>
              ))}
            </div>
            <h1 className="text-2xl font-bold text-slate-900">{c.title}</h1>
            <div className="text-xs text-slate-500 mt-2 flex items-center gap-3 flex-wrap">
              <span className="flex items-center gap-1">
                <Clock size={11} /> {new Date(c.created_at).toLocaleString('ko-KR')}
                <span className="text-slate-400">· {createdName}</span>
              </span>
              {c.updated_at !== c.created_at && (
                <span className="text-slate-400">
                  · 수정 {new Date(c.updated_at).toLocaleString('ko-KR')}
                </span>
              )}
            </div>

            {(postUrls.length > 0 || c.gmail_thread_url) && (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {postUrls.map((u, idx) => (
                  <a
                    key={`u-${idx}`}
                    href={u}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs inline-flex items-center gap-1 text-sky-700 hover:text-sky-900 bg-sky-50 border border-sky-200 rounded-lg px-2.5 py-1"
                    title={u}
                  >
                    <LinkIcon size={11} />
                    원본 게시물{postUrls.length > 1 ? ` ${idx + 1}` : ''} 열기
                    <ExternalLink size={10} />
                  </a>
                ))}
                {c.gmail_thread_url && (
                  <a
                    href={c.gmail_thread_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs inline-flex items-center gap-1 text-sky-700 hover:text-sky-900 bg-sky-50 border border-sky-200 rounded-lg px-2.5 py-1"
                  >
                    <Mail size={11} /> Gmail 원본 <ExternalLink size={10} />
                  </a>
                )}
              </div>
            )}
          </div>

          {canEdit && (
            <button
              onClick={onEdit}
              className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm px-3 py-1.5 rounded-lg font-semibold"
            >
              <Edit3 size={13} /> 편집
            </button>
          )}
        </div>

        {/* Gmail 첨부 (있을 때만, 기본 접힘 상태) */}
        {c.gmail_body_text && (
          <details className="border-t border-slate-100 pt-5 group">
            <summary className="cursor-pointer flex items-center gap-2 text-sm font-semibold text-sky-900 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-lg px-3 py-2 transition list-none">
              <Mail size={14} className="text-sky-600 shrink-0" />
              <span className="flex-1 min-w-0 truncate">
                📧 {c.gmail_subject || '(제목 없음)'}
              </span>
              <span className="text-[11px] text-sky-700/70 font-normal hidden md:inline">
                {c.gmail_from?.replace(/<.*>/, '').trim()}
                {c.gmail_date && ` · ${new Date(c.gmail_date).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}`}
              </span>
              <span className="text-[11px] text-sky-600 font-normal shrink-0 group-open:hidden">▼ 펼치기</span>
              <span className="text-[11px] text-sky-600 font-normal shrink-0 hidden group-open:inline">▲ 접기</span>
            </summary>
            <div className="mt-2 bg-white border border-sky-200 border-t-0 rounded-b-lg -mt-px">
              <div className="px-4 py-2 bg-sky-50/50 border-b border-sky-100 text-[11px] text-slate-600 grid grid-cols-1 md:grid-cols-3 gap-2">
                <div><b>From:</b> {c.gmail_from || '—'}</div>
                <div><b>Date:</b> {c.gmail_date ? new Date(c.gmail_date).toLocaleString('ko-KR') : '—'}</div>
                <div className="md:col-span-1 truncate"><b>Subject:</b> {c.gmail_subject || '—'}</div>
              </div>
              <div className="px-4 py-3 text-sm text-slate-800 whitespace-pre-wrap leading-relaxed max-h-[60vh] overflow-auto">
                {c.gmail_body_text}
              </div>
            </div>
          </details>
        )}

        {/* 본문 */}
        {c.body_html && c.body_html !== '<p></p>' ? (
          <div
            className="case-prose border-t border-slate-100 pt-5 mt-4"
            dangerouslySetInnerHTML={{ __html: c.body_html }}
          />
        ) : !c.gmail_body_text ? (
          <p className="text-sm text-slate-400 italic border-t border-slate-100 pt-5">
            본문이 없습니다.
          </p>
        ) : null}
      </article>

      {/* 도움 요청 섹션 */}
      <HelpRequestsSection
        caseId={c.id}
        helpRequests={helpRequests}
        members={members}
        profiles={profiles}
        user={user}
        isAdmin={isAdmin}
        onChanged={onHelpRequestsChanged}
      />

      {/* 조치 항목 체크리스트 */}
      <TasksSection
        caseId={c.id}
        tasks={tasks}
        members={members}
        profiles={profiles}
        user={user}
        isAdmin={isAdmin}
        onChanged={onTasksChanged}
      />

      {/* 처리 현황 (자유 노트) */}
      <WorkflowNotesSection
        caseId={c.id}
        wfNotes={wfNotes}
        profiles={profiles}
        user={user}
        onChanged={onWfNotesChanged}
      />

      {/* 첨부 갤러리 */}
      {attachments.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
            📎 첨부 이미지 <span className="text-slate-400 font-normal">{attachments.length}장</span>
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {attachments.map((a) => {
              const url = attachmentUrls[a.storage_path]
              return (
                <a
                  key={a.id}
                  href={url || '#'}
                  target="_blank"
                  rel="noreferrer"
                  className="block bg-slate-100 rounded-lg overflow-hidden aspect-square group relative"
                >
                  {url ? (
                    <img src={url} alt={a.file_name} className="w-full h-full object-cover group-hover:scale-105 transition" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Loader2 size={14} className="animate-spin text-slate-400" />
                    </div>
                  )}
                </a>
              )
            })}
          </div>
        </div>
      )}

      {/* 댓글 */}
      <CommentsSection
        caseId={c.id}
        caseTitle={c.title}
        comments={comments}
        profiles={profiles}
        user={user}
        isAdmin={isAdmin}
        onChanged={onCommentsChanged}
      />

      {/* 히스토리 타임라인 */}
      <HistoryTimeline
        caseData={c}
        statusLog={statusLog}
        helpRequests={helpRequests}
        comments={comments}
        tasks={tasks}
        profiles={profiles}
      />
    </>
  )
}

// ─────────────────────────────────────────────────────
// 도움 요청 섹션
// ─────────────────────────────────────────────────────

function HelpRequestsSection({ caseId, helpRequests, members, profiles, user, isAdmin, onChanged }) {
  const [input, setInput] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const existingIds = useMemo(
    () => new Set(helpRequests.filter((h) => !h.is_team_all).map((h) => h.recipient_id)),
    [helpRequests]
  )
  const hasTeamAll = helpRequests.some((h) => h.is_team_all)

  const suggestions = useMemo(() => {
    const base = []
    if (!hasTeamAll) {
      base.push({ id: 'team_all', label: '온라인팀 전체', isTeamAll: true })
    }
    for (const m of members) {
      if (m.id === user?.id) continue             // 본인 제외
      if (existingIds.has(m.id)) continue          // 이미 요청된 사람 제외
      const name = m.full_name || m.email?.split('@')[0] || '?'
      base.push({ id: m.id, label: name, email: m.email })
    }
    const q = input.trim().toLowerCase()
    if (!q) return base
    return base.filter((s) =>
      s.label.toLowerCase().includes(q) || s.email?.toLowerCase().includes(q)
    )
  }, [members, hasTeamAll, existingIds, user?.id, input])

  async function handleAdd(item) {
    if (busy) return
    setBusy(true)
    try {
      await addCaseHelpRequest(caseId, item.isTeamAll ? 'team_all' : item.id, user.id)
      setInput('')
      setPickerOpen(false)
      onChanged?.()
    } catch (e) {
      alert('요청 추가 실패: ' + e.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove(h) {
    try {
      await removeCaseHelpRequest(h.id)
      onChanged?.()
    } catch (e) {
      alert('요청 해제 실패: ' + e.message)
    }
  }

  const canRemove = (h) => h.requested_by === user?.id || isAdmin

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-4">
      <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
        <LifeBuoy size={14} className="text-amber-600" /> 도움 요청
        <span className="text-slate-400 font-normal text-xs">
          {helpRequests.length === 0 ? '아직 없음' : `${helpRequests.length}건`}
        </span>
      </h2>

      <div className="flex flex-wrap gap-2 items-center">
        {helpRequests.map((h) => {
          const label = h.is_team_all
            ? '🌐 온라인팀 전체'
            : (profiles[h.recipient_id]?.full_name
               || profiles[h.recipient_id]?.email?.split('@')[0]
               || '—')
          return (
            <span
              key={h.id}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                h.is_team_all
                  ? 'bg-purple-100 text-purple-800'
                  : 'bg-amber-100 text-amber-800'
              }`}
            >
              {!h.is_team_all && <Users size={11} />}
              {label}
              {canRemove(h) && (
                <button
                  onClick={() => handleRemove(h)}
                  className="hover:bg-black/10 rounded-full p-0.5"
                  title="요청 해제"
                >
                  <XIcon size={10} />
                </button>
              )}
            </span>
          )
        })}

        {/* 추가 버튼 / 피커 */}
        <div className="relative">
          {!pickerOpen ? (
            <button
              onClick={() => setPickerOpen(true)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-myriad-ink bg-slate-100 hover:bg-slate-200 px-2.5 py-1 rounded-full"
            >
              <Plus size={11} /> 요청 추가
            </button>
          ) : (
            <div className="inline-flex items-center gap-1">
              <input
                autoFocus
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onBlur={() => setTimeout(() => setPickerOpen(false), 150)}
                placeholder="이름 입력..."
                className="text-xs px-2 py-1 border border-slate-300 rounded-full w-32 focus:outline-none focus:ring-2 focus:ring-myriad-primary/40"
              />
              {suggestions.length > 0 && (
                <div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-10 w-56 max-h-60 overflow-auto">
                  {suggestions.map((s) => (
                    <button
                      key={s.id}
                      onMouseDown={(e) => { e.preventDefault(); handleAdd(s) }}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 flex items-center gap-2"
                    >
                      {s.isTeamAll ? <span>🌐</span> : <UserPlus size={11} className="text-slate-400" />}
                      <span className={s.isTeamAll ? 'font-semibold text-purple-700' : ''}>
                        {s.label}
                      </span>
                      {s.email && !s.isTeamAll && (
                        <span className="text-slate-400 ml-auto truncate">{s.email}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {helpRequests.length === 0 && !pickerOpen && (
        <p className="text-xs text-slate-400 mt-2">
          조치가 필요한 케이스라면 도움을 요청할 팀원이나 전체팀을 지정하세요. 지정된 순간 알림이 발송됩니다.
        </p>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────
// 조치 항목 (체크리스트)
// ─────────────────────────────────────────────────────

function TasksSection({ caseId, tasks, members, profiles, user, isAdmin, onChanged }) {
  const [newContent, setNewContent] = useState('')
  const [newAssignee, setNewAssignee] = useState('')
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState({ content: '', assignee_id: '' })
  const [busy, setBusy] = useState(false)

  const doneCount = tasks.filter((t) => t.status === 'done').length
  const totalCount = tasks.length
  const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0

  async function handleAdd() {
    const content = newContent.trim()
    if (!content || busy) return
    setBusy(true)
    try {
      // 신규 태스크는 맨 뒤에 붙이기
      const nextOrder = tasks.length > 0
        ? Math.max(...tasks.map((t) => t.sort_order ?? 0)) + 1
        : 0
      await createCaseTask(caseId, content, newAssignee || null, user.id, nextOrder)
      setNewContent('')
      setNewAssignee('')
      setAdding(false)
      onChanged?.()
    } catch (e) {
      alert('조치 항목 추가 실패: ' + e.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleToggle(t) {
    const next = t.status === 'done' ? 'pending' : 'done'
    try {
      await toggleCaseTask(t.id, next)
      onChanged?.()
    } catch (e) {
      alert('상태 변경 실패: ' + e.message)
    }
  }

  function startEdit(t) {
    setEditingId(t.id)
    setEditDraft({ content: t.content, assignee_id: t.assignee_id || '' })
  }

  async function saveEdit(t) {
    const content = editDraft.content.trim()
    if (!content) return
    try {
      await updateCaseTask(t.id, {
        content,
        assignee_id: editDraft.assignee_id || null
      })
      setEditingId(null)
      onChanged?.()
    } catch (e) {
      alert('수정 실패: ' + e.message)
    }
  }

  async function handleDelete(t) {
    if (!window.confirm('이 조치 항목을 삭제할까요?')) return
    try {
      await deleteCaseTask(t.id)
      onChanged?.()
    } catch (e) {
      alert('삭제 실패: ' + e.message)
    }
  }

  const canDelete = (t) => t.created_by === user?.id || isAdmin

  function nameOf(id) {
    if (!id) return null
    const p = profiles[id] || members.find((m) => m.id === id)
    return p?.full_name || p?.email?.split('@')[0] || '—'
  }

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <ListChecks size={14} className="text-sky-600" /> 조치 항목
          {totalCount > 0 && (
            <span className="text-xs font-normal text-slate-500">
              {doneCount}/{totalCount} 완료 ({pct}%)
            </span>
          )}
        </h2>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-myriad-ink bg-slate-100 hover:bg-slate-200 px-2.5 py-1 rounded-full"
          >
            <Plus size={11} /> 항목 추가
          </button>
        )}
      </div>

      {/* 진행도 막대 */}
      {totalCount > 0 && (
        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mb-3">
          <div
            className="h-full bg-emerald-400 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {/* 조치 항목 리스트 */}
      {tasks.length === 0 && !adding ? (
        <p className="text-xs text-slate-400 py-2">
          이 케이스의 조치 단계를 항목별로 쪼개어 담당자와 함께 관리하세요.
        </p>
      ) : (
        <ul className="space-y-1.5 mb-2">
          {tasks.map((t) => {
            const isEditing = editingId === t.id
            const isDone = t.status === 'done'
            const assigneeName = nameOf(t.assignee_id)
            return (
              <li
                key={t.id}
                className={`flex items-start gap-2 px-2 py-1.5 rounded-lg ${
                  isDone ? 'bg-slate-50' : 'hover:bg-slate-50'
                }`}
              >
                <button
                  onClick={() => handleToggle(t)}
                  className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 transition ${
                    isDone
                      ? 'bg-emerald-500 border-emerald-500 text-white'
                      : 'border-slate-300 hover:border-emerald-400'
                  }`}
                  title={isDone ? '완료 해제' : '완료 체크'}
                >
                  {isDone && <CheckCircle2 size={10} />}
                </button>

                {isEditing ? (
                  <div className="flex-1 flex flex-col gap-1.5">
                    <input
                      value={editDraft.content}
                      onChange={(e) => setEditDraft({ ...editDraft, content: e.target.value })}
                      className="text-sm px-2 py-1 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-myriad-primary/40"
                      autoFocus
                    />
                    <div className="flex items-center gap-2">
                      <select
                        value={editDraft.assignee_id}
                        onChange={(e) => setEditDraft({ ...editDraft, assignee_id: e.target.value })}
                        className="text-xs px-2 py-1 border border-slate-300 rounded bg-white"
                      >
                        <option value="">담당자 없음</option>
                        {members.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.full_name || m.email?.split('@')[0]}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => saveEdit(t)}
                        className="text-[11px] px-2 py-1 bg-myriad-primary text-myriad-ink rounded font-semibold"
                      >
                        저장
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="text-[11px] px-2 py-1 border border-slate-300 rounded"
                      >
                        취소
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-sm leading-relaxed ${
                          isDone ? 'text-slate-400 line-through' : 'text-slate-800'
                        }`}
                      >
                        {t.content}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-500">
                        {assigneeName && (
                          <span className="inline-flex items-center gap-0.5 bg-sky-50 text-sky-700 px-1.5 py-0.5 rounded font-semibold">
                            <UserPlus size={9} /> {assigneeName}
                          </span>
                        )}
                        {isDone && t.completed_at && (
                          <span className="text-slate-400">
                            · 완료 {new Date(t.completed_at).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}
                            {t.completed_by && ` · ${nameOf(t.completed_by)}`}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => startEdit(t)}
                        className="text-slate-400 hover:text-slate-700 p-1"
                        title="편집"
                      >
                        <Edit3 size={11} />
                      </button>
                      {canDelete(t) && (
                        <button
                          onClick={() => handleDelete(t)}
                          className="text-rose-400 hover:text-rose-600 p-1"
                          title="삭제"
                        >
                          <Trash2 size={11} />
                        </button>
                      )}
                    </div>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {/* 신규 조치 항목 입력 */}
      {adding && (
        <div className="border-t border-slate-100 pt-3 flex flex-col gap-2">
          <input
            autoFocus
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="조치 내용 (예: 판매자 연락처 확인 후 DM 발송)"
            className="text-sm px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent?.isComposing) {
                e.preventDefault()
                handleAdd()
              } else if (e.key === 'Escape') {
                setAdding(false); setNewContent(''); setNewAssignee('')
              }
            }}
          />
          <div className="flex items-center gap-2">
            <select
              value={newAssignee}
              onChange={(e) => setNewAssignee(e.target.value)}
              className="text-xs px-2 py-1.5 border border-slate-300 rounded bg-white"
            >
              <option value="">담당자 없음</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.full_name || m.email?.split('@')[0]}
                </option>
              ))}
            </select>
            <button
              onClick={handleAdd}
              disabled={busy || !newContent.trim()}
              className="text-xs font-semibold bg-myriad-primary hover:bg-myriad-primaryDark disabled:bg-slate-200 text-myriad-ink px-3 py-1.5 rounded-lg"
            >
              {busy ? <Loader2 size={11} className="animate-spin" /> : '추가'}
            </button>
            <button
              onClick={() => { setAdding(false); setNewContent(''); setNewAssignee('') }}
              className="text-xs text-slate-500 hover:text-slate-700 px-2"
            >
              취소
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────
// 처리 현황 (자유 기록 — TipTap)
// ─────────────────────────────────────────────────────

function WorkflowNotesSection({ caseId, wfNotes, profiles, user, onChanged }) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [draftHtml, setDraftHtml] = useState('')
  const [draftText, setDraftText] = useState('')

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      TiptapLink.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener' } }),
      Placeholder.configure({
        placeholder: '이 케이스가 현재 어떻게 처리되고 있는지 팀원과 자유롭게 정리하는 공간입니다. (예: 접근 전략, 참고 링크, 진행 상황, 결정사항 등)'
      })
    ],
    content: wfNotes?.body_html || '',
    onUpdate: ({ editor }) => {
      setDraftHtml(editor.getHTML())
      setDraftText(editor.getText())
    },
    editorProps: {
      attributes: { class: 'case-prose max-w-none focus:outline-none px-4 py-3 min-h-[120px]' }
    },
    editable: editing
  }, [editing, wfNotes?.body_html])

  // 편집 시작 시 현재 저장된 내용을 에디터에 주입
  useEffect(() => {
    if (editing && editor) {
      editor.commands.setContent(wfNotes?.body_html || '')
      setDraftHtml(wfNotes?.body_html || '')
      setDraftText('')
    }
  }, [editing, editor])

  async function handleSave() {
    setSaving(true)
    try {
      await upsertCaseWorkflowNotes(caseId, draftHtml, draftText, user.id)
      setEditing(false)
      onChanged?.()
    } catch (e) {
      alert('저장 실패: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  function handleCancel() {
    setEditing(false)
    setDraftHtml('')
    setDraftText('')
  }

  const lastEditor = wfNotes?.updated_by ? profiles[wfNotes.updated_by] : null
  const lastEditorName =
    lastEditor?.full_name || lastEditor?.email?.split('@')[0] || '—'

  const hasContent = wfNotes?.body_html && wfNotes.body_html !== '<p></p>'

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <NotebookPen size={14} className="text-purple-600" /> 처리 현황
          <span className="text-xs font-normal text-slate-400">(팀 공동 편집)</span>
        </h2>
        {!editing ? (
          <button
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-myriad-ink bg-slate-100 hover:bg-slate-200 px-2.5 py-1 rounded-full"
          >
            <Edit3 size={11} /> 편집
          </button>
        ) : (
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-1 text-xs font-semibold bg-myriad-primary hover:bg-myriad-primaryDark disabled:bg-slate-200 text-myriad-ink px-3 py-1 rounded-lg"
            >
              {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
              저장
            </button>
            <button
              onClick={handleCancel}
              className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1"
            >
              취소
            </button>
          </div>
        )}
      </div>

      {editing ? (
        <div className="border border-slate-200 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-myriad-primary/40">
          <EditorContent editor={editor} />
        </div>
      ) : hasContent ? (
        <div
          className="case-prose"
          dangerouslySetInnerHTML={{ __html: wfNotes.body_html }}
        />
      ) : (
        <p className="text-xs text-slate-400 py-3">
          아직 작성된 내용이 없습니다. 편집 버튼을 눌러 처리 상황을 기록해보세요.
        </p>
      )}

      {wfNotes?.updated_at && !editing && (
        <p className="text-[10px] text-slate-400 mt-3">
          마지막 편집: {lastEditorName} · {new Date(wfNotes.updated_at).toLocaleString('ko-KR')}
        </p>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────
// 히스토리 타임라인
// ─────────────────────────────────────────────────────

function HistoryTimeline({ caseData, statusLog, helpRequests, comments, tasks, profiles }) {
  const events = useMemo(() => {
    const list = []
    // 생성
    list.push({
      kind: 'created',
      at: caseData.created_at,
      actor: caseData.created_by
    })
    // 상태 변경
    for (const s of statusLog) {
      list.push({
        kind: 'status',
        at: s.changed_at,
        actor: s.changed_by,
        from: s.from_status,
        to: s.to_status
      })
    }
    // 도움 요청
    for (const h of helpRequests) {
      list.push({
        kind: 'help_request',
        at: h.requested_at,
        actor: h.requested_by,
        recipient: h.recipient_id,
        isTeamAll: h.is_team_all
      })
    }
    // 태스크 생성 + 완료
    for (const t of tasks || []) {
      list.push({
        kind: 'task_created',
        at: t.created_at,
        actor: t.created_by,
        content: t.content,
        assignee: t.assignee_id
      })
      if (t.status === 'done' && t.completed_at) {
        list.push({
          kind: 'task_done',
          at: t.completed_at,
          actor: t.completed_by,
          content: t.content
        })
      }
    }
    // 댓글
    for (const c of comments) {
      list.push({
        kind: 'comment',
        at: c.created_at,
        actor: c.author_id,
        body: c.body
      })
    }
    // 최신 → 과거
    return list.sort((a, b) => new Date(b.at) - new Date(a.at))
  }, [caseData, statusLog, helpRequests, comments, tasks])

  function nameOf(id) {
    const p = profiles[id]
    return p?.full_name || p?.email?.split('@')[0] || '—'
  }

  function renderEvent(e) {
    const who = nameOf(e.actor)
    if (e.kind === 'created') {
      return <>🆕 <b>{who}</b> 님이 케이스를 등록했습니다.</>
    }
    if (e.kind === 'status') {
      const fromLabel = STATUS_LABELS[e.from] || e.from || '시작'
      const toLabel = STATUS_LABELS[e.to] || e.to
      return <>🔄 <b>{who}</b> 님이 상태를 <i>{fromLabel}</i> → <b>{toLabel}</b> 로 변경.</>
    }
    if (e.kind === 'help_request') {
      const target = e.isTeamAll ? '온라인팀 전체' : nameOf(e.recipient)
      return <>🆘 <b>{who}</b> 님이 <b>{target}</b> 에게 도움 요청.</>
    }
    if (e.kind === 'task_created') {
      const preview = e.content?.length > 80 ? e.content.slice(0, 80) + '...' : e.content
      const assignSuffix = e.assignee ? <> (담당: <b>{nameOf(e.assignee)}</b>)</> : null
      return <>📝 <b>{who}</b> 조치 항목 추가: <span className="text-slate-600">{preview}</span>{assignSuffix}</>
    }
    if (e.kind === 'task_done') {
      const preview = e.content?.length > 80 ? e.content.slice(0, 80) + '...' : e.content
      return <>✅ <b>{who}</b> 조치 항목 완료: <span className="text-slate-600">{preview}</span></>
    }
    if (e.kind === 'comment') {
      const preview = e.body?.length > 80 ? e.body.slice(0, 80) + '...' : e.body
      return <>💬 <b>{who}</b>: <span className="text-slate-600">{preview}</span></>
    }
    return null
  }

  function dotColor(kind) {
    switch (kind) {
      case 'created': return 'bg-sky-400'
      case 'status': return 'bg-amber-400'
      case 'help_request': return 'bg-purple-400'
      case 'task_created': return 'bg-cyan-400'
      case 'task_done': return 'bg-emerald-500'
      case 'comment': return 'bg-slate-400'
      default: return 'bg-slate-300'
    }
  }

  if (events.length === 0) return null

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 mt-4">
      <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
        <History size={14} /> 히스토리
        <span className="text-slate-400 font-normal text-xs">{events.length}개 이벤트</span>
      </h2>
      <ol className="space-y-3 border-l-2 border-slate-200 ml-2 pl-5 relative">
        {events.map((e, i) => (
          <li key={i} className="relative">
            <span
              className={`absolute -left-[27px] top-1.5 w-3 h-3 rounded-full ${dotColor(e.kind)} border-2 border-white ring-1 ring-slate-200`}
            />
            <p className="text-[11px] text-slate-400">
              {new Date(e.at).toLocaleString('ko-KR')}
            </p>
            <p className="text-sm text-slate-800 leading-relaxed mt-0.5">
              {renderEvent(e)}
            </p>
          </li>
        ))}
      </ol>
    </div>
  )
}

// ─────────────────────────────────────────────────────
// Comments Section
// ─────────────────────────────────────────────────────

function CommentsSection({ caseId, caseTitle, comments, profiles, user, isAdmin, onChanged }) {
  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState('')
  // 삭제된 ID 를 즉시 숨김 처리 (optimistic UI). onChanged() 가 끝나면 자동으로 정합.
  const [pendingDeletedIds, setPendingDeletedIds] = useState(new Set())

  // 부모로부터 새 comments 가 내려오면 pending 클리어
  useEffect(() => {
    setPendingDeletedIds(new Set())
  }, [comments])

  async function submit() {
    const body = draft.trim()
    if (!body || !user) return
    setSubmitting(true)
    try {
      await createCaseComment(caseId, body, user.id, caseTitle)
      setDraft('')
      onChanged?.()
    } catch (e) {
      alert('댓글 작성 실패: ' + e.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function submitEdit(c) {
    const body = editDraft.trim()
    if (!body) return
    try {
      await updateCaseComment(c.id, body)
      setEditingId(null)
      setEditDraft('')
      onChanged?.()
    } catch (e) {
      alert('수정 실패: ' + e.message)
    }
  }

  async function handleDelete(c) {
    if (!window.confirm('이 댓글을 삭제할까요?')) return
    // 즉시 UI 에서 숨김 (optimistic) — 사용자 체감 빠름
    setPendingDeletedIds((prev) => new Set([...prev, c.id]))
    try {
      await deleteCaseComment(c.id)
      onChanged?.()    // 부모가 loadComments() 재호출 → 정합 확인
    } catch (e) {
      // 실패 시 숨김 해제 (롤백)
      setPendingDeletedIds((prev) => {
        const next = new Set(prev)
        next.delete(c.id)
        return next
      })
      alert('삭제 실패: ' + e.message)
    }
  }

  // 화면에 그릴 댓글 = 부모 props 에서 pending 삭제분 제외
  const visibleComments = comments.filter((c) => !pendingDeletedIds.has(c.id))

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5">
      <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
        <MessageSquare size={14} /> 댓글 <span className="text-slate-400 font-normal">{visibleComments.length}개</span>
      </h2>

      {visibleComments.length === 0 ? (
        <p className="text-xs text-slate-400 py-3 text-center">아직 댓글이 없습니다. 의견을 남겨보세요.</p>
      ) : (
        <ul className="space-y-2 mb-4">
          {visibleComments.map((c) => {
            const p = profiles[c.author_id]
            const author = p?.full_name || p?.email?.split('@')[0] || '알 수 없음'
            const isMine = c.author_id === user?.id
            const canModify = isMine || isAdmin
            return (
              <li key={c.id} className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                <div className="flex items-start gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-myriad-primary/20 text-myriad-ink flex items-center justify-center text-[11px] font-bold shrink-0">
                    {author[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap text-xs">
                      <span className="font-semibold text-slate-900">{author}</span>
                      <span className="text-slate-400">·</span>
                      <span className="text-slate-500 flex items-center gap-0.5">
                        <Clock size={9} /> {new Date(c.created_at).toLocaleString('ko-KR')}
                        {c.updated_at !== c.created_at && ' (수정됨)'}
                      </span>
                    </div>
                    {editingId === c.id ? (
                      <div className="mt-2 flex gap-2">
                        <textarea
                          value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          rows={2}
                          className="flex-1 text-sm px-2 py-1.5 border border-slate-300 rounded resize-none"
                          autoFocus
                        />
                        <div className="flex flex-col gap-1">
                          <button
                            onClick={() => submitEdit(c)}
                            className="text-[11px] px-2 py-1 bg-myriad-primary text-myriad-ink rounded font-semibold"
                          >
                            저장
                          </button>
                          <button
                            onClick={() => { setEditingId(null); setEditDraft('') }}
                            className="text-[11px] px-2 py-1 border border-slate-300 rounded"
                          >
                            취소
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="text-sm text-slate-800 whitespace-pre-wrap mt-1 leading-relaxed">
                          {c.body}
                        </p>
                        {canModify && (
                          <div className="flex items-center gap-2 mt-2">
                            {isMine && (
                              <button
                                onClick={() => { setEditingId(c.id); setEditDraft(c.body) }}
                                className="text-[11px] text-slate-500 hover:text-slate-900 flex items-center gap-0.5"
                              >
                                <Edit3 size={10} /> 수정
                              </button>
                            )}
                            <button
                              onClick={() => handleDelete(c)}
                              className="text-[11px] text-rose-500 hover:text-rose-700 flex items-center gap-0.5"
                            >
                              <Trash2 size={10} /> 삭제
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {/* 새 댓글 입력 */}
      <div className="flex gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          placeholder="이 케이스에 대한 의견/질문 남기기... (Enter 전송 / Shift+Enter 줄바꿈)"
          className="flex-1 text-sm px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40 resize-none"
          onKeyDown={(e) => {
            // Enter 단독 → 전송. Shift+Enter → 기본 동작(줄바꿈).
            // 한글 IME 조합 중에는 Enter 가 조합 확정용으로 사용되므로 무시.
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent?.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <button
          onClick={submit}
          disabled={submitting || !draft.trim()}
          className="flex items-center justify-center gap-1 bg-myriad-primary hover:bg-myriad-primaryDark disabled:bg-slate-200 text-myriad-ink font-semibold px-4 rounded-lg disabled:cursor-not-allowed"
        >
          {submitting ? <Loader2 size={12} className="animate-spin" /> : <Send size={13} />}
        </button>
      </div>
    </div>
  )
}
