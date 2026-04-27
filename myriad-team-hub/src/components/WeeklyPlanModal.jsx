/**
 * 주간 계획 편집 모달.
 *  - 헤더: "Week N (M/D ~ M/D)"
 *  - 본문: 번호 매겨진 항목 리스트 (자유 텍스트, +항목 추가, X 제거)
 *  - 톤: "이번 주 할 일" — 보고용 X, 본인 정리용 O
 */
import { useEffect, useState } from 'react'
import { X, Plus, Loader2, Save, GripVertical, CheckCircle2 } from 'lucide-react'
import { saveWeeklyPlan, listDailyRecordsInRange } from '../lib/weekly'
import { isoWeekStart, isoWeekEnd, formatMD, dateKey } from '../lib/dateHelpers'
import { useAuth } from '../contexts/AuthContext'

const WEEKDAYS_MON = ['월', '화', '수', '목', '금', '토', '일']

function makeItem(text = '') {
  return { text }
}

export default function WeeklyPlanModal({ year, week, weekStartDate, initialItems, onClose, onSaved }) {
  const { user } = useAuth()
  const [items, setItems] = useState(
    initialItems && initialItems.length > 0
      ? initialItems.map((it) => ({ text: it.text || '' }))
      : [makeItem(), makeItem(), makeItem()]
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [doneByDay, setDoneByDay] = useState([])    // [{ date, key, items }]
  const [doneLoading, setDoneLoading] = useState(false)

  const wStart = isoWeekStart(weekStartDate)
  const wEnd = isoWeekEnd(weekStartDate)

  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    setDoneLoading(true)
    listDailyRecordsInRange(user.id, dateKey(wStart), dateKey(wEnd))
      .then((records) => {
        if (cancelled) return
        const map = {}
        for (const r of records) map[r.log_date] = r
        const out = []
        for (let i = 0; i < 7; i++) {
          const d = new Date(wStart)
          d.setDate(wStart.getDate() + i)
          const k = dateKey(d)
          const rec = map[k]
          if (rec?.items?.length > 0) out.push({ date: d, key: k, items: rec.items })
        }
        setDoneByDay(out)
      })
      .catch(() => { if (!cancelled) setDoneByDay([]) })
      .finally(() => { if (!cancelled) setDoneLoading(false) })
    return () => { cancelled = true }
  }, [user?.id, year, week])

  const doneTotal = doneByDay.reduce((sum, g) => sum + g.items.length, 0)

  function update(i, value) {
    setItems((arr) => arr.map((it, idx) => idx === i ? { ...it, text: value } : it))
  }
  function add() {
    setItems((arr) => [...arr, makeItem()])
  }
  function remove(i) {
    setItems((arr) => arr.filter((_, idx) => idx !== i))
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await saveWeeklyPlan(user.id, {
        year,
        week,
        weekStart: weekStartDate.toISOString().slice(0, 10),
        items
      })
      onSaved?.()
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  // 모달 열릴 때 첫 빈 항목 포커스 (UX)
  useEffect(() => {
    const firstEmpty = document.querySelector('input[data-week-item][value=""]')
    if (firstEmpty) firstEmpty.focus()
  }, [])

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-6 py-4 border-b border-slate-200 flex items-center">
          <div>
            <h2 className="font-bold text-slate-900">Week {week}</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {formatMD(wStart)} ~ {formatMD(wEnd)} · 이번 주 할 일
            </p>
          </div>
          <div className="flex-1" />
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded">
            <X size={18} />
          </button>
        </header>

        <div className="p-6 overflow-auto space-y-2 flex-1">
          <p className="text-xs text-slate-500 mb-3">
            가볍게 한 줄씩 적어두세요. 순서나 분량 신경 안 쓰셔도 돼요.
          </p>
          {items.map((it, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-400 w-6 text-right shrink-0">
                {i + 1}.
              </span>
              <input
                type="text"
                data-week-item=""
                value={it.text}
                onChange={(e) => update(i, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent?.isComposing) {
                    e.preventDefault()
                    add()
                    setTimeout(() => {
                      const inputs = document.querySelectorAll('input[data-week-item]')
                      inputs[inputs.length - 1]?.focus()
                    }, 0)
                  }
                }}
                placeholder="예: Apple Inc. 모니터링"
                className="flex-1 px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40"
              />
              <button
                type="button"
                onClick={() => remove(i)}
                className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded"
                title="제거"
              >
                <X size={14} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={add}
            className="mt-2 w-full flex items-center justify-center gap-1.5 border border-dashed border-slate-300 text-slate-500 hover:text-slate-800 hover:border-myriad-primary py-2 rounded-lg text-xs transition"
          >
            <Plus size={12} /> 항목 추가
          </button>
          {error && <div className="text-xs text-rose-600 mt-2">{error}</div>}

          {/* 이 주에 한 일 — 그 주의 일일 기록 누적 (조회 전용) */}
          <div className="mt-6 pt-4 border-t border-slate-200">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                <CheckCircle2 size={14} className="text-teal-700" />
                이 주에 한 일
              </h3>
              {doneTotal > 0 && (
                <span className="text-[11px] font-semibold text-teal-800 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded-full">
                  총 {doneTotal}개
                </span>
              )}
            </div>
            {doneLoading ? (
              <div className="text-xs text-slate-400 flex items-center gap-2 py-2">
                <Loader2 size={12} className="animate-spin" /> 불러오는 중...
              </div>
            ) : doneByDay.length > 0 ? (
              <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
                {doneByDay.map((g) => (
                  <div key={g.key}>
                    <div className="text-[11px] font-bold text-slate-500 mb-1 flex items-center gap-1.5">
                      <span>{WEEKDAYS_MON[g.date.getDay() === 0 ? 6 : g.date.getDay() - 1]}</span>
                      <span className="text-slate-400">{formatMD(g.date)}</span>
                      <span className="text-slate-400 font-medium">· {g.items.length}개</span>
                    </div>
                    <ol className="space-y-1 list-decimal list-inside text-sm text-slate-700 pl-1">
                      {g.items.map((it, i) => (
                        <li key={i} className="leading-relaxed">{it.text}</li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400 py-1">
                이 주에는 아직 기록이 없습니다.
              </p>
            )}
          </div>
        </div>

        <footer className="px-6 py-4 border-t border-slate-200 flex items-center justify-end gap-2">
          <button onClick={onClose} className="text-slate-600 hover:bg-slate-100 px-4 py-2 rounded-lg text-sm">
            취소
          </button>
          <button
            onClick={save}
            disabled={saving}
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
