/**
 * 케이스 상세 페이지 (/community/cases/:id)
 *  - 신규 (/community/cases/new) 는 props.mode="new"
 *  - 뷰 모드: 메타데이터 + 본문(TipTap HTML 렌더) + 갤러리 + 댓글 + 상태 변경
 *  - 편집 모드: CaseEditor 재사용
 *  - 권한: 작성자/관리자만 편집·삭제
 */
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Edit3, Loader2, Briefcase, Tag as TagIcon, Globe, Link as LinkIcon,
  Mail, Clock, Circle, CheckCircle2, Send, Trash2, MessageSquare, ExternalLink,
  ChevronDown, AlertCircle
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import {
  getCase, createCase, updateCase, deleteCase, changeCaseStatus,
  listCaseAttachments, commitTmpAttachments, getAttachmentSignedUrls,
  listCaseComments, createCaseComment, updateCaseComment, deleteCaseComment,
  STATUS_OPTIONS, STATUS_LABELS, STATUS_COLORS, INFRINGEMENT_COLORS
} from '../lib/cases'
import { getProfileShort } from '../lib/community'
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cases', filter: `id=eq.${id}` }, () => loadCase())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'case_attachments', filter: `case_id=eq.${id}` }, () => loadAttachments())
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [id, isNew])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      await Promise.all([loadCase(), loadAttachments(), loadComments()])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
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
            brand: caseData.brand,
            // migration 014 에서 platform_other 가 platform 으로 통합됨.
            // 만약 아직 마이그레이션 전 데이터면 platform_other 로 폴백.
            platform: caseData.platform || caseData.platform_other || '',
            postUrl: caseData.post_url || '',
            infringementType: caseData.infringement_type,
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
          onEdit={() => setEditing(true)}
          canEdit={canEdit}
          statusMenuOpen={statusMenuOpen}
          setStatusMenuOpen={setStatusMenuOpen}
          onStatusChange={handleStatusChange}
          user={user}
          isAdmin={isAdmin}
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
  onEdit, canEdit, statusMenuOpen, setStatusMenuOpen, onStatusChange,
  user, isAdmin
}) {
  const c = caseData
  const createdProfile = profiles[c.created_by]
  const createdName = createdProfile?.full_name || createdProfile?.email?.split('@')[0] || '—'
  // migration 014 이후엔 platform 에 다 들어감. 이전 데이터 폴백.
  const platformLabel = c.platform || c.platform_other || '—'

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
              <span className="text-xs font-bold bg-myriad-primary/25 text-myriad-ink px-2.5 py-1 rounded-md flex items-center gap-1">
                <TagIcon size={11} /> {c.brand}
              </span>
              <span className="text-xs font-bold bg-sky-100 text-sky-800 px-2.5 py-1 rounded-md flex items-center gap-1">
                <Globe size={11} /> {platformLabel}
              </span>
              <span className={`text-xs font-bold px-2.5 py-1 rounded-md flex items-center gap-1 ${INFRINGEMENT_COLORS[c.infringement_type] || 'bg-slate-100 text-slate-700'}`}>
                <AlertCircle size={11} /> {c.infringement_type}
              </span>
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

            {(c.post_url || c.gmail_thread_url) && (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {c.post_url && (
                  <a
                    href={c.post_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs inline-flex items-center gap-1 text-sky-700 hover:text-sky-900 bg-sky-50 border border-sky-200 rounded-lg px-2.5 py-1"
                  >
                    <LinkIcon size={11} /> 원본 게시물 열기 <ExternalLink size={10} />
                  </a>
                )}
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
      />
    </>
  )
}

// ─────────────────────────────────────────────────────
// Comments Section
// ─────────────────────────────────────────────────────

function CommentsSection({ caseId, caseTitle, comments, profiles, user, isAdmin }) {
  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState('')

  async function submit() {
    const body = draft.trim()
    if (!body || !user) return
    setSubmitting(true)
    try {
      await createCaseComment(caseId, body, user.id, caseTitle)
      setDraft('')
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
    } catch (e) {
      alert('수정 실패: ' + e.message)
    }
  }

  async function handleDelete(c) {
    if (!window.confirm('이 댓글을 삭제할까요?')) return
    try {
      await deleteCaseComment(c.id)
    } catch (e) {
      alert('삭제 실패: ' + e.message)
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5">
      <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
        <MessageSquare size={14} /> 댓글 <span className="text-slate-400 font-normal">{comments.length}개</span>
      </h2>

      {comments.length === 0 ? (
        <p className="text-xs text-slate-400 py-3 text-center">아직 댓글이 없습니다. 의견을 남겨보세요.</p>
      ) : (
        <ul className="space-y-2 mb-4">
          {comments.map((c) => {
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
