/**
 * 날짜/주차 계산 유틸 (ISO 8601 기준).
 *  - ISO 주는 월요일 시작, Thursday 기준으로 연도 결정
 *  - 매주의 1일이 같은 ISO 연도/주에 속함을 보장
 */

const pad = (n) => String(n).padStart(2, '0')

/** YYYY-MM-DD 형식 키 (DB log_date 와 매칭) */
export function dateKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** ISO 주 정보 — { year, week } */
export function isoWeekOf(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum) // 그 주 Thursday 로 이동
  const year = d.getUTCFullYear()
  const yearStart = new Date(Date.UTC(year, 0, 1))
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7)
  return { year, week }
}

/** 그 날짜가 속한 ISO 주의 월요일 Date */
export function isoWeekStart(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const day = d.getDay()              // 0=일, 1=월, ...
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d
}

/** 그 날짜가 속한 ISO 주의 일요일 Date */
export function isoWeekEnd(date) {
  const start = isoWeekStart(date)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  return end
}

/** 한 달 캘린더 그리드 생성 (월요일 시작, 6주 = 42칸) */
export function getMonthGridMondayStart(year, month) {
  const first = new Date(year, month, 1)
  // 월요일 = 1, 일요일 = 0 → 월요일 시작 그리드 offset
  const dayOfWeek = first.getDay()
  const startOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  const gridStart = new Date(year, month, 1 - startOffset)
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart)
    d.setDate(gridStart.getDate() + i)
    return d
  })
}

/** 한 달 캘린더 그리드 생성 (일요일 시작, 6주 = 42칸) */
export function getMonthGridSundayStart(year, month) {
  const first = new Date(year, month, 1)
  // 일요일 = 0 → 그대로 offset
  const startOffset = first.getDay()
  const gridStart = new Date(year, month, 1 - startOffset)
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart)
    d.setDate(gridStart.getDate() + i)
    return d
  })
}

/** "M/D" 형식 표시 */
export function formatMD(d) {
  return `${d.getMonth() + 1}/${d.getDate()}`
}

/** "M월 D일 (요일)" — 한국어 */
export function formatKoreanDay(d) {
  const weekdays = ['일', '월', '화', '수', '목', '금', '토']
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${weekdays[d.getDay()]})`
}

/** 시:분 (TIME 형식) → "HH:MM" 문자열 */
export function timeToHHMM(timeStr) {
  if (!timeStr) return ''
  // Postgres TIME 은 'HH:MM:SS' 또는 'HH:MM:SS.SSS'
  return timeStr.slice(0, 5)
}

/** 오늘 키 */
export function todayKey() {
  return dateKey(new Date())
}
