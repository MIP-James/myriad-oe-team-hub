/**
 * ProjectDetail — /projects/:slug
 * 프로젝트 헤더 + 섹션(탭) 바 + kind 별 렌더링.
 *   URL 상태: ?tab=<section.key> &m=<YYYY-MM-01> &c=<campaignId> &post=<postId>
 */
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  FolderKanban, Megaphone, Gauge, CalendarRange, Target, Crosshair, Copyright, Building2, ListTodo, Library,
  Loader2, ChevronLeft, CheckSquare, Square, ChevronDown, ChevronUp, Table2, Info
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import {
  getProjectBySlug, listSections, listCampaigns, listMetrics, listMonthChecks, setMonthCheck,
  monthRange, monthKey, monthLabel, shortMonthLabel
} from '../lib/projects'
import ProjectBoard from '../components/projects/ProjectBoard'
import ProjectDashboard from '../components/projects/ProjectDashboard'
import MetricsTable from '../components/projects/MetricsTable'
import CampaignPanel from '../components/projects/CampaignPanel'
import ProjectBrands from '../components/projects/ProjectBrands'
import ProjectLibrary from '../components/projects/ProjectLibrary'

const ICONS = { Megaphone, Gauge, CalendarRange, Target, Crosshair, Copyright, Building2, ListTodo, Library, FolderKanban }

export default function ProjectDetail() {
  const { slug } = useParams()
  const [params, setParams] = useSearchParams()
  const [project, setProject] = useState(null)
  const [sections, setSections] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    getProjectBySlug(slug)
      .then(async (p) => {
        if (!alive) return
        if (!p) { setError('프로젝트를 찾을 수 없습니다.'); return }
        setProject(p)
        setSections(await listSections(p.id))
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [slug])

  const tabKey = params.get('tab')
  const section = sections.find((s) => s.key === tabKey) || sections.find((s) => s.kind === 'dashboard') || sections[0]

  function goTab(key, extra = {}) {
    const next = new URLSearchParams()
    next.set('tab', key)
    for (const [k, v] of Object.entries(extra)) if (v) next.set(k, v)
    setParams(next)
  }

  if (loading) return <div className="p-8 text-slate-400 text-sm flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> 불러오는 중...</div>
  if (error || !project) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <Link to="/projects" className="text-sm text-slate-500 hover:text-slate-800 inline-flex items-center gap-1 mb-4"><ChevronLeft size={14} /> 팀 프로젝트</Link>
        <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-4 text-sm">{error || '프로젝트가 없습니다.'}</div>
        <p className="text-xs text-slate-400 mt-3">"Could not find the table" 류 오류면 Supabase 에서 마이그레이션 037 을 먼저 실행해 주세요.</p>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <Link to="/projects" className="text-xs text-slate-500 hover:text-slate-800 inline-flex items-center gap-1 mb-2"><ChevronLeft size={12} /> 팀 프로젝트</Link>
      <header className="mb-5 flex items-start gap-3">
        <div className="w-11 h-11 rounded-xl bg-[#3A3737] text-[#F2B100] flex items-center justify-center shrink-0"><FolderKanban size={22} /></div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-900 leading-tight">{project.name}</h1>
          <div className="text-sm text-slate-500 mt-0.5">
            {project.client}
            {project.starts_on && <span className="ml-2 text-slate-400">· {project.starts_on} ~ {project.ends_on || '진행 중'}</span>}
          </div>
        </div>
      </header>

      {/* 탭 바 */}
      <div className="flex gap-1 border-b border-slate-200 mb-5 overflow-x-auto">
        {sections.map((s) => {
          const Icon = ICONS[s.icon] || FolderKanban
          const active = section?.id === s.id
          return (
            <button key={s.id} onClick={() => goTab(s.key)}
              className={`flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold border-b-2 -mb-px whitespace-nowrap transition ${active ? 'text-myriad-ink border-myriad-primary' : 'text-slate-500 border-transparent hover:text-slate-800'}`}>
              <Icon size={14} /> {s.label}
            </button>
          )
        })}
      </div>

      {section && (
        <>
          {section.description && section.kind !== 'dashboard' && (
            <p className="text-xs text-slate-500 mb-3 flex items-start gap-1.5"><Info size={12} className="mt-0.5 shrink-0 text-slate-400" /> {section.description}</p>
          )}
          <SectionRenderer key={section.id} project={project} section={section} sections={sections} goTab={goTab} params={params} setParams={setParams} />
        </>
      )}
    </div>
  )
}

function SectionRenderer({ project, section, sections, goTab, params, setParams }) {
  switch (section.kind) {
    case 'dashboard': return <ProjectDashboard project={project} sections={sections} goTab={goTab} />
    case 'monthly': return <MonthlySection project={project} section={section} params={params} setParams={setParams} />
    case 'copyright': return <CopyrightSection project={project} section={section} params={params} setParams={setParams} />
    case 'campaign': return <CampaignSection project={project} section={section} kind="planned" params={params} setParams={setParams} />
    case 'adhoc': return <CampaignSection project={project} section={section} kind="adhoc" params={params} setParams={setParams} />
    case 'brands': return <ProjectBrands project={project} />
    case 'library': return <ProjectLibrary project={project} />
    case 'notice': return <ProjectBoard project={project} section={section} emptyHint="공지가 없습니다. 고정해야 할 규칙부터 등록해 보세요." />
    case 'issues': return <ProjectBoard project={project} section={section} emptyHint="열린 이슈가 없습니다." />
    default: return <ProjectBoard project={project} section={section} />
  }
}

// ─────────────────────────────────────────────────────
// 월 서브탭 공통
// ─────────────────────────────────────────────────────
function useMonthTabs(project, params, setParams) {
  const months = useMemo(() => {
    const r = monthRange(project.starts_on, project.ends_on)
    const cur = monthKey()
    if (!r.includes(cur) && (!project.ends_on || cur <= monthKey(new Date(project.ends_on)))) r.push(cur)
    return r
  }, [project.starts_on, project.ends_on])
  const cur = monthKey()
  const fallback = months.includes(cur) ? cur : months[months.length - 1]
  const month = months.includes(params.get('m')) ? params.get('m') : fallback
  function setMonth(m) {
    const next = new URLSearchParams(params)
    next.set('m', m); next.delete('post')
    setParams(next, { replace: true })
  }
  return { months, month, setMonth }
}

function MonthTabs({ months, month, setMonth }) {
  const cur = monthKey()
  return (
    <div className="flex flex-wrap gap-1.5 mb-3">
      {months.map((m) => (
        <button key={m} onClick={() => setMonth(m)}
          className={`px-3 py-1.5 rounded-lg text-sm border ${month === m ? 'bg-white border-myriad-primary shadow-sm font-semibold text-slate-900' : 'border-slate-200 text-slate-600 hover:bg-white'} ${m > cur ? 'opacity-60' : ''}`}>
          {monthLabel(m)}{m === cur && <span className="ml-1 text-[10px] text-[#B98A00] font-bold">이번 달</span>}
        </button>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────
// 월별 실적: 체크리스트 + 실적표 + 게시판
// ─────────────────────────────────────────────────────
function MonthlySection({ project, section, params, setParams }) {
  const { user } = useAuth()
  const { months, month, setMonth } = useMonthTabs(project, params, setParams)
  const [checks, setChecks] = useState({})
  const [metrics, setMetrics] = useState([])
  const [showTable, setShowTable] = useState(true)
  const cycle = project.config?.report_cycle || []

  useEffect(() => {
    listMonthChecks(project.id, month).then(setChecks)
    listMetrics(project.id, month).then(setMetrics)
  }, [project.id, month])

  async function toggle(key) {
    const next = !checks[key]?.done
    setChecks((c) => ({ ...c, [key]: { ...(c[key] || {}), done: next } }))
    try { await setMonthCheck(project.id, month, key, next, user.id) } catch { listMonthChecks(project.id, month).then(setChecks) }
  }
  const doneN = cycle.filter((c) => checks[c.key]?.done).length

  return (
    <div>
      <MonthTabs months={months} month={month} setMonth={setMonth} />

      <div className="grid lg:grid-cols-3 gap-4 mb-4">
        {/* 체크리스트 */}
        {cycle.length > 0 && (
          <section className="bg-white border border-[#E7E3DE] rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-bold text-slate-900 text-sm">{shortMonthLabel(month)} 마감 체크리스트</h3>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${doneN === cycle.length ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{doneN}/{cycle.length}</span>
            </div>
            <ul className="space-y-1">
              {cycle.map((c) => {
                const done = !!checks[c.key]?.done
                return (
                  <li key={c.key}>
                    <button onClick={() => toggle(c.key)} className="w-full text-left flex items-start gap-2 text-sm hover:bg-[#FAF8F4] rounded px-1 py-1">
                      {done ? <CheckSquare size={15} className="text-emerald-600 shrink-0 mt-0.5" /> : <Square size={15} className="text-slate-400 shrink-0 mt-0.5" />}
                      <span className={`flex-1 leading-snug ${done ? 'line-through text-slate-400' : 'text-slate-800'}`}>{c.label}</span>
                      {c.day_hint && <span className="text-[10px] text-[#8A8580] shrink-0 mt-0.5">{c.day_hint}</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        {/* 실적표 */}
        <section className={`bg-white border border-[#E7E3DE] rounded-xl overflow-hidden ${cycle.length ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
          <button onClick={() => setShowTable((v) => !v)} className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-[#FAF8F4]">
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2"><Table2 size={14} /> {monthLabel(month)} 실적표 (KOIPA 양식 · 셀 클릭 후 입력, 포커스 벗어나면 저장)</h3>
            {showTable ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
          </button>
          {showTable && (
            <div className="border-t border-[#E7E3DE]">
              <MetricsTable project={project} month={month} rows={metrics} editable onSaved={() => listMetrics(project.id, month).then(setMetrics)} />
              <p className="text-[11px] text-[#8A8580] px-4 py-2">K = KOIPA 소관 · M = Myriad 소관. "수집" 열은 침해 게시물 수집 건수(선택). 저작권보호원 행은 저작권 트랙 송부(신고)·차단 건수로 집계됩니다.</p>
            </div>
          )}
        </section>
      </div>

      <h3 className="font-bold text-slate-900 text-sm mb-2">{monthLabel(month)} 정보 공유 · 히스토리</h3>
      <ProjectBoard project={project} section={section} periodMonth={month} months={months}
        emptyHint={`${monthLabel(month)} 게시글이 없습니다. 실적 파일, 보완 요청 회신, 유선 협의 내용을 남겨두세요.`} />
    </div>
  )
}

// ─────────────────────────────────────────────────────
// 저작권 트랙: 게이지 + 월 서브탭 + 게시판
// ─────────────────────────────────────────────────────
function CopyrightSection({ project, section, params, setParams }) {
  const { months, month, setMonth } = useMonthTabs(project, params, setParams)
  const [metrics, setMetrics] = useState([])
  useEffect(() => { listMetrics(project.id).then((m) => setMetrics(m.filter((r) => r.category === '저작권'))) }, [project.id])
  const cfg = project.config || {}
  const goal = cfg.copyright_goal || 0
  const base = cfg.copyright_baseline || 0
  const sent = metrics.reduce((s, r) => s + r.reported_k + r.reported_m, 0)
  const done = metrics.reduce((s, r) => s + r.blocked_k + r.blocked_m, 0)
  const thisMonth = metrics.find((r) => r.month === month)

  return (
    <div>
      {goal > 0 && (
        <section className="bg-white border border-[#E7E3DE] rounded-xl p-4 mb-4">
          <div className="flex flex-wrap items-end gap-6">
            <div>
              <div className="text-[11px] text-[#8A8580]">목표 대비 차단</div>
              <div className="text-2xl font-bold text-[#2B2928]">{base + done} <span className="text-sm text-[#8A8580] font-normal">/ {goal}건</span></div>
            </div>
            <div>
              <div className="text-[11px] text-[#8A8580]">송부 누계 (권리자 확인 요청)</div>
              <div className="text-2xl font-bold text-[#B98A00]">{sent}<span className="text-sm text-[#8A8580] font-normal">건</span></div>
            </div>
            <div>
              <div className="text-[11px] text-[#8A8580]">잔여</div>
              <div className="text-2xl font-bold text-[#2B2928]">{Math.max(goal - base - done, 0)}<span className="text-sm text-[#8A8580] font-normal">건</span></div>
            </div>
            <div className="flex-1 min-w-[200px]">
              <div className="h-2.5 bg-[#FAF8F4] border border-[#E7E3DE] rounded-full overflow-hidden relative">
                <div className="absolute inset-y-0 left-0 bg-[#E7E3DE]" style={{ width: `${Math.min(((base + sent) / goal) * 100, 100)}%` }} />
                <div className="absolute inset-y-0 left-0 bg-[#B98A00]" style={{ width: `${Math.min(((base + done) / goal) * 100, 100)}%` }} />
              </div>
              <div className="text-[11px] text-[#8A8580] mt-1">사업 전 완료 {base}건 포함 · 월 30~50건 · 당월 1~2주차 송부 · {monthLabel(month)} 송부 {thisMonth ? thisMonth.reported_k + thisMonth.reported_m : 0}건 (월별 실적표 "저작권보호원" 행)</div>
            </div>
          </div>
        </section>
      )}
      <MonthTabs months={months} month={month} setMonth={setMonth} />
      <ProjectBoard project={project} section={section} periodMonth={month} months={months}
        emptyHint={`${monthLabel(month)} 저작권 기록이 없습니다. 송부 리스트, KOIPA 검토 의견, 관리번호 부여 내역을 남겨두세요.`} />
    </div>
  )
}

// ─────────────────────────────────────────────────────
// 기획 / 비정기: 라운드 패널 + 게시판
// ─────────────────────────────────────────────────────
function CampaignSection({ project, section, kind, params, setParams }) {
  const [campaigns, setCampaigns] = useState([])
  const [loaded, setLoaded] = useState(false)
  useEffect(() => { load() }, [project.id, kind])
  async function load() { setCampaigns(await listCampaigns(project.id, kind)); setLoaded(true) }

  const cParam = params.get('c')
  const selectedId = campaigns.some((c) => c.id === cParam) ? cParam
    : (campaigns.find((c) => c.status === 'active') || campaigns[0])?.id || null
  function select(id) {
    const next = new URLSearchParams(params)
    next.set('c', id); next.delete('post')
    setParams(next, { replace: true })
  }

  if (!loaded) return <div className="py-10 text-center text-sm text-slate-400 flex items-center justify-center gap-2"><Loader2 size={14} className="animate-spin" /> 불러오는 중...</div>

  return (
    <div>
      <CampaignPanel project={project} kind={kind} campaigns={campaigns} selectedId={selectedId} onSelect={select} onChanged={load} />
      <h3 className="font-bold text-slate-900 text-sm mb-2">{campaigns.find((c) => c.id === selectedId)?.title || '라운드'} 진행 기록</h3>
      <ProjectBoard project={project} section={section} campaignId={selectedId} campaigns={campaigns}
        emptyHint="아직 기록이 없습니다. 착수·모니터링 결과·KOIPA 회신·제출물 파일을 남겨두세요." />
    </div>
  )
}
