/**
 * ProjectBrands — 브랜드 & 담당.
 * 브랜드사별 담당 팀원 배정 · 모니터링 착수 상태 · 특이사항. (서류 현황은 M-Bridge 권리·서류가 정본)
 * 담당자/상태 셀은 클릭 즉시 저장.
 */
import { useEffect, useMemo, useState } from 'react'
import { Plus, Edit3, Trash2, X, Save, Loader2, Search, Building2, AlertTriangle, User } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import {
  MONITORING_STATUS, MONITORING_STATUS_MAP, listBrands, saveBrand, patchBrand, deleteBrand,
  listTeamProfiles, profileName
} from '../../lib/projects'

export default function ProjectBrands({ project, onChanged }) {
  const { isAdmin, user } = useAuth()
  const [rows, setRows] = useState([])
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [wave, setWave] = useState('')
  const [owner, setOwner] = useState('') // '' | 'me' | 'none' | <profile id>
  const [editor, setEditor] = useState(null)

  useEffect(() => { load(); listTeamProfiles().then(setProfiles) }, [project.id])
  async function load() {
    setLoading(true)
    try { setRows(await listBrands(project.id)) } catch (e) { setError(e.message) } finally { setLoading(false) }
  }
  const pmap = useMemo(() => Object.fromEntries(profiles.map((p) => [p.id, p])), [profiles])

  const filtered = useMemo(() => rows.filter((r) => {
    if (wave && String(r.wave) !== wave) return false
    if (owner === 'me' && r.assignee_id !== user?.id) return false
    if (owner === 'none' && r.assignee_id) return false
    if (owner && owner !== 'me' && owner !== 'none' && r.assignee_id !== owner) return false
    if (search.trim()) {
      const s = search.trim().toLowerCase()
      if (!r.company.toLowerCase().includes(s) && !(r.brand_names || []).some((b) => b.toLowerCase().includes(s)) && !(r.note || '').toLowerCase().includes(s)) return false
    }
    return true
  }), [rows, wave, owner, search, user?.id])

  const stats = useMemo(() => ({
    total: rows.length,
    wave1: rows.filter((r) => r.wave === 1).length,
    wave2: rows.filter((r) => r.wave === 2).length,
    active: rows.filter((r) => r.monitoring_status === 'active').length,
    pending: rows.filter((r) => r.monitoring_status === 'pending').length,
    unassigned: rows.filter((r) => !r.assignee_id).length,
    mine: rows.filter((r) => r.assignee_id === user?.id).length,
    brands: rows.reduce((s, r) => s + (r.brand_names?.length || r.brand_count || 0), 0)
  }), [rows, user?.id])

  async function patch(r, patchObj) {
    setRows((list) => list.map((x) => (x.id === r.id ? { ...x, ...patchObj } : x)))
    try { await patchBrand(r.id, patchObj); onChanged?.() } catch (e) { setError(e.message); load() }
  }
  async function handleDelete(r) {
    if (!confirm(`"${r.company}" 을 삭제할까요?`)) return
    await deleteBrand(r.id); load(); onChanged?.()
  }

  const selCls = 'text-xs border border-transparent hover:border-slate-300 focus:border-myriad-primary rounded-md px-1.5 py-1 bg-transparent focus:bg-white focus:outline-none cursor-pointer'

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
        <Stat label="참여 브랜드사" value={`${stats.total}개사`} sub={`1차 ${stats.wave1} · 2차 ${stats.wave2}`} />
        <Stat label="보유 브랜드 수" value={`${stats.brands}개`} sub="이름 미확정은 수량만" />
        <Stat label="모니터링 중" value={`${stats.active}/${stats.total}`} sub={`착수 전 ${stats.pending}`} gold />
        <Stat label="담당자 미배정" value={`${stats.unassigned}개사`} sub="셀 클릭으로 배정" warn={stats.unassigned > 0} />
        <Stat label="내 담당" value={`${stats.mine}개사`} sub={profileName(pmap[user?.id]) || ''} />
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="flex gap-1 text-xs">
          {[['', '전체'], ['1', '1차 모집'], ['2', '2차 모집']].map(([k, l]) => (
            <button key={k} onClick={() => setWave(k)} className={`px-2.5 py-1 rounded-full border font-semibold ${wave === k ? 'bg-myriad-primary/20 border-myriad-primary text-myriad-ink' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{l}</button>
          ))}
        </div>
        <select value={owner} onChange={(e) => setOwner(e.target.value)} className="px-2.5 py-1 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-myriad-primary/40">
          <option value="">담당자 전체</option>
          <option value="me">내 담당</option>
          <option value="none">미배정</option>
          {profiles.map((p) => <option key={p.id} value={p.id}>{profileName(p)}</option>)}
        </select>
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="브랜드사 / 브랜드 / 특이사항 검색"
            className="w-full pl-7 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40" />
        </div>
        <div className="flex-1" />
        <button onClick={() => setEditor({ initial: null })} className="flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-lg bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink"><Plus size={14} /> 브랜드사 추가</button>
      </div>

      {error && <div className="mb-3 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg p-3 flex items-center gap-2"><AlertTriangle size={13} /> {error}</div>}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="py-14 text-center text-sm text-slate-400 flex items-center justify-center gap-2"><Loader2 size={14} className="animate-spin" /> 불러오는 중...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#3A3737] text-white text-xs">
                <tr>
                  <th className="px-3 py-2 text-left w-8">#</th>
                  <th className="px-3 py-2 text-left">브랜드사</th>
                  <th className="px-3 py-2 text-left w-14">차수</th>
                  <th className="px-3 py-2 text-left w-36">담당 팀원</th>
                  <th className="px-3 py-2 text-left w-32">모니터링</th>
                  <th className="px-3 py-2 text-left">특이사항 · 노하우</th>
                  <th className="px-2 py-2 w-16" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => {
                  const st = MONITORING_STATUS_MAP[r.monitoring_status] || MONITORING_STATUS_MAP.pending
                  return (
                    <tr key={r.id} className="border-b border-[#E7E3DE] hover:bg-[#FAF8F4]">
                      <td className="px-3 py-2 text-xs text-slate-400">{i + 1}</td>
                      <td className="px-3 py-2">
                        <div className="font-semibold text-slate-900">{r.company}</div>
                        {(r.brand_names?.length > 0 || r.brand_count) && (
                          <div className="text-xs text-slate-500">{r.brand_names?.length ? r.brand_names.join(', ') : `브랜드 ${r.brand_count}개`}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">{r.wave}차</td>
                      <td className="px-2 py-1.5">
                        <select value={r.assignee_id || ''} onChange={(e) => patch(r, { assignee_id: e.target.value || null })}
                          className={`${selCls} w-full ${r.assignee_id ? 'text-slate-800 font-semibold' : 'text-slate-400'}`}>
                          <option value="">미배정</option>
                          {profiles.map((p) => <option key={p.id} value={p.id}>{profileName(p)}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <select value={r.monitoring_status} onChange={(e) => patch(r, { monitoring_status: e.target.value })}
                          className={`${selCls} w-full font-semibold ${st.cls}`}>
                          {MONITORING_STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600 max-w-md">{r.note}</td>
                      <td className="px-2 py-2 text-right whitespace-nowrap">
                        <button onClick={() => setEditor({ initial: r })} className="p-1 text-slate-400 hover:text-slate-800"><Edit3 size={13} /></button>
                        {isAdmin && <button onClick={() => handleDelete(r)} className="p-1 text-slate-400 hover:text-rose-600"><Trash2 size={13} /></button>}
                      </td>
                    </tr>
                  )
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={7} className="py-10 text-center text-sm text-slate-400">해당하는 브랜드사가 없습니다.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="text-xs text-slate-400 mt-2 flex items-center gap-1"><User size={11} /> 담당 팀원·모니터링 상태는 선택 즉시 저장됩니다. 위임장·사업자등록증 등 서류 현황은 M-Bridge 권리·서류에서 확인하세요.</p>

      {editor && <BrandEditorModal project={project} initial={editor.initial} profiles={profiles} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); load(); onChanged?.() }} />}
    </div>
  )
}

function Stat({ label, value, sub, warn, gold }) {
  return (
    <div className="bg-white border border-[#E7E3DE] rounded-xl px-3 py-2.5">
      <div className="text-[11px] text-[#8A8580]">{label}</div>
      <div className={`text-xl font-bold ${gold ? 'text-[#B98A00]' : warn ? 'text-rose-600' : 'text-[#2B2928]'}`}>{value}</div>
      {sub && <div className="text-[11px] text-[#8A8580] truncate">{sub}</div>}
    </div>
  )
}

function BrandEditorModal({ project, initial, profiles, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({
    id: initial?.id, project_id: project.id,
    company: initial?.company || '',
    brandsText: (initial?.brand_names || []).join(', '),
    brand_count: initial?.brand_count ?? '',
    wave: initial?.wave || 1,
    category: initial?.category || '',
    assignee_id: initial?.assignee_id || '',
    monitoring_status: initial?.monitoring_status || 'pending',
    note: initial?.note || ''
  }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const inputCls = 'px-2.5 py-1.5 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-myriad-primary/40'

  async function submit(e) {
    e.preventDefault()
    if (!form.company.trim()) { setError('브랜드사 이름을 입력하세요.'); return }
    setSaving(true); setError(null)
    try {
      await saveBrand({ ...form, brand_names: form.brandsText.split(/[,\n]/), assignee_id: form.assignee_id || null })
      onSaved()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-6 overflow-y-auto" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <form onSubmit={submit} className="bg-white rounded-2xl shadow-xl w-full max-w-xl my-4">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h3 className="font-bold text-slate-900 flex items-center gap-2"><Building2 size={16} /> {initial ? '브랜드사 수정' : '브랜드사 추가'}</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <div className="flex gap-2">
            <input value={form.company} onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))} className={`${inputCls} flex-1 font-semibold`} placeholder="브랜드사 (법인명)" autoFocus />
            <select value={form.wave} onChange={(e) => setForm((f) => ({ ...f, wave: Number(e.target.value) }))} className={inputCls}>
              <option value={1}>1차 모집</option><option value={2}>2차 모집</option><option value={3}>3차 모집</option>
            </select>
          </div>
          <div className="flex gap-2">
            <input value={form.brandsText} onChange={(e) => setForm((f) => ({ ...f, brandsText: e.target.value }))} className={`${inputCls} flex-1`} placeholder="보유 브랜드 (쉼표 구분)" />
            <input type="number" min="0" value={form.brand_count} onChange={(e) => setForm((f) => ({ ...f, brand_count: e.target.value }))} className={`${inputCls} w-28`} placeholder="브랜드 수" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} className={inputCls} placeholder="업종 (선택)" />
            <select value={form.assignee_id} onChange={(e) => setForm((f) => ({ ...f, assignee_id: e.target.value }))} className={inputCls}>
              <option value="">담당 미배정</option>
              {profiles.map((p) => <option key={p.id} value={p.id}>{profileName(p)}</option>)}
            </select>
            <select value={form.monitoring_status} onChange={(e) => setForm((f) => ({ ...f, monitoring_status: e.target.value }))} className={inputCls}>
              {MONITORING_STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
          <textarea value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} rows={3} className={`${inputCls} w-full`} placeholder="특이사항 · 노하우 (예: 밴드 신고는 보호원 처리, 식별자료 링크, 자주 나오는 위조 유형)" />
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
