/**
 * CampaignPanel — 기획(차수) / 비정기 모니터링 라운드 헤더 + 편집 모달.
 * 라운드 카드: 기간 · 주제 · 브랜드 · 상태 · 제출물 체크리스트(클릭으로 완료 토글).
 */
import { useState } from 'react'
import { Plus, Edit3, Trash2, X, Save, Loader2, CheckSquare, Square, Calendar, Tag } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { CAMPAIGN_STATUS, fmtDate, daysUntil, saveCampaign, deleteCampaign } from '../../lib/projects'

export default function CampaignPanel({ project, kind, campaigns, selectedId, onSelect, onChanged }) {
  const { user, isAdmin } = useAuth()
  const [editor, setEditor] = useState(null) // null | { initial }
  const selected = campaigns.find((c) => c.id === selectedId) || campaigns[0] || null

  async function toggleDeliverable(c, idx) {
    const next = c.deliverables.map((d, i) => (i === idx ? { ...d, done: !d.done } : d))
    await saveCampaign({ ...c, deliverables: next }, user.id)
    onChanged?.()
  }

  async function handleDelete(c) {
    if (!confirm(`"${c.title}" 라운드를 삭제할까요? 연결된 글은 라운드 미지정으로 남습니다.`)) return
    await deleteCampaign(c.id)
    onChanged?.()
  }

  return (
    <div className="mb-4">
      {/* 라운드 서브탭 */}
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {campaigns.map((c) => {
          const st = CAMPAIGN_STATUS[c.status] || CAMPAIGN_STATUS.planned
          const active = selected?.id === c.id
          return (
            <button key={c.id} onClick={() => onSelect(c.id)}
              className={`px-3 py-1.5 rounded-lg text-sm border flex items-center gap-2 ${active ? 'bg-white border-myriad-primary shadow-sm font-semibold text-slate-900' : 'border-slate-200 text-slate-600 hover:bg-white'}`}>
              {c.title}
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${st.cls}`}>{st.label}</span>
            </button>
          )
        })}
        <button onClick={() => setEditor({ initial: null })}
          className="px-2.5 py-1.5 rounded-lg text-xs border border-dashed border-slate-300 text-slate-500 hover:border-myriad-primary hover:text-myriad-ink flex items-center gap-1">
          <Plus size={12} /> 라운드 추가
        </button>
      </div>

      {selected && (
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h3 className="font-bold text-slate-900 text-lg">{selected.title}</h3>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${(CAMPAIGN_STATUS[selected.status] || CAMPAIGN_STATUS.planned).cls}`}>
                  {(CAMPAIGN_STATUS[selected.status] || CAMPAIGN_STATUS.planned).label}
                </span>
              </div>
              <div className="text-sm text-slate-600 flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="inline-flex items-center gap-1"><Calendar size={13} className="text-slate-400" />
                  {selected.starts_on ? fmtDate(selected.starts_on, { year: 'numeric', month: '2-digit', day: '2-digit' }) : '시작 미정'}
                  {' ~ '}
                  {selected.ends_on ? fmtDate(selected.ends_on, { month: '2-digit', day: '2-digit' }) : <span className="text-amber-700 font-semibold">마감일 미정</span>}
                  <PeriodBadge c={selected} />
                </span>
                {selected.brands?.length > 0 && (
                  <span className="inline-flex items-center gap-1 flex-wrap"><Tag size={13} className="text-slate-400" />
                    {selected.brands.map((b) => <span key={b} className="text-xs bg-myriad-primary/20 text-myriad-ink px-1.5 py-0.5 rounded font-semibold">{b}</span>)}
                  </span>
                )}
              </div>
              {selected.theme && <p className="text-sm text-slate-700 mt-2">{selected.theme}</p>}
              {selected.note && <p className="text-xs text-slate-500 mt-1 whitespace-pre-wrap">{selected.note}</p>}
            </div>
            <div className="flex gap-1 shrink-0">
              <button onClick={() => setEditor({ initial: selected })} className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg" title="라운드 수정"><Edit3 size={15} /></button>
              {isAdmin && <button onClick={() => handleDelete(selected)} className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg" title="삭제"><Trash2 size={15} /></button>}
            </div>
          </div>

          {selected.deliverables?.length > 0 && (
            <div className="mt-3 border-t border-slate-100 pt-3">
              <div className="text-xs font-semibold text-slate-500 mb-1.5">제출물 · 마일스톤</div>
              <ul className="space-y-1">
                {selected.deliverables.map((d, i) => {
                  const dl = d.due_on ? daysUntil(d.due_on) : null
                  const overdue = !d.done && dl !== null && dl < 0
                  const soon = !d.done && dl !== null && dl >= 0 && dl <= 3
                  return (
                    <li key={i}>
                      <button onClick={() => toggleDeliverable(selected, i)} className="flex items-center gap-2 text-sm text-left w-full hover:bg-slate-50 rounded px-1 py-0.5">
                        {d.done ? <CheckSquare size={15} className="text-emerald-600 shrink-0" /> : <Square size={15} className="text-slate-400 shrink-0" />}
                        <span className={`flex-1 ${d.done ? 'line-through text-slate-400' : 'text-slate-800'}`}>{d.label}</span>
                        {d.due_on && (
                          <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${d.done ? 'text-slate-400' : overdue ? 'bg-rose-100 text-rose-700' : soon ? 'bg-amber-100 text-amber-800' : 'text-slate-500'}`}>
                            {fmtDate(d.due_on)}{!d.done && overdue ? ` (${-dl}일 지남)` : !d.done && dl === 0 ? ' (오늘)' : !d.done && soon ? ` (D-${dl})` : ''}
                          </span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>
      )}

      {editor && (
        <CampaignEditorModal
          project={project} kind={kind} initial={editor.initial}
          nextRound={(campaigns.filter((c) => c.kind === 'planned').reduce((m, c) => Math.max(m, c.round_no || 0), 0)) + 1}
          onClose={() => setEditor(null)}
          onSaved={(saved) => { setEditor(null); onChanged?.(); if (saved?.id) onSelect(saved.id) }}
        />
      )}
    </div>
  )
}

function PeriodBadge({ c }) {
  if (!c.starts_on) return null
  const ds = daysUntil(c.starts_on)
  const de = c.ends_on ? daysUntil(c.ends_on) : null
  if (c.status === 'done') return null
  if (ds > 0) return <span className="ml-1 text-[10px] font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">D-{ds}</span>
  if (de !== null && de < 0) return <span className="ml-1 text-[10px] font-bold text-rose-700 bg-rose-100 px-1.5 py-0.5 rounded">기간 종료</span>
  if (de !== null) return <span className="ml-1 text-[10px] font-bold text-myriad-ink bg-myriad-primary/30 px-1.5 py-0.5 rounded">진행 중 · 종료 D-{de}</span>
  return <span className="ml-1 text-[10px] font-bold text-myriad-ink bg-myriad-primary/30 px-1.5 py-0.5 rounded">진행 중</span>
}

function CampaignEditorModal({ project, kind, initial, nextRound, onClose, onSaved }) {
  const { user } = useAuth()
  const [form, setForm] = useState(() => ({
    id: initial?.id,
    project_id: project.id,
    kind,
    round_no: initial?.round_no ?? (kind === 'planned' ? nextRound : null),
    title: initial?.title || (kind === 'planned' ? `${nextRound}차 기획 모니터링` : ''),
    theme: initial?.theme || '',
    brandsText: (initial?.brands || []).join(', '),
    starts_on: initial?.starts_on || '',
    ends_on: initial?.ends_on || '',
    status: initial?.status || 'planned',
    deliverables: initial?.deliverables || [],
    note: initial?.note || '',
    sort_order: initial?.sort_order ?? (kind === 'planned' ? nextRound : 0)
  }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const inputCls = 'px-2.5 py-1.5 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-myriad-primary/40'

  function setD(i, patch) { setForm((f) => ({ ...f, deliverables: f.deliverables.map((d, j) => (j === i ? { ...d, ...patch } : d)) })) }
  function addD() { setForm((f) => ({ ...f, deliverables: [...f.deliverables, { label: '', due_on: null, done: false }] })) }
  function rmD(i) { setForm((f) => ({ ...f, deliverables: f.deliverables.filter((_, j) => j !== i) })) }

  async function submit(e) {
    e.preventDefault()
    if (!form.title.trim()) { setError('라운드 이름을 입력하세요.'); return }
    setSaving(true); setError(null)
    try {
      const saved = await saveCampaign({
        ...form,
        brands: form.brandsText.split(/[,\n]/),
        deliverables: form.deliverables.filter((d) => d.label.trim()).map((d) => ({ label: d.label.trim(), due_on: d.due_on || null, done: !!d.done }))
      }, user.id)
      onSaved(saved)
    } catch (e) {
      setError(e.message)
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-6 overflow-y-auto" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <form onSubmit={submit} className="bg-white rounded-2xl shadow-xl w-full max-w-2xl my-4">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h3 className="font-bold text-slate-900">{initial ? '라운드 수정' : '라운드 추가'}</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <div className="flex gap-2">
            {kind === 'planned' && (
              <input type="number" min="1" value={form.round_no ?? ''} onChange={(e) => setForm((f) => ({ ...f, round_no: e.target.value ? Number(e.target.value) : null }))} className={`${inputCls} w-20`} placeholder="차수" />
            )}
            <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} className={`${inputCls} flex-1 font-semibold`} placeholder="라운드 이름" />
            <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))} className={inputCls}>
              {Object.entries(CAMPAIGN_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div className="flex gap-2 items-center text-sm text-slate-600">
            <label className="flex items-center gap-1.5">시작 <input type="date" value={form.starts_on} onChange={(e) => setForm((f) => ({ ...f, starts_on: e.target.value }))} className={inputCls} /></label>
            <label className="flex items-center gap-1.5">종료 <input type="date" value={form.ends_on} onChange={(e) => setForm((f) => ({ ...f, ends_on: e.target.value }))} className={inputCls} /></label>
            <span className="text-xs text-slate-400">종료 비우면 "마감일 미정"</span>
          </div>
          <textarea value={form.theme} onChange={(e) => setForm((f) => ({ ...f, theme: e.target.value }))} rows={2} className={`${inputCls} w-full`} placeholder="주제 / 대상 품목 (예: 신학기 완구·문구 브랜드)" />
          <input value={form.brandsText} onChange={(e) => setForm((f) => ({ ...f, brandsText: e.target.value }))} className={`${inputCls} w-full`} placeholder="대상 브랜드 (쉼표 구분: 셀린느, 디올, 어뉴골프)" />
          <textarea value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} rows={2} className={`${inputCls} w-full`} placeholder="비고" />

          <div className="border border-slate-200 rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-600">제출물 · 마일스톤</span>
              <button type="button" onClick={addD} className="text-xs text-slate-600 hover:text-myriad-ink flex items-center gap-1"><Plus size={12} /> 항목 추가</button>
            </div>
            <div className="space-y-1.5">
              {form.deliverables.map((d, i) => (
                <div key={i} className="flex items-center gap-2">
                  <button type="button" onClick={() => setD(i, { done: !d.done })} className="shrink-0">{d.done ? <CheckSquare size={15} className="text-emerald-600" /> : <Square size={15} className="text-slate-400" />}</button>
                  <input value={d.label} onChange={(e) => setD(i, { label: e.target.value })} className={`${inputCls} flex-1`} placeholder="항목 (예: 결과 보고 hwp 제출)" />
                  <input type="date" value={d.due_on || ''} onChange={(e) => setD(i, { due_on: e.target.value || null })} className={inputCls} />
                  <button type="button" onClick={() => rmD(i)} className="text-slate-400 hover:text-rose-600"><Trash2 size={13} /></button>
                </div>
              ))}
              {form.deliverables.length === 0 && <div className="text-xs text-slate-400">항목 없음</div>}
            </div>
          </div>
          {error && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>}
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
