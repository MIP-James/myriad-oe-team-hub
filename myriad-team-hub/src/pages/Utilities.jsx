import { Wrench } from 'lucide-react'

const UTILITIES = [
  { name: 'MYRIAD Enforcement Tools', desc: 'Naver / VeRO / Image Crawler / Uploader 통합 런처', status: '준비 중' },
  { name: 'Market Image Matcher', desc: '옥션/지마켓/쿠팡/11번가/스마트스토어 이미지 매칭', status: '준비 중' },
  { name: 'Report Generator', desc: '월간 동향 보고서 자동 생성', status: '준비 중' },
  { name: 'IP Report Editor', desc: '침해 보고서 편집기', status: '준비 중' }
]

export default function Utilities() {
  return (
    <div className="p-8 max-w-6xl mx-auto">
      <header className="mb-8 flex items-center gap-3">
        <Wrench className="text-myriad-ink" />
        <h1 className="text-2xl font-bold text-slate-900">유틸리티</h1>
      </header>

      <p className="text-sm text-slate-500 mb-6">
        각 유틸리티는 로컬 런처를 통해 실행됩니다. 런처 연동은 Phase 4에서 구현 예정입니다.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {UTILITIES.map((u) => (
          <div key={u.name} className="bg-white border border-slate-200 rounded-2xl p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-slate-900">{u.name}</h3>
                <p className="text-xs text-slate-500 mt-1">{u.desc}</p>
              </div>
              <span className="text-[11px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full shrink-0">
                {u.status}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
