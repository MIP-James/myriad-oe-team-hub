import { NavLink, Outlet } from 'react-router-dom'
import { LayoutDashboard, StickyNote, CalendarDays, Wrench, Users, ShieldCheck, LogOut } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

const NAV = [
  { to: '/', label: '대시보드', icon: LayoutDashboard, end: true },
  { to: '/memos', label: '메모', icon: StickyNote },
  { to: '/schedules', label: '일정', icon: CalendarDays },
  { to: '/utilities', label: '유틸리티', icon: Wrench },
  { to: '/community', label: '팀 커뮤니티', icon: Users },
  { to: '/admin', label: '관리자', icon: ShieldCheck }
]

export default function Layout() {
  const { user, signOut } = useAuth()
  return (
    <div className="h-full flex">
      <aside className="w-60 bg-white border-r border-slate-200 flex flex-col">
        <div className="h-14 flex items-center px-5 border-b border-slate-200">
          <span className="font-bold text-myriad-ink">MYRIAD</span>
          <span className="ml-2 text-xs text-slate-500">Team Hub</span>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition ${
                  isActive
                    ? 'bg-myriad-primary/20 text-myriad-ink font-semibold'
                    : 'text-slate-600 hover:bg-slate-100'
                }`
              }
            >
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-slate-200">
          <div className="text-xs text-slate-500 px-2 pb-2 truncate">{user?.email}</div>
          <button
            onClick={signOut}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100"
          >
            <LogOut size={16} />
            로그아웃
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
