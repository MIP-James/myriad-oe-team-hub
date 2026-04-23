/**
 * 일일 리마인더 설정 모달.
 *  - 활성/비활성 토글
 *  - 시:분 선택 (5분 단위)
 *  - 브라우저 알림 권한 요청 버튼
 */
import { useEffect, useState } from 'react'
import { X, Bell, BellOff, Loader2, Save, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { saveReminderSettings, getReminderSettings } from '../lib/weekly'
import { timeToHHMM } from '../lib/dateHelpers'
import { useAuth } from '../contexts/AuthContext'

export default function ReminderSettingsModal({ onClose, onSaved }) {
  const { user } = useAuth()
  const [enabled, setEnabled] = useState(true)
  const [hour, setHour] = useState(17)
  const [minute, setMinute] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [permission, setPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  )

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
      } catch (e) {
        console.warn('[reminder] load:', e?.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [user?.id])

  async function requestPermission() {
    if (typeof Notification === 'undefined') return
    try {
      const result = await Notification.requestPermission()
      setPermission(result)
    } catch {
      setPermission('denied')
    }
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const dailyTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`
      await saveReminderSettings(user.id, { dailyTime, enabled })
      onSaved?.()
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
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

            {/* 브라우저 알림 권한 */}
            <div className="border border-slate-200 rounded-lg p-3">
              <div className="text-xs font-semibold text-slate-600 mb-2">윈도우 알림 권한</div>
              {permission === 'granted' && (
                <div className="text-xs text-emerald-700 flex items-center gap-1">
                  <CheckCircle2 size={12} /> 허용됨 — 사이트 열려있을 때 윈도우 알림이 떠요
                </div>
              )}
              {permission === 'default' && (
                <div className="space-y-2">
                  <p className="text-xs text-slate-500">
                    아직 권한을 요청하지 않았어요. 윈도우 알림을 받으려면 허용해주세요.
                    (사이트가 열려있을 때만 작동)
                  </p>
                  <button
                    onClick={requestPermission}
                    className="text-xs bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-3 py-1.5 rounded-lg"
                  >
                    권한 요청
                  </button>
                </div>
              )}
              {permission === 'denied' && (
                <div className="text-xs text-amber-700 flex items-start gap-1">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  <span>차단됨. 브라우저 주소창 왼쪽 자물쇠 아이콘 → 알림 권한을 직접 허용해주세요. 권한 없어도 사이트 열려있을 땐 우측 하단 토스트로 표시돼요.</span>
                </div>
              )}
              {permission === 'unsupported' && (
                <div className="text-xs text-slate-500">이 브라우저는 알림을 지원하지 않습니다.</div>
              )}
            </div>

            {error && <div className="text-xs text-rose-600">{error}</div>}
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
