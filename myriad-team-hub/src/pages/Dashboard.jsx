import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CalendarDays, StickyNote, ChevronRight, Pin, Lock, Users as UsersIcon,
  Loader2, Megaphone, AlertCircle, AlertTriangle, Info, Briefcase, Tag as TagIcon,
  Wrench, BarChart3, ExternalLink
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { listAnnouncements, getMyReadIds } from '../lib/community'
import { listRecentCases, STATUS_LABELS, STATUS_COLORS } from '../lib/cases'

export default function Dashboard() {
  const { user } = useAuth()
  const name = user?.user_metadata?.full_name || user?.email?.split('@')[0] || ''

  const [todayItems, setTodayItems] = useState([])
  const [memos, setMemos] = useState([])
  const [unreadAnns, setUnreadAnns] = useState([])
  const [recentCases, setRecentCases] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [user?.id])

  async function load() {
    const now = new Date()
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const dayEnd = new Date(dayStart)
    dayEnd.setDate(dayEnd.getDate() + 1)

    const [schedulesRes, memosRes, anns, reads, caseList] = await Promise.all([
      supabase
        .from('schedules')
        .select('*')
        .gte('starts_at', dayStart.toISOString())
        .lt('starts_at', dayEnd.toISOString())
        .order('starts_at', { ascending: true }),
      supabase
        .from('memos')
        .select('*')
        .order('pinned', { ascending: false })
        .order('updated_at', { ascending: false })
        .limit(5),
      listAnnouncements().catch(() => []),
      getMyReadIds(user?.id).catch(() => new Set()),
      listRecentCases(5).catch(() => [])
    ])
    setTodayItems(schedulesRes.data ?? [])
    setMemos(memosRes.data ?? [])
    setUnreadAnns((anns ?? []).filter((a) => !reads.has(a.id)).slice(0, 3))
    setRecentCases(caseList)
    setLoading(false)
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <header className="mb-8">
        <p className="text-sm text-slate-500">안녕하세요,</p>
        <h1 className="text-2xl font-bold text-slate-900 mt-1">{name} 님 👋</h1>
      </header>

      {unreadAnns.length > 0 && (
        <section className="mb-4 bg-amber-50 border border-amber-200 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Megaphone size={16} className="text-amber-700" />
            <h2 className="font-semibold text-amber-900">
              읽지 않은 공지 {unreadAnns.length}건
            </h2>
            <div className="flex-1" />
            <Link
              to="/community"
              className="text-xs text-amber-800 hover:underline font-semibold"
            >
              모두 보기 →
            </Link>
          </div>
          <ul className="space-y-2">
            {unreadAnns.map((a) => (
              <li key={a.id}>
                <Link
                  to="/community"
                  className="flex items-center gap-2 text-sm text-amber-900 hover:text-amber-700"
                >
                  <span className="shrink-0">
                    {a.severity === 'urgent' ? <AlertCircle size={12} /> :
                     a.severity === 'important' ? <AlertTriangle size={12} /> :
                     <Info size={12} />}
                  </span>
                  <span className="font-semibold truncate">{a.title}</span>
                  <span className="text-xs text-amber-700 shrink-0">
                    {new Date(a.created_at).toLocaleDateString('ko-KR')}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ─── 빠른 작업 (Quick Actions) ─── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <QuickAction
          to="/utilities"
          icon={Wrench}
          title="유틸리티"
          subtitle="모니터링 도구 실행"
          colorClass="bg-sky-100 text-sky-700"
          ringClass="hover:border-sky-400"
        />
        <QuickAction
          to="/reports"
          icon={BarChart3}
          title="월간 보고서"
          subtitle="브랜드별 보고서 작성/검토"
          colorClass="bg-myriad-primary/30 text-myriad-ink"
          ringClass="hover:border-myriad-primary"
        />
        <QuickAction
          href="https://bpm-admin.myriadip.com"
          icon={Briefcase}
          title="BPM"
          subtitle="브랜드 관리 시스템"
          colorClass="bg-purple-100 text-purple-700"
          ringClass="hover:border-purple-400"
          external
        />
      </div>

      {/* ─── 정보 위젯 3종 (오늘 일정 / 최근 메모 / 최근 케이스) ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 오늘의 일정 */}
        <Widget
          icon={CalendarDays}
          title="오늘의 일정"
          to="/schedules"
          empty={todayItems.length === 0 ? '오늘 예정된 일정이 없습니다.' : null}
          loading={loading}
        >
          <ul className="space-y-2">
            {todayItems.map((it) => (
              <li
                key={it.id}
                className="flex items-start gap-3 p-2 rounded-lg hover:bg-slate-50 transition"
              >
                <div className="shrink-0 text-xs font-semibold text-slate-600 bg-slate-100 px-2 py-1 rounded w-16 text-center">
                  {new Date(it.starts_at).toLocaleTimeString('ko-KR', {
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    {it.visibility === 'team' ? (
                      <UsersIcon size={12} className="text-sky-500 shrink-0" />
                    ) : (
                      <Lock size={12} className="text-amber-500 shrink-0" />
                    )}
                    <span className="font-medium text-slate-900 truncate">{it.title}</span>
                  </div>
                  {it.description && (
                    <div className="text-xs text-slate-500 mt-0.5 line-clamp-1">
                      {it.description}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Widget>

        {/* 메모 */}
        <Widget
          icon={StickyNote}
          title="최근 메모"
          to="/memos"
          empty={memos.length === 0 ? '작성된 메모가 없습니다.' : null}
          loading={loading}
        >
          <ul className="space-y-2">
            {memos.map((m) => (
              <li key={m.id}>
                <Link
                  to="/memos"
                  className="block p-2 rounded-lg hover:bg-slate-50 transition"
                >
                  <div className="flex items-center gap-1.5">
                    {m.pinned && (
                      <Pin size={11} className="text-amber-500 fill-amber-400 shrink-0" />
                    )}
                    <span className="font-medium text-slate-900 truncate">
                      {m.title || '(제목 없음)'}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5 line-clamp-1 whitespace-pre-wrap">
                    {m.body || '(내용 없음)'}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Widget>

        {/* 최근 케이스 */}
        <Widget
          icon={Briefcase}
          title="최근 케이스"
          to="/community?tab=cases"
          empty={recentCases.length === 0 ? '아직 공유된 케이스가 없습니다.' : null}
          loading={loading}
        >
          <ul className="space-y-2">
            {recentCases.map((c) => (
              <li key={c.id}>
                <Link
                  to={`/community/cases/${c.id}`}
                  className="block p-2 rounded-lg hover:bg-slate-50 transition"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-slate-900 truncate flex-1">{c.title}</span>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${STATUS_COLORS[c.status] || 'bg-slate-100 text-slate-600'}`}>
                      {STATUS_LABELS[c.status] || c.status}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                    <span className="inline-flex items-center gap-0.5 text-[10px] bg-myriad-primary/20 text-myriad-ink px-1.5 py-0.5 rounded-full">
                      <TagIcon size={8} /> {c.brand}
                    </span>
                    <span className="text-[10px] text-slate-500">{c.platform || c.platform_other || '—'}</span>
                    <span className="text-slate-400 ml-auto">{relativeTime(c.created_at)}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Widget>
      </div>
    </div>
  )
}

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

// ─────────────────────────────────────────────────────
// QuickAction — 대시보드 상단 빠른가기 카드 (내부 라우트 또는 외부 URL)
// ─────────────────────────────────────────────────────
function QuickAction({ to, href, icon: Icon, title, subtitle, colorClass, ringClass, external }) {
  const inner = (
    <>
      <div className={`w-12 h-12 rounded-xl ${colorClass} flex items-center justify-center shrink-0`}>
        <Icon size={22} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <h3 className="font-bold text-slate-900">{title}</h3>
          {external && <ExternalLink size={12} className="text-slate-400" />}
        </div>
        <p className="text-xs text-slate-500 mt-0.5 truncate">{subtitle}</p>
      </div>
      <ChevronRight size={16} className="text-slate-300 shrink-0" />
    </>
  )
  const cls = `bg-white border border-slate-200 ${ringClass} rounded-2xl p-5 transition shadow-sm hover:shadow-md flex items-center gap-4 group`

  if (external && href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={cls}>
        {inner}
      </a>
    )
  }
  return (
    <Link to={to} className={cls}>
      {inner}
    </Link>
  )
}

function Widget({ icon: Icon, title, to, children, empty, loading }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 hover:shadow-sm transition">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-myriad-primary/20 flex items-center justify-center">
            <Icon size={16} className="text-myriad-ink" />
          </div>
          <h3 className="font-semibold text-slate-900">{title}</h3>
        </div>
        <Link
          to={to}
          className="text-xs text-slate-500 hover:text-myriad-ink flex items-center gap-0.5"
        >
          전체 보기 <ChevronRight size={12} />
        </Link>
      </div>
      {loading ? (
        <div className="py-6 text-center text-sm text-slate-400 flex items-center justify-center gap-2">
          <Loader2 size={14} className="animate-spin" /> 불러오는 중...
        </div>
      ) : empty ? (
        <div className="py-6 text-center text-sm text-slate-400">{empty}</div>
      ) : (
        children
      )}
    </div>
  )
}
