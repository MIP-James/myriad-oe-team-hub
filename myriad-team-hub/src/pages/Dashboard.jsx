import { useAuth } from '../contexts/AuthContext'
import { CalendarDays, StickyNote, Activity } from 'lucide-react'

export default function Dashboard() {
  const { user } = useAuth()
  const name = user?.user_metadata?.full_name || user?.email?.split('@')[0] || ''

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <header className="mb-8">
        <p className="text-sm text-slate-500">안녕하세요,</p>
        <h1 className="text-2xl font-bold text-slate-900 mt-1">{name} 님 👋</h1>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card icon={CalendarDays} title="오늘의 일정" hint="일정 모듈 준비 중" />
        <Card icon={StickyNote} title="내 메모" hint="메모 모듈 준비 중" />
        <Card icon={Activity} title="최근 작업" hint="유틸 작업 이력 준비 중" />
      </div>

      <div className="mt-8 bg-white border border-slate-200 rounded-2xl p-6">
        <h2 className="font-semibold text-slate-900 mb-2">📌 진행 상황</h2>
        <ul className="text-sm text-slate-600 space-y-1.5 list-disc pl-5">
          <li>Phase 1: 로그인 + 기본 레이아웃 ✅</li>
          <li>Phase 2: 개인 일정/메모 (준비 중)</li>
          <li>Phase 3: 유틸리티 허브 (준비 중)</li>
          <li>Phase 4: 로컬 런처 연동 (준비 중)</li>
          <li>Phase 5: 팀 커뮤니티 (준비 중)</li>
        </ul>
      </div>
    </div>
  )
}

function Card({ icon: Icon, title, hint }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 hover:shadow-md transition">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 rounded-lg bg-myriad-primary/20 flex items-center justify-center">
          <Icon size={18} className="text-myriad-ink" />
        </div>
        <h3 className="font-semibold text-slate-900">{title}</h3>
      </div>
      <p className="text-xs text-slate-400">{hint}</p>
    </div>
  )
}
