/**
 * 일일 리마인더 훅 — Layout 에서 1회만 호출.
 *
 * 동작:
 *  - 사용자의 reminder_settings 를 1분마다 새로 확인 (다른 탭에서 시간 변경 시 반영)
 *  - 1분마다 현재 시각이 설정 시각과 일치하는지 체크
 *  - 설정 시각 도달 시 + 오늘 아직 알림 안 보낸 경우 → 윈도우 알림 + 사이트 내 토스트
 *  - 사용자가 알림 클릭 시 → /schedules?openToday=1 로 이동
 *  - localStorage 로 "마지막 알림 날짜" 추적 (같은 날 중복 알림 방지)
 *
 * 한계:
 *  - 사이트가 닫혀있을 땐 알림 못 옴 (브라우저 알림은 활성 탭 + 권한 필요)
 *  - PWA 백그라운드 알림은 큰 추가 작업 — 추후 검토
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { getReminderSettings } from '../lib/weekly'
import { dateKey } from '../lib/dateHelpers'

const LAST_NOTIFIED_KEY = 'myriad_reminder_last_date'
const SETTINGS_REFRESH_MS = 60_000   // 1분
const TICK_MS = 60_000                // 1분

export function useDailyReminder() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const settingsRef = useRef(null)
  const [toast, setToast] = useState(null)   // { title, body } | null

  useEffect(() => {
    if (!user?.id) return
    let cancelled = false

    async function loadSettings() {
      try {
        const s = await getReminderSettings(user.id)
        if (!cancelled) settingsRef.current = s
      } catch (e) {
        console.warn('[reminder] load failed:', e?.message)
      }
    }
    loadSettings()
    const settingsTimer = setInterval(loadSettings, SETTINGS_REFRESH_MS)

    function fireReminder() {
      const today = dateKey(new Date())
      try {
        localStorage.setItem(LAST_NOTIFIED_KEY, today)
      } catch {}

      const title = '오늘 한 일 정리해볼까요? 🌿'
      const body = '잠깐 한 줄만 적어두면 나중에 도움 돼요.'

      // 1) 윈도우 알림 (권한 있을 때)
      if (typeof window !== 'undefined' && 'Notification' in window
          && Notification.permission === 'granted') {
        try {
          const n = new Notification(title, {
            body,
            icon: '/vite.svg',
            tag: 'myriad-daily-reminder',
            requireInteraction: false
          })
          n.onclick = () => {
            window.focus()
            navigate('/schedules?openToday=1')
            n.close()
          }
        } catch (e) {
          console.warn('[reminder] notification failed:', e?.message)
        }
      }

      // 2) 사이트 내 토스트 (백업 — 권한 없거나 닫아놨을 때 보여줌)
      setToast({ title, body })
    }

    function tick() {
      const s = settingsRef.current
      if (!s || !s.enabled || !s.daily_time) return

      const now = new Date()
      const today = dateKey(now)
      const lastNotified = (() => {
        try { return localStorage.getItem(LAST_NOTIFIED_KEY) } catch { return null }
      })()
      if (lastNotified === today) return

      const [hh, mm] = String(s.daily_time).split(':').map(Number)
      if (Number.isNaN(hh) || Number.isNaN(mm)) return

      const targetMinutes = hh * 60 + mm
      const nowMinutes = now.getHours() * 60 + now.getMinutes()

      // 설정 시각 ~ 5분 윈도우 내에서만 발송 (지나간 시각 회고 발송 방지)
      if (nowMinutes >= targetMinutes && nowMinutes < targetMinutes + 5) {
        fireReminder()
      }
    }

    // 첫 즉시 1회 + 이후 1분 간격
    tick()
    const tickTimer = setInterval(tick, TICK_MS)

    return () => {
      cancelled = true
      clearInterval(settingsTimer)
      clearInterval(tickTimer)
    }
  }, [user?.id, navigate])

  function dismissToast() {
    setToast(null)
  }

  function openToast() {
    navigate('/schedules?openToday=1')
    setToast(null)
  }

  return { toast, dismissToast, openToast }
}
