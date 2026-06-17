import { supabase } from './supabase'

// 등급 메타 (색/라벨/정의/액션) — score2axis.py 의 등급 정의와 일치
export const GRADE_META = {
  A: { label: 'A · 즉시 법적 타겟', short: '즉시 타겟', cls: 'bg-rose-600',  band: 'bg-rose-50',   text: 'text-rose-700',
       def: '신원 확보 + 온라인 신고 건수 적음', action: '민·형사 타겟 선정 (제거해도 신고 손실 적음)' },
  B: { label: 'B · 지속 관찰',     short: '지속 관찰', cls: 'bg-orange-500', band: 'bg-orange-50', text: 'text-orange-700',
       def: '타겟 선정 가능하나 온라인 신고 건수 높음', action: '대체 셀러 확보 후 타겟 선정 권장' },
  C: { label: 'C · 집중 모니터링', short: '집중 모니터링', cls: 'bg-sky-600', band: 'bg-sky-50', text: 'text-sky-700',
       def: '신원 불명이나 신고건수 다량 공급', action: '신고 주력 모집단으로 계속 활용' },
  D: { label: 'D · 후순위',       short: '후순위', cls: 'bg-slate-400', band: 'bg-slate-50', text: 'text-slate-600',
       def: '활동·증거 모두 약함', action: '주기적 정리만' },
  X: { label: 'X · 제외',         short: '제외', cls: 'bg-slate-300', band: 'bg-slate-50', text: 'text-slate-500',
       def: '대형유통/샵인샵 — 플랫폼 단위', action: '입점업체 단위로 별도 확인' },
}

export const TREND_META = {
  surge:   { label: '급증', icon: '▲', text: 'text-rose-600' },
  steady:  { label: '유지', icon: '＝', text: 'text-slate-500' },
  decline: { label: '하락', icon: '▼', text: 'text-slate-400' },
  unknown: { label: '—',   icon: '·', text: 'text-slate-300' },
}

export const STATUS_META = {
  new:       { label: '신규' },
  watching:  { label: '관찰중' },
  in_review: { label: '검토중' },
  cased:     { label: '케이스화' },
  dismissed: { label: '제외' },
}

function quantile(sorted, q) {
  if (!sorted.length) return 0
  const pos = (sorted.length - 1) * q
  const base = Math.floor(pos)
  const rest = pos - base
  return sorted[base + 1] !== undefined
    ? sorted[base] + rest * (sorted[base + 1] - sorted[base])
    : sorted[base]
}

/**
 * 선택한 범위(전체 또는 특정 브랜드) 안에서 A/B/C/D 등급을 다시 매긴다.
 * 점수(enf/yield)는 절대값이라 그대로 두고, 高/低 컷만 이 범위 분포로 재계산.
 * → "Apple 안에서의 상위 30%가 A" 라는 브랜드별 상대평가 (score2axis.py 와 동일).
 * 대형유통/샵인샵(is_big)은 항상 X.
 */
export function applyScopeGrades(ops) {
  const valid = ops.filter((o) => !o.is_big)
  const enfPos = valid.map((o) => Number(o.enf_score)).filter((s) => s > 0).sort((a, b) => a - b)
  const yld = valid.map((o) => Number(o.yield_score)).sort((a, b) => a - b)
  const enfHi = Math.max(enfPos.length ? quantile(enfPos, 0.70) : 0, 30)
  const yieldHi = Math.max(yld.length ? quantile(yld, 0.70) : 0, 30)
  return ops.map((o) => {
    if (o.is_big) return { ...o, grade: 'X' }
    const e = Number(o.enf_score), y = Number(o.yield_score)
    const eHi = e >= enfHi && e > 0
    const yHi = y >= yieldHi
    const grade = eHi && yHi ? 'B' : eHi && !yHi ? 'A' : !eHi && yHi ? 'C' : 'D'
    return { ...o, grade }
  })
}

export async function loadTargets() {
  const { data, error } = await supabase
    .from('infringer_targets')
    .select('*')
    .order('grade', { ascending: true })
    .order('enf_score', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function updateTargetStatus(clusterKey, patch) {
  const { error } = await supabase
    .from('infringer_targets')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('cluster_key', clusterKey)
  if (error) throw error
}

// "지금 갱신" — 동기화 함수 호출 (admin 토큰)
export async function runSync() {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) throw new Error('로그인 세션이 없습니다.')
  const res = await fetch('/api/targets-sync', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `동기화 실패 (${res.status})`)
  return body
}
