import { Users } from 'lucide-react'

export default function Community() {
  return (
    <div className="p-8 max-w-6xl mx-auto">
      <header className="mb-8 flex items-center gap-3">
        <Users className="text-myriad-ink" />
        <h1 className="text-2xl font-bold text-slate-900">팀 커뮤니티</h1>
      </header>
      <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-slate-500">
        공지 · 스레드 · 파일 공유 모듈 (Phase 5)
      </div>
    </div>
  )
}
