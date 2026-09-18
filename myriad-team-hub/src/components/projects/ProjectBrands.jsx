/**
 * ProjectBrands — 참여 브랜드사 × 서류 5종 매트릭스.
 * 셀 클릭으로 확보 여부 토글(즉시 저장). 서류 완비 → M 전환 제안.
 */
import { useEffect, useMemo, useState } from 'react'
import { Plus, Edit3, Trash2, X, Save, Loader2, Check, Search, Building2, AlertTriangle } from 'lucide-react'
import { BRAND_DOCS, listBrands, saveBrand, patchBrand, deleteBrand } from '../../lib/projects'
import { useAuth } from '../../contexts/AuthContext'

export default function ProjectBrands({ project, onChanged }) {
  const { isAdmin } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [wave, setWave] = useState('')
  const [onlyMissing, setOnlyMissing] = useState(false)
  const [editor, setEditor] = useState(null)

  useEffect(() => { load() }, [project.id])
  async function load() {
    setLoading(true)
    try { setRows(await listBrands(project.id)) } catch (e) { setError(e.message) } finally { setLoading(false) }
  }

  const filtered = useMemo(() => rows.filter((r) => {
    if (wave && String(r.wave) !== wave) return false
    if (onlyMissing && BRAND_DOCS.every((d) => r[d.key])) return false
    if (search.trim()) {
      const s = search.trim().toLowerCase()
      if (!r.company.toLowerCase().includes(s) && !(r.brand_names || []).some((b) => b.toLowerCase().includes(s)) && !(r.note || '').toLowerCase().includes(s)) return false
    }
    return true
  }), [rows, wave, onlyMissing, search])

  const stats = useMemo(() => ({
    total: rows.length,
    wave1: rows.filter((r) => r.wave === 1).length,
    wave2: rows.filter((r) => r.wave === 2).length,
    poa: rows.filter((r) => r.doc_poa).length,
    complete: rows.filter((r) => BRAND_DOCS.every((d) => r[d.key])).length,
    m: rows.filter((r) => r.report_owner === 'M').length,
    brands: rows.reduce((s, r) => s + (r.brand_names?.length || r.brand_count || 0), 0)
  }), [rows])

  async function toggleDoc(r, key) {
    const next = !r[key]
    setRows((list) => list.map((x) => (x.id === r.id ? { ...x, [key]: next } : x)))
    try { await patchBrand(r.id, { [key]: next }); onChanged?.() } catch (e) { setError(e.message); load() }
  }
  async function toggleOwner(r) {
    const next = r.report_owner === 'M' ? 'K' : 'M'
    setRows((list) => list.map((x) => (x.id === r.id ? { ...x, report_owner: next } : x)))
    try { await patchBrand(r.id, { report_owner: next }); onChanged?.() } catch (e) { setError(e.message); load() }
  }
  async function handleDelete(r) {
    if (!confirm(`"${r.company}" 을 삭제할까요?`)) return
    await deleteBrand(r.id); load(); onChanged?.()
  }

  return (
    <div>
      {/* 요약 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
        <Stat label="참여 브랜드사" value={`${stats.total}개사`} sub={`1차 ${stats.wave1} · 2차 ${stats.wave2}`} />
        <Stat label="보유 브랜드 수" value={`${stats.brands}개`} sub="이름 미확정은 수량만" />
        <Stat label="3자 위임장 확보" value={`${stats.poa}/${stats.total}`} sub={`미확보 ${stats.total - stats.poa}`} warn={stats.total - stats.poa > 0} />
        <Stat label="서류 5종 완비" value={`${stats.complete}/${stats.total}`} sub="전부 체크된 곳" />
        <Stat label="Myriad(M) 소관 신고" value={`${stats.m}개사`} sub={`KOIPA(K) ${stats.total - stats.m}`} gold />
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="flex gap-1 text-xs">
          {[['', '전체'], ['1', '1차 모집'], ['2', '2차 모집']].map(([k, l]) => (
            <button key={k} onClick={() => setWave(k)} className={`px-2.5 py-1 rounded-full border font-semibold ${wave === k ? 'bg-myriad-primary/20 border-myriad-primary text-myriad-ink' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{l}</button>
          ))}
          <button onClick={() => setOnlyMissing((v) => !v)} className={`px-2.5 py-1 rounded-full border font-semibold ${onlyMissing ? 'bg-rose-100 border-rose-300 text-rose-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>서류 미비만</button>
        </div>
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="브랜드사 / 브랜드 / 비고 검색"
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
                  {BRAND_DOCS.map((d) => <th key={d.key} className="px-2 py-2 text-center w-16" title={d.label}>{d.short}</th>)}
                  <th className="px-2 py-2 text-center w-16" title="신고 주체 (클릭 전환)">신고</th>
                  <th className="px-3 py-2 text-left">비고</th>
                  <th className="px-2 py-2 w-16" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => {
                  const complete = BRAND_DOCS.every((d) => r[d.key])
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
                      {BRAND_DOCS.map((d) => (
                        <td key={d.key} className="px-2 py-2 text-center">
                          <button onClick={() => toggleDoc(r, d.key)} title={`${d.label} ${r[d.key] ? '확보' : '미확보'} (클릭 전환)`}
                            className={`w-7 h-7 rounded-md inline-flex items-center justify-center border transition ${r[d.key] ? 'bg-emerald-100 border-emerald-300 text-emerald-700' : 'bg-white border-slate-200 text-slate-300 hover:border-slate-400'}`}>
                            {r[d.key] ? <Check size={14} /> : <X size={12} />}
                          </button>
                        </td>
                      ))}
                      <td className="px-2 py-2 text-center">
                        <button onClick={() => toggleOwner(r)} title="클릭하면 K ↔ M 전환"
                          className={`w-8 h-7 rounded-md text-xs font-bold border ${r.report_owner === 'M' ? 'bg-[#F2B100]/25 border-[#F2B100] text-[#2B2928]' : 'bg-slate-100 border-slate-200 text-slate-600'}`}>
                          {r.report_owner}
                        </button>
                        {complete && r.report_owner === 'K' && <div className="text-[9px] text-amber-700 mt-0.5">완비→M?</div>}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600 max-w-xs">{r.note}</td>
                      <td className="px-2 py-2 text-right whitespace-nowrap">
                        <button onClick={() => setEditor({ initial: r })} className="p-1 text-slate-400 hover:text-slate-800"><Edit3 size={13} /></button>
                        {isAdmin && <button onClick={() => handleDelete(r)} className="p-1 text-slate-400 hover:text-rose-600"><Trash2 size={13} /></button>}
                      </td>
                    </tr>
                  )
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={5 + BRAND_DOCS.length + 3} className="py-10 text-center text-sm text-slate-400">해당하는 브랜드사가 없습니다.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="text-xs text-slate-400 mt-2">서류 셀과 K/M 셀은 클릭 즉시 저장됩니다. 서류 5종 = 3자 권리위임장 · 카카오스토리 신고용 위임장 · 법인인감증명서 · 위조상품 식별자료/공식업체 리스트 · 사업자등록증.</p>

      {editor && <BrandEditorModal project={project} initial={editor.initial} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); load(); onChanged?.() }} />}
    </div>
  )
}

function Stat({ label, value, sub, warn, gold }) {
  return (
    <div className="bg-white border border-[#E7E3DE] rounded-xl px-3 py-2.5">
      <div className="text-[11px] text-[#8A8580]">{label}</div>
      <div className={`text-xl font-bold ${gold ? 'text-[#B98A00]' : warn ? 'text-rose-600' : 'text-[#2B2928]'}`}>{value}</div>
      {sub && <div className="text-[11px] text-[#8A8580]">{sub}</div>}
    </div>
  )
}

function BrandEditorModal({ project, initial, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({
    id: initial?.id, project_id: project.id,
    company: initial?.company || '',
    brandsText: (initial?.brand_names || []).join(', '),
    brand_count: initial?.brand_count ?? '',
    wave: initial?.wave || 1,
    category: initial?.category || '',
    doc_poa: !!initial?.doc_poa, doc_kakao: !!initial?.doc_kakao, doc_seal: !!initial?.doc_seal,
    doc_identify: !!initial?.doc_identify, doc_bizreg: !!initial?.doc_bizreg,
    report_owner: initial?.report_owner || 'K',
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
      await saveBrand({ ...form, brand_names: form.brandsText.split(/[,\n]/) })
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
          <input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} className={`${inputCls} w-full`} placeholder="업종 (선택)" />
          <div className="border border-slate-200 rounded-xl p-3">
            <div className="text-xs font-semibold text-slate-600 mb-2">서류 확보 현황</div>
            <div className="grid grid-cols-2 gap-1.5">
              {BRAND_DOCS.map((d) => (
                <label key={d.key} className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={form[d.key]} onChange={(e) => setForm((f) => ({ ...f, [d.key]: e.target.checked }))} className="accent-[#F2B100]" /> {d.label}
                </label>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-3 text-sm">
              <span className="text-slate-600">신고 주체</span>
              {['K', 'M'].map((o) => (
                <label key={o} className="flex items-center gap-1"><input type="radio" checked={form.report_owner === o} onChange={() => setForm((f) => ({ ...f, report_owner: o }))} className="accent-[#F2B100]" /> {o === 'K' ? 'K (KOIPA)' : 'M (Myriad)'}</label>
              ))}
            </div>
          </div>
          <textarea value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} rows={2} className={`${inputCls} w-full`} placeholder="비고 (예: 3자 위임장 미서명 9/4)" />
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
