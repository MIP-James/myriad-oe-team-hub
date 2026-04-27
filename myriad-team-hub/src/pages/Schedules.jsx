/**
 * 일정 페이지 — Phase 9 통합:
 *  - 기존: 월간 캘린더 + 개인/팀 일정 (그대로 유지)
 *  - 신규:
 *      • 월요일 시작 그리드 (ISO 주 정렬)
 *      • 각 주 행 위에 "Week N (M/D~M/D) — 계획 N개" 띠 (클릭 → 주간 계획 모달)
 *      • 각 일자 셀 하단에 일일 기록 인디케이터 (📝 N) — 클릭 → 일일 기록 모달
 *      • 헤더에 🔔 알림 버튼 (현재 시각 표시 + 클릭 → 설정 모달)
 *      • ?openToday=1 쿼리 → 오늘 일일 기록 모달 자동 오픈 (리마인더에서 호출)
 */
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  CalendarDays, ChevronLeft, ChevronRight, Plus, X, Trash2, Save, Loader2,
  Lock, Users as UsersIcon, Bell, BellOff, NotebookPen, ChevronRight as Chevron,
  CheckCircle2, History
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import {
  getMonthGridSundayStart, isoWeekOf, isoWeekStart, isoWeekEnd,
  dateKey, formatMD, timeToHHMM
} from '../lib/dateHelpers'
import {
  listWeeklyPlansInRange, listDailyRecordsInRange,
  getDailyRecord, getReminderSettings
} from '../lib/weekly'
import WeeklyPlanModal from '../components/WeeklyPlanModal'
import DailyRecordModal from '../components/DailyRecordModal'
import ReminderSettingsModal from '../components/ReminderSettingsModal'

// 캘린더 헤더: 일요일 시작 (표준 UI). 주차 띠 계산은 ISO(월~일) 유지.
const WEEKDAYS_SUN = ['일', '월', '화', '수', '목', '금', '토']
// "이번 주 한 일" 섹션은 ISO 주(월~일) 순서로 누적되므로 별도 배열 유지.
const WEEKDAYS_MON = ['월', '화', '수', '목', '금', '토', '일']
const pad = (n) => n.toString().padStart(2, '0')

// ── 날짜/시간 헬퍼 (다일 일정 지원) ─────────────────────
function enumerateDateKeys(startKey, endKey) {
  if (!startKey) return []
  const [sy, sm, sd] = startKey.split('-').map(Number)
  const [ey, em, ed] = (endKey || startKey).split('-').map(Number)
  const cur = new Date(sy, sm - 1, sd)
  const last = new Date(ey, em - 1, ed)
  if (cur > last) return [startKey]
  const keys = []
  while (cur <= last) {
    keys.push(`${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}`)
    cur.setDate(cur.getDate() + 1)
  }
  return keys
}

function combineDateTime(dateStr, timeHHMM) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const [h, mi] = (timeHHMM || '00:00').split(':').map(Number)
  return new Date(y, m - 1, d, h, mi, 0).toISOString()
}

function extractTimeHHMM(iso) {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatDateKeyKorean(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][date.getDay()]
  return `${m}/${d} (${weekday})`
}

// 팀 공개 일정 작성자 라벨 (full_name 우선, 없으면 email 앞부분)
function authorLabel(profile) {
  if (!profile) return null
  return profile.full_name || profile.email?.split('@')[0] || null
}

// 선택한 날짜에 해당하는 일정 표시용 시간 문자열
function getItemTimeForDay(item, selectedKey) {
  if (Array.isArray(item.daily_times) && item.daily_times.length > 0) {
    const row = item.daily_times.find((x) => x.date === selectedKey)
    if (row) return `${row.starts_at} ~ ${row.ends_at}`
  }
  const startKey = dateKey(new Date(item.starts_at))
  const endKey = item.ends_at ? dateKey(new Date(item.ends_at)) : startKey
  const s = new Date(item.starts_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
  const e = item.ends_at ? new Date(item.ends_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : ''
  if (startKey === endKey) return e ? `${s} ~ ${e}` : s
  if (selectedKey === startKey) return `${s} 부터`
  if (selectedKey === endKey) return `~ ${e}`
  return '종일'
}

export default function Schedules() {
  const { user } = useAuth()
  const today = new Date()
  const [params, setParams] = useSearchParams()

  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1))
  const [selectedDay, setSelectedDay] = useState(dateKey(today))

  // 기존: schedules
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [editor, setEditor] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // 신규: weekly_plans / daily_records / reminder
  const [weeklyPlans, setWeeklyPlans] = useState({})       // { 'YYYY-W' : plan }
  const [dailyRecords, setDailyRecords] = useState({})     // { 'YYYY-MM-DD' : record }
  const [reminderSettings, setReminderSettings] = useState(null)
  const [profileMap, setProfileMap] = useState({})         // { user_id : { full_name, email } } — 팀 공개 작성자 표시용
  const [weeklyEditor, setWeeklyEditor] = useState(null)   // { year, week, weekStart, items }
  const [dailyEditor, setDailyEditor] = useState(null)     // { date, items }
  const [reminderModalOpen, setReminderModalOpen] = useState(false)

  // "지난 주 한 일" 탐색 — 선택한 주 기준 N주 전 (1 = 지난 주)
  const [pastWeekOffset, setPastWeekOffset] = useState(1)
  const [pastWeekRecords, setPastWeekRecords] = useState({})    // { 'YYYY-MM-DD' : record }
  const [pastWeekLoading, setPastWeekLoading] = useState(false)

  const grid = useMemo(
    () => getMonthGridSundayStart(cursor.getFullYear(), cursor.getMonth()),
    [cursor]
  )

  // 그리드를 6주 행으로 분할
  const rows = useMemo(() => {
    const out = []
    for (let i = 0; i < 6; i++) out.push(grid.slice(i * 7, (i + 1) * 7))
    return out
  }, [grid])

  useEffect(() => { load() }, [cursor, user?.id])

  // ?openToday=1 처리 — 리마인더 토스트에서 점프
  useEffect(() => {
    if (params.get('openToday') === '1' && user?.id) {
      const t = new Date()
      setSelectedDay(dateKey(t))
      ;(async () => {
        const rec = await getDailyRecord(user.id, dateKey(t)).catch(() => null)
        setDailyEditor({ date: t, items: rec?.items ?? [] })
      })()
      // 쿼리 파라미터 정리
      const next = new URLSearchParams(params)
      next.delete('openToday')
      setParams(next, { replace: true })
    }
  }, [params, user?.id])

  async function load() {
    if (!user?.id) return
    setLoading(true)
    const rangeStart = grid[0]
    const rangeEnd = new Date(grid[41])
    rangeEnd.setDate(rangeEnd.getDate() + 1)

    try {
      // 월 그리드와 겹치는 모든 일정: starts_at < rangeEnd AND (ends_at >= rangeStart OR ends_at IS NULL)
      const [schedulesRes, plans, records, reminder] = await Promise.all([
        supabase
          .from('schedules')
          .select('*')
          .lt('starts_at', rangeEnd.toISOString())
          .or(`ends_at.gte.${rangeStart.toISOString()},ends_at.is.null`)
          .order('starts_at', { ascending: true }),
        listWeeklyPlansInRange(
          user.id,
          dateKey(rangeStart),
          dateKey(grid[41])
        ),
        listDailyRecordsInRange(
          user.id,
          dateKey(rangeStart),
          dateKey(grid[41])
        ),
        getReminderSettings(user.id)
      ])
      if (schedulesRes.error) setError(schedulesRes.error.message)
      else setItems(schedulesRes.data ?? [])

      // 팀 공개 일정의 작성자 프로필 한 번에 조회 (본인 제외)
      const teamAuthorIds = [
        ...new Set(
          (schedulesRes.data ?? [])
            .filter((s) => s.visibility === 'team' && s.user_id !== user.id)
            .map((s) => s.user_id)
        )
      ]
      if (teamAuthorIds.length > 0) {
        const { data: profileRows } = await supabase
          .from('profiles')
          .select('id,full_name,email')
          .in('id', teamAuthorIds)
        const pmap = {}
        for (const p of (profileRows ?? [])) pmap[p.id] = p
        setProfileMap(pmap)
      } else {
        setProfileMap({})
      }

      // 인덱싱
      const planMap = {}
      for (const p of plans) planMap[`${p.year}-${p.week_number}`] = p
      setWeeklyPlans(planMap)

      const recMap = {}
      for (const r of records) recMap[r.log_date] = r
      setDailyRecords(recMap)

      setReminderSettings(reminder)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // 시작~종료 사이 모든 날짜에 일정 매핑 (ends_at 없으면 시작일만)
  const itemsByDay = useMemo(() => {
    const map = {}
    for (const s of items) {
      const start = new Date(s.starts_at)
      const end = s.ends_at ? new Date(s.ends_at) : start
      const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate())
      const last = new Date(end.getFullYear(), end.getMonth(), end.getDate())
      while (cur <= last) {
        const k = dateKey(cur)
        if (!map[k]) map[k] = []
        map[k].push(s)
        cur.setDate(cur.getDate() + 1)
      }
    }
    return map
  }, [items])

  // ─── 일정 (다일 지원) ───────────────────
  function openNew(date) {
    const dk = dateKey(date)
    setEditor({
      id: null, title: '', description: '',
      startDate: dk, endDate: dk,
      dayTimes: { [dk]: { starts: '09:00', ends: '10:00' } },
      visibility: 'private',
      user_id: user.id
    })
    setError(null)
  }

  function openEdit(item) {
    const startDate = dateKey(new Date(item.starts_at))
    const endDate = item.ends_at ? dateKey(new Date(item.ends_at)) : startDate
    const dayKeys = enumerateDateKeys(startDate, endDate)
    const dayTimes = {}
    if (Array.isArray(item.daily_times) && item.daily_times.length > 0) {
      for (const row of item.daily_times) {
        dayTimes[row.date] = { starts: row.starts_at, ends: row.ends_at }
      }
    } else if (dayKeys.length === 1) {
      dayTimes[startDate] = {
        starts: extractTimeHHMM(item.starts_at),
        ends: item.ends_at ? extractTimeHHMM(item.ends_at) : '18:00'
      }
    } else {
      for (let i = 0; i < dayKeys.length; i++) {
        if (i === 0) {
          dayTimes[dayKeys[i]] = { starts: extractTimeHHMM(item.starts_at), ends: '18:00' }
        } else if (i === dayKeys.length - 1) {
          dayTimes[dayKeys[i]] = {
            starts: '09:00',
            ends: item.ends_at ? extractTimeHHMM(item.ends_at) : '18:00'
          }
        } else {
          dayTimes[dayKeys[i]] = { starts: '09:00', ends: '18:00' }
        }
      }
    }
    // 범위 내 빈 슬롯 채우기
    for (const k of dayKeys) {
      if (!dayTimes[k]) dayTimes[k] = { starts: '09:00', ends: '18:00' }
    }
    setEditor({
      id: item.id, title: item.title, description: item.description ?? '',
      startDate, endDate, dayTimes,
      visibility: item.visibility, user_id: item.user_id
    })
    setError(null)
  }

  async function saveSchedule() {
    if (!editor.title.trim()) { setError('제목을 입력하세요.'); return }
    const dayKeys = enumerateDateKeys(editor.startDate, editor.endDate)
    if (dayKeys.length === 0) { setError('날짜 범위가 올바르지 않습니다.'); return }
    if (editor.startDate > editor.endDate) { setError('종료일이 시작일보다 빠릅니다.'); return }

    // 범위 내 슬롯 확정 + 유효성
    const dayTimes = {}
    for (const k of dayKeys) {
      const slot = editor.dayTimes[k] || { starts: '09:00', ends: '18:00' }
      if (slot.starts >= slot.ends) {
        setError(`${formatDateKeyKorean(k)}: 시작 시간이 종료 시간보다 늦거나 같습니다.`)
        return
      }
      dayTimes[k] = slot
    }

    setSaving(true); setError(null)
    const firstK = dayKeys[0]
    const lastK = dayKeys[dayKeys.length - 1]
    const payload = {
      title: editor.title.trim(),
      description: editor.description?.trim() || null,
      starts_at: combineDateTime(firstK, dayTimes[firstK].starts),
      ends_at: combineDateTime(lastK, dayTimes[lastK].ends),
      visibility: editor.visibility,
      user_id: user.id,
      daily_times: dayKeys.length > 1
        ? dayKeys.map((k) => ({ date: k, starts_at: dayTimes[k].starts, ends_at: dayTimes[k].ends }))
        : null
    }
    const { error } = editor.id
      ? await supabase.from('schedules').update(payload).eq('id', editor.id)
      : await supabase.from('schedules').insert(payload)
    setSaving(false)
    if (error) { setError(error.message); return }
    setEditor(null); await load()
  }
  async function removeSchedule() {
    if (!editor?.id) { setEditor(null); return }
    if (!window.confirm('이 일정을 삭제할까요?')) return
    const { error } = await supabase.from('schedules').delete().eq('id', editor.id)
    if (error) { setError(error.message); return }
    setEditor(null); await load()
  }

  // ─── 주간 계획 / 일일 기록 ────────
  function openWeeklyPlan(rowDays) {
    // 일요일 시작 그리드 → 월요일은 [1] (ISO 주 기준)
    const monday = rowDays[1]
    const { year, week } = isoWeekOf(monday)
    const plan = weeklyPlans[`${year}-${week}`]
    setWeeklyEditor({
      year, week, weekStart: monday,
      items: plan?.items ?? []
    })
  }
  async function openDailyRecord(d) {
    const k = dateKey(d)
    const existing = dailyRecords[k]
    setDailyEditor({ date: new Date(d), items: existing?.items ?? [] })
  }

  const selectedDayItems = itemsByDay[selectedDay] ?? []
  const isEditorMine = !editor?.id || editor?.user_id === user?.id
  const selectedDate = useMemo(() => {
    const [y, m, d] = selectedDay.split('-').map(Number)
    return new Date(y, m - 1, d)
  }, [selectedDay])
  const selectedDailyRecord = dailyRecords[selectedDay]
  // 선택한 날짜가 속한 주의 주간 계획
  const selectedWeekInfo = useMemo(() => isoWeekOf(selectedDate), [selectedDate])
  const selectedWeeklyPlan = weeklyPlans[`${selectedWeekInfo.year}-${selectedWeekInfo.week}`]
  const selectedWeekStart = useMemo(() => isoWeekStart(selectedDate), [selectedDate])
  const selectedWeekEnd = useMemo(() => isoWeekEnd(selectedDate), [selectedDate])

  // 이번 주 한 일 = 선택한 주의 월~일 daily_records 누적
  const selectedWeekDoneByDay = useMemo(() => {
    const out = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(selectedWeekStart)
      d.setDate(selectedWeekStart.getDate() + i)
      const k = dateKey(d)
      const rec = dailyRecords[k]
      if (rec?.items?.length > 0) out.push({ date: d, key: k, items: rec.items })
    }
    return out
  }, [selectedWeekStart, dailyRecords])
  const selectedWeekDoneCount = useMemo(
    () => selectedWeekDoneByDay.reduce((sum, g) => sum + g.items.length, 0),
    [selectedWeekDoneByDay]
  )

  // ── 지난 주 한 일 (selectedWeekStart - 7*offset) ─────────────
  const pastWeekStart = useMemo(() => {
    const d = new Date(selectedWeekStart)
    d.setDate(d.getDate() - 7 * pastWeekOffset)
    return d
  }, [selectedWeekStart, pastWeekOffset])
  const pastWeekEnd = useMemo(() => {
    const d = new Date(pastWeekStart)
    d.setDate(d.getDate() + 6)
    return d
  }, [pastWeekStart])
  const pastWeekInfo = useMemo(() => isoWeekOf(pastWeekStart), [pastWeekStart])
  const pastWeekStartKey = dateKey(pastWeekStart)
  const pastWeekEndKey = dateKey(pastWeekEnd)

  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    setPastWeekLoading(true)
    listDailyRecordsInRange(user.id, pastWeekStartKey, pastWeekEndKey)
      .then((records) => {
        if (cancelled) return
        const map = {}
        for (const r of records) map[r.log_date] = r
        setPastWeekRecords(map)
      })
      .catch(() => { if (!cancelled) setPastWeekRecords({}) })
      .finally(() => { if (!cancelled) setPastWeekLoading(false) })
    return () => { cancelled = true }
  }, [user?.id, pastWeekStartKey, pastWeekEndKey])

  const pastWeekDoneByDay = useMemo(() => {
    const out = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(pastWeekStart)
      d.setDate(pastWeekStart.getDate() + i)
      const k = dateKey(d)
      const rec = pastWeekRecords[k]
      if (rec?.items?.length > 0) out.push({ date: d, key: k, items: rec.items })
    }
    return out
  }, [pastWeekStart, pastWeekRecords])
  const pastWeekDoneCount = useMemo(
    () => pastWeekDoneByDay.reduce((sum, g) => sum + g.items.length, 0),
    [pastWeekDoneByDay]
  )

  // 선택한 주가 바뀌면 offset 리셋 (직관적: 새 기준점 = 직전 주 다시 보기)
  useEffect(() => { setPastWeekOffset(1) }, [dateKey(selectedWeekStart)])

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <header className="mb-6 flex items-center gap-3 flex-wrap">
        <CalendarDays className="text-myriad-ink" />
        <h1 className="text-2xl font-bold text-slate-900">일정</h1>
        <div className="flex-1" />
        <ReminderButton settings={reminderSettings} onClick={() => setReminderModalOpen(true)} />
        <button
          onClick={() => openNew(selectedDate)}
          className="flex items-center gap-2 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-4 py-2 rounded-lg transition"
        >
          <Plus size={16} /> 새 일정
        </button>
      </header>

      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          className="p-2 rounded-lg hover:bg-slate-200"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="text-xl font-bold text-slate-900 mx-2 min-w-[8rem] text-center">
          {cursor.getFullYear()}년 {cursor.getMonth() + 1}월
        </div>
        <button
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
          className="p-2 rounded-lg hover:bg-slate-200"
        >
          <ChevronRight size={18} />
        </button>
        <button
          onClick={() => {
            setCursor(new Date(today.getFullYear(), today.getMonth(), 1))
            setSelectedDay(dateKey(today))
          }}
          className="ml-2 text-sm text-slate-500 hover:text-slate-900 px-3 py-1.5 rounded-lg hover:bg-slate-100"
        >
          오늘
        </button>
        {loading && <Loader2 className="animate-spin text-slate-400 ml-2" size={16} />}
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* ─── 캘린더 ─── */}
        <div className="col-span-12 lg:col-span-8">
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            {/* 요일 헤더 — 일요일 시작 */}
            <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
              {WEEKDAYS_SUN.map((d, i) => (
                <div
                  key={d}
                  className={`py-2 text-center ${
                    i === 0 ? 'text-rose-500' : i === 6 ? 'text-blue-500' : ''
                  }`}
                >
                  {d}
                </div>
              ))}
            </div>

            {/* 주 단위 행 (각 행 위에 주차 띠) — 주차 계산은 행의 월요일(index 1) 기준 ISO 주 */}
            {rows.map((rowDays, rowIdx) => {
              const monday = rowDays[1]       // 일요일 시작 그리드에서 월요일은 두 번째 칸
              const { year, week } = isoWeekOf(monday)
              const plan = weeklyPlans[`${year}-${week}`]
              const planCount = plan?.items?.length ?? 0
              // ISO 주 범위: 월 ~ 그 다음 일요일 (다음 행의 index 0)
              const wEnd = new Date(monday)
              wEnd.setDate(monday.getDate() + 6)
              return (
                <div key={rowIdx}>
                  {/* 주차 띠 — 차분한 stone/amber 톤 */}
                  <button
                    onClick={() => openWeeklyPlan(rowDays)}
                    className={`w-full px-4 py-2 transition border-b border-stone-200 flex items-center gap-2 text-xs text-left group ${
                      planCount > 0
                        ? 'bg-amber-100/70 hover:bg-amber-100'
                        : 'bg-stone-50 hover:bg-amber-50'
                    }`}
                  >
                    <NotebookPen size={12} className="text-stone-600 group-hover:text-myriad-ink" />
                    <span className="font-bold text-stone-800">Week {week}</span>
                    <span className="text-stone-500 font-medium">
                      {formatMD(monday)} ~ {formatMD(wEnd)}
                    </span>
                    <div className="flex-1" />
                    {planCount > 0 ? (
                      <span className="text-stone-800 font-bold inline-flex items-center gap-1 bg-white/80 px-2 py-0.5 rounded-full border border-amber-200">
                        📝 이번 주 계획 {planCount}개
                      </span>
                    ) : (
                      <span className="text-stone-500 font-medium">+ 이번 주 할 일 적어두기</span>
                    )}
                    <Chevron size={12} className="text-stone-400 group-hover:text-stone-700" />
                  </button>

                  {/* 7일 셀 */}
                  <div className="grid grid-cols-7">
                    {rowDays.map((d, idx) => {
                      const k = dateKey(d)
                      const inMonth = d.getMonth() === cursor.getMonth()
                      const isToday = k === dateKey(today)
                      const isSelected = k === selectedDay
                      const dayItems = itemsByDay[k] ?? []
                      const dayRecord = dailyRecords[k]
                      const recordCount = dayRecord?.items?.length ?? 0
                      const isWeekend = idx === 0 || idx === 6
                      return (
                        <button
                          key={idx}
                          onClick={() => setSelectedDay(k)}
                          onDoubleClick={() => openDailyRecord(d)}
                          className={`relative h-28 p-1.5 border-b border-r border-slate-100 text-left transition ${
                            isSelected
                              ? 'bg-amber-50 hover:bg-amber-100'
                              : 'hover:bg-slate-50'
                          } ${!inMonth ? 'text-slate-300 bg-slate-50/50' : ''}`}
                        >
                          <div
                            className={`text-xs font-semibold inline-flex items-center justify-center w-5 h-5 ${
                              isToday ? 'rounded-full bg-myriad-primary text-myriad-ink' : ''
                            } ${idx === 0 && inMonth && !isToday ? 'text-rose-500' : ''} ${
                              idx === 6 && inMonth && !isToday ? 'text-blue-500' : ''
                            }`}
                          >
                            {d.getDate()}
                          </div>
                          <div className="mt-1 space-y-0.5">
                            {dayItems.slice(0, 2).map((it) => (
                              <div
                                key={it.id}
                                onClick={(e) => { e.stopPropagation(); openEdit(it) }}
                                className={`text-[10px] truncate px-1 py-0.5 rounded cursor-pointer ${
                                  it.visibility === 'team'
                                    ? 'bg-sky-100 text-sky-700 hover:bg-sky-200'
                                    : 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                                }`}
                                title={it.title}
                              >
                                {it.title}
                              </div>
                            ))}
                            {dayItems.length > 2 && (
                              <div className="text-[10px] text-slate-400">+{dayItems.length - 2}</div>
                            )}
                          </div>
                          {/* 일일 기록 인디케이터 (셀 하단) */}
                          {recordCount > 0 && (
                            <div
                              className="absolute bottom-1 left-1.5 right-1.5 inline-flex items-center gap-0.5 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1 py-0.5 rounded"
                              onClick={(e) => { e.stopPropagation(); openDailyRecord(d) }}
                            >
                              📝 {recordCount}
                            </div>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
          <p className="text-xs text-slate-400 mt-2">
            💡 주차 띠 클릭 → 이번 주 할 일 · 일자 더블클릭 → 그날 한 일 기록 · 🟠 개인 일정 · 🔵 팀 공개 일정 · <span className="text-emerald-700">📝 일일 기록</span>
          </p>
        </div>

        {/* ─── 사이드 패널 ─── */}
        <div className="col-span-12 lg:col-span-4 space-y-4">
          {/* 선택한 날짜 */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <h3 className="font-bold text-slate-900 mb-3">
              {selectedDay.replace(/-/g, '. ')} 일정
            </h3>
            {loading ? (
              <div className="text-sm text-slate-400 flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" /> 불러오는 중...
              </div>
            ) : selectedDayItems.length === 0 ? (
              <p className="text-sm text-slate-400">이 날 일정이 없습니다.</p>
            ) : (
              <ul className="space-y-2">
                {selectedDayItems.map((it) => {
                  const author = it.visibility === 'team' && it.user_id !== user.id
                    ? authorLabel(profileMap[it.user_id])
                    : null
                  return (
                    <li key={it.id}>
                      <button
                        onClick={() => openEdit(it)}
                        className="w-full text-left p-3 rounded-lg border border-slate-200 hover:border-myriad-primary hover:bg-amber-50 transition"
                      >
                        <div className="flex items-center gap-2">
                          {it.visibility === 'team'
                            ? <UsersIcon size={14} className="text-sky-500 shrink-0" />
                            : <Lock size={14} className="text-amber-500 shrink-0" />}
                          <span className="font-semibold text-slate-900 truncate">{it.title}</span>
                          {author && (
                            <span className="text-[11px] font-medium text-sky-700 bg-sky-50 border border-sky-200 px-1.5 py-0.5 rounded shrink-0">
                              by {author}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 mt-1">
                          {getItemTimeForDay(it, selectedDay)}
                        </div>
                        {it.description && (
                          <div className="text-xs text-slate-600 mt-1 whitespace-pre-wrap line-clamp-2">{it.description}</div>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            <button
              onClick={() => openNew(selectedDate)}
              className="mt-4 w-full flex items-center justify-center gap-2 border border-dashed border-slate-300 text-slate-600 hover:text-slate-900 hover:border-myriad-primary py-2 rounded-lg text-sm transition"
            >
              <Plus size={14} /> 이 날 일정 추가
            </button>
          </div>

          {/* 이번 주 계획 (선택한 날짜가 속한 주) */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-slate-900 flex items-center gap-1.5">
                <NotebookPen size={14} className="text-myriad-ink" />
                이번 주 계획
              </h3>
              <button
                onClick={() => setWeeklyEditor({
                  year: selectedWeekInfo.year,
                  week: selectedWeekInfo.week,
                  weekStart: selectedWeekStart,
                  items: selectedWeeklyPlan?.items ?? []
                })}
                className="text-xs text-myriad-ink hover:underline font-semibold"
              >
                {selectedWeeklyPlan ? '편집' : '+ 계획'}
              </button>
            </div>
            <div className="text-[11px] text-slate-400 mb-2">
              Week {selectedWeekInfo.week} · {formatMD(selectedWeekStart)} ~ {formatMD(selectedWeekEnd)}
            </div>
            {selectedWeeklyPlan && selectedWeeklyPlan.items?.length > 0 ? (
              <ol className="space-y-1.5 list-decimal list-inside text-sm text-slate-700">
                {selectedWeeklyPlan.items.map((it, i) => (
                  <li key={i} className="leading-relaxed">{it.text}</li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-slate-400">
                아직 계획 없음. 이번 주 할 일을 가볍게 적어두세요.
              </p>
            )}
          </div>

          {/* 선택한 날짜의 일일 기록 */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-slate-900 flex items-center gap-1.5">
                <NotebookPen size={14} className="text-emerald-700" />
                오늘 한 일
              </h3>
              <button
                onClick={() => openDailyRecord(selectedDate)}
                className="text-xs text-myriad-ink hover:underline font-semibold"
              >
                {selectedDailyRecord ? '편집' : '+ 기록'}
              </button>
            </div>
            {selectedDailyRecord && selectedDailyRecord.items?.length > 0 ? (
              <ol className="space-y-1.5 list-decimal list-inside text-sm text-slate-700">
                {selectedDailyRecord.items.map((it, i) => (
                  <li key={i} className="leading-relaxed">{it.text}</li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-slate-400">
                아직 기록 없음. 가볍게 한 줄 적어두면 나중에 도움 돼요.
              </p>
            )}
          </div>

          {/* 이번 주 한 일 (선택한 주의 일일 기록 누적) */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-slate-900 flex items-center gap-1.5">
                <CheckCircle2 size={14} className="text-teal-700" />
                이번 주 한 일
              </h3>
              {selectedWeekDoneCount > 0 && (
                <span className="text-[11px] font-semibold text-teal-800 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded-full">
                  총 {selectedWeekDoneCount}개
                </span>
              )}
            </div>
            <div className="text-[11px] text-slate-400 mb-2">
              Week {selectedWeekInfo.week} · {formatMD(selectedWeekStart)} ~ {formatMD(selectedWeekEnd)} 누적
            </div>
            {selectedWeekDoneByDay.length > 0 ? (
              <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                {selectedWeekDoneByDay.map((g) => {
                  const isSelectedDay = g.key === selectedDay
                  return (
                    <div key={g.key}>
                      <button
                        onClick={() => { setSelectedDay(g.key); openDailyRecord(g.date) }}
                        className={`w-full text-left text-[11px] font-bold mb-1 flex items-center gap-1.5 px-1.5 py-0.5 rounded transition ${
                          isSelectedDay
                            ? 'text-teal-800 bg-teal-50'
                            : 'text-slate-500 hover:text-teal-800 hover:bg-slate-50'
                        }`}
                      >
                        <span>{WEEKDAYS_MON[g.date.getDay() === 0 ? 6 : g.date.getDay() - 1]}</span>
                        <span className="text-slate-400">{formatMD(g.date)}</span>
                        <span className="text-slate-400 font-medium">· {g.items.length}개</span>
                      </button>
                      <ol className="space-y-1 list-decimal list-inside text-sm text-slate-700 pl-1">
                        {g.items.map((it, i) => (
                          <li key={i} className="leading-relaxed">{it.text}</li>
                        ))}
                      </ol>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-sm text-slate-400">
                아직 이번 주 기록 없음. '오늘 한 일'을 채우면 여기 누적돼요.
              </p>
            )}
          </div>

          {/* 지난 주 한 일 — N주 전 탐색 */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-slate-900 flex items-center gap-1.5">
                <History size={14} className="text-slate-500" />
                지난 주 한 일
              </h3>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPastWeekOffset((o) => o + 1)}
                  className="p-1 rounded hover:bg-slate-100 text-slate-500"
                  title="더 이전 주"
                >
                  <ChevronLeft size={14} />
                </button>
                <button
                  onClick={() => setPastWeekOffset((o) => Math.max(1, o - 1))}
                  disabled={pastWeekOffset <= 1}
                  className="p-1 rounded hover:bg-slate-100 text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed"
                  title="다음 주"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
            <div className="text-[11px] text-slate-400 mb-2 flex items-center gap-2 flex-wrap">
              <span className="font-semibold">Week {pastWeekInfo.week}</span>
              <span>{formatMD(pastWeekStart)} ~ {formatMD(pastWeekEnd)}</span>
              <span className="text-slate-400">· {pastWeekOffset}주 전</span>
              {pastWeekDoneCount > 0 && (
                <span className="ml-auto font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">
                  총 {pastWeekDoneCount}개
                </span>
              )}
            </div>
            {pastWeekLoading ? (
              <div className="text-sm text-slate-400 flex items-center gap-2 py-2">
                <Loader2 size={14} className="animate-spin" /> 불러오는 중...
              </div>
            ) : pastWeekDoneByDay.length > 0 ? (
              <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                {pastWeekDoneByDay.map((g) => (
                  <div key={g.key}>
                    <button
                      onClick={() => {
                        setCursor(new Date(g.date.getFullYear(), g.date.getMonth(), 1))
                        setSelectedDay(g.key)
                        openDailyRecord(g.date)
                      }}
                      className="w-full text-left text-[11px] font-bold mb-1 flex items-center gap-1.5 px-1.5 py-0.5 rounded text-slate-500 hover:text-slate-800 hover:bg-slate-50 transition"
                      title="이 날짜로 이동 + 기록 열기"
                    >
                      <span>{WEEKDAYS_MON[g.date.getDay() === 0 ? 6 : g.date.getDay() - 1]}</span>
                      <span className="text-slate-400">{formatMD(g.date)}</span>
                      <span className="text-slate-400 font-medium">· {g.items.length}개</span>
                    </button>
                    <ol className="space-y-1 list-decimal list-inside text-sm text-slate-700 pl-1">
                      {g.items.map((it, i) => (
                        <li key={i} className="leading-relaxed">{it.text}</li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400">
                이 주({formatMD(pastWeekStart)} ~ {formatMD(pastWeekEnd)})에는 기록이 없습니다.
                <br />
                ◀ 버튼으로 더 이전 주를 찾아보세요.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ─── 모달들 ─── */}
      {editor && (
        <ScheduleEditor
          editor={editor} setEditor={setEditor}
          isMine={isEditorMine} saving={saving} error={error}
          authorProfile={!isEditorMine ? profileMap[editor.user_id] : null}
          onSave={saveSchedule} onDelete={removeSchedule}
          onClose={() => setEditor(null)}
        />
      )}

      {weeklyEditor && (
        <WeeklyPlanModal
          year={weeklyEditor.year}
          week={weeklyEditor.week}
          weekStartDate={weeklyEditor.weekStart}
          initialItems={weeklyEditor.items}
          onClose={() => setWeeklyEditor(null)}
          onSaved={() => { setWeeklyEditor(null); load() }}
        />
      )}

      {dailyEditor && (
        <DailyRecordModal
          date={dailyEditor.date}
          initialItems={dailyEditor.items}
          onClose={() => setDailyEditor(null)}
          onSaved={() => { setDailyEditor(null); load() }}
        />
      )}

      {reminderModalOpen && (
        <ReminderSettingsModal
          onClose={() => setReminderModalOpen(false)}
          onSaved={() => { setReminderModalOpen(false); load() }}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────
// 알림 버튼 (헤더 우측)
// ─────────────────────────────────────────────────────

function ReminderButton({ settings, onClick }) {
  const enabled = settings?.enabled && settings?.daily_time
  const time = settings?.daily_time ? timeToHHMM(settings.daily_time) : null
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold border transition ${
        enabled
          ? 'border-myriad-primary text-myriad-ink bg-myriad-primary/10 hover:bg-myriad-primary/20'
          : 'border-slate-200 text-slate-500 hover:bg-slate-50'
      }`}
      title="일일 리마인더 설정"
    >
      {enabled ? <Bell size={14} /> : <BellOff size={14} />}
      {enabled ? `매일 ${time}` : '리마인더 끔'}
    </button>
  )
}

// ─────────────────────────────────────────────────────
// 일정 편집 모달 (기존 로직 그대로, 컴포넌트로 분리)
// ─────────────────────────────────────────────────────

function ScheduleEditor({ editor, setEditor, isMine, saving, error, authorProfile, onSave, onDelete, onClose }) {
  const authorName = authorLabel(authorProfile)
  const dayKeys = enumerateDateKeys(editor.startDate, editor.endDate)
  const isMultiDay = dayKeys.length > 1
  const singleKey = dayKeys[0] || editor.startDate

  // 시작일/종료일 변경 시 dayTimes 범위 재조정 (기존 값 유지, 새 날짜는 09:00-18:00, 범위 밖은 제거)
  function updateRange(nextStart, nextEnd) {
    let start = nextStart || editor.startDate
    let end = nextEnd || editor.endDate
    if (start > end) end = start  // 시작일이 종료일보다 뒤로 가면 종료일을 시작일로 맞춤
    const keys = enumerateDateKeys(start, end)
    const nextDayTimes = {}
    for (const k of keys) {
      nextDayTimes[k] = editor.dayTimes[k] || { starts: '09:00', ends: '18:00' }
    }
    setEditor({ ...editor, startDate: start, endDate: end, dayTimes: nextDayTimes })
  }

  function updateDayTime(k, field, value) {
    setEditor({
      ...editor,
      dayTimes: { ...editor.dayTimes, [k]: { ...editor.dayTimes[k], [field]: value } }
    })
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-200 flex items-center shrink-0 gap-2">
          <h2 className="font-bold text-slate-900">
            {editor.id ? (isMine ? '일정 편집' : '일정 보기') : '새 일정'}
          </h2>
          {!isMine && authorName && (
            <span className="text-[11px] font-medium text-sky-700 bg-sky-50 border border-sky-200 px-2 py-0.5 rounded">
              by {authorName}
            </span>
          )}
          <div className="flex-1" />
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded">
            <X size={18} />
          </button>
        </div>
        <div className="p-6 space-y-4 overflow-auto flex-1">
          <div>
            <label className="text-xs font-semibold text-slate-600 block mb-1">제목 *</label>
            <input
              type="text"
              value={editor.title}
              onChange={(e) => setEditor({ ...editor, title: e.target.value })}
              placeholder="일정 제목"
              disabled={!isMine}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40 disabled:bg-slate-50 disabled:text-slate-500"
              autoFocus={isMine}
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600 block mb-1">내용</label>
            <textarea
              value={editor.description}
              onChange={(e) => setEditor({ ...editor, description: e.target.value })}
              rows={3}
              disabled={!isMine}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40 resize-none disabled:bg-slate-50 disabled:text-slate-500"
            />
          </div>

          {/* 시작일 / 종료일 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1">시작일 *</label>
              <input
                type="date"
                value={editor.startDate}
                onChange={(e) => updateRange(e.target.value, null)}
                disabled={!isMine}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40 disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1">종료일 *</label>
              <input
                type="date"
                value={editor.endDate}
                onChange={(e) => updateRange(null, e.target.value)}
                disabled={!isMine}
                min={editor.startDate}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40 disabled:bg-slate-50"
              />
            </div>
          </div>

          {/* 단일 날짜: 시간 한 쌍 / 다일: 날짜별 시간 행 */}
          {!isMultiDay ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1">시작 시간</label>
                <input
                  type="time"
                  value={editor.dayTimes[singleKey]?.starts || '09:00'}
                  onChange={(e) => updateDayTime(singleKey, 'starts', e.target.value)}
                  disabled={!isMine}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40 disabled:bg-slate-50"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1">종료 시간</label>
                <input
                  type="time"
                  value={editor.dayTimes[singleKey]?.ends || '18:00'}
                  onChange={(e) => updateDayTime(singleKey, 'ends', e.target.value)}
                  disabled={!isMine}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40 disabled:bg-slate-50"
                />
              </div>
            </div>
          ) : (
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-2">
                날짜별 시간 ({dayKeys.length}일)
              </label>
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-64 overflow-auto">
                {dayKeys.map((k) => {
                  const slot = editor.dayTimes[k] || { starts: '09:00', ends: '18:00' }
                  return (
                    <div key={k} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50">
                      <div className="w-20 text-xs font-semibold text-slate-700 shrink-0">
                        {formatDateKeyKorean(k)}
                      </div>
                      <input
                        type="time"
                        value={slot.starts}
                        onChange={(e) => updateDayTime(k, 'starts', e.target.value)}
                        disabled={!isMine}
                        className="w-24 px-2 py-1 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-myriad-primary/40 disabled:bg-slate-50"
                      />
                      <span className="text-slate-400">~</span>
                      <input
                        type="time"
                        value={slot.ends}
                        onChange={(e) => updateDayTime(k, 'ends', e.target.value)}
                        disabled={!isMine}
                        className="w-24 px-2 py-1 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-myriad-primary/40 disabled:bg-slate-50"
                      />
                    </div>
                  )
                })}
              </div>
              <p className="text-[11px] text-slate-400 mt-1.5">
                💡 각 날짜마다 시간이 다르게 잡혀요. 초기값은 09:00~18:00 — 필요한 날만 수정하세요.
              </p>
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-slate-600 block mb-2">공개 범위</label>
            <div className="flex gap-2">
              <button
                onClick={() => isMine && setEditor({ ...editor, visibility: 'private' })}
                disabled={!isMine}
                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border transition ${
                  editor.visibility === 'private'
                    ? 'border-amber-500 bg-amber-50 text-amber-900 font-semibold'
                    : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                } disabled:opacity-60 disabled:cursor-not-allowed`}
              >
                <Lock size={14} /> 나만 보기
              </button>
              <button
                onClick={() => isMine && setEditor({ ...editor, visibility: 'team' })}
                disabled={!isMine}
                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border transition ${
                  editor.visibility === 'team'
                    ? 'border-sky-500 bg-sky-50 text-sky-900 font-semibold'
                    : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                } disabled:opacity-60 disabled:cursor-not-allowed`}
              >
                <UsersIcon size={14} /> 팀 공개
              </button>
            </div>
          </div>
          {!isMine && (
            <p className="text-xs text-slate-500 bg-slate-50 rounded-lg p-3">
              <span className="font-semibold text-slate-700">{authorName ?? '다른 팀원'}</span> 님이 등록한 팀 공개 일정입니다. 수정/삭제는 작성자만 가능합니다.
            </p>
          )}
          {error && <div className="text-xs text-rose-600">{error}</div>}
        </div>
        <div className="px-6 py-4 border-t border-slate-200 flex items-center shrink-0">
          {editor.id && isMine && (
            <button onClick={onDelete} className="text-rose-600 hover:bg-rose-50 px-3 py-2 rounded-lg flex items-center gap-2 text-sm">
              <Trash2 size={14} /> 삭제
            </button>
          )}
          <div className="flex-1" />
          <button onClick={onClose} className="text-slate-600 hover:bg-slate-100 px-4 py-2 rounded-lg">
            {isMine ? '취소' : '닫기'}
          </button>
          {isMine && (
            <button
              onClick={onSave}
              disabled={saving}
              className="ml-2 flex items-center gap-2 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              저장
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
