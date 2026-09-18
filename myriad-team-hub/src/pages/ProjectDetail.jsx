/**
 * ProjectDetail — /projects/:slug
 * 프로젝트 헤더 + 섹션(탭) 바 + kind 별 렌더링.
 *   URL 상태: ?tab=<section.key> &m=<YYYY-MM-01> &c=<campaignId> &post=<postId>
 */
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  FolderKanban, Megaphone, Gauge, CalendarRange, Target, Crosshair, Copyright, Building2, ListTodo, Library,
  Loader2, ChevronLeft, CheckSquare, Square, Info, Check
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import {
  getProjectBySlug, listSections, listCampaigns, listMonthSummary, upsertMonthSummary, listMonthChecks, setMonthCheck,
  monthRange, monthKey, monthLabel, shortMonthLabel
} from '../lib/projects'
import ProjectBoard from '../components/projects/ProjectBoard'
import ProjectDashboard from '../components/projects/ProjectDashboard'
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
          {section.description && (
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
    case 'library': return (
      <div className="space-y-6">
        <div>
          <h3 className="font-bold text-slate-900 text-sm mb-2">실무 가이드 · 노하우</h3>
          <ProjectBoard project={project} section={section} emptyHint="가이드가 없습니다. 플랫폼별 신고 절차, 캡처 요령, 자주 하는 실수를 남겨두세요." />
        </div>
        <ProjectLibrary project={project} />
      </div>
    )
    case 'notice': return <ProjectBoard project={project} section={section} emptyHint="공지가 없습니다. 고정해야 할 규칙부터 등록해 보세요." />
    case 'issues': return <ProjectBoard project={project} section={section} emptyHint="열린 할 일이 없습니다." />
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

/** 숫자 1개 인라인 입력 — blur 시 저장 */
function NumField({ label, value, onCommit, hint }) {
  const [v, setV] = useState(value ?? 0)
  const [saved, setSaved] = useState(false)
  useEffect(() => { setV(value ?? 0) }, [value])
  async function commit() {
    if (String(v) === String(value ?? 0)) return
    await onCommit(v)
    setSaved(true); setTimeout(() => setSaved(false), 1200)
  }
  return (
    <label className="block">
      <span className="text-[11px] text-[#8A8580]">{label}</span>
      <div className="relative">
        <input type="text" inputMode="numeric" value={v === 0 ? '' : v} placeholder="0"
          onChange={(e) => setV(e.target.value.replace(/[^\d]/g, ''))}
          onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
          className="w-full text-xl font-bold text-[#2B2928] tabular-nums px-2 py-1 border border-[#E7E3DE] rounded-lg focus:outline-none focus:border-myriad-primary bg-white" />
        {saved && <Check size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-emerald-500" />}
      </div>
      {hint && <span className="text-[10px] text-[#8A8580]">{hint}</span>}
    </label>
  )
}

// ─────────────────────────────────────────────────────
// 월별 운영: 체크리스트 + KOIPA 확정 건수 + 게시판
// ─────────────────────────────────────────────────────
function MonthlySection({ project, section, params, setParams }) {
  const { user } = useAuth()
  const { months, month, setMonth } = useMonthTabs(project, params, setParams)
  const [checks, setChecks] = useState({})
  const [summary, setSummary] = useState([])
  const cycle = project.config?.report_cycle || []
  const goal = project.config?.goal_count || 0

  useEffect(() => { listMonthChecks(project.id, month).then(setChecks) }, [project.id, month])
  useEffect(() => { listMonthSummary(project.id).then(setSummary) }, [project.id])
  const row = summary.find((r) => r.month === month)
  const cumulative = summary.filter((r) => r.month <= month).reduce((s, r) => s + (r.confirmed_blocked || 0), 0)

  async function toggle(key) {
    const next = !checks[key]?.done
    setChecks((c) => ({ ...c, [key]: { ...(c[key] || {}), done: next } }))
    try { await setMonthCheck(project.id, month, key, next, user.id) } catch { listMonthChecks(project.id, month).then(setChecks) }
  }
  async function save(patch) {
    await upsertMonthSummary(project.id, month, patch, user.id)
    setSummary(await listMonthSummary(project.id))
  }
  const doneN = cycle.filter((c) => checks[c.key]?.done).length

  return (
    <div>
      <MonthTabs months={months} month={month} setMonth={setMonth} />

      <div className="grid lg:grid-cols-5 gap-4 mb-4">
        {cycle.length > 0 && (
          <section className="lg:col-span-3 bg-white border border-[#E7E3DE] rounded-xl p-4">
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

        <section className={`bg-white border border-[#E7E3DE] rounded-xl p-4 ${cycle.length ? 'lg:col-span-2' : 'lg:col-span-5'}`}>
          <h3 className="font-bold text-slate-900 text-sm mb-2">{shortMonthLabel(month)} KOIPA 확정 인정 건수</h3>
          <div className="grid grid-cols-2 gap-3">
            <NumField label="확정 차단(인정)" value={row?.confirmed_blocked} onCommit={(v) => save({ confirmed_blocked: v })} hint="KOIPA 마감 회신 기준 → 달성률" />
            <NumField label="당사 보고 신고" value={row?.reported} onCommit={(v) => save({ reported: v })} hint="1차·2차 보고 합계 (참고)" />
          </div>
          <div className="mt-3 text-[11px] text-[#8A8580]">
            {month} 까지 누계 <b className="text-[#2B2928]">{cumulative.toLocaleString()}</b> / {goal.toLocaleString()} = <b className="text-[#B98A00]">{goal ? ((cumulative / goal) * 100).toFixed(2) : '-'}%</b>
          </div>
          <textarea
            defaultValue={row?.note || ''} key={`${month}-${row?.updated_at || ''}`}
            onBlur={(e) => { if ((e.target.value || '') !== (row?.note || '')) save({ note: e.target.value }) }}
            rows={2} placeholder="메모 (예: 9/7 마감 확정, 4개 플랫폼만 인정)"
            className="mt-2 w-full text-xs px-2 py-1.5 border border-[#E7E3DE] rounded-lg focus:outline-none focus:border-myriad-primary" />
          <p className="text-[10px] text-[#8A8580] mt-1">플랫폼별 K/M 세부 표·제출 이력은 M-Bridge 실적 제출에서 확인.</p>
        </section>
      </div>

      <h3 className="font-bold text-slate-900 text-sm mb-2">{monthLabel(month)} 내부 기록 · 유선 협의 · 검수 메모</h3>
      <ProjectBoard project={project} section={section} periodMonth={month} months={months}
        emptyHint={`${monthLabel(month)} 기록이 없습니다. 유선 협의 내용, 내부 검수 결과, 제출 전 확인 사항을 남겨두세요.`} />
    </div>
  )
}

// ─────────────────────────────────────────────────────
// 저작권 트랙: 월별 송부·차단 입력 + 게이지 + 게시판
// ─────────────────────────────────────────────────────
function CopyrightSection({ project, section, params, setParams }) {
  const { user } = useAuth()
  const { months, month, setMonth } = useMonthTabs(project, params, setParams)
  const [summary, setSummary] = useState([])
  useEffect(() => { listMonthSummary(project.id).then(setSummary) }, [project.id])
  const cfg = project.config || {}
  const goal = cfg.copyright_goal || 0
  const base = cfg.copyright_baseline || 0
  const sent = summary.reduce((s, r) => s + (r.copyright_sent || 0), 0)
  const done = summary.reduce((s, r) => s + (r.copyright_blocked || 0), 0)
  const row = summary.find((r) => r.month === month)

  async function save(patch) {
    await upsertMonthSummary(project.id, month, patch, user.id)
    setSummary(await listMonthSummary(project.id))
  }

  return (
    <div>
      <MonthTabs months={months} month={month} setMonth={setMonth} />
      <section className="bg-white border border-[#E7E3DE] rounded-xl p-4 mb-4">
        <div className="grid md:grid-cols-4 gap-4 items-end">
          <NumField label={`${shortMonthLabel(month)} 송부 (권리자 확인 요청)`} value={row?.copyright_sent} onCommit={(v) => save({ copyright_sent: v })} />
          <NumField label={`${shortMonthLabel(month)} 차단 확정`} value={row?.copyright_blocked} onCommit={(v) => save({ copyright_blocked: v })} />
          {goal > 0 && (
            <div className="md:col-span-2">
              <div className="flex items-end gap-4 mb-1.5">
                <div><div className="text-[11px] text-[#8A8580]">누계 차단 / 목표</div><div className="text-xl font-bold text-[#2B2928]">{base + done} <span className="text-sm text-[#8A8580] font-normal">/ {goal}</span></div></div>
                <div><div className="text-[11px] text-[#8A8580]">송부 누계</div><div className="text-xl font-bold text-[#B98A00]">{sent}</div></div>
                <div><div className="text-[11px] text-[#8A8580]">잔여</div><div className="text-xl font-bold text-[#2B2928]">{Math.max(goal - base - done, 0)}</div></div>
              </div>
              <div className="h-2.5 bg-[#FAF8F4] border border-[#E7E3DE] rounded-full overflow-hidden relative">
                <div className="absolute inset-y-0 left-0 bg-[#E7E3DE]" style={{ width: `${Math.min(((base + sent) / goal) * 100, 100)}%` }} />
                <div className="absolute inset-y-0 left-0 bg-[#B98A00]" style={{ width: `${Math.min(((base + done) / goal) * 100, 100)}%` }} />
              </div>
              <div className="text-[11px] text-[#8A8580] mt-1">사업 전 완료 {base}건 포함 · 월 30~50건 · 당월 1~2주차 송부 · 알리·테무 제외</div>
            </div>
          )}
        </div>
      </section>
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
