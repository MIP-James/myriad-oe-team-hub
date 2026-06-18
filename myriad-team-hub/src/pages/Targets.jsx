import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Crosshair, RefreshCw, Loader2, Search, ArrowUpRight, ArrowDownRight,
  Link2, ShieldAlert, X, ExternalLink, TrendingUp, TrendingDown, Minus, Activity
} from 'lucide-react'
import {
  loadTargets, updateTargetStatus, runSync, applyScopeGrades,
  GRADE_META, TREND_META, STATUS_META
} from '../lib/targets'

const GRADE_ORDER = ['A', 'B', 'C', 'D', 'X']

export default function Targets() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState(null)
  const [info, setInfo] = useState(null)
  const [selected, setSelected] = useState(null)

  // 필터
  const [brand, setBrand] = useState('all')
  const [grade, setGrade] = useState('all')
  const [crossOnly, setCrossOnly] = useState(false)
  const [trend, setTrend] = useState('all')
  const [q, setQ] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setError(null)
    try { setRows(await loadTargets()) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  async function onSync() {
    setSyncing(true); setError(null); setInfo(null)
    try {
      const r = await runSync()
      setInfo(`갱신 완료 — ${r.stats.records}건 → ${r.stats.clusters}명 운영자 (${r.source === 'mock' ? '샘플 데이터' : 'BPM'})`)
      await load()
    } catch (e) { setError(e.message) }
    finally { setSyncing(false) }
  }

  // 고객사(브랜드) 목록 — 운영자들의 brands 합집합
  const brandOptions = useMemo(() => {
    const set = new Set()
    for (const r of rows) for (const b of (r.brands || [])) set.add(b)
    return Array.from(set).sort()
  }, [rows])

  // 선택 범위로 좁히고, 그 범위 안에서 등급 재계산 (브랜드별 상대평가)
  const scoped = useMemo(() => {
    const base = brand === 'all' ? rows : rows.filter((r) => (r.brands || []).includes(brand))
    return applyScopeGrades(base)
  }, [rows, brand])

  const counts = useMemo(() => {
    const c = { A: 0, B: 0, C: 0, D: 0, X: 0, cross: 0 }
    for (const r of scoped) { c[r.grade] = (c[r.grade] || 0) + 1; if (r.cross_brand && r.grade !== 'X') c.cross++ }
    return c
  }, [scoped])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return scoped.filter((r) => {
      if (grade !== 'all' && r.grade !== grade) return false
      if (crossOnly && !r.cross_brand) return false
      if (trend !== 'all' && r.trend !== trend) return false
      if (needle) {
        const blob = `${r.rep_store} ${r.rep_company} ${r.rep_president} ${(r.brands || []).join(' ')} ${r.platforms}`.toLowerCase()
        if (!blob.includes(needle)) return false
      }
      return true
    })
  }, [scoped, grade, crossOnly, trend, q])

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <header className="mb-6 flex items-center gap-3">
        <Crosshair className="text-myriad-ink" />
        <h1 className="text-2xl font-bold text-slate-900">재침해자 타겟 보드</h1>
        {rows[0]?.scored_at && (
          <span className="text-xs text-slate-400">
            기준 {new Date(rows[0].scored_at).toLocaleString('ko-KR')}
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={onSync}
          disabled={syncing}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold disabled:opacity-60"
        >
          {syncing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          지금 갱신
        </button>
      </header>

      {error && <Banner tone="error" onClose={() => setError(null)}>{error}</Banner>}
      {info && <Banner tone="info" onClose={() => setInfo(null)}>{info}</Banner>}

      {/* 고객사(브랜드) 선택 — 선택 시 그 브랜드 안에서 등급 재계산 */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-sm font-medium text-slate-600">고객사</span>
        <select value={brand} onChange={(e) => { setBrand(e.target.value); setGrade('all') }}
          className="text-sm border border-slate-300 rounded-lg px-3 py-1.5 bg-white text-slate-800 font-medium">
          <option value="all">전체 ({rows.length}명 · 교차 브랜드 탐지)</option>
          {brandOptions.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        {brand !== 'all' && (
          <span className="text-xs text-rose-600 bg-rose-50 px-2 py-1 rounded">
            {brand} 안에서의 상대 등급 (상위 30% = A/B)
          </span>
        )}
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        {GRADE_ORDER.map((g) => (
          <SummaryCard key={g} grade={g} count={counts[g] || 0}
            active={grade === g} onClick={() => setGrade(grade === g ? 'all' : g)} />
        ))}
        <button
          onClick={() => setCrossOnly((v) => !v)}
          className={`rounded-xl p-3 text-left border transition ${crossOnly ? 'border-rose-400 bg-rose-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
        >
          <div className="text-xs text-slate-500 flex items-center gap-1"><Link2 size={12} /> 교차 브랜드</div>
          <div className="text-2xl font-bold text-rose-700 mt-0.5">{counts.cross}</div>
        </button>
      </div>

      <div className="grid lg:grid-cols-[280px_1fr] gap-5 items-start">
        {/* 2×2 매트릭스 */}
        <Matrix rows={scoped} onPick={setSelected} />

        {/* 리스트 */}
        <div>
          <FilterBar {...{ grade, setGrade, crossOnly, setCrossOnly, trend, setTrend, q, setQ }} count={filtered.length} />
          {loading ? (
            <div className="py-16 text-center text-sm text-slate-400 flex items-center justify-center gap-2">
              <Loader2 size={14} className="animate-spin" /> 불러오는 중...
            </div>
          ) : rows.length === 0 ? (
            <EmptyState onSync={onSync} syncing={syncing} />
          ) : (
            <TargetTable rows={filtered} onPick={setSelected} />
          )}
        </div>
      </div>

      {selected && (
        <DetailDrawer
          row={selected}
          onClose={() => setSelected(null)}
          onChanged={(patch) => { setSelected((s) => ({ ...s, ...patch })); load() }}
        />
      )}
    </div>
  )
}

function Banner({ tone, children, onClose }) {
  const cls = tone === 'error' ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-sky-50 border-sky-200 text-sky-700'
  return (
    <div className={`mb-4 border text-sm rounded-lg p-3 flex items-start gap-2 ${cls}`}>
      <span className="flex-1">{children}</span>
      <button onClick={onClose} className="opacity-60 hover:opacity-100"><X size={14} /></button>
    </div>
  )
}

function SummaryCard({ grade, count, active, onClick }) {
  const m = GRADE_META[grade]
  return (
    <button onClick={onClick}
      className={`rounded-xl p-3 text-left border transition ${active ? 'border-myriad-ink' : 'border-slate-200 hover:bg-slate-50'} ${m.band}`}>
      <div className={`text-xs font-medium ${m.text}`}>{m.label}</div>
      <div className="text-2xl font-bold text-slate-900 mt-0.5">{count}</div>
    </button>
  )
}

// 2×2 매트릭스 (세로=법적가치, 가로=생산성). 등급이 곧 사분면.
function Matrix({ rows, onPick }) {
  const cells = {
    A: rows.filter((r) => r.grade === 'A'),
    B: rows.filter((r) => r.grade === 'B'),
    D: rows.filter((r) => r.grade === 'D'),
    C: rows.filter((r) => r.grade === 'C'),
  }
  const Cell = ({ g }) => {
    const m = GRADE_META[g]
    return (
      <div className={`relative rounded-lg p-2 h-28 overflow-hidden ${m.band}`}>
        <div className={`text-xs font-semibold ${m.text}`}>{m.short}</div>
        <div className="absolute inset-0 pt-6 px-2 pb-2">
          <div className="flex flex-wrap gap-1 content-start h-full">
            {cells[g].slice(0, 28).map((r) => (
              <button key={r.cluster_key} title={r.rep_company || r.rep_store}
                onClick={() => onPick(r)}
                className={`w-2.5 h-2.5 rounded-full ${m.cls} ${r.cross_brand ? 'ring-2 ring-rose-300' : ''} hover:scale-150 transition`} />
            ))}
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4">
      <div className="text-sm font-semibold text-slate-800 mb-3">2×2 매트릭스</div>
      <div className="flex gap-2">
        <div className="flex flex-col justify-between text-[10px] text-slate-400 py-1">
          <span>법적<br />가치↑</span><span>↓</span>
        </div>
        <div className="flex-1 grid grid-cols-2 gap-2">
          <Cell g="A" /><Cell g="B" /><Cell g="D" /><Cell g="C" />
        </div>
      </div>
      <div className="flex justify-between text-[10px] text-slate-400 mt-1 pl-7">
        <span>← 생산성 낮음</span><span>생산성 높음 →</span>
      </div>
      <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
        점 = 운영자 · 빨간 테두리 = 교차 브랜드 · 클릭 시 상세
      </p>
    </div>
  )
}

function FilterBar({ grade, setGrade, trend, setTrend, q, setQ, count }) {
  return (
    <div className="flex flex-wrap items-center gap-2 mb-3">
      <div className="flex gap-1">
        {['all', ...GRADE_ORDER].map((g) => (
          <button key={g} onClick={() => setGrade(g)}
            className={`px-2.5 py-1 rounded-lg text-xs border transition ${grade === g ? 'bg-myriad-ink text-white border-myriad-ink' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
            {g === 'all' ? '전체' : g}
          </button>
        ))}
      </div>
      <select value={trend} onChange={(e) => setTrend(e.target.value)}
        className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-600">
        <option value="all">추세 전체</option>
        <option value="surge">급증</option>
        <option value="steady">유지</option>
        <option value="decline">하락</option>
      </select>
      <div className="relative flex-1 min-w-[160px]">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="상호·대표·브랜드 검색"
          className="w-full text-xs border border-slate-200 rounded-lg pl-8 pr-2 py-1.5" />
      </div>
      <span className="text-xs text-slate-400">{count}건</span>
    </div>
  )
}

function GradeBadge({ g }) {
  const m = GRADE_META[g]
  return <span className={`inline-block text-[11px] font-bold text-white px-2 py-0.5 rounded ${m.cls}`}>{g}</span>
}

function TrendCell({ trend, pct }) {
  const m = TREND_META[trend] || TREND_META.unknown
  const Icon = trend === 'surge' ? TrendingUp : trend === 'decline' ? TrendingDown : Minus
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs ${m.text}`}>
      <Icon size={13} /> {m.label}{pct != null && trend !== 'steady' ? ` ${pct > 0 ? '+' : ''}${pct}%` : ''}
    </span>
  )
}

// 등급 변동 뱃지 (지난 스냅샷 대비)
function GradeMove({ row }) {
  if (!row.prev_grade || row.prev_grade === row.grade) return null
  const up = GRADE_ORDER.indexOf(row.grade) < GRADE_ORDER.indexOf(row.prev_grade)
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded ${up ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>
      {up ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}{row.prev_grade}→{row.grade}
    </span>
  )
}

function TargetTable({ rows, onPick }) {
  if (rows.length === 0) return <div className="py-12 text-center text-sm text-slate-400 bg-white border border-slate-200 rounded-2xl">조건에 맞는 운영자가 없습니다.</div>
  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-500 text-xs">
          <tr>
            <th className="text-left font-medium px-3 py-2 w-10">등급</th>
            <th className="text-left font-medium px-3 py-2">운영자</th>
            <th className="text-center font-medium px-2 py-2 w-14">법적</th>
            <th className="text-center font-medium px-2 py-2 w-14">생산</th>
            <th className="text-center font-medium px-2 py-2 w-20">추세</th>
            <th className="text-center font-medium px-2 py-2 w-16">증거</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.cluster_key} onClick={() => onPick(r)} className="hover:bg-slate-50 cursor-pointer">
              <td className="px-3 py-2.5"><GradeBadge g={r.grade} /></td>
              <td className="px-3 py-2.5">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-medium text-slate-800">{r.rep_company || r.rep_store || '(무명)'}</span>
                  {r.cross_brand && <span className="text-[10px] bg-rose-50 text-rose-700 px-1.5 py-0.5 rounded">교차 {r.brand_count}사</span>}
                  <GradeMove row={r} />
                </div>
                <div className="text-[11px] text-slate-400">{r.platforms} · 계정 {r.account_count} · 누적 {r.cumulative_max}</div>
              </td>
              <td className="px-2 py-2.5 text-center font-semibold text-slate-700">{Math.round(Number(r.enf_score))}</td>
              <td className="px-2 py-2.5 text-center text-slate-500">{Math.round(Number(r.yield_score))}</td>
              <td className="px-2 py-2.5 text-center"><TrendCell trend={r.trend} pct={r.trend_pct} /></td>
              <td className="px-2 py-2.5 text-center text-xs">
                {r.customs + r.raid + r.legal > 0
                  ? <span className="text-sky-700">{[r.customs && '세관', r.raid && '단속', r.legal && '법률'].filter(Boolean).join('·')}</span>
                  : <span className="text-slate-300">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function EmptyState({ onSync, syncing }) {
  return (
    <div className="py-16 text-center bg-white border border-slate-200 rounded-2xl">
      <Crosshair className="mx-auto text-slate-300 mb-3" size={32} />
      <p className="text-sm text-slate-500 mb-1">아직 타겟 데이터가 없습니다.</p>
      <p className="text-xs text-slate-400 mb-4">“지금 갱신”을 누르면 샘플 데이터로 점수를 계산해 채웁니다.<br />(다음 주 BPM DB 연동 후엔 실제 데이터로 자동 갱신됩니다.)</p>
      <button onClick={onSync} disabled={syncing}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold disabled:opacity-60">
        {syncing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
        지금 갱신
      </button>
    </div>
  )
}

// ── 상세 패널 ──────────────────────────────────────────────────────
function DetailDrawer({ row, onClose, onChanged }) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const m = GRADE_META[row.grade]
  const d = row.detail || {}

  async function setStatus(status) {
    setBusy(true)
    try { await updateTargetStatus(row.cluster_key, { status }); onChanged({ status }) }
    finally { setBusy(false) }
  }
  async function toCase() {
    setBusy(true)
    try { await updateTargetStatus(row.cluster_key, { status: 'cased' }); onChanged({ status: 'cased' }) }
    finally { setBusy(false); navigate('/community/cases/new') }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div className="relative w-full max-w-md bg-white h-full overflow-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-slate-200 px-5 py-4 flex items-center gap-2">
          <GradeBadge g={row.grade} />
          <span className="font-bold text-slate-900 truncate">{row.rep_company || row.rep_store || '(무명)'}</span>
          <GradeMove row={row} />
          <div className="flex-1" />
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-5">
          {/* 점수 */}
          <div className="grid grid-cols-2 gap-3">
            <ScoreBox label="법적 타겟 가치" value={Math.round(Number(row.enf_score))} tone="rose" />
            <ScoreBox label="모니터링 생산성" value={Math.round(Number(row.yield_score))} tone="sky" />
          </div>

          <div className={`text-xs ${m.text} ${m.band} rounded-lg p-3`}>
            <div className="font-semibold mb-0.5">{m.label}</div>
            <div className="text-slate-600">{m.def}</div>
            <div className="text-slate-500 mt-1">→ {m.action}</div>
          </div>

          {/* 플래그 */}
          <div className="flex flex-wrap gap-1.5">
            {row.cross_brand && <Flag icon={Link2} tone="rose">교차 브랜드 {row.brand_count}사 — {(row.brands || []).join(', ')}</Flag>}
            {row.is_pipeline && <Flag icon={Activity} tone="sky">모니터링 주력 공급원 (브랜드 수집 {row.brand_share}% · 제거 시 모니터링 차질 → A 제외)</Flag>}
            {!row.identified && <Flag icon={ShieldAlert} tone="slate">신원 불명 — 확인 선행 필요</Flag>}
            {row.has_legal_pipeline && <Flag icon={ShieldAlert} tone="amber">법무 진행중</Flag>}
          </div>

          {/* 추세 + 스파크라인 */}
          <Section title="활동 추세">
            <div className="flex items-center gap-3">
              <TrendCell trend={row.trend} pct={row.trend_pct} />
              <Sparkline series={d.series || []} />
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              최초 {row.first_date || '—'} · 최종 {row.last_date || '—'} · 최근 {row.recency_months != null ? row.recency_months + '개월 전' : '—'}
            </div>
          </Section>

          {/* 계정 */}
          <Section title={`연결 계정 ${(d.accounts || []).length}개`}>
            <ul className="space-y-1.5">
              {(d.accounts || []).map((a, i) => (
                <li key={i} className="text-xs text-slate-600 flex items-center gap-2">
                  <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">{a.platform}</span>
                  <span className="truncate">{a.store || a.vendor_id}</span>
                  {a.biz && <span className="text-slate-400">· {a.biz}</span>}
                </li>
              ))}
            </ul>
          </Section>

          {/* 증거 */}
          {(d.evidence && (d.evidence.customs?.length || d.evidence.enforce?.length || d.evidence.legal?.length)) ? (
            <Section title="오프라인 증거">
              <div className="space-y-1 text-xs">
                {(d.evidence.customs || []).map((c, i) => <EvidenceRow key={'c' + i} label="세관" id={c.id} sub={c.ymd} />)}
                {(d.evidence.enforce || []).map((c, i) => <EvidenceRow key={'e' + i} label="단속" id={c.id} sub={c.ymd} />)}
                {(d.evidence.legal || []).map((c, i) => <EvidenceRow key={'l' + i} label="법률" id={c.id} sub={c.approval ? '승인 ' + c.approval : null} />)}
              </div>
            </Section>
          ) : null}

          {/* 액션 */}
          <Section title="액션">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs text-slate-500">상태</span>
              <select value={row.status} onChange={(e) => setStatus(e.target.value)} disabled={busy}
                className="text-xs border border-slate-200 rounded-lg px-2 py-1">
                {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <button onClick={toCase} disabled={busy}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold disabled:opacity-60">
              <ArrowUpRight size={15} /> 케이스로 전환
            </button>
            <p className="text-[11px] text-slate-400 mt-1.5">케이스 생성 페이지로 이동합니다. (자동 채움은 BPM 연동 후 확장)</p>
          </Section>
        </div>
      </div>
    </div>
  )
}

function ScoreBox({ label, value, tone }) {
  const c = tone === 'rose' ? 'text-rose-700' : 'text-sky-700'
  return (
    <div className="bg-slate-50 rounded-lg p-3">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`text-2xl font-bold ${c}`}>{value}</div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div>
      <div className="text-xs font-semibold text-slate-700 mb-2">{title}</div>
      {children}
    </div>
  )
}

function Flag({ icon: Icon, tone, children }) {
  const map = { rose: 'bg-rose-50 text-rose-700', slate: 'bg-slate-100 text-slate-500', amber: 'bg-amber-50 text-amber-700', sky: 'bg-sky-50 text-sky-700' }
  return <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded ${map[tone]}`}><Icon size={11} />{children}</span>
}

function EvidenceRow({ label, id, sub }) {
  return (
    <div className="flex items-center gap-2 text-slate-600">
      <span className="text-[10px] bg-sky-50 text-sky-700 px-1.5 py-0.5 rounded">{label}</span>
      <span className="font-mono text-[11px]">{id}</span>
      {sub && <span className="text-slate-400 text-[11px]">{sub}</span>}
      <ExternalLink size={11} className="text-slate-300" />
    </div>
  )
}

// 초간단 인라인 스파크라인 (의존성 0)
function Sparkline({ series }) {
  if (!series.length) return <span className="text-[11px] text-slate-300">데이터 없음</span>
  const pts = series.slice(-30)
  const max = Math.max(1, ...pts.map((p) => p.count))
  const W = 120, H = 28
  const step = pts.length > 1 ? W / (pts.length - 1) : W
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${(i * step).toFixed(1)} ${(H - (p.count / max) * H).toFixed(1)}`).join(' ')
  return (
    <svg width={W} height={H} className="overflow-visible">
      <path d={path} fill="none" stroke="#0ea5e9" strokeWidth="1.5" />
    </svg>
  )
}
