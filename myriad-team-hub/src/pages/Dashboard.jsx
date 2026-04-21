import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CalendarDays, StickyNote, Activity, ChevronRight, Pin, Lock, Users as UsersIcon, Loader2
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

export default function Dashboard() {
  const { user } = useAuth()
  const name = user?.user_metadata?.full_name || user?.email?.split('@')[0] || ''

  const [todayItems, setTodayItems] = useState([])
  const [memos, setMemos] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])

  async function load() {
    const now = new Date()
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const dayEnd = new Date(dayStart)
    dayEnd.setDate(dayEnd.getDate() + 1)

    const [schedulesRes, memosRes] = await Promise.all([
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
        .limit(5)
    ])
    setTodayItems(schedulesRes.data ?? [])
    setMemos(memosRes.data ?? [])
    setLoading(false)
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <header className="mb-8">
        <p className="text-sm text-slate-500">안녕하세요,</p>
        <h1 className="text-2xl font-bold text-slate-900 mt-1">{name} 님 👋</h1>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
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
      </div>

      {/* 진행 상황 */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6">
        <div className="flex items-center gap-2 mb-3">
          <Activity size={16} className="text-myriad-ink" />
          <h2 className="font-semibold text-slate-900">진행 상황</h2>
        </div>
        <ul className="text-sm text-slate-600 space-y-1.5 list-disc pl-5">
          <li>Phase 1: 로그인 + 기본 레이아웃 ✅</li>
          <li>Phase 2: 개인 일정/메모 ✅</li>
          <li>Phase 3: 유틸리티 허브 (준비 중)</li>
          <li>Phase 4: 로컬 런처 연동 (준비 중)</li>
          <li>Phase 5: 팀 커뮤니티 (준비 중)</li>
        </ul>
      </div>
    </div>
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
