/**
 * ChecklistEditorModal — 월별 마감 체크리스트(projects.config.report_cycle) 편집 (관리자).
 * 항목 = { key, label, day_hint }. key 는 project_month_checks 와 연결되므로 기존 항목은 유지, 신규만 생성.
 * 전 월에 공통 적용되는 템플릿이며, 월별 완료 체크 상태는 그대로 남는다.
 */
import { useState } from 'react'
import { X, Save, Loader2, Plus, Trash2, ChevronUp, ChevronDown, GripVertical } from 'lucide-react'
import { updateProject, newCycleKey } from '../../lib/projects'

const inputCls = 'px-2.5 py-1.5 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-myriad-primary/40'

export default function ChecklistEditorModal({ project, onClose, onSaved }) {
  const [items, setItems] = useState(() => (project.config?.report_cycle || []).map((c) => ({ key: c.key, label: c.label || '', day_hint: c.day_hint || '' })))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  function patch(i, p) { setItems((a) => a.map((it, j) => (j === i ? { ...it, ...p } : it))) }
  function add() { setItems((a) => [...a, { key: newCycleKey(), label: '', day_hint: '', _new: true }]) }
  function remove(i) {
    const it = items[i]
    if (it.label.trim() && !it._new && !confirm(`"${it.label}" 항목을 삭제할까요?\n모든 월의 체크리스트에서 사라집니다. (이미 체크한 기록은 DB 에 남지만 표시되지 않습니다)`)) return
    setItems((a) => a.filter((_, j) => j !== i))
  }
  function move(i, dir) {
    setItems((a) => {
      const j = i + dir
      if (j < 0 || j >= a.length) return a
      const next = [...a]; [next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  async function submit(e) {
    e.preventDefault()
    const cleaned = items.filter((it) => it.label.trim()).map((it) => ({ key: it.key, label: it.label.trim(), day_hint: it.day_hint.trim() || null }))
    setSaving(true); setError(null)
    try {
      const saved = await updateProject(project.id, { config: { report_cycle: cleaned } })
      onSaved(saved)
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-6 overflow-y-auto" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <form onSubmit={submit} className="bg-white rounded-2xl shadow-xl w-full max-w-2xl my-4">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <div>
            <h3 className="font-bold text-slate-900">마감 체크리스트 편집</h3>
            <p className="text-[11px] text-[#8A8580] mt-0.5">모든 월에 공통 적용되는 항목 목록입니다. 월별 체크(완료) 상태는 항목별로 그대로 유지됩니다.</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1"><X size={18} /></button>
        </div>
        <div className="p-5">
          <div className="grid grid-cols-[auto_1fr_7rem_auto] gap-x-2 text-[11px] text-[#8A8580] px-1 mb-1">
            <span className="w-5" /><span>항목</span><span>시점 힌트</span><span className="w-[4.5rem]" />
          </div>
          <div className="space-y-1.5">
            {items.map((it, i) => (
              <div key={it.key} className="grid grid-cols-[auto_1fr_7rem_auto] gap-x-2 items-center">
                <GripVertical size={14} className="text-slate-300 w-5" />
                <input value={it.label} onChange={(e) => patch(i, { label: e.target.value })} className={`${inputCls} w-full`} placeholder="예: 1차 실적 보고 메일 + 두레이 업로드" autoFocus={it._new} />
                <input value={it.day_hint} onChange={(e) => patch(i, { day_hint: e.target.value })} className={`${inputCls} w-full`} placeholder="~10일" />
                <div className="flex items-center gap-0.5 w-[4.5rem] justify-end">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="p-1 text-slate-400 hover:text-slate-800 disabled:opacity-30" title="위로"><ChevronUp size={14} /></button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === items.length - 1} className="p-1 text-slate-400 hover:text-slate-800 disabled:opacity-30" title="아래로"><ChevronDown size={14} /></button>
                  <button type="button" onClick={() => remove(i)} className="p-1 text-slate-400 hover:text-rose-600" title="삭제"><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
            {items.length === 0 && <div className="text-xs text-slate-400 py-3 text-center border border-dashed border-slate-200 rounded-lg">항목이 없습니다. 아래에서 추가하세요.</div>}
          </div>
          <button type="button" onClick={add} className="mt-3 text-xs text-slate-600 hover:text-myriad-ink flex items-center gap-1 px-2 py-1.5 rounded-lg border border-dashed border-slate-300 hover:border-myriad-primary"><Plus size={12} /> 항목 추가</button>
          <p className="text-[11px] text-[#8A8580] mt-3">시점 힌트는 자유 입력입니다 (예: ~9일, 21~22일, 마감 후). 비워둔 항목은 저장 시 제외됩니다.</p>
          {error && <div className="mt-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200">
          <button type="button" onClick={onClose} className="text-sm px-3 py-1.5 text-slate-600 hover:bg-slate-100 rounded-lg">취소</button>
          <button type="submit" disabled={saving} className="text-sm font-semibold px-4 py-1.5 rounded-lg bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink flex items-center gap-1.5 disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} 저장
          </button>
        </div>
      </form>
    </div>
  )
}
