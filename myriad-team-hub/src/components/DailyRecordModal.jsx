/**
 * 일일 기록 편집 모달.
 *  - 헤더: "M월 D일 (요일) — 오늘 한 일"
 *  - 본문: 번호 매겨진 항목 리스트 (자유 텍스트)
 *  - 톤: 가볍게, 부담 없이
 */
import { useEffect, useState } from 'react'
import { X, Plus, Loader2, Save } from 'lucide-react'
import { saveDailyRecord } from '../lib/weekly'
import { dateKey, formatKoreanDay } from '../lib/dateHelpers'
import { useAuth } from '../contexts/AuthContext'

function makeItem(text = '') { return { text } }

export default function DailyRecordModal({ date, initialItems, onClose, onSaved }) {
  const { user } = useAuth()
  const [items, setItems] = useState(
    initialItems && initialItems.length > 0
      ? initialItems.map((it) => ({ text: it.text || '' }))
      : [makeItem(), makeItem()]
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

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
      await saveDailyRecord(user.id, dateKey(date), items)
      onSaved?.()
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    const firstEmpty = document.querySelector('input[data-day-item][value=""]')
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
            <h2 className="font-bold text-slate-900">{formatKoreanDay(date)}</h2>
            <p className="text-xs text-slate-500 mt-0.5">오늘 한 일</p>
          </div>
          <div className="flex-1" />
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded">
            <X size={18} />
          </button>
        </header>

        <div className="p-6 overflow-auto space-y-2 flex-1">
          <p className="text-xs text-slate-500 mb-3">
            한 줄씩 가볍게. 그날 떠오르는 대로 적으셔도 돼요.
          </p>
          {items.map((it, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-400 w-6 text-right shrink-0">
                {i + 1}.
              </span>
              <input
                type="text"
                data-day-item=""
                value={it.text}
                onChange={(e) => update(i, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent?.isComposing) {
                    e.preventDefault()
                    add()
                    setTimeout(() => {
                      const inputs = document.querySelectorAll('input[data-day-item]')
                      inputs[inputs.length - 1]?.focus()
                    }, 0)
                  }
                }}
                placeholder="예: Apple 위조품 3건 검토"
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
