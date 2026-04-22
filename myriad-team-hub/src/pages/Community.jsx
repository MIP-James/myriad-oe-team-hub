import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Users, Megaphone, Activity, Pin, PinOff, Plus, X, Save, Trash2, Loader2,
  AlertCircle, AlertTriangle, Info, CheckCircle2, Edit3, RefreshCw, BarChart3,
  FileSpreadsheet, Rocket, Wrench, Clock, BookOpen, FilePlus2
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  listAnnouncements, createAnnouncement, updateAnnouncement, deleteAnnouncement,
  markAnnouncementRead, getMyReadIds,
  listActivityEvents, getProfileShort
} from '../lib/community'
import { useAuth } from '../contexts/AuthContext'

const TABS = [
  { key: 'announcements', label: '공지', icon: Megaphone },
  { key: 'activity', label: '활동', icon: Activity }
]

export default function Community() {
  const [tab, setTab] = useState('announcements')
  return (
    <div className="p-8 max-w-4xl mx-auto">
      <header className="mb-6 flex items-center gap-3">
        <Users className="text-myriad-ink" />
        <h1 className="text-2xl font-bold text-slate-900">팀 커뮤니티</h1>
      </header>

      <div className="flex gap-1 border-b border-slate-200 mb-6">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition ${
              tab === key
                ? 'text-myriad-ink border-myriad-primary'
                : 'text-slate-500 border-transparent hover:text-slate-800'
            }`}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {tab === 'announcements' && <AnnouncementsTab />}
      {tab === 'activity' && <ActivityTab />}
    </div>
  )
}

// ─────────────────────────────────────────────────────
// 공지 탭
// ─────────────────────────────────────────────────────

const EMPTY_ANN = { id: null, title: '', body: '', severity: 'info', pinned: false }

function AnnouncementsTab() {
  const { user, isAdmin } = useAuth()
  const [items, setItems] = useState([])
  const [readIds, setReadIds] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editor, setEditor] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [user?.id])

  useEffect(() => {
    const ch = supabase
      .channel('announcements-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, load)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [])

  async function load() {
    setLoading(true)
    try {
      const [anns, reads] = await Promise.all([
        listAnnouncements(),
        getMyReadIds(user?.id)
      ])
      setItems(anns)
      setReadIds(reads)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleMarkRead(ann) {
    if (!user?.id || readIds.has(ann.id)) return
    await markAnnouncementRead(ann.id, user.id)
    setReadIds((prev) => new Set([...prev, ann.id]))
  }

  async function save() {
    if (!editor.title.trim() || !editor.body.trim()) {
      setError('제목과 내용을 모두 입력하세요.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (editor.id) {
        await updateAnnouncement(editor.id, {
          title: editor.title.trim(),
          body: editor.body,
          severity: editor.severity,
          pinned: editor.pinned
        })
      } else {
        const created = await createAnnouncement(
          {
            title: editor.title.trim(),
            body: editor.body,
            severity: editor.severity,
            pinned: editor.pinned
          },
          user.id
        )
        // 활동 피드에도 기록
        await supabase.from('activity_events').insert({
          actor_id: user.id,
          event_type: 'announcement_posted',
          target_type: 'announcement',
          target_id: created.id,
          payload: { title: created.title, severity: created.severity }
        })
      }
      setEditor(null)
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!editor?.id) { setEditor(null); return }
    if (!window.confirm('이 공지를 삭제할까요?')) return
    try {
      await deleteAnnouncement(editor.id)
      setEditor(null)
      await load()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-slate-500">
          관리자 공지 — 유틸 업데이트, 보고서 마감, 팀 안내 등
        </p>
        {isAdmin && (
          <button
            onClick={() => { setEditor({ ...EMPTY_ANN }); setError(null) }}
            className="flex items-center gap-1.5 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-3 py-1.5 rounded-lg text-sm"
          >
            <Plus size={14} /> 새 공지
          </button>
        )}
      </div>

      {error && !editor && (
        <div className="mb-4 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg p-3">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-sm text-slate-400 flex items-center justify-center gap-2">
          <Loader2 size={14} className="animate-spin" /> 불러오는 중...
        </div>
      ) : items.length === 0 ? (
        <div className="py-16 text-center text-sm text-slate-400 bg-white border border-slate-200 rounded-2xl">
          <Megaphone size={32} className="mx-auto mb-3 text-slate-300" />
          아직 공지가 없습니다.
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((a) => (
            <AnnouncementCard
              key={a.id}
              ann={a}
              isRead={readIds.has(a.id)}
              isAdmin={isAdmin}
              onMarkRead={() => handleMarkRead(a)}
              onEdit={() => { setEditor({ ...a }); setError(null) }}
            />
          ))}
        </div>
      )}

      {editor && (
        <AnnouncementEditor
          editor={editor}
          setEditor={setEditor}
          onSave={save}
          onClose={() => setEditor(null)}
          onDelete={remove}
          saving={saving}
          error={error}
        />
      )}
    </>
  )
}

function AnnouncementCard({ ann, isRead, isAdmin, onMarkRead, onEdit }) {
  const { icon: SevIcon, tint } = severityStyle(ann.severity)
  return (
    <div
      className={`bg-white border rounded-2xl p-5 transition ${
        isRead
          ? 'border-slate-200'
          : 'border-myriad-primary shadow-sm'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`w-9 h-9 rounded-lg ${tint} flex items-center justify-center shrink-0`}>
          <SevIcon size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {ann.pinned && (
              <Pin size={12} className="text-amber-500 fill-amber-400" />
            )}
            <h3 className="font-bold text-slate-900">{ann.title}</h3>
            <SeverityBadge severity={ann.severity} />
            {!isRead && (
              <span className="text-[10px] font-bold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded">
                NEW
              </span>
            )}
          </div>
          <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-2">
            <Clock size={10} />
            {new Date(ann.created_at).toLocaleString('ko-KR')}
            {ann.created_by_profile?.full_name && (
              <span>· {ann.created_by_profile.full_name}</span>
            )}
          </div>
          <p className="text-sm text-slate-700 mt-3 whitespace-pre-wrap leading-relaxed">
            {ann.body}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-4 pt-4 border-t border-slate-100">
        <div className="flex-1" />
        {isAdmin && (
          <button
            onClick={onEdit}
            className="text-xs text-slate-500 hover:text-slate-900 flex items-center gap-1"
          >
            <Edit3 size={11} /> 편집
          </button>
        )}
        {!isRead ? (
          <button
            onClick={onMarkRead}
            className="text-xs font-semibold bg-myriad-primary/20 hover:bg-myriad-primary/40 text-myriad-ink px-3 py-1 rounded-lg"
          >
            읽음 처리
          </button>
        ) : (
          <span className="text-xs text-emerald-600 flex items-center gap-1">
            <CheckCircle2 size={11} /> 읽음
          </span>
        )}
      </div>
    </div>
  )
}

function AnnouncementEditor({ editor, setEditor, onSave, onClose, onDelete, saving, error }) {
  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-200 flex items-center">
          <h2 className="font-bold text-slate-900">
            {editor.id ? '공지 편집' : '새 공지'}
          </h2>
          <div className="flex-1" />
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 overflow-auto space-y-4">
          <label className="block">
            <span className="text-xs font-semibold text-slate-600">제목 *</span>
            <input
              type="text"
              value={editor.title}
              onChange={(e) => setEditor({ ...editor, title: e.target.value })}
              className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40"
              autoFocus
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-600">내용 *</span>
            <textarea
              value={editor.body}
              onChange={(e) => setEditor({ ...editor, body: e.target.value })}
              rows={6}
              className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40 resize-none text-sm"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-semibold text-slate-600">중요도</span>
              <select
                value={editor.severity}
                onChange={(e) => setEditor({ ...editor, severity: e.target.value })}
                className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg bg-white"
              >
                <option value="info">일반</option>
                <option value="important">중요</option>
                <option value="urgent">긴급</option>
              </select>
            </label>
            <label className="flex items-center gap-2 mt-5">
              <input
                type="checkbox"
                checked={editor.pinned}
                onChange={(e) => setEditor({ ...editor, pinned: e.target.checked })}
                className="w-4 h-4"
              />
              <span className="text-sm text-slate-700">상단 고정</span>
            </label>
          </div>
          {error && <div className="text-xs text-rose-600">{error}</div>}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex items-center">
          {editor.id && (
            <button
              onClick={onDelete}
              className="text-rose-600 hover:bg-rose-50 px-3 py-2 rounded-lg flex items-center gap-2 text-sm"
            >
              <Trash2 size={14} /> 삭제
            </button>
          )}
          <div className="flex-1" />
          <button onClick={onClose} className="text-slate-600 hover:bg-slate-100 px-4 py-2 rounded-lg">
            취소
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="ml-2 flex items-center gap-2 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            저장
          </button>
        </div>
      </div>
    </div>
  )
}

function SeverityBadge({ severity }) {
  const map = {
    info: ['일반', 'bg-slate-100 text-slate-600'],
    important: ['중요', 'bg-amber-100 text-amber-800'],
    urgent: ['긴급', 'bg-rose-100 text-rose-700']
  }
  const [label, cls] = map[severity] ?? map.info
  return <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${cls}`}>{label}</span>
}

function severityStyle(sev) {
  if (sev === 'urgent') return { icon: AlertCircle, tint: 'bg-rose-100 text-rose-700' }
  if (sev === 'important') return { icon: AlertTriangle, tint: 'bg-amber-100 text-amber-700' }
  return { icon: Info, tint: 'bg-sky-100 text-sky-700' }
}

// ─────────────────────────────────────────────────────
// 활동 탭
// ─────────────────────────────────────────────────────

function ActivityTab() {
  const [events, setEvents] = useState([])
  const [profiles, setProfiles] = useState({})   // userId → profile
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => { load() }, [])

  useEffect(() => {
    const ch = supabase
      .channel('activity-feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity_events' }, load)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [])

  async function load() {
    setLoading(true)
    try {
      const list = await listActivityEvents(80)
      setEvents(list)
      // 프로필 일괄 조회
      const uniq = [...new Set(list.map((e) => e.actor_id).filter(Boolean))]
      const pmap = {}
      await Promise.all(uniq.map(async (id) => { pmap[id] = await getProfileShort(id) }))
      setProfiles(pmap)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // 날짜별 그룹핑
  const grouped = useMemo(() => groupByDay(events), [events])

  if (loading) {
    return (
      <div className="py-12 text-center text-sm text-slate-400 flex items-center justify-center gap-2">
        <Loader2 size={14} className="animate-spin" /> 불러오는 중...
      </div>
    )
  }
  if (error) {
    return <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg p-3">{error}</div>
  }
  if (events.length === 0) {
    return (
      <div className="py-16 text-center text-sm text-slate-400 bg-white border border-slate-200 rounded-2xl">
        <Activity size={32} className="mx-auto mb-3 text-slate-300" />
        아직 기록된 활동이 없습니다.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {grouped.map(({ label, items }) => (
        <section key={label}>
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
            {label}
          </h3>
          <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100">
            {items.map((ev) => (
              <EventRow key={ev.id} ev={ev} profile={profiles[ev.actor_id]} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function EventRow({ ev, profile }) {
  const { icon: Icon, color, text, link } = renderEvent(ev)
  const actorName = profile?.full_name || profile?.email?.split('@')[0] || '알 수 없음'
  return (
    <div className="px-5 py-3 flex items-start gap-3">
      <div className={`w-8 h-8 rounded-lg ${color} flex items-center justify-center shrink-0 mt-0.5`}>
        <Icon size={14} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-slate-800">
          <span className="font-semibold">{actorName}</span> {text}
        </div>
        <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-2">
          <Clock size={10} />
          {new Date(ev.created_at).toLocaleString('ko-KR')}
          {link && (
            <Link to={link} className="text-myriad-ink hover:underline">
              바로가기 →
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}

function renderEvent(ev) {
  const p = ev.payload || {}
  switch (ev.event_type) {
    case 'report_generated':
      return {
        icon: BarChart3,
        color: 'bg-myriad-primary/20 text-myriad-ink',
        text: <>{p.brand ?? ''} {p.month ? `${p.month} ` : ''}보고서를 생성했습니다.</>,
        link: ev.target_id ? `/reports/groups/${p.group_id || ''}` : null
      }
    case 'brand_report_status_changed':
      return {
        icon: p.to === 'done' ? CheckCircle2 : Edit3,
        color: p.to === 'done' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700',
        text: <>{p.brand ?? ''} 보고서 상태를 <b>{p.to === 'done' ? '완료' : '수정 중'}</b> 으로 변경했습니다.</>,
        link: p.group_id ? `/reports/groups/${p.group_id}` : null
      }
    case 'report_group_published':
      return {
        icon: Rocket,
        color: 'bg-emerald-100 text-emerald-700',
        text: <>{p.year_month ?? ''} 그룹을 Drive 에 발행했습니다.</>,
        link: p.group_id ? `/reports/groups/${p.group_id}` : null
      }
    case 'announcement_posted':
      return {
        icon: Megaphone,
        color: 'bg-sky-100 text-sky-700',
        text: <>공지를 올렸습니다: "{p.title ?? ''}"</>,
        link: '/community'
      }
    case 'utility_executed':
      return {
        icon: Wrench,
        color: 'bg-slate-100 text-slate-700',
        text: <>{p.utility_name ?? '유틸'} 을 실행했습니다.</>,
        link: '/jobs'
      }
    case 'shared_sheet_added':
      return {
        icon: FileSpreadsheet,
        color: 'bg-sky-100 text-sky-700',
        text: <>새 공용 시트 "{p.title ?? ''}" 를 등록했습니다.</>,
        link: '/sheets'
      }
    case 'comment_posted':
      return {
        icon: Users,
        color: 'bg-amber-100 text-amber-800',
        text: <>{p.brand ?? ''} 보고서에 댓글을 남겼습니다{p.preview ? `: "${p.preview}"` : ''}.</>,
        link: p.group_id ? `/reports/groups/${p.group_id}` : null
      }
    case 'comment_resolved':
      return {
        icon: CheckCircle2,
        color: 'bg-emerald-100 text-emerald-700',
        text: <>{p.brand ?? ''} 보고서 댓글을 해결 처리했습니다.</>,
        link: p.group_id ? `/reports/groups/${p.group_id}` : null
      }
    case 'wiki_page_created':
      return {
        icon: FilePlus2,
        color: 'bg-indigo-100 text-indigo-700',
        text: <>위키에 새 페이지 "{p.title ?? ''}" 를 만들었습니다.</>,
        link: ev.target_id ? `/wiki/${ev.target_id}` : '/wiki'
      }
    case 'wiki_page_updated':
      return {
        icon: BookOpen,
        color: 'bg-indigo-100 text-indigo-700',
        text: <>위키 "{p.title ?? ''}" 을(를) 수정했습니다.</>,
        link: ev.target_id ? `/wiki/${ev.target_id}` : '/wiki'
      }
    default:
      return {
        icon: Activity,
        color: 'bg-slate-100 text-slate-500',
        text: <>{ev.event_type}</>,
        link: null
      }
  }
}

function groupByDay(events) {
  const now = new Date()
  const today = dayKey(now)
  const yesterday = dayKey(new Date(now.getTime() - 86400000))

  const groups = new Map()
  for (const ev of events) {
    const d = new Date(ev.created_at)
    const k = dayKey(d)
    let label
    if (k === today) label = '오늘'
    else if (k === yesterday) label = '어제'
    else label = d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })
    if (!groups.has(label)) groups.set(label, [])
    groups.get(label).push(ev)
  }
  return [...groups.entries()].map(([label, items]) => ({ label, items }))
}

function dayKey(d) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}
