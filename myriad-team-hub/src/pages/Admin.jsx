import { ShieldCheck } from 'lucide-react'

export default function Admin() {
  return (
    <div className="p-8 max-w-6xl mx-auto">
      <header className="mb-8 flex items-center gap-3">
        <ShieldCheck className="text-myriad-ink" />
        <h1 className="text-2xl font-bold text-slate-900">관리자</h1>
      </header>
      <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-slate-500">
        사용자 관리 · 유틸 버전 배포 · 시스템 설정 (추후)
      </div>
    </div>
  )
}
