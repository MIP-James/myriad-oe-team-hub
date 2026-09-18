/**
 * PostView — 게시글 상세 (인라인 패널). 본문 + 첨부 다운로드 + 댓글 + 상태 변경.
 */
import { useEffect, useState } from 'react'
import {
  X, Paperclip, Download, Edit3, Trash2, Loader2, Send, Pin, Calendar, MessageSquare
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { getProfileShort } from '../../lib/community'
import {
  ISSUE_STATUS, ISSUE_STATUS_MAP, SEVERITY_MAP, monthLabel, fmtBytes, fmtDate,
  listAttachments, signedUrls, listComments, addComment, deleteComment, patchPost
} from '../../lib/projects'

export default function PostView({ post, section, campaigns = [], onEdit, onDelete, onClose, onChanged }) {
  const { user, isAdmin } = useAuth()
  const [atts, setAtts] = useState([])
  const [urls, setUrls] = useState({})
  const [comments, setComments] = useState([])
  const [profiles, setProfiles] = useState({})
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!post?.id) return
    listAttachments(post.id).then(async (a) => {
      setAtts(a)
      setUrls(await signedUrls(a.map((x) => x.storage_path)))
    }).catch(() => {})
    loadComments()
  }, [post?.id])

  async function loadComments() {
    const c = await listComments(post.id).catch(() => [])
    setComments(c)
    const ids = [...new Set([post.created_by, ...c.map((x) => x.created_by)].filter(Boolean))]
    const map = {}
    await Promise.all(ids.map(async (id) => { map[id] = await getProfileShort(id) }))
    setProfiles(map)
  }

  async function send(e) {
    e.preventDefault()
    if (!draft.trim()) return
    setSending(true)
    try {
      await addComment(post.id, draft, user.id)
      setDraft('')
      await loadComments()
      onChanged?.()
    } finally { setSending(false) }
  }

  async function changeStatus(s) {
    await patchPost(post.id, { status: s, updated_by: user.id })
    onChanged?.()
  }

  const name = (id) => profiles[id]?.full_name || profiles[id]?.email?.split('@')[0] || '—'
  const campaign = campaigns.find((c) => c.id === post.campaign_id)
  const canDelete = isAdmin || post.created_by === user?.id

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
      <div className="flex items-start gap-3 px-5 py-4 border-b border-slate-100">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 mb-1">
            {post.pinned && <span className="text-[10px] font-bold text-myriad-ink bg-myriad-primary/30 px-1.5 py-0.5 rounded inline-flex items-center gap-0.5"><Pin size={9} /> 고정</span>}
            {section.kind === 'notice' && post.severity !== 'info' && (
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${SEVERITY_MAP[post.severity]?.cls}`}>{SEVERITY_MAP[post.severity]?.label}</span>
            )}
            {post.status !== 'none' && (
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${ISSUE_STATUS_MAP[post.status]?.cls}`}>{ISSUE_STATUS_MAP[post.status]?.label}</span>
            )}
            {post.period_month && <span className="text-[10px] font-semibold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">{monthLabel(post.period_month)}</span>}
            {campaign && <span className="text-[10px] font-semibold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">{campaign.title}</span>}
            {post.category && <span className="text-[10px] font-semibold text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded">{post.category}</span>}
            {post.due_on && (
              <span className="text-[10px] font-semibold text-slate-600 inline-flex items-center gap-0.5"><Calendar size={9} /> 기한 {fmtDate(post.due_on)}</span>
            )}
          </div>
          <h3 className="text-lg font-bold text-slate-900 leading-snug">{post.title}</h3>
          <div className="text-xs text-slate-500 mt-1">
            {name(post.created_by)} · {new Date(post.created_at).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })}
            {post.updated_at !== post.created_at && <span className="ml-1 text-slate-400">(수정됨)</span>}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={onEdit} className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg" title="수정"><Edit3 size={15} /></button>
          {canDelete && <button onClick={onDelete} className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg" title="삭제"><Trash2 size={15} /></button>}
          <button onClick={onClose} className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg" title="닫기"><X size={16} /></button>
        </div>
      </div>

      {section.kind === 'issues' && (
        <div className="px-5 py-2.5 border-b border-slate-100 flex items-center gap-2 text-xs">
          <span className="text-slate-500">상태 변경:</span>
          {ISSUE_STATUS.map((s) => (
            <button key={s.key} onClick={() => changeStatus(s.key)}
              className={`px-2 py-0.5 rounded-full font-semibold border ${post.status === s.key ? s.cls + ' border-transparent' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
              {s.label}
            </button>
          ))}
        </div>
      )}

      <div className="px-5 py-4">
        {post.body_html ? (
          <div className="case-prose !min-h-0" dangerouslySetInnerHTML={{ __html: post.body_html }} />
        ) : (
          <div className="text-sm text-slate-400 italic">본문 없음</div>
        )}
      </div>

      {atts.length > 0 && (
        <div className="px-5 pb-4">
          <div className="text-xs font-semibold text-slate-500 mb-1.5 flex items-center gap-1"><Paperclip size={11} /> 첨부 {atts.length}</div>
          <ul className="space-y-1">
            {atts.map((a) => (
              <li key={a.id}>
                <a href={urls[a.storage_path] || '#'} target="_blank" rel="noopener" download={a.file_name}
                  className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg border border-slate-200 hover:border-myriad-primary hover:bg-myriad-primary/5">
                  <Download size={13} className="text-slate-400 shrink-0" />
                  <span className="truncate flex-1 text-slate-800">{a.file_name}</span>
                  <span className="text-xs text-slate-400">{fmtBytes(a.size_bytes)}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 댓글 */}
      <div className="border-t border-slate-100 px-5 py-4 bg-slate-50/60 rounded-b-xl">
        <div className="text-xs font-semibold text-slate-500 mb-2 flex items-center gap-1"><MessageSquare size={11} /> 댓글 {comments.length}</div>
        <ul className="space-y-2 mb-3">
          {comments.map((c) => (
            <li key={c.id} className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm">
              <div className="flex items-center gap-2 text-xs text-slate-500 mb-0.5">
                <span className="font-semibold text-slate-700">{name(c.created_by)}</span>
                <span>{new Date(c.created_at).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                {(isAdmin || c.created_by === user?.id) && (
                  <button onClick={async () => { if (confirm('댓글을 삭제할까요?')) { await deleteComment(c.id); loadComments(); onChanged?.() } }}
                    className="ml-auto text-slate-400 hover:text-rose-600"><Trash2 size={11} /></button>
                )}
              </div>
              <div className="whitespace-pre-wrap text-slate-800">{c.body}</div>
            </li>
          ))}
        </ul>
        <form onSubmit={send} className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent?.isComposing) { e.preventDefault(); send(e) } }}
            placeholder="댓글 입력 (Enter 로 등록)"
            className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-myriad-primary/40"
          />
          <button type="submit" disabled={sending || !draft.trim()}
            className="px-3 py-2 rounded-lg bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink disabled:opacity-40">
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        </form>
      </div>
    </div>
  )
}
