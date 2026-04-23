import { NavLink, Outlet } from 'react-router-dom'
import { LayoutDashboard, StickyNote, CalendarDays, FileSpreadsheet, BarChart3, Wrench, Cpu, History, Users, ShieldCheck, LogOut, Bell, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useDailyReminder } from '../hooks/useDailyReminder'
import NotificationBell from './NotificationBell'

const BASE_NAV = [
  { to: '/', label: '대시보드', icon: LayoutDashboard, end: true },
  { to: '/memos', label: '메모', icon: StickyNote },
  { to: '/schedules', label: '일정', icon: CalendarDays },
  { to: '/sheets', label: '공용 시트', icon: FileSpreadsheet },
  { to: '/reports', label: '월간 동향 보고서', icon: BarChart3 },
  { to: '/utilities', label: '유틸리티', icon: Wrench },
  { to: '/launcher', label: '내 런처', icon: Cpu },
  { to: '/jobs', label: '작업 이력', icon: History },
  { to: '/community', label: '팀 커뮤니티', icon: Users }
]
const ADMIN_NAV = { to: '/admin', label: '관리자', icon: ShieldCheck }

export default function Layout() {
  const { user, signOut, isAdmin } = useAuth()
  const nav = isAdmin ? [...BASE_NAV, ADMIN_NAV] : BASE_NAV
  const { toast, dismissToast, openToast } = useDailyReminder()

  return (
    <div className="h-full flex">
      <aside className="w-60 bg-white border-r border-slate-200 flex flex-col">
        <div className="h-14 flex items-center px-5 border-b border-slate-200">
          <span className="font-bold text-myriad-ink">MYRIAD</span>
          <span className="ml-2 text-xs text-slate-500">Team Hub</span>
          <div className="flex-1" />
          <NotificationBell />
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {nav.map(({ to, label, icon: Icon, end }) => (
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
      <main className="flex-1 overflow-auto relative">
        <Outlet />

        {/* 일일 리마인더 토스트 — 윈도우 알림이 못 떠도 사이트 안에서 보이게 */}
        {toast && (
          <div className="fixed bottom-6 right-6 z-50 max-w-sm bg-white border border-myriad-primary shadow-lg rounded-xl p-4 flex items-start gap-3 animate-slide-in">
            <div className="w-9 h-9 rounded-full bg-myriad-primary/30 flex items-center justify-center shrink-0">
              <Bell size={16} className="text-myriad-ink" />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="font-semibold text-slate-900 text-sm">{toast.title}</h4>
              <p className="text-xs text-slate-600 mt-0.5">{toast.body}</p>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={openToast}
                  className="text-xs font-semibold bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink px-3 py-1 rounded-lg"
                >
                  지금 기록하기
                </button>
                <button
                  onClick={dismissToast}
                  className="text-xs text-slate-500 hover:text-slate-700 px-2"
                >
                  나중에
                </button>
              </div>
            </div>
            <button
              onClick={dismissToast}
              className="text-slate-400 hover:text-slate-700 p-1 -mt-1 -mr-1"
            >
              <X size={14} />
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
