import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CalendarDays, StickyNote, ChevronRight, Pin, Lock, Users as UsersIcon,
  Loader2, Megaphone, AlertCircle, AlertTriangle, Info, Briefcase, Tag as TagIcon,
  Wrench, BarChart3, ExternalLink, Bookmark
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { listAnnouncements, getMyReadIds } from '../lib/community'
import { listRecentCases, STATUS_LABELS, STATUS_COLORS, getCaseBrands, getCasePlatforms } from '../lib/cases'
import { listActiveShortcuts, getColorClasses } from '../lib/externalShortcuts'

export default function Dashboard() {
  const { user, isAdmin } = useAuth()
  const name = user?.user_metadata?.full_name || user?.email?.split('@')[0] || ''

  const [todayItems, setTodayItems] = useState([])
  const [memos, setMemos] = useState([])
  const [unreadAnns, setUnreadAnns] = useState([])
  const [recentCases, setRecentCases] = useState([])
  const [shortcuts, setShortcuts] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [user?.id])

  useEffect(() => {
    // 외부 바로가기 realtime — 관리자가 추가/수정 시 즉시 반영
    const ch = supabase
      .channel('ext-shortcuts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'external_shortcuts' }, () => {
        listActiveShortcuts().then(setShortcuts).catch(() => {})
      })
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [])

  async function load() {
    const now = new Date()
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const dayEnd = new Date(dayStart)
    dayEnd.setDate(dayEnd.getDate() + 1)

    const [schedulesRes, memosRes, anns, reads, caseList, sc] = await Promise.all([
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
      listRecentCases(5).catch(() => []),
      listActiveShortcuts().catch(() => [])
    ])
    setTodayItems(schedulesRes.data ?? [])
    setMemos(memosRes.data ?? [])
    setUnreadAnns((anns ?? []).filter((a) => !reads.has(a.id)).slice(0, 3))
    setRecentCases(caseList)
    setShortcuts(sc)
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

      {/* ─── 1. 정보 위젯 3종 (오늘 일정 / 최근 메모 / 최근 케이스) ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
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
                  {new Date(it.starts_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
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
                    <div className="text-xs text-slate-500 mt-0.5 line-clamp-1">{it.description}</div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Widget>

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
                <Link to="/memos" className="block p-2 rounded-lg hover:bg-slate-50 transition">
                  <div className="flex items-center gap-1.5">
                    {m.pinned && <Pin size={11} className="text-amber-500 fill-amber-400 shrink-0" />}
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

        <Widget
          icon={Briefcase}
          title="최근 케이스"
          to="/community?tab=cases"
          empty={recentCases.length === 0 ? '아직 공유된 케이스가 없습니다.' : null}
          loading={loading}
        >
          <ul className="space-y-2">
            {recentCases.map((c) => {
              const brands = getCaseBrands(c)
              const platforms = getCasePlatforms(c)
              const brandFirst = brands[0] || '—'
              const brandRest = brands.length - 1
              const platformFirst = platforms[0] || '—'
              const platformRest = platforms.length - 1
              return (
                <li key={c.id}>
                  <Link to={`/community/cases/${c.id}`} className="block p-2 rounded-lg hover:bg-slate-50 transition">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-slate-900 truncate flex-1">{c.title}</span>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${STATUS_COLORS[c.status] || 'bg-slate-100 text-slate-600'}`}>
                        {STATUS_LABELS[c.status] || c.status}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                      <span
                        title={brands.join(', ')}
                        className="inline-flex items-center gap-0.5 text-[10px] bg-myriad-primary/20 text-myriad-ink px-1.5 py-0.5 rounded-full"
                      >
                        <TagIcon size={8} /> {brandFirst}{brandRest > 0 ? ` +${brandRest}` : ''}
                      </span>
                      <span title={platforms.join(', ')} className="text-[10px] text-slate-500">
                        {platformFirst}{platformRest > 0 ? ` +${platformRest}` : ''}
                      </span>
                      <span className="text-slate-400 ml-auto">{relativeTime(c.created_at)}</span>
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        </Widget>
      </div>

      {/* ─── 2. 빠른 작업 — 큰 덩어리 3종 (유틸 / 보고서 / BPM) ─── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <BigQuickAction
          to="/utilities"
          icon={Wrench}
          title="유틸리티"
          subtitle="모니터링 도구 실행"
          colorClass="bg-sky-100 text-sky-700"
          ringClass="hover:border-sky-400"
        />
        <BigQuickAction
          to="/reports"
          icon={BarChart3}
          title="월간 동향 보고서"
          subtitle="브랜드별 보고서 작성/검토"
          colorClass="bg-myriad-primary/30 text-myriad-ink"
          ringClass="hover:border-myriad-primary"
        />
        <BigQuickAction
          href="https://bpm-admin.myriadip.com"
          icon={Briefcase}
          title="BPM"
          subtitle="어드민 웹 페이지 바로가기"
          colorClass="bg-purple-100 text-purple-700"
          ringClass="hover:border-purple-400"
          external
        />
      </div>

      {/* ─── 3. 외부 바로가기 (관리자가 등록) ─── */}
      <ExternalShortcutsSection
        shortcuts={shortcuts}
        loading={loading}
        isAdmin={isAdmin}
      />
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
// 큰 덩어리 빠른 작업 카드 (유틸/보고서/BPM)
// ─────────────────────────────────────────────────────
function BigQuickAction({ to, href, icon: Icon, title, subtitle, colorClass, ringClass, external }) {
  const inner = (
    <>
      <div className={`w-16 h-16 rounded-2xl ${colorClass} flex items-center justify-center shrink-0`}>
        <Icon size={28} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <h3 className="font-bold text-slate-900 text-lg">{title}</h3>
          {external && <ExternalLink size={13} className="text-slate-400" />}
        </div>
        <p className="text-sm text-slate-500 mt-1">{subtitle}</p>
      </div>
      <ChevronRight size={18} className="text-slate-300 shrink-0" />
    </>
  )
  const cls = `bg-white border-2 border-slate-200 ${ringClass} rounded-2xl p-6 transition shadow-sm hover:shadow-lg flex items-center gap-5 group min-h-[110px]`

  if (external && href) {
    return <a href={href} target="_blank" rel="noreferrer" className={cls}>{inner}</a>
  }
  return <Link to={to} className={cls}>{inner}</Link>
}

// ─────────────────────────────────────────────────────
// 외부 바로가기 그리드 — 관리자가 추가, 모두 사용
// ─────────────────────────────────────────────────────
function ExternalShortcutsSection({ shortcuts, loading, isAdmin }) {
  if (loading) return null
  if (shortcuts.length === 0 && !isAdmin) return null

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-slate-700 flex items-center gap-2">
          <Bookmark size={16} className="text-myriad-ink" />
          외부 바로가기
        </h2>
        {isAdmin && (
          <Link
            to="/admin/shortcuts"
            className="text-xs text-slate-500 hover:text-myriad-ink font-semibold"
          >
            관리 →
          </Link>
        )}
      </div>

      {shortcuts.length === 0 ? (
        <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-8 text-center">
          <Bookmark size={28} className="mx-auto mb-2 text-slate-300" />
          <p className="text-sm text-slate-500">
            아직 등록된 바로가기가 없습니다.
          </p>
          {isAdmin && (
            <Link
              to="/admin/shortcuts"
              className="mt-3 inline-flex items-center gap-1.5 text-xs bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-3 py-1.5 rounded-lg"
            >
              + 첫 바로가기 등록
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {shortcuts.map((s) => {
            const cc = getColorClasses(s.color)
            return (
              <a
                key={s.id}
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className={`bg-white border border-slate-200 ${cc.border} rounded-xl p-4 transition shadow-sm hover:shadow-md flex items-center gap-3 group`}
              >
                <div className={`w-11 h-11 rounded-lg ${cc.icon} flex items-center justify-center text-xl shrink-0`}>
                  {s.icon || '🔗'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-slate-900 truncate">{s.name}</span>
                    <ExternalLink size={11} className="text-slate-400 shrink-0" />
                  </div>
                  {s.description && (
                    <p className="text-xs text-slate-500 mt-0.5 truncate">{s.description}</p>
                  )}
                </div>
              </a>
            )
          })}
        </div>
      )}
    </section>
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
