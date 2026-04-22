import { useEffect, useState } from 'react'
import {
  MessageSquare, Send, Loader2, Trash2, Edit3, CheckCircle2, Circle,
  MessageCircle, Clock
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  listComments, createComment, updateCommentBody, toggleCommentResolved,
  deleteComment
} from '../lib/comments'
import { getProfileShort, logActivity } from '../lib/community'
import { useAuth } from '../contexts/AuthContext'

function relativeTime(iso) {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return '방금'
  if (min < 60) return `${min}분 전`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}시간 전`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}일 전`
  return new Date(iso).toLocaleDateString('ko-KR')
}

export default function BrandReportComments({ report, defaultOpen = false }) {
  const { user, isAdmin } = useAuth()
  const [open, setOpen] = useState(defaultOpen)
  const [comments, setComments] = useState([])
  const [profiles, setProfiles] = useState({})
  const [loading, setLoading] = useState(false)
  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState('')

  useEffect(() => {
    if (!open) return
    load()
  }, [open, report.id])

  useEffect(() => {
    if (!open) return
    const ch = supabase
      .channel(`brc-${report.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'brand_report_comments', filter: `brand_report_id=eq.${report.id}` },
        () => load()
      )
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [open, report.id])

  async function load() {
    setLoading(true)
    try {
      const list = await listComments(report.id)
      setComments(list)
      // 프로필 일괄 조회
      const ids = [...new Set(list.map((c) => c.author_id).filter(Boolean))]
      const pmap = { ...profiles }
      await Promise.all(
        ids.filter((id) => !pmap[id]).map(async (id) => {
          pmap[id] = await getProfileShort(id)
        })
      )
      setProfiles(pmap)
    } finally {
      setLoading(false)
    }
  }

  async function submit() {
    const body = draft.trim()
    if (!body || !user) return
    setSubmitting(true)
    try {
      const c = await createComment(report.id, body, user.id)
      setDraft('')
      logActivity('comment_posted', {
        target_type: 'brand_report',
        target_id: report.id,
        payload: {
          brand: report.brand_name,
          group_id: report.group_id,
          preview: body.slice(0, 80)
        }
      })
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
      await updateCommentBody(c.id, body)
      setEditingId(null)
      setEditDraft('')
    } catch (e) {
      alert('수정 실패: ' + e.message)
    }
  }

  async function handleResolveToggle(c) {
    try {
      const newResolved = await toggleCommentResolved(c, user.id)
      if (newResolved) {
        logActivity('comment_resolved', {
          target_type: 'brand_report',
          target_id: report.id,
          payload: { brand: report.brand_name, group_id: report.group_id }
        })
      }
    } catch (e) {
      alert('상태 변경 실패: ' + e.message)
    }
  }

  async function handleDelete(c) {
    if (!window.confirm('이 댓글을 삭제할까요?')) return
    try {
      await deleteComment(c.id)
    } catch (e) {
      alert('삭제 실패: ' + e.message)
    }
  }

  const openCount = comments.filter((c) => !c.resolved).length

  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-xs text-slate-600 hover:text-myriad-ink w-full"
      >
        <MessageSquare size={12} />
        <span className="font-semibold">댓글</span>
        {comments.length > 0 && (
          <span className="text-slate-400">({comments.length})</span>
        )}
        {openCount > 0 && (
          <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded-full">
            <Circle size={7} className="fill-current" />
            미해결 {openCount}
          </span>
        )}
        <div className="flex-1" />
        <span className="text-[10px] text-slate-400">
          {open ? '접기' : '펼치기'}
        </span>
      </button>

      {open && (
        <div className="mt-3 space-y-2">
          {loading && comments.length === 0 ? (
            <div className="text-xs text-slate-400 flex items-center gap-1 py-2">
              <Loader2 size={11} className="animate-spin" /> 불러오는 중...
            </div>
          ) : comments.length === 0 ? (
            <div className="text-xs text-slate-400 py-2 text-center">
              아직 댓글이 없습니다. 첫 피드백을 남겨보세요.
            </div>
          ) : (
            <ul className="space-y-2">
              {comments.map((c) => {
                const p = profiles[c.author_id]
                const author = p?.full_name || p?.email?.split('@')[0] || '알 수 없음'
                const isMine = c.author_id === user?.id
                const canModify = isMine || isAdmin
                return (
                  <li
                    key={c.id}
                    className={`text-xs rounded-lg p-3 ${
                      c.resolved
                        ? 'bg-slate-50 border border-slate-200 opacity-70'
                        : 'bg-amber-50 border border-amber-200'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <div className="w-6 h-6 rounded-full bg-myriad-primary/20 text-myriad-ink flex items-center justify-center text-[10px] font-bold shrink-0">
                        {author[0]?.toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-semibold text-slate-900">{author}</span>
                          <span className="text-slate-400">·</span>
                          <span className="text-slate-500 text-[11px] flex items-center gap-0.5">
                            <Clock size={9} /> {relativeTime(c.created_at)}
                            {c.updated_at !== c.created_at && ' (수정됨)'}
                          </span>
                          {c.resolved && (
                            <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                              <CheckCircle2 size={9} /> 해결됨
                            </span>
                          )}
                        </div>

                        {editingId === c.id ? (
                          <div className="mt-2 flex gap-2">
                            <textarea
                              value={editDraft}
                              onChange={(e) => setEditDraft(e.target.value)}
                              rows={2}
                              className="flex-1 text-xs px-2 py-1.5 border border-slate-300 rounded resize-none"
                              autoFocus
                            />
                            <div className="flex flex-col gap-1">
                              <button
                                onClick={() => submitEdit(c)}
                                className="text-[10px] px-2 py-1 bg-myriad-primary text-myriad-ink rounded font-semibold"
                              >
                                저장
                              </button>
                              <button
                                onClick={() => { setEditingId(null); setEditDraft('') }}
                                className="text-[10px] px-2 py-1 border border-slate-300 rounded"
                              >
                                취소
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-slate-800 whitespace-pre-wrap mt-1 leading-relaxed">
                            {c.body}
                          </p>
                        )}

                        {editingId !== c.id && (
                          <div className="flex items-center gap-2 mt-2">
                            <button
                              onClick={() => handleResolveToggle(c)}
                              className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
                                c.resolved
                                  ? 'bg-slate-200 text-slate-600 hover:bg-slate-300'
                                  : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                              }`}
                            >
                              {c.resolved ? '미해결로 되돌리기' : '해결로 표시'}
                            </button>
                            <div className="flex-1" />
                            {canModify && editingId === null && (
                              <>
                                {isMine && (
                                  <button
                                    onClick={() => { setEditingId(c.id); setEditDraft(c.body) }}
                                    className="text-[10px] text-slate-500 hover:text-slate-900 flex items-center gap-0.5"
                                  >
                                    <Edit3 size={9} /> 수정
                                  </button>
                                )}
                                <button
                                  onClick={() => handleDelete(c)}
                                  className="text-[10px] text-rose-500 hover:text-rose-700 flex items-center gap-0.5"
                                >
                                  <Trash2 size={9} /> 삭제
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          {/* 새 댓글 입력 */}
          <div className="flex gap-2 pt-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={2}
              placeholder="이 보고서에 대한 피드백/질문 남기기..."
              className="flex-1 text-xs px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40 resize-none"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault()
                  submit()
                }
              }}
            />
            <button
              onClick={submit}
              disabled={submitting || !draft.trim()}
              className="flex items-center justify-center gap-1 bg-myriad-primary hover:bg-myriad-primaryDark disabled:bg-slate-200 text-myriad-ink font-semibold px-3 rounded-lg disabled:cursor-not-allowed"
            >
              {submitting ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Send size={12} />
              )}
            </button>
          </div>
          <p className="text-[10px] text-slate-400 text-right">Ctrl+Enter 로 전송</p>
        </div>
      )}
    </div>
  )
}
