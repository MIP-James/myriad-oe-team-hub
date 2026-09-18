/**
 * ProjectDashboard — 팀 현황 (내부 실무 뷰).
 * 대외 수치(수집·위반확정·신고·차단 자동 집계)는 M-Bridge 정본 → 여기서는 링크 카드로만 연결.
 * 여기 숫자는 "KOIPA 가 확정해준 월별 인정 건수" 만 사용.
 */
import { useEffect, useMemo, useState } from 'react'
import { Loader2, Target, ListTodo, Calendar, Building2, Copyright, ChevronRight, AlertTriangle, ExternalLink, User, CheckSquare } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import {
  listMonthSummary, summarize, listCampaigns, listBrands, listUpcomingIssues, listMyOpenIssues, countOpenIssues,
  listResources, listTeamProfiles, profileName, CAMPAIGN_STATUS, MONITORING_STATUS_MAP, fmtDate, daysUntil, monthLabel
} from '../../lib/projects'

const num = (v) => (v || 0).toLocaleString('ko-KR')

export default function ProjectDashboard({ project, sections, goTab }) {
  const { user } = useAuth()
  const [summary, setSummary] = useState([])
  const [campaigns, setCampaigns] = useState([])
  const [brands, setBrands] = useState([])
  const [issues, setIssues] = useState([])
  const [mine, setMine] = useState([])
  const [openIssues, setOpenIssues] = useState(0)
  const [links, setLinks] = useState([])
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => { load() }, [project.id, user?.id])
  async function load() {
    setLoading(true)
    try {
      const [s, c, b, i, m, oi, r, p] = await Promise.all([
        listMonthSummary(project.id), listCampaigns(project.id), listBrands(project.id),
        listUpcomingIssues(project.id, 8), listMyOpenIssues(project.id, user?.id, 8), countOpenIssues(project.id),
        listResources(project.id), listTeamProfiles()
      ])
      setSummary(s); setCampaigns(c); setBrands(b); setIssues(i); setMine(m); setOpenIssues(oi)
      setLinks(r.filter((x) => x.kind === 'link')); setProfiles(p)
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }

  const cfg = project.config || {}
  const goal = cfg.goal_count || 0
  const agg = useMemo(() => summarize(summary), [summary])
  const rate = goal ? (agg.blocked / goal) * 100 : 0
  const pmap = useMemo(() => Object.fromEntries(profiles.map((p) => [p.id, p])), [profiles])

  const deadlines = useMemo(() => {
    const out = []
    for (const i of issues) if (i.due_on) out.push({ kind: 'issue', id: i.id, label: i.title, due_on: i.due_on, assignee: i.assignee_id })
    for (const c of campaigns) for (const d of c.deliverables || []) {
      if (!d.done && d.due_on) out.push({ kind: 'campaign', id: c.id, ckind: c.kind, label: `${c.title} · ${d.label}`, due_on: d.due_on })
    }
    return out.sort((a, b) => a.due_on.localeCompare(b.due_on)).slice(0, 8)
  }, [issues, campaigns])

  // 브랜드 담당 요약 (담당자별 개수)
  const byOwner = useMemo(() => {
    const m = {}
    for (const b of brands) { const k = b.assignee_id || '__none'; m[k] = (m[k] || 0) + 1 }
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [brands])

  const key = (kind) => sections.find((s) => s.kind === kind)?.key
  const mbridge = links.filter((l) => l.group_label === 'M-Bridge')
  const others = links.filter((l) => l.group_label !== 'M-Bridge')

  if (loading) return <div className="py-16 text-center text-sm text-slate-400 flex items-center justify-center gap-2"><Loader2 size={14} className="animate-spin" /> 불러오는 중...</div>
  if (error) return <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg p-3 flex items-center gap-2"><AlertTriangle size={13} /> {error}</div>

  return (
    <div className="space-y-5">
      {/* 상단: 목표 대비 KOIPA 확정 + 열린 할 일 + 내 할 일 */}
      <div className="grid lg:grid-cols-3 gap-3">
        <button onClick={() => key('monthly') && goTab(key('monthly'))} className="text-left bg-white border border-[#E7E3DE] rounded-xl p-4 hover:border-[#F2B100] transition">
          <div className="flex items-center gap-1.5 text-[11px] text-[#8A8580] mb-1"><Target size={12} /> KOIPA 확정 인정 누계 (목표 {num(goal)})</div>
          <div className="flex items-end gap-2">
            <span className="text-3xl font-bold text-[#B98A00] tabular-nums leading-none">{num(agg.blocked)}</span>
            <span className="text-sm text-[#2B2928] font-bold pb-0.5">{rate.toFixed(2)}%</span>
          </div>
          <div className="h-2 bg-[#FAF8F4] border border-[#E7E3DE] rounded-full overflow-hidden mt-2">
            <div className="h-full bg-[#F2B100]" style={{ width: `${Math.min(rate, 100)}%` }} />
          </div>
          <div className="text-[11px] text-[#8A8580] mt-1.5">
            {agg.byMonth.length ? agg.byMonth.map((m) => `${monthLabel(m.month).slice(6)} ${num(m.confirmed_blocked)}`).join(' · ') : '월별 운영 탭에서 확정 건수 입력'}
            <span className="ml-1">· 실시간 파이프라인 수치는 M-Bridge 종합 현황</span>
          </div>
        </button>

        <button onClick={() => key('issues') && goTab(key('issues'))} className="text-left bg-white border border-[#E7E3DE] rounded-xl p-4 hover:border-[#F2B100] transition">
          <div className="flex items-center gap-1.5 text-[11px] text-[#8A8580] mb-1"><ListTodo size={12} /> 열린 할 일</div>
          <div className={`text-3xl font-bold tabular-nums leading-none ${openIssues ? 'text-rose-600' : 'text-[#2B2928]'}`}>{num(openIssues)}</div>
          <div className="text-[11px] text-[#8A8580] mt-2">접수 + 처리 중 · 기한 지난 건 {deadlines.filter((d) => d.kind === 'issue' && daysUntil(d.due_on) < 0).length}</div>
        </button>

        <div className="bg-white border border-[#E7E3DE] rounded-xl p-4">
          <div className="flex items-center gap-1.5 text-[11px] text-[#8A8580] mb-1.5"><User size={12} /> 내 할 일 ({profileName(pmap[user?.id])})</div>
          {mine.length === 0 ? <div className="text-sm text-slate-400">담당으로 배정된 열린 할 일이 없습니다.</div> : (
            <ul className="space-y-1">
              {mine.slice(0, 4).map((i) => {
                const dl = i.due_on ? daysUntil(i.due_on) : null
                return (
                  <li key={i.id}>
                    <button onClick={() => key('issues') && goTab(key('issues'), { post: i.id })} className="w-full text-left flex items-center gap-2 text-xs hover:bg-[#FAF8F4] rounded px-1 py-0.5">
                      <CheckSquare size={11} className="text-slate-400 shrink-0" />
                      <span className="truncate text-slate-800">{i.title}</span>
                      {dl !== null && <span className={`ml-auto shrink-0 font-bold ${dl < 0 ? 'text-rose-600' : dl <= 3 ? 'text-amber-700' : 'text-slate-400'}`}>{dl < 0 ? `+${-dl}일` : dl === 0 ? '오늘' : `D-${dl}`}</span>}
                    </button>
                  </li>
                )
              })}
              {mine.length > 4 && <li className="text-[11px] text-slate-400 px-1">외 {mine.length - 4}건</li>}
            </ul>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-5 gap-5">
        {/* 마감 임박 */}
        <section className="lg:col-span-3 bg-white border border-[#E7E3DE] rounded-xl p-4">
          <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2 mb-2"><AlertTriangle size={14} /> 마감 임박 (할 일 + 라운드 제출물)</h3>
          {deadlines.length === 0 ? <div className="text-xs text-slate-400">기한이 잡힌 열린 항목이 없습니다.</div> : (
            <ul className="divide-y divide-[#E7E3DE]">
              {deadlines.map((d, i) => {
                const dl = daysUntil(d.due_on)
                const overdue = dl < 0
                return (
                  <li key={i}>
                    <button
                      onClick={() => d.kind === 'issue' ? key('issues') && goTab(key('issues'), { post: d.id }) : goTab(d.ckind === 'adhoc' ? key('adhoc') : key('campaign'), { c: d.id })}
                      className="w-full text-left flex items-center gap-3 text-sm hover:bg-[#FAF8F4] px-1 py-2">
                      <span className={`shrink-0 text-xs font-bold px-1.5 py-0.5 rounded tabular-nums w-14 text-center ${overdue ? 'bg-rose-100 text-rose-700' : dl <= 3 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>
                        {overdue ? `+${-dl}일` : dl === 0 ? '오늘' : `D-${dl}`}
                      </span>
                      <span className="truncate text-slate-800 flex-1">{d.label}</span>
                      {d.assignee && <span className="text-[11px] text-slate-500 shrink-0">{profileName(pmap[d.assignee])}</span>}
                      <span className="shrink-0 text-xs text-slate-400 w-12 text-right">{fmtDate(d.due_on)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <div className="lg:col-span-2 space-y-4">
          {/* 저작권 */}
          {cfg.copyright_goal > 0 && (
            <section className="bg-white border border-[#E7E3DE] rounded-xl p-4">
              <header className="flex items-center justify-between mb-2">
                <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2"><Copyright size={14} /> 저작권 트랙</h3>
                {key('copyright') && <button onClick={() => goTab(key('copyright'))} className="text-xs text-[#B98A00] font-semibold hover:underline inline-flex items-center">상세 <ChevronRight size={12} /></button>}
              </header>
              <div className="flex items-end gap-2">
                <span className="text-2xl font-bold text-[#2B2928]">{num((cfg.copyright_baseline || 0) + agg.copyrightBlocked)}</span>
                <span className="text-xs text-[#8A8580] pb-1">/ {cfg.copyright_goal}건 차단 · 송부 {num(agg.copyrightSent)}건</span>
              </div>
              <div className="h-2 bg-[#FAF8F4] border border-[#E7E3DE] rounded-full overflow-hidden mt-2 relative">
                <div className="absolute inset-y-0 left-0 bg-[#E7E3DE]" style={{ width: `${Math.min((((cfg.copyright_baseline || 0) + agg.copyrightSent) / cfg.copyright_goal) * 100, 100)}%` }} />
                <div className="absolute inset-y-0 left-0 bg-[#B98A00]" style={{ width: `${Math.min((((cfg.copyright_baseline || 0) + agg.copyrightBlocked) / cfg.copyright_goal) * 100, 100)}%` }} />
              </div>
            </section>
          )}

          {/* 브랜드 담당 */}
          <section className="bg-white border border-[#E7E3DE] rounded-xl p-4">
            <header className="flex items-center justify-between mb-2">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2"><Building2 size={14} /> 브랜드 담당 ({brands.length}개사)</h3>
              {key('brands') && <button onClick={() => goTab(key('brands'))} className="text-xs text-[#B98A00] font-semibold hover:underline inline-flex items-center">배정 <ChevronRight size={12} /></button>}
            </header>
            <ul className="text-xs space-y-1">
              {byOwner.map(([k, n]) => (
                <li key={k} className="flex items-center justify-between">
                  <span className={k === '__none' ? 'text-rose-600 font-semibold' : 'text-slate-700'}>{k === '__none' ? '미배정' : profileName(pmap[k])}</span>
                  <span className="font-bold tabular-nums text-[#2B2928]">{n}</span>
                </li>
              ))}
            </ul>
            <div className="text-[11px] text-[#8A8580] mt-2">
              모니터링 중 {brands.filter((b) => b.monitoring_status === 'active').length} · 착수 전 {brands.filter((b) => b.monitoring_status === 'pending').length}
            </div>
          </section>
        </div>
      </div>

      {/* 라운드 일정 */}
      {campaigns.length > 0 && (
        <section>
          <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2 mb-2"><Calendar size={14} /> 기획 · 비정기 모니터링 일정</h3>
          <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">
            {campaigns.map((c) => {
              const st = CAMPAIGN_STATUS[c.status] || CAMPAIGN_STATUS.planned
              const doneN = (c.deliverables || []).filter((d) => d.done).length
              const totN = (c.deliverables || []).length
              return (
                <button key={c.id} onClick={() => goTab(c.kind === 'adhoc' ? key('adhoc') : key('campaign'), { c: c.id })}
                  className={`text-left bg-white border rounded-xl p-3 hover:shadow-sm transition ${c.status === 'active' ? 'border-[#F2B100]' : 'border-[#E7E3DE]'}`}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="font-semibold text-slate-900 text-sm truncate">{c.title}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${st.cls}`}>{st.label}</span>
                  </div>
                  <div className="text-xs text-slate-600">{c.starts_on ? fmtDate(c.starts_on) : '?'} ~ {c.ends_on ? fmtDate(c.ends_on) : <span className="text-amber-700 font-semibold">미정</span>}</div>
                  {c.theme && <div className="text-[11px] text-slate-500 mt-1 line-clamp-2">{c.theme}</div>}
                  {c.brands?.length > 0 && <div className="text-[11px] text-[#B98A00] mt-1 truncate">{c.brands.join(' · ')}</div>}
                  {totN > 0 && <div className="text-[11px] text-slate-500 mt-1">제출물 {doneN}/{totN}</div>}
                </button>
              )
            })}
          </div>
        </section>
      )}

      {/* 외부 시스템 바로가기 */}
      {(mbridge.length > 0 || others.length > 0) && (
        <section>
          <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2 mb-2"><ExternalLink size={14} /> M-Bridge (KOIPA 협업 포털) · 외부 링크</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {[...mbridge, ...others].map((l) => (
              <a key={l.id} href={l.url} target="_blank" rel="noopener"
                className="bg-[#3A3737] hover:bg-[#2B2928] text-white rounded-xl px-3 py-2.5 transition group">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-sm truncate">{l.label}</span>
                  <ExternalLink size={12} className="text-[#F2B100] shrink-0" />
                </div>
                {l.note && <div className="text-[11px] text-white/60 mt-0.5 line-clamp-1">{l.note}</div>}
                {l.group_label && l.group_label !== 'M-Bridge' && <div className="text-[10px] text-[#F2B100] mt-0.5">{l.group_label}</div>}
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
