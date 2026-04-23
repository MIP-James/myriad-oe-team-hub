/**
 * 상단 알림 벨 — 팀 일정 등록 시 카드 배너 표시.
 * Realtime 구독으로 즉시 뱃지 업데이트.
 */
import { useEffect, useState, useRef, useCallback } from 'react'
import { Bell, X, CalendarDays } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import {
  listRecentNotifications,
  countUnread,
  markAllRead,
  markOneRead,
  subscribeToNotifications
} from '../lib/notifications'

export default function NotificationBell() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [unread, setUnread] = useState(0)
  const [toast, setToast] = useState(null) // 실시간 수신 토스트
  const containerRef = useRef(null)

  const refresh = useCallback(async () => {
    if (!user?.id) return
    try {
      const [rows, unreadCount] = await Promise.all([
        listRecentNotifications(user.id),
        countUnread(user.id)
      ])
      setItems(rows)
      setUnread(unreadCount)
    } catch (e) {
      console.warn('[notifications] refresh failed:', e)
    }
  }, [user?.id])

  useEffect(() => {
    if (!user?.id) return
    refresh()
    const unsub = subscribeToNotifications(user.id, (n) => {
      setItems((cur) => [n, ...cur].slice(0, 20))
      setUnread((u) => u + 1)
      // 오른쪽 하단 3초 토스트
      setToast(n)
      setTimeout(() => setToast((cur) => (cur?.id === n.id ? null : cur)), 5000)
    })
    return unsub
  }, [user?.id, refresh])

  useEffect(() => {
    function onClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  async function togglePanel() {
    const next = !open
    setOpen(next)
    if (next && unread > 0) {
      setTimeout(async () => {
        try {
          await markAllRead(user.id)
          setUnread(0)
          setItems((cur) =>
            cur.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() }))
          )
        } catch (e) {
          console.warn('[notifications] markAllRead failed:', e)
        }
      }, 1500)
    }
  }

  async function onClickItem(n) {
    setOpen(false)
    if (!n.read_at) {
      try { await markOneRead(n.id) } catch {}
    }
    if (n.link) navigate(n.link)
  }

  return (
    <>
      <div ref={containerRef} className="relative">
        <button
          onClick={togglePanel}
          className="relative p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-900 transition"
          title="알림"
        >
          <Bell size={16} />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 bg-rose-500 text-white text-[9px] font-bold rounded-full px-1 min-w-[16px] h-[16px] flex items-center justify-center">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>

        {open && (
          <div className="absolute left-0 top-full mt-2 w-80 max-h-[70vh] bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden z-50 flex flex-col">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center">
              <h3 className="font-bold text-slate-900 text-sm">알림</h3>
              {unread > 0 && (
                <span className="ml-2 text-[10px] font-semibold bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded-full">
                  미확인 {unread}
                </span>
              )}
              <div className="flex-1" />
              <button
                onClick={() => setOpen(false)}
                className="p-1 hover:bg-slate-100 rounded text-slate-500"
              >
                <X size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-auto">
              {items.length === 0 ? (
                <div className="py-10 text-center text-xs text-slate-400">
                  아직 알림이 없습니다.
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {items.map((n) => (
                    <li key={n.id}>
                      <button
                        onClick={() => onClickItem(n)}
                        className={`block w-full text-left px-4 py-3 hover:bg-slate-50 transition ${
                          !n.read_at ? 'bg-amber-50/50' : ''
                        }`}
                      >
                        <div className="flex gap-3">
                          <div className="w-8 h-8 rounded-full bg-sky-100 text-sky-700 flex items-center justify-center shrink-0">
                            <CalendarDays size={14} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] text-slate-900 font-semibold truncate">{n.title}</p>
                            {n.body && (
                              <p className="text-xs text-slate-600 mt-0.5 line-clamp-2">{n.body}</p>
                            )}
                            <p className="text-[10px] text-slate-400 mt-1">
                              {formatRelative(n.created_at)}
                            </p>
                          </div>
                          {!n.read_at && (
                            <div className="w-2 h-2 rounded-full bg-rose-500 shrink-0 mt-1.5" />
                          )}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 실시간 수신 토스트 — 사이드바와 독립된 main 영역 우측 하단 */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] max-w-sm bg-white border border-sky-300 shadow-lg rounded-xl p-4 flex items-start gap-3 animate-slide-in">
          <div className="w-9 h-9 rounded-full bg-sky-100 flex items-center justify-center shrink-0">
            <CalendarDays size={16} className="text-sky-700" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="font-semibold text-slate-900 text-sm">{toast.title}</h4>
            {toast.body && (
              <p className="text-xs text-slate-600 mt-0.5 line-clamp-2">{toast.body}</p>
            )}
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => {
                  setToast(null)
                  if (toast.link) navigate(toast.link)
                }}
                className="text-xs font-semibold bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink px-3 py-1 rounded-lg"
              >
                일정 보기
              </button>
              <button
                onClick={() => setToast(null)}
                className="text-xs text-slate-500 hover:text-slate-700 px-2"
              >
                닫기
              </button>
            </div>
          </div>
          <button
            onClick={() => setToast(null)}
            className="text-slate-400 hover:text-slate-700 p-1 -mt-1 -mr-1"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </>
  )
}

function formatRelative(iso) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '방금 전'
  if (mins < 60) return `${mins}분 전`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}시간 전`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}일 전`
  return new Date(iso).toLocaleDateString('ko-KR')
}
