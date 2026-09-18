/**
 * ProjectSettingsModal — 프로젝트 기본 정보·기간·목표 수정 (관리자).
 * projects 행 컬럼(name/short_name/client/description/starts_on/ends_on/is_active)
 * + config(goal_count/copyright_goal/copyright_baseline) 를 한 번에 저장.
 */
import { useState } from 'react'
import { X, Save, Loader2 } from 'lucide-react'
import { updateProject } from '../../lib/projects'

const inputCls = 'px-2.5 py-1.5 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-myriad-primary/40'

export default function ProjectSettingsModal({ project, hasCopyright, onClose, onSaved }) {
  const cfg = project.config || {}
  const [form, setForm] = useState({
    name: project.name || '',
    short_name: project.short_name || '',
    client: project.client || '',
    description: project.description || '',
    starts_on: project.starts_on || '',
    ends_on: project.ends_on || '',
    is_active: project.is_active !== false,
    goal_count: cfg.goal_count ?? '',
    copyright_goal: cfg.copyright_goal ?? '',
    copyright_baseline: cfg.copyright_baseline ?? ''
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const num = (v) => (v === '' || v === null || v === undefined ? null : Number(String(v).replace(/[^\d]/g, '')) || 0)

  async function submit(e) {
    e.preventDefault()
    if (!form.name.trim()) { setError('프로젝트 이름을 입력하세요.'); return }
    if (form.starts_on && form.ends_on && form.ends_on < form.starts_on) { setError('종료일이 시작일보다 앞설 수 없습니다.'); return }
    setSaving(true); setError(null)
    try {
      const config = { goal_count: num(form.goal_count) }
      if (hasCopyright) {
        config.copyright_goal = num(form.copyright_goal)
        config.copyright_baseline = num(form.copyright_baseline)
      }
      const saved = await updateProject(project.id, {
        name: form.name.trim(),
        short_name: form.short_name.trim() || null,
        client: form.client.trim() || null,
        description: form.description.trim() || null,
        starts_on: form.starts_on || null,
        ends_on: form.ends_on || null,
        is_active: !!form.is_active,
        config
      })
      onSaved(saved)
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-6 overflow-y-auto" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <form onSubmit={submit} className="bg-white rounded-2xl shadow-xl w-full max-w-lg my-4">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h3 className="font-bold text-slate-900">프로젝트 설정</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="space-y-2">
            <input value={form.name} onChange={set('name')} className={`${inputCls} w-full font-semibold`} placeholder="정식 명칭" />
            <div className="grid grid-cols-2 gap-2">
              <input value={form.short_name} onChange={set('short_name')} className={inputCls} placeholder="짧은 이름 (카드 표기)" />
              <input value={form.client} onChange={set('client')} className={inputCls} placeholder="발주처 / 고객사" />
            </div>
            <textarea value={form.description} onChange={set('description')} rows={2} className={`${inputCls} w-full`} placeholder="한 줄 설명" />
          </div>

          <div>
            <div className="text-xs font-semibold text-slate-600 mb-1.5">기간</div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block"><span className="text-[11px] text-[#8A8580]">시작일</span>
                <input type="date" value={form.starts_on} onChange={set('starts_on')} className={`${inputCls} w-full`} /></label>
              <label className="block"><span className="text-[11px] text-[#8A8580]">종료일 (비우면 "진행 중")</span>
                <input type="date" value={form.ends_on} onChange={set('ends_on')} className={`${inputCls} w-full`} /></label>
            </div>
            <p className="text-[11px] text-[#8A8580] mt-1">월별 운영·저작권 탭의 월 목록은 이 기간으로 만들어집니다. 기간을 줄여도 이미 입력한 월 데이터는 지워지지 않습니다.</p>
          </div>

          <div>
            <div className="text-xs font-semibold text-slate-600 mb-1.5">목표</div>
            <div className={`grid gap-2 ${hasCopyright ? 'grid-cols-3' : 'grid-cols-1'}`}>
              <label className="block"><span className="text-[11px] text-[#8A8580]">전체 차단 목표 건수</span>
                <input type="text" inputMode="numeric" value={form.goal_count} onChange={(e) => setForm((f) => ({ ...f, goal_count: e.target.value.replace(/[^\d]/g, '') }))} className={`${inputCls} w-full tabular-nums`} placeholder="예: 85000" /></label>
              {hasCopyright && (
                <>
                  <label className="block"><span className="text-[11px] text-[#8A8580]">저작권 목표</span>
                    <input type="text" inputMode="numeric" value={form.copyright_goal} onChange={(e) => setForm((f) => ({ ...f, copyright_goal: e.target.value.replace(/[^\d]/g, '') }))} className={`${inputCls} w-full tabular-nums`} placeholder="예: 96" /></label>
                  <label className="block"><span className="text-[11px] text-[#8A8580]">사업 전 완료</span>
                    <input type="text" inputMode="numeric" value={form.copyright_baseline} onChange={(e) => setForm((f) => ({ ...f, copyright_baseline: e.target.value.replace(/[^\d]/g, '') }))} className={`${inputCls} w-full tabular-nums`} placeholder="예: 8" /></label>
                </>
              )}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} className="accent-[#F2B100]" />
            진행 중 프로젝트 (해제하면 목록 카드에 "종료" 표시)
          </label>

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
