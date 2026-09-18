/**
 * MetricsTable — KOIPA 실적표 양식(구분 × 플랫폼 × 보호원/미리어드/소계).
 *  - editable=true : 한 달치 입력 (수집 / 신고 K·M / 차단 K·M / 메모). 셀 blur 시 upsert.
 *  - editable=false: 대시보드 누적 표 (읽기 전용).
 * 플랫폼 행 순서는 project.config.platforms 에서 옴.
 */
import { useEffect, useMemo, useState } from 'react'
import { Loader2, Check } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { upsertMetric } from '../../lib/projects'

const COLS = [
  { key: 'collected', label: '수집', group: '수집' },
  { key: 'reported_k', label: 'K', group: '신고' },
  { key: 'reported_m', label: 'M', group: '신고' },
  { key: 'blocked_k', label: 'K', group: '차단' },
  { key: 'blocked_m', label: 'M', group: '차단' }
]

const n = (v) => (Number(v) || 0)
const fmt = (v) => (v ? v.toLocaleString('ko-KR') : '-')

export default function MetricsTable({ project, month = null, rows = [], editable = false, onSaved }) {
  const { user } = useAuth()
  const platforms = project?.config?.platforms || []
  const [local, setLocal] = useState({})
  const [savingKey, setSavingKey] = useState(null)
  const [savedKey, setSavedKey] = useState(null)

  // platform → row (수기 입력 시 local 우선)
  const byPlatform = useMemo(() => {
    const m = {}
    for (const r of rows) m[r.platform] = r
    return m
  }, [rows])

  useEffect(() => { setLocal({}) }, [month, rows])

  function val(platform, key) {
    if (local[platform]?.[key] !== undefined) return local[platform][key]
    return byPlatform[platform]?.[key] ?? (key === 'note' ? '' : 0)
  }

  async function commit(platform, category, key) {
    const row = {
      project_id: project.id,
      month,
      category,
      platform,
      collected: val(platform, 'collected'),
      reported_k: val(platform, 'reported_k'),
      reported_m: val(platform, 'reported_m'),
      blocked_k: val(platform, 'blocked_k'),
      blocked_m: val(platform, 'blocked_m'),
      note: val(platform, 'note')
    }
    // 전부 0/빈값이고 DB 에도 없으면 저장 안 함
    const empty = COLS.every((c) => n(row[c.key]) === 0) && !row.note
    if (empty && !byPlatform[platform]) return
    const k = `${platform}:${key}`
    setSavingKey(k)
    try {
      await upsertMetric(row, user.id)
      setSavedKey(k); setTimeout(() => setSavedKey((s) => (s === k ? null : s)), 1200)
      onSaved?.()
    } finally { setSavingKey(null) }
  }

  // 카테고리별 그룹
  const groups = useMemo(() => {
    const out = []
    for (const p of platforms) {
      let g = out.find((x) => x.category === p.category)
      if (!g) { g = { category: p.category, items: [] }; out.push(g) }
      g.items.push(p.name)
    }
    // 시드 외 플랫폼(DB 에만 있는)도 표시
    for (const r of rows) {
      if (!platforms.some((p) => p.name === r.platform)) {
        let g = out.find((x) => x.category === (r.category || '기타'))
        if (!g) { g = { category: r.category || '기타', items: [] }; out.push(g) }
        if (!g.items.includes(r.platform)) g.items.push(r.platform)
      }
    }
    return out
  }, [platforms, rows])

  const totals = useMemo(() => {
    const t = Object.fromEntries(COLS.map((c) => [c.key, 0]))
    for (const g of groups) for (const p of g.items) for (const c of COLS) t[c.key] += n(val(p, c.key))
    return t
  }, [groups, local, rows])

  const inputCls = 'w-full text-right px-1.5 py-1 text-xs border border-transparent hover:border-slate-300 focus:border-myriad-primary rounded bg-transparent focus:bg-white focus:outline-none tabular-nums'

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-[#3A3737] text-white">
            <th rowSpan={2} className="px-2 py-1.5 text-left font-semibold w-20 border-r border-white/10">구분</th>
            <th rowSpan={2} className="px-2 py-1.5 text-left font-semibold border-r border-white/10">플랫폼</th>
            <th className="px-2 py-1 text-center font-semibold border-r border-white/10">수집</th>
            <th colSpan={3} className="px-2 py-1 text-center font-semibold border-r border-white/10">신고</th>
            <th colSpan={3} className="px-2 py-1 text-center font-semibold border-r border-white/10">차단 완료</th>
            {editable && <th rowSpan={2} className="px-2 py-1.5 text-left font-semibold w-44">메모</th>}
          </tr>
          <tr className="bg-[#3A3737] text-white/80">
            <th className="px-2 py-1 text-right font-normal border-r border-white/10 w-16">건수</th>
            <th className="px-2 py-1 text-right font-normal w-16" title="KOIPA 소관">K</th>
            <th className="px-2 py-1 text-right font-normal w-16" title="Myriad 소관">M</th>
            <th className="px-2 py-1 text-right font-semibold border-r border-white/10 w-16">소계</th>
            <th className="px-2 py-1 text-right font-normal w-16" title="KOIPA 소관">K</th>
            <th className="px-2 py-1 text-right font-normal w-16" title="Myriad 소관">M</th>
            <th className="px-2 py-1 text-right font-semibold border-r border-white/10 w-16">소계</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => g.items.map((p, i) => {
            const cat = g.category
            const rSum = n(val(p, 'reported_k')) + n(val(p, 'reported_m'))
            const bSum = n(val(p, 'blocked_k')) + n(val(p, 'blocked_m'))
            return (
              <tr key={p} className="border-b border-[#E7E3DE] hover:bg-[#FAF8F4]">
                {i === 0 && (
                  <td rowSpan={g.items.length} className="px-2 py-1 font-semibold text-[#2B2928] bg-[#FAF8F4] border-r border-[#E7E3DE] align-top">{cat}</td>
                )}
                <td className="px-2 py-1 text-[#2B2928] border-r border-[#E7E3DE]">{p}</td>
                {COLS.map((c, ci) => (
                  <td key={c.key} className={`px-1 py-0.5 text-right tabular-nums ${ci === 0 ? 'border-r border-[#E7E3DE]' : ''} ${editable ? '' : 'px-2 py-1'}`}>
                    {editable ? (
                      <div className="relative">
                        <input
                          type="text" inputMode="numeric"
                          value={val(p, c.key) === 0 && local[p]?.[c.key] === undefined ? '' : val(p, c.key)}
                          placeholder="-"
                          onChange={(e) => setLocal((l) => ({ ...l, [p]: { ...(l[p] || {}), [c.key]: e.target.value.replace(/[^\d]/g, '') } }))}
                          onBlur={() => commit(p, cat, c.key)}
                          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                          className={inputCls}
                        />
                        {savingKey === `${p}:${c.key}` && <Loader2 size={9} className="absolute right-0.5 top-1/2 -translate-y-1/2 animate-spin text-slate-400" />}
                        {savedKey === `${p}:${c.key}` && <Check size={9} className="absolute right-0.5 top-1/2 -translate-y-1/2 text-emerald-500" />}
                      </div>
                    ) : (
                      <span className={c.key === 'collected' ? 'text-[#8A8580]' : 'text-[#2B2928]'}>{fmt(n(val(p, c.key)))}</span>
                    )}
                    {/* 소계 삽입 */}
                  </td>
                )).flatMap((cell, ci) => {
                  if (ci === 2) return [cell, <td key="rsum" className="px-2 py-1 text-right font-semibold tabular-nums border-r border-[#E7E3DE] text-[#2B2928]">{fmt(rSum)}</td>]
                  if (ci === 4) return [cell, <td key="bsum" className="px-2 py-1 text-right font-semibold tabular-nums border-r border-[#E7E3DE] text-[#B98A00]">{fmt(bSum)}</td>]
                  return [cell]
                })}
                {editable && (
                  <td className="px-1 py-0.5">
                    <input
                      type="text"
                      value={val(p, 'note')}
                      placeholder="메모"
                      onChange={(e) => setLocal((l) => ({ ...l, [p]: { ...(l[p] || {}), note: e.target.value } }))}
                      onBlur={() => commit(p, cat, 'note')}
                      className="w-full px-1.5 py-1 text-xs border border-transparent hover:border-slate-300 focus:border-myriad-primary rounded bg-transparent focus:bg-white focus:outline-none"
                    />
                  </td>
                )}
              </tr>
            )
          }))}
        </tbody>
        <tfoot>
          <tr className="bg-[#FAF8F4] font-bold text-[#2B2928] border-t-2 border-[#3A3737]">
            <td colSpan={2} className="px-2 py-1.5 border-r border-[#E7E3DE]">합계</td>
            <td className="px-2 py-1.5 text-right tabular-nums border-r border-[#E7E3DE] text-[#8A8580]">{fmt(totals.collected)}</td>
            <td className="px-2 py-1.5 text-right tabular-nums">{fmt(totals.reported_k)}</td>
            <td className="px-2 py-1.5 text-right tabular-nums">{fmt(totals.reported_m)}</td>
            <td className="px-2 py-1.5 text-right tabular-nums border-r border-[#E7E3DE]">{fmt(totals.reported_k + totals.reported_m)}</td>
            <td className="px-2 py-1.5 text-right tabular-nums">{fmt(totals.blocked_k)}</td>
            <td className="px-2 py-1.5 text-right tabular-nums">{fmt(totals.blocked_m)}</td>
            <td className="px-2 py-1.5 text-right tabular-nums border-r border-[#E7E3DE] text-[#B98A00]">{fmt(totals.blocked_k + totals.blocked_m)}</td>
            {editable && <td />}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
