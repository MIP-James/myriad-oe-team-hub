/**
 * ProjectDashboard — 프로젝트 실시간 현황.
 * 숫자 출처: project_metrics_monthly (월별 실적 탭 입력값) 자동 집계.
 */
import { useEffect, useMemo, useState } from 'react'
import { Loader2, Target, ShieldCheck, Send, Search, ListTodo, Calendar, Building2, Copyright, ChevronRight, AlertTriangle } from 'lucide-react'
import {
  listMetrics, aggregateMetrics, listCampaigns, listBrands, listUpcomingIssues, countOpenIssues,
  CAMPAIGN_STATUS, BRAND_DOCS, fmtDate, daysUntil, shortMonthLabel, monthLabel
} from '../../lib/projects'
import MetricsTable from './MetricsTable'

const num = (v) => (v || 0).toLocaleString('ko-KR')

export default function ProjectDashboard({ project, sections, goTab }) {
  const [metrics, setMetrics] = useState([])
  const [campaigns, setCampaigns] = useState([])
  const [brands, setBrands] = useState([])
  const [issues, setIssues] = useState([])
  const [openIssues, setOpenIssues] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => { load() }, [project.id])
  async function load() {
    setLoading(true)
    try {
      const [m, c, b, i, oi] = await Promise.all([
        listMetrics(project.id), listCampaigns(project.id), listBrands(project.id),
        listUpcomingIssues(project.id, 6), countOpenIssues(project.id)
      ])
      setMetrics(m); setCampaigns(c); setBrands(b); setIssues(i); setOpenIssues(oi)
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }

  const cfg = project.config || {}
  const goal = cfg.goal_count || 0
  const agg = useMemo(() => aggregateMetrics(metrics.filter((r) => r.category !== '저작권')), [metrics])
  const copyright = useMemo(() => {
    const rows = metrics.filter((r) => r.category === '저작권')
    const sent = rows.reduce((s, r) => s + (r.reported_k || 0) + (r.reported_m || 0), 0)
    const done = rows.reduce((s, r) => s + (r.blocked_k || 0) + (r.blocked_m || 0), 0)
    return { sent, done, baseline: cfg.copyright_baseline || 0, goal: cfg.copyright_goal || 0 }
  }, [metrics, cfg])

  const rate = goal ? (agg.blocked / goal) * 100 : 0
  const reportRate = goal ? (agg.reported / goal) * 100 : 0

  // 누적 플랫폼 표용 행
  const cumulativeRows = useMemo(() => Object.values(agg.byPlatform), [agg])

  // 마감 임박 통합 (이슈 + 라운드 제출물)
  const deadlines = useMemo(() => {
    const out = []
    for (const i of issues) if (i.due_on) out.push({ kind: 'issue', id: i.id, label: i.title, due_on: i.due_on, status: i.status })
    for (const c of campaigns) for (const d of c.deliverables || []) {
      if (!d.done && d.due_on) out.push({ kind: 'campaign', id: c.id, ckind: c.kind, label: `${c.title} · ${d.label}`, due_on: d.due_on })
    }
    return out.sort((a, b) => a.due_on.localeCompare(b.due_on)).slice(0, 8)
  }, [issues, campaigns])

  const brandStats = useMemo(() => ({
    total: brands.length,
    poa: brands.filter((b) => b.doc_poa).length,
    complete: brands.filter((b) => BRAND_DOCS.every((d) => b[d.key])).length,
    m: brands.filter((b) => b.report_owner === 'M').length
  }), [brands])

  const monthlyIdx = sections.find((s) => s.kind === 'monthly')?.key
  const campaignKey = sections.find((s) => s.kind === 'campaign')?.key
  const adhocKey = sections.find((s) => s.kind === 'adhoc')?.key
  const issuesKey = sections.find((s) => s.kind === 'issues')?.key
  const brandsKey = sections.find((s) => s.kind === 'brands')?.key
  const copyKey = sections.find((s) => s.kind === 'copyright')?.key

  if (loading) return <div className="py-16 text-center text-sm text-slate-400 flex items-center justify-center gap-2"><Loader2 size={14} className="animate-spin" /> 집계 중...</div>
  if (error) return <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg p-3 flex items-center gap-2"><AlertTriangle size={13} /> {error}</div>

  return (
    <div className="space-y-5">
      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Kpi icon={Target} label="차단 목표" value={num(goal)} sub={`${project.starts_on ? fmtDate(project.starts_on, { year: 'numeric', month: 'short' }) : ''} ~ ${project.ends_on ? fmtDate(project.ends_on, { year: 'numeric', month: 'short' }) : ''}`} />
        <Kpi icon={ShieldCheck} label="차단 완료 누계" value={num(agg.blocked)} sub={`달성률 ${rate.toFixed(2)}% · K ${num(agg.total.blocked_k)} / M ${num(agg.total.blocked_m)}`} gold />
        <Kpi icon={Send} label="신고 진행 누계" value={num(agg.reported)} sub={`목표 대비 ${reportRate.toFixed(1)}% · K ${num(agg.total.reported_k)} / M ${num(agg.total.reported_m)}`} />
        <Kpi icon={Search} label="침해 게시물 수집 누계" value={agg.total.collected ? num(agg.total.collected) : '—'} sub={agg.total.collected ? '월별 실적표 수집 열 합계' : '월별 실적표의 "수집" 열에 입력하면 집계'} muted={!agg.total.collected} />
        <Kpi icon={ListTodo} label="열린 이슈" value={num(openIssues)} sub="접수 + 처리 중" warn={openIssues > 0} onClick={issuesKey ? () => goTab(issuesKey) : undefined} />
      </div>

      {/* 진행 바 */}
      <div className="bg-white border border-[#E7E3DE] rounded-xl p-4">
        <div className="flex items-center justify-between text-xs text-[#8A8580] mb-1.5">
          <span>차단 목표 달성률</span>
          <span><b className="text-[#2B2928] text-sm">{rate.toFixed(2)}%</b> · 잔여 {num(Math.max(goal - agg.blocked, 0))}건</span>
        </div>
        <div className="h-3 bg-[#FAF8F4] border border-[#E7E3DE] rounded-full overflow-hidden relative">
          <div className="absolute inset-y-0 left-0 bg-[#E7E3DE]" style={{ width: `${Math.min(reportRate, 100)}%` }} title={`신고 누계 ${reportRate.toFixed(1)}%`} />
          <div className="absolute inset-y-0 left-0 bg-[#F2B100]" style={{ width: `${Math.min(rate, 100)}%` }} />
        </div>
        <div className="flex gap-4 text-[11px] text-[#8A8580] mt-1.5">
          <span className="inline-flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm bg-[#F2B100] inline-block" /> 차단 완료</span>
          <span className="inline-flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm bg-[#E7E3DE] inline-block" /> 신고 진행</span>
        </div>
      </div>

      <div className="grid lg:grid-cols-5 gap-5">
        {/* 월별 실적 */}
        <section className="lg:col-span-3 bg-white border border-[#E7E3DE] rounded-xl overflow-hidden">
          <header className="px-4 py-2.5 border-b border-[#E7E3DE] flex items-center justify-between">
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2"><Calendar size={14} /> 월별 신고 · 차단 (K = KOIPA 소관 / M = Myriad 소관)</h3>
            {monthlyIdx && <button onClick={() => goTab(monthlyIdx)} className="text-xs text-[#B98A00] font-semibold hover:underline inline-flex items-center">실적 입력 <ChevronRight size={12} /></button>}
          </header>
          {agg.byMonth.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-400">아직 실적이 입력되지 않았습니다. 월별 실적 탭에서 입력하세요.</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-[#3A3737] text-white">
                <tr>
                  <th rowSpan={2} className="px-3 py-1.5 text-left border-r border-white/10">월</th>
                  <th colSpan={3} className="px-2 py-1 text-center border-r border-white/10">신고</th>
                  <th colSpan={3} className="px-2 py-1 text-center border-r border-white/10">차단 완료</th>
                  <th rowSpan={2} className="px-3 py-1.5 text-right">누적 달성률</th>
                </tr>
                <tr className="text-white/80">
                  <th className="px-2 py-1 text-right font-normal">K</th><th className="px-2 py-1 text-right font-normal">M</th><th className="px-2 py-1 text-right font-semibold border-r border-white/10">소계</th>
                  <th className="px-2 py-1 text-right font-normal">K</th><th className="px-2 py-1 text-right font-normal">M</th><th className="px-2 py-1 text-right font-semibold border-r border-white/10">소계</th>
                </tr>
              </thead>
              <tbody>
                {agg.byMonth.map((m, i) => {
                  const cum = agg.byMonth.slice(0, i + 1).reduce((s, x) => s + x.blocked_k + x.blocked_m, 0)
                  return (
                    <tr key={m.month} className="border-b border-[#E7E3DE] hover:bg-[#FAF8F4] cursor-pointer" onClick={() => monthlyIdx && goTab(monthlyIdx, { m: m.month })}>
                      <td className="px-3 py-1.5 font-semibold text-[#2B2928] border-r border-[#E7E3DE]">{monthLabel(m.month)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{num(m.reported_k)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{num(m.reported_m)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-semibold border-r border-[#E7E3DE]">{num(m.reported_k + m.reported_m)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{num(m.blocked_k)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{num(m.blocked_m)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-[#B98A00] border-r border-[#E7E3DE]">{num(m.blocked_k + m.blocked_m)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-bold text-[#2B2928]">{goal ? ((cum / goal) * 100).toFixed(2) : '-'}%</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </section>

        <div className="lg:col-span-2 space-y-4">
          {/* 저작권 */}
          {copyright.goal > 0 && (
            <section className="bg-white border border-[#E7E3DE] rounded-xl p-4">
              <header className="flex items-center justify-between mb-2">
                <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2"><Copyright size={14} /> 저작권 모니터링</h3>
                {copyKey && <button onClick={() => goTab(copyKey)} className="text-xs text-[#B98A00] font-semibold hover:underline inline-flex items-center">상세 <ChevronRight size={12} /></button>}
              </header>
              <div className="flex items-end gap-2 mb-1.5">
                <span className="text-2xl font-bold text-[#2B2928]">{num(copyright.baseline + copyright.done)}</span>
                <span className="text-xs text-[#8A8580] pb-1">/ {num(copyright.goal)}건 차단 · 송부 {num(copyright.sent)}건</span>
              </div>
              <div className="h-2.5 bg-[#FAF8F4] border border-[#E7E3DE] rounded-full overflow-hidden relative">
                <div className="absolute inset-y-0 left-0 bg-[#E7E3DE]" style={{ width: `${Math.min(((copyright.baseline + copyright.sent) / copyright.goal) * 100, 100)}%` }} />
                <div className="absolute inset-y-0 left-0 bg-[#B98A00]" style={{ width: `${Math.min(((copyright.baseline + copyright.done) / copyright.goal) * 100, 100)}%` }} />
              </div>
              <div className="text-[11px] text-[#8A8580] mt-1.5">사업 전 완료 {copyright.baseline}건 포함 · 잔여 {num(Math.max(copyright.goal - copyright.baseline - copyright.done, 0))}건 · 알리·테무 제외</div>
            </section>
          )}

          {/* 브랜드 */}
          <section className="bg-white border border-[#E7E3DE] rounded-xl p-4">
            <header className="flex items-center justify-between mb-2">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2"><Building2 size={14} /> 참여 브랜드사</h3>
              {brandsKey && <button onClick={() => goTab(brandsKey)} className="text-xs text-[#B98A00] font-semibold hover:underline inline-flex items-center">서류 현황 <ChevronRight size={12} /></button>}
            </header>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Mini label="브랜드사" value={brandStats.total} />
              <Mini label="위임장 확보" value={`${brandStats.poa}/${brandStats.total}`} warn={brandStats.poa < brandStats.total} />
              <Mini label="M 소관" value={brandStats.m} gold />
            </div>
          </section>

          {/* 마감 임박 */}
          <section className="bg-white border border-[#E7E3DE] rounded-xl p-4">
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2 mb-2"><AlertTriangle size={14} /> 마감 임박</h3>
            {deadlines.length === 0 ? <div className="text-xs text-slate-400">기한이 잡힌 열린 항목이 없습니다.</div> : (
              <ul className="space-y-1">
                {deadlines.map((d, i) => {
                  const dl = daysUntil(d.due_on)
                  const overdue = dl < 0
                  return (
                    <li key={i}>
                      <button
                        onClick={() => d.kind === 'issue' ? issuesKey && goTab(issuesKey, { post: d.id }) : goTab(d.ckind === 'adhoc' ? adhocKey : campaignKey, { c: d.id })}
                        className="w-full text-left flex items-center gap-2 text-xs hover:bg-[#FAF8F4] rounded px-1 py-1">
                        <span className={`shrink-0 font-bold px-1.5 py-0.5 rounded tabular-nums ${overdue ? 'bg-rose-100 text-rose-700' : dl <= 3 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>
                          {overdue ? `+${-dl}일` : dl === 0 ? '오늘' : `D-${dl}`}
                        </span>
                        <span className="truncate text-slate-800">{d.label}</span>
                        <span className="ml-auto shrink-0 text-slate-400">{fmtDate(d.due_on)}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>
      </div>

      {/* 기획 / 비정기 타임라인 */}
      {campaigns.length > 0 && (
        <section>
          <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2 mb-2"><Target size={14} /> 기획 · 비정기 모니터링 일정</h3>
          <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">
            {campaigns.map((c) => {
              const st = CAMPAIGN_STATUS[c.status] || CAMPAIGN_STATUS.planned
              const doneN = (c.deliverables || []).filter((d) => d.done).length
              const totN = (c.deliverables || []).length
              return (
                <button key={c.id} onClick={() => goTab(c.kind === 'adhoc' ? adhocKey : campaignKey, { c: c.id })}
                  className={`text-left bg-white border rounded-xl p-3 hover:shadow-sm transition ${c.status === 'active' ? 'border-[#F2B100]' : 'border-[#E7E3DE]'}`}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="font-semibold text-slate-900 text-sm truncate">{c.title}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${st.cls}`}>{st.label}</span>
                  </div>
                  <div className="text-xs text-slate-600">
                    {c.starts_on ? fmtDate(c.starts_on) : '?'} ~ {c.ends_on ? fmtDate(c.ends_on) : <span className="text-amber-700 font-semibold">미정</span>}
                  </div>
                  {c.theme && <div className="text-[11px] text-slate-500 mt-1 line-clamp-2">{c.theme}</div>}
                  {c.brands?.length > 0 && <div className="text-[11px] text-[#B98A00] mt-1 truncate">{c.brands.join(' · ')}</div>}
                  {totN > 0 && <div className="text-[11px] text-slate-500 mt-1">제출물 {doneN}/{totN}</div>}
                </button>
              )
            })}
          </div>
        </section>
      )}

      {/* 누적 플랫폼 표 */}
      {cumulativeRows.length > 0 && (
        <section className="bg-white border border-[#E7E3DE] rounded-xl overflow-hidden">
          <header className="px-4 py-2.5 border-b border-[#E7E3DE]">
            <h3 className="font-bold text-slate-900 text-sm">플랫폼별 누적 (KOIPA 실적표 양식)</h3>
            <p className="text-[11px] text-[#8A8580]">{agg.byMonth.map((m) => shortMonthLabel(m.month)).join(' + ')} 합산</p>
          </header>
          <MetricsTable project={project} rows={cumulativeRows} editable={false} />
        </section>
      )}
    </div>
  )
}

function Kpi({ icon: Icon, label, value, sub, gold, warn, muted, onClick }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag onClick={onClick} className={`text-left bg-white border border-[#E7E3DE] rounded-xl p-3.5 ${onClick ? 'hover:border-[#F2B100] transition' : ''}`}>
      <div className="flex items-center gap-1.5 text-[11px] text-[#8A8580] mb-1"><Icon size={12} /> {label}</div>
      <div className={`text-2xl font-bold tabular-nums leading-tight ${gold ? 'text-[#B98A00]' : warn ? 'text-rose-600' : muted ? 'text-slate-400' : 'text-[#2B2928]'}`}>{value}</div>
      {sub && <div className="text-[11px] text-[#8A8580] mt-1 leading-snug">{sub}</div>}
    </Tag>
  )
}
function Mini({ label, value, gold, warn }) {
  return (
    <div className="bg-[#FAF8F4] rounded-lg py-2">
      <div className={`text-lg font-bold ${gold ? 'text-[#B98A00]' : warn ? 'text-rose-600' : 'text-[#2B2928]'}`}>{value}</div>
      <div className="text-[10px] text-[#8A8580]">{label}</div>
    </div>
  )
}
