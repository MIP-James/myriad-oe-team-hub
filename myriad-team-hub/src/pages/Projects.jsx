/**
 * Projects — /projects  팀 프로젝트 목록.
 * 카드 = 프로젝트 요약(발주처·기간·목표·진행률). 클릭 → /projects/:slug
 * 신규 프로젝트 = 관리자 모달 (기본 7 섹션 자동 생성).
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FolderKanban, Plus, Loader2, ChevronRight, Building2, Calendar, X, Save, AlertTriangle } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { listProjects, listMonthSummary, summarize, countOpenIssues, createProjectWithDefaults } from '../lib/projects'

export default function Projects() {
  const { isAdmin, user } = useAuth()
  const [rows, setRows] = useState([])
  const [stats, setStats] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => { load() }, [])
  async function load() {
    setLoading(true); setError(null)
    try {
      const p = await listProjects()
      setRows(p)
      const s = {}
      await Promise.all(p.map(async (x) => {
        const [m, oi] = await Promise.all([listMonthSummary(x.id).catch(() => []), countOpenIssues(x.id)])
        s[x.id] = { agg: summarize(m), openIssues: oi }
      }))
      setStats(s)
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <header className="mb-6 flex items-center gap-3">
        <FolderKanban className="text-myriad-ink" />
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-slate-900">팀 프로젝트</h1>
          <p className="text-sm text-slate-500">팀이 수행하는 외부 프로젝트별 정보·이슈·자료를 한곳에 모아둡니다.</p>
        </div>
        {isAdmin && (
          <button onClick={() => setCreating(true)} className="flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink"><Plus size={14} /> 새 프로젝트</button>
        )}
      </header>

      {error && (
        <div className="mb-4 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg p-3 flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <div>{error}<div className="text-xs text-rose-500 mt-1">"Could not find the table" 류 오류면 Supabase 에서 마이그레이션 037 을 먼저 실행해 주세요.</div></div>
        </div>
      )}

      {loading ? (
        <div className="py-16 text-center text-sm text-slate-400 flex items-center justify-center gap-2"><Loader2 size={14} className="animate-spin" /> 불러오는 중...</div>
      ) : rows.length === 0 ? (
        <div className="py-16 text-center text-sm text-slate-400 bg-white border border-dashed border-slate-200 rounded-xl">등록된 프로젝트가 없습니다.</div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {rows.map((p) => {
            const st = stats[p.id]
            const goal = p.config?.goal_count || 0
            const blocked = st?.agg?.blocked || 0
            const reported = st?.agg?.reported || 0
            const rate = goal ? (blocked / goal) * 100 : null
            return (
              <Link key={p.id} to={`/projects/${p.slug}`} className={`group bg-white border rounded-2xl p-5 hover:shadow-md transition ${p.is_active ? 'border-[#E7E3DE] hover:border-[#F2B100]' : 'border-slate-200 opacity-70'}`}>
                <div className="flex items-start gap-3">
                  <div className="w-11 h-11 rounded-xl bg-[#3A3737] text-[#F2B100] flex items-center justify-center shrink-0"><FolderKanban size={22} /></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="font-bold text-slate-900 leading-snug group-hover:text-[#B98A00] transition">{p.short_name || p.name}</h2>
                      {!p.is_active && <span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">종료</span>}
                    </div>
                    {p.short_name && <div className="text-xs text-slate-500 truncate">{p.name}</div>}
                    <div className="text-xs text-slate-500 mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
                      {p.client && <span className="inline-flex items-center gap-1"><Building2 size={11} /> {p.client}</span>}
                      {p.starts_on && <span className="inline-flex items-center gap-1"><Calendar size={11} /> {p.starts_on} ~ {p.ends_on || '진행 중'}</span>}
                    </div>
                  </div>
                  <ChevronRight size={18} className="text-slate-300 group-hover:text-[#B98A00] shrink-0 mt-2" />
                </div>
                {p.description && <p className="text-xs text-slate-600 mt-3 line-clamp-2">{p.description}</p>}
                {goal > 0 && (
                  <div className="mt-4">
                    <div className="flex items-center justify-between text-[11px] text-[#8A8580] mb-1">
                      <span>KOIPA 확정 {blocked.toLocaleString()} / 목표 {goal.toLocaleString()} · 보고 {reported.toLocaleString()}</span>
                      <span className="font-bold text-[#2B2928]">{rate.toFixed(2)}%</span>
                    </div>
                    <div className="h-2 bg-[#FAF8F4] border border-[#E7E3DE] rounded-full overflow-hidden relative">
                      <div className="absolute inset-y-0 left-0 bg-[#E7E3DE]" style={{ width: `${Math.min((reported / goal) * 100, 100)}%` }} />
                      <div className="absolute inset-y-0 left-0 bg-[#F2B100]" style={{ width: `${Math.min(rate, 100)}%` }} />
                    </div>
                  </div>
                )}
                {st?.openIssues > 0 && <div className="mt-3 text-xs font-semibold text-rose-600">열린 이슈 {st.openIssues}건</div>}
              </Link>
            )
          })}
        </div>
      )}

      {creating && <NewProjectModal userId={user?.id} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); load() }} />}
    </div>
  )
}

function NewProjectModal({ userId, onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', short_name: '', slug: '', client: '', description: '', starts_on: '', ends_on: '', goal_count: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const inputCls = 'px-2.5 py-1.5 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-myriad-primary/40'

  async function submit(e) {
    e.preventDefault()
    if (!form.name.trim()) { setError('프로젝트 이름을 입력하세요.'); return }
    const slug = (form.slug || form.short_name || form.name).trim().toLowerCase().replace(/[^a-z0-9가-힣]+/g, '-').replace(/^-|-$/g, '')
    if (!slug) { setError('URL 키(slug)를 영문·숫자로 입력하세요.'); return }
    setSaving(true); setError(null)
    try {
      await createProjectWithDefaults({ ...form, slug, goal_count: form.goal_count ? Number(form.goal_count) : null }, userId)
      onCreated()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-6 overflow-y-auto" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <form onSubmit={submit} className="bg-white rounded-2xl shadow-xl w-full max-w-lg my-4">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h3 className="font-bold text-slate-900">새 프로젝트</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={`${inputCls} w-full font-semibold`} placeholder="정식 명칭" autoFocus />
          <div className="grid grid-cols-2 gap-2">
            <input value={form.short_name} onChange={(e) => setForm((f) => ({ ...f, short_name: e.target.value }))} className={inputCls} placeholder="짧은 이름 (카드 표기)" />
            <input value={form.slug} onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))} className={inputCls} placeholder="URL 키 (영문, 예: koipa-2026)" />
          </div>
          <input value={form.client} onChange={(e) => setForm((f) => ({ ...f, client: e.target.value }))} className={`${inputCls} w-full`} placeholder="발주처 / 고객사" />
          <div className="grid grid-cols-3 gap-2">
            <input type="date" value={form.starts_on} onChange={(e) => setForm((f) => ({ ...f, starts_on: e.target.value }))} className={inputCls} />
            <input type="date" value={form.ends_on} onChange={(e) => setForm((f) => ({ ...f, ends_on: e.target.value }))} className={inputCls} />
            <input type="number" value={form.goal_count} onChange={(e) => setForm((f) => ({ ...f, goal_count: e.target.value }))} className={inputCls} placeholder="목표 건수" />
          </div>
          <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={3} className={`${inputCls} w-full`} placeholder="한 줄 설명" />
          <p className="text-xs text-slate-500">기본 탭 7개(공지·규칙 · 팀 현황 · 월별 운영 · 기획 모니터링 · 브랜드 & 담당 · 할 일 · 가이드 & 연락처)가 자동 생성됩니다. 마감 체크리스트는 첫 프로젝트 것을 복사해 오며, 기간·목표·체크리스트는 생성 후 프로젝트 페이지에서 수정할 수 있습니다.</p>
          {error && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200">
          <button type="button" onClick={onClose} className="text-sm px-3 py-1.5 text-slate-600 hover:bg-slate-100 rounded-lg">취소</button>
          <button type="submit" disabled={saving} className="text-sm font-semibold px-4 py-1.5 rounded-lg bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink flex items-center gap-1.5 disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} 생성
          </button>
        </div>
      </form>
    </div>
  )
}
