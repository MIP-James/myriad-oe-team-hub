/**
 * 일일 리마인더 설정 모달.
 *  - 활성/비활성 토글
 *  - 시:분 선택 (5분 단위)
 *  - 브라우저 알림 권한 요청 버튼
 */
import { useEffect, useState } from 'react'
import { X, Bell, BellOff, Loader2, Save, AlertTriangle, CheckCircle2, Send, Monitor } from 'lucide-react'
import { saveReminderSettings, getReminderSettings } from '../lib/weekly'
import { timeToHHMM } from '../lib/dateHelpers'
import { useAuth } from '../contexts/AuthContext'
import { REMINDER_SETTINGS_CHANGED } from '../hooks/useDailyReminder'
import {
  isPushSupported,
  getPermissionState,
  getCurrentSubscription,
  subscribePush,
  unsubscribePush
} from '../lib/push'

export default function ReminderSettingsModal({ onClose, onSaved }) {
  const { user } = useAuth()
  const [enabled, setEnabled] = useState(true)
  const [hour, setHour] = useState(17)
  const [minute, setMinute] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [permission, setPermission] = useState(getPermissionState())
  const [pushSubscribed, setPushSubscribed] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)
  const [pushError, setPushError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const s = await getReminderSettings(user.id)
        if (cancelled) return
        if (s) {
          setEnabled(s.enabled)
          if (s.daily_time) {
            const [hh, mm] = timeToHHMM(s.daily_time).split(':').map(Number)
            setHour(hh)
            setMinute(mm)
          }
        }
        // 현재 push 구독 상태 확인
        const sub = await getCurrentSubscription()
        if (!cancelled) setPushSubscribed(!!sub)
      } catch (e) {
        console.warn('[reminder] load:', e?.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [user?.id])

  async function togglePush() {
    setPushBusy(true)
    setPushError(null)
    try {
      if (pushSubscribed) {
        await unsubscribePush()
        setPushSubscribed(false)
      } else {
        await subscribePush()
        setPushSubscribed(true)
        setPermission('granted')
      }
    } catch (e) {
      setPushError(e?.message || String(e))
      // 권한 상태 갱신
      setPermission(getPermissionState())
    } finally {
      setPushBusy(false)
    }
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const dailyTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`
      await saveReminderSettings(user.id, { dailyTime, enabled })
      // 훅이 즉시 새 설정 다시 읽도록 신호
      window.dispatchEvent(new Event(REMINDER_SETTINGS_CHANGED))
      onSaved?.()
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  /** 테스트 알림 — 실제 시각/저장과 무관하게 바로 윈도우 알림 + 토스트 발송 */
  function sendTestNotification() {
    const title = '🧪 테스트 알림'
    const body = '이 알림이 보이면 정상! 저장한 시각에도 동일하게 와요.'

    // 1. 윈도우 알림
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        new Notification(title, { body, icon: '/vite.svg', tag: 'myriad-test' })
      } catch (e) {
        console.warn('[test notif]', e)
      }
    }
    // 2. 사이트 내 토스트 — 일반 리마인더 토스트 트리거를 흉내내기 위해
    //    localStorage 비우고 즉시 발송 이벤트 보냄
    try {
      localStorage.removeItem('myriad_reminder_last_date')
    } catch {}
    window.dispatchEvent(new CustomEvent('myriad-test-toast', {
      detail: { title, body }
    }))
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-6 py-4 border-b border-slate-200 flex items-center">
          <Bell size={16} className="text-myriad-ink mr-2" />
          <h2 className="font-bold text-slate-900">일일 리마인더 설정</h2>
          <div className="flex-1" />
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded">
            <X size={18} />
          </button>
        </header>

        {loading ? (
          <div className="p-6 text-center text-sm text-slate-400 flex items-center justify-center gap-2">
            <Loader2 size={14} className="animate-spin" /> 불러오는 중...
          </div>
        ) : (
          <div className="p-6 space-y-5">
            <p className="text-xs text-slate-500 leading-relaxed">
              매일 설정한 시간에 "오늘 한 일 정리해볼까요?" 알림을 보내드려요.
              꼭 적어야 하는 건 아니고, 가볍게 떠오를 때 도와주는 정도예요.
            </p>

            {/* 활성화 토글 */}
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <div className="flex items-center gap-2">
                {enabled ? <Bell size={14} className="text-myriad-ink" /> : <BellOff size={14} className="text-slate-400" />}
                <span className="text-sm font-semibold text-slate-700">알림 활성화</span>
              </div>
              <button
                type="button"
                onClick={() => setEnabled((v) => !v)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${enabled ? 'bg-myriad-primary' : 'bg-slate-300'}`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`}
                />
              </button>
            </div>

            {/* 시간 선택 */}
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-2">알림 시각</label>
              <div className="flex items-center gap-2">
                <select
                  value={hour}
                  onChange={(e) => setHour(parseInt(e.target.value))}
                  disabled={!enabled}
                  className="px-3 py-2 border border-slate-300 rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-myriad-primary/40 disabled:bg-slate-50 disabled:text-slate-400"
                >
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={i}>{String(i).padStart(2, '0')}</option>
                  ))}
                </select>
                <span className="text-slate-500">:</span>
                <select
                  value={minute}
                  onChange={(e) => setMinute(parseInt(e.target.value))}
                  disabled={!enabled}
                  className="px-3 py-2 border border-slate-300 rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-myriad-primary/40 disabled:bg-slate-50 disabled:text-slate-400"
                >
                  {Array.from({ length: 60 }, (_, i) => (
                    <option key={i} value={i}>{String(i).padStart(2, '0')}</option>
                  ))}
                </select>
                <span className="text-xs text-slate-400 ml-2">({hour < 12 ? '오전' : '오후'} {((hour + 11) % 12) + 1}시 {minute}분)</span>
              </div>
            </div>

            {/* PC 알림 (PWA push) — 브라우저 닫혀있어도 윈도우 토스트 도달 */}
            <div className="border border-slate-200 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Monitor size={14} className="text-myriad-ink" />
                  <span className="text-xs font-semibold text-slate-700">PC 알림 (윈도우 토스트)</span>
                </div>
                {isPushSupported() ? (
                  <button
                    type="button"
                    onClick={togglePush}
                    disabled={pushBusy}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
                      pushSubscribed ? 'bg-myriad-primary' : 'bg-slate-300'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                        pushSubscribed ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                ) : (
                  <span className="text-[11px] text-slate-400">미지원 브라우저</span>
                )}
              </div>

              {pushSubscribed && (
                <div className="text-[11px] text-emerald-700 flex items-center gap-1">
                  <CheckCircle2 size={11} />
                  켜짐 — 브라우저 닫혀있어도 케이스/일정/보고서 알림이 윈도우 토스트로 도착합니다
                </div>
              )}
              {!pushSubscribed && permission === 'denied' && (
                <div className="text-[11px] text-amber-700 flex items-start gap-1">
                  <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                  <span>차단된 상태. Chrome 주소창 왼쪽 자물쇠 → 알림 → 허용으로 변경 후 다시 켜주세요.</span>
                </div>
              )}
              {!pushSubscribed && permission !== 'denied' && (
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  켜면 본 PC + 사용 중인 다른 PC 의 Chrome 모두에서 알림 받습니다.
                  Chrome 이 백그라운드에 살아있으면 사이트 닫혀있어도 토스트가 떠요.
                </p>
              )}
              {pushError && (
                <div className="text-[11px] text-rose-600 flex items-start gap-1">
                  <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                  <span>{pushError}</span>
                </div>
              )}
            </div>

            {error && <div className="text-xs text-rose-600">{error}</div>}

            {/* 테스트 알림 — 알림 작동 검증용 */}
            <button
              type="button"
              onClick={sendTestNotification}
              className="w-full flex items-center justify-center gap-1.5 text-xs text-slate-600 hover:text-myriad-ink border border-dashed border-slate-300 hover:border-myriad-primary py-2 rounded-lg transition"
            >
              <Send size={12} /> 지금 테스트 알림 보내기
            </button>
          </div>
        )}

        <footer className="px-6 py-4 border-t border-slate-200 flex items-center justify-end gap-2">
          <button onClick={onClose} className="text-slate-600 hover:bg-slate-100 px-4 py-2 rounded-lg text-sm">
            취소
          </button>
          <button
            onClick={save}
            disabled={saving || loading}
            className="flex items-center gap-2 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-5 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            저장
          </button>
        </footer>
      </div>
    </div>
  )
}
