import { Link } from 'react-router-dom'
import { ShieldCheck, Wrench, Users, ExternalLink, ChevronRight, Mail } from 'lucide-react'

const SECTIONS = [
  {
    to: '/admin/utilities',
    label: '유틸리티 관리',
    desc: '유틸 등록 / 버전 업데이트 / 다운로드 링크 관리',
    icon: Wrench,
    ready: true
  },
  {
    to: '/admin/shortcuts',
    label: '외부 바로가기 관리',
    desc: '대시보드 하단 외부 사이트 바로가기 (KIPRIS 등) 등록',
    icon: ExternalLink,
    ready: true
  },
  {
    to: '/admin/users',
    label: '사용자 관리',
    desc: '팀원 역할 (admin/member) 변경',
    icon: Users,
    ready: true
  },
  {
    to: '/admin/inbound-status',
    label: 'Inbound 자동 케이스화',
    desc: 'Gmail 신고 메일 → 자동 케이스 등록. Reader 등록 + 매핑 룰 + 키워드 관리',
    icon: Mail,
    ready: true
  }
]

export default function Admin() {
  return (
    <div className="p-8 max-w-5xl mx-auto">
      <header className="mb-8 flex items-center gap-3">
        <ShieldCheck className="text-myriad-ink" />
        <h1 className="text-2xl font-bold text-slate-900">관리자</h1>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {SECTIONS.map(({ to, label, desc, icon: Icon, ready }) => {
          const Card = (
            <div
              className={`bg-white border border-slate-200 rounded-2xl p-5 transition ${
                ready ? 'hover:shadow-md hover:border-myriad-primary' : 'opacity-60'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-myriad-primary/10 flex items-center justify-center">
                  <Icon size={18} className="text-myriad-ink" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-slate-900">{label}</h3>
                    {!ready && (
                      <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded">
                        준비 중
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-1">{desc}</p>
                </div>
                {ready && <ChevronRight size={16} className="text-slate-400" />}
              </div>
            </div>
          )
          return ready ? (
            <Link key={to} to={to}>{Card}</Link>
          ) : (
            <div key={to}>{Card}</div>
          )
        })}
      </div>
    </div>
  )
}
