/**
 * ProjectBoard — 프로젝트 섹션 공용 게시판.
 * 공지 / 월별 실적 / 기획 / 비정기 / 저작권 / 이슈 트래커 6개 탭이 공유.
 * 필터(periodMonth / campaignId)는 상위에서 주입, 목록·상세·작성·수정·삭제를 여기서 처리.
 */
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Plus, Loader2, Pin, Paperclip, MessageSquare, Search, X, AlertTriangle, Calendar, Inbox
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { getProfileShort } from '../../lib/community'
import {
  ISSUE_STATUS, ISSUE_STATUS_MAP, SEVERITY_MAP, fmtDate, daysUntil,
  listPosts, createPost, updatePost, deletePost, countAttachments, countComments
} from '../../lib/projects'
import PostEditorModal from './PostEditorModal'
import PostView from './PostView'

export default function ProjectBoard({
  project, section, periodMonth = null, campaignId = null,
  months = [], campaigns = [], emptyHint = '아직 글이 없습니다.', onDataChanged
}) {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const openId = params.get('post')

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [profiles, setProfiles] = useState({})
  const [attCounts, setAttCounts] = useState({})
  const [cmtCounts, setCmtCounts] = useState({})
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState(section.kind === 'issues' ? 'active' : '')
  const [editor, setEditor] = useState(null) // null | { initial }

  const isIssues = section.kind === 'issues'

  useEffect(() => { load() }, [section.id, periodMonth, campaignId])

  useEffect(() => {
    const ch = supabase
      .channel(`project-posts-${section.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_posts', filter: `section_id=eq.${section.id}` }, load)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [section.id, periodMonth, campaignId])

  async function load() {
    setLoading(true); setError(null)
    try {
      const data = await listPosts({ sectionId: section.id, periodMonth, campaignId })
      setRows(data)
      const ids = data.map((r) => r.id)
      const [ac, cc] = await Promise.all([countAttachments(ids), countComments(ids)])
      setAttCounts(ac); setCmtCounts(cc)
      const uids = [...new Set(data.map((r) => r.created_by).filter(Boolean))]
      const map = {}
      await Promise.all(uids.map(async (id) => { map[id] = await getProfileShort(id) }))
      setProfiles(map)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const filtered = useMemo(() => {
    let list = rows
    if (isIssues) {
      if (statusFilter === 'active') list = list.filter((r) => r.status === 'open' || r.status === 'in_progress')
      else if (statusFilter) list = list.filter((r) => r.status === statusFilter)
      // 열린 건 우선, 기한 임박 순
      list = [...list].sort((a, b) => {
        const oa = a.status === 'done' ? 1 : 0, ob = b.status === 'done' ? 1 : 0
        if (oa !== ob) return oa - ob
        if (a.due_on && b.due_on) return a.due_on.localeCompare(b.due_on)
        if (a.due_on) return -1
        if (b.due_on) return 1
        return b.created_at.localeCompare(a.created_at)
      })
    }
    if (search.trim()) {
      const s = search.trim().toLowerCase()
      list = list.filter((r) => r.title.toLowerCase().includes(s) || (r.body_text || '').toLowerCase().includes(s) || (r.category || '').toLowerCase().includes(s))
    }
    return list
  }, [rows, search, statusFilter, isIssues])

  const openPost = rows.find((r) => r.id === openId) || null

  function setOpen(id) {
    const next = new URLSearchParams(params)
    if (id) next.set('post', id); else next.delete('post')
    setParams(next, { replace: true })
  }

  async function handleSave(form) {
    const payload = { ...form, projectId: project.id, sectionId: section.id }
    let saved
    if (editor?.initial?.id) saved = await updatePost(editor.initial.id, payload, user.id)
    else saved = await createPost(payload, user.id)
    await load()
    onDataChanged?.()
    return saved
  }

  async function handleDelete(post) {
    if (!confirm(`"${post.title}" 글을 삭제할까요? 첨부파일도 함께 삭제됩니다.`)) return
    await deletePost(post.id)
    setOpen(null)
    await load()
    onDataChanged?.()
  }

  const name = (id) => profiles[id]?.full_name || profiles[id]?.email?.split('@')[0] || '—'

  return (
    <div>
      {/* 툴바 */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {isIssues && (
          <div className="flex gap-1 text-xs">
            {[{ key: 'active', label: '열린 건' }, ...ISSUE_STATUS, { key: '', label: '전체' }].map((s) => (
              <button key={s.key} onClick={() => setStatusFilter(s.key)}
                className={`px-2.5 py-1 rounded-full border font-semibold ${statusFilter === s.key ? 'bg-myriad-primary/20 border-myriad-primary text-myriad-ink' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                {s.label}
              </button>
            ))}
          </div>
        )}
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="제목/본문/분류 검색"
            className="w-full pl-7 pr-7 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40" />
          {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400"><X size={12} /></button>}
        </div>
        <div className="flex-1" />
        <button onClick={() => setEditor({ initial: null })}
          className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-lg bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink">
          <Plus size={14} /> 새 글
        </button>
      </div>

      {error && (
        <div className="mb-3 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg p-3 flex items-center gap-2">
          <AlertTriangle size={13} /> {error}
        </div>
      )}

      {openPost && (
        <div className="mb-4">
          <PostView
            post={openPost} section={section} campaigns={campaigns}
            onEdit={() => setEditor({ initial: openPost })}
            onDelete={() => handleDelete(openPost)}
            onClose={() => setOpen(null)}
            onChanged={() => { load(); onDataChanged?.() }}
          />
        </div>
      )}

      {/* 목록 */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="py-14 text-center text-sm text-slate-400 flex items-center justify-center gap-2"><Loader2 size={14} className="animate-spin" /> 불러오는 중...</div>
        ) : filtered.length === 0 ? (
          <div className="py-14 text-center text-sm text-slate-400 flex flex-col items-center gap-2">
            <Inbox size={22} className="text-slate-300" />
            {rows.length === 0 ? emptyHint : '검색/필터 결과가 없습니다.'}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {filtered.map((r) => {
              const dl = r.due_on ? daysUntil(r.due_on) : null
              const overdue = dl !== null && dl < 0 && r.status !== 'done'
              const soon = dl !== null && dl >= 0 && dl <= 3 && r.status !== 'done'
              const active = r.id === openId
              return (
                <li key={r.id}>
                  <button onClick={() => setOpen(active ? null : r.id)}
                    className={`w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-slate-50 transition ${active ? 'bg-myriad-primary/5' : ''} ${r.pinned ? 'bg-amber-50/40' : ''}`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {r.pinned && <Pin size={12} className="text-myriad-ink shrink-0" />}
                        {section.kind === 'notice' && r.severity !== 'info' && (
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${SEVERITY_MAP[r.severity]?.cls}`}>{SEVERITY_MAP[r.severity]?.label}</span>
                        )}
                        {r.status !== 'none' && (
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${ISSUE_STATUS_MAP[r.status]?.cls}`}>{ISSUE_STATUS_MAP[r.status]?.label}</span>
                        )}
                        {r.category && <span className="text-[10px] font-semibold text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded">{r.category}</span>}
                        <span className={`font-semibold text-slate-900 truncate ${r.status === 'done' ? 'line-through text-slate-400' : ''}`}>{r.title}</span>
                      </div>
                      {r.body_text && <div className="text-xs text-slate-500 mt-0.5 line-clamp-1">{r.body_text}</div>}
                    </div>
                    <div className="shrink-0 flex items-center gap-2 text-xs text-slate-500 pt-0.5">
                      {r.due_on && (
                        <span className={`inline-flex items-center gap-0.5 font-semibold px-1.5 py-0.5 rounded ${overdue ? 'bg-rose-100 text-rose-700' : soon ? 'bg-amber-100 text-amber-800' : 'text-slate-500'}`}>
                          <Calendar size={10} /> {fmtDate(r.due_on)}{overdue ? ` (${-dl}일 지남)` : dl === 0 ? ' (오늘)' : soon ? ` (D-${dl})` : ''}
                        </span>
                      )}
                      {attCounts[r.id] > 0 && <span className="inline-flex items-center gap-0.5"><Paperclip size={11} />{attCounts[r.id]}</span>}
                      {cmtCounts[r.id] > 0 && <span className="inline-flex items-center gap-0.5"><MessageSquare size={11} />{cmtCounts[r.id]}</span>}
                      <span className="w-16 truncate text-right">{name(r.created_by)}</span>
                      <span className="w-12 text-right">{fmtDate(r.created_at)}</span>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {editor && (
        <PostEditorModal
          section={section} project={project} initial={editor.initial}
          months={months} campaigns={campaigns}
          defaultMonth={periodMonth} defaultCampaignId={campaignId}
          onSave={handleSave}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  )
}
