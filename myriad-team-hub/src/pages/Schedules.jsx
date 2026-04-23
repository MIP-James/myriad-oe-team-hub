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
  Lock, Users as UsersIcon, Bell, BellOff, NotebookPen, ChevronRight as Chevron
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import {
  getMonthGridMondayStart, isoWeekOf, isoWeekStart, isoWeekEnd,
  dateKey, formatMD, timeToHHMM
} from '../lib/dateHelpers'
import {
  listWeeklyPlansInRange, listDailyRecordsInRange,
  getDailyRecord, getReminderSettings
} from '../lib/weekly'
import WeeklyPlanModal from '../components/WeeklyPlanModal'
import DailyRecordModal from '../components/DailyRecordModal'
import ReminderSettingsModal from '../components/ReminderSettingsModal'

const WEEKDAYS_MON = ['월', '화', '수', '목', '금', '토', '일']
const pad = (n) => n.toString().padStart(2, '0')

const toInputValue = (iso) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
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
  const [weeklyEditor, setWeeklyEditor] = useState(null)   // { year, week, weekStart, items }
  const [dailyEditor, setDailyEditor] = useState(null)     // { date, items }
  const [reminderModalOpen, setReminderModalOpen] = useState(false)

  const grid = useMemo(
    () => getMonthGridMondayStart(cursor.getFullYear(), cursor.getMonth()),
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
      const [schedulesRes, plans, records, reminder] = await Promise.all([
        supabase
          .from('schedules')
          .select('*')
          .gte('starts_at', rangeStart.toISOString())
          .lt('starts_at', rangeEnd.toISOString())
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

  const itemsByDay = useMemo(() => {
    const map = {}
    for (const s of items) {
      const k = dateKey(new Date(s.starts_at))
      if (!map[k]) map[k] = []
      map[k].push(s)
    }
    return map
  }, [items])

  // ─── 일정 (기존) ───────────────────
  function openNew(date) {
    const start = new Date(date)
    start.setHours(9, 0, 0, 0)
    const end = new Date(start)
    end.setHours(10, 0, 0, 0)
    setEditor({
      id: null, title: '', description: '',
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      visibility: 'private',
      user_id: user.id
    })
    setError(null)
  }
  function openEdit(item) {
    setEditor({
      id: item.id, title: item.title, description: item.description ?? '',
      starts_at: item.starts_at, ends_at: item.ends_at,
      visibility: item.visibility, user_id: item.user_id
    })
    setError(null)
  }
  async function saveSchedule() {
    if (!editor.title.trim()) { setError('제목을 입력하세요.'); return }
    setSaving(true); setError(null)
    const payload = {
      title: editor.title.trim(),
      description: editor.description?.trim() || null,
      starts_at: editor.starts_at,
      ends_at: editor.ends_at || null,
      visibility: editor.visibility,
      user_id: user.id
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
    const monday = rowDays[0]
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
            {/* 요일 헤더 */}
            <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
              {WEEKDAYS_MON.map((d, i) => (
                <div
                  key={d}
                  className={`py-2 text-center ${
                    i === 5 ? 'text-blue-500' : i === 6 ? 'text-rose-500' : ''
                  }`}
                >
                  {d}
                </div>
              ))}
            </div>

            {/* 주 단위 행 (각 행 위에 주차 띠) */}
            {rows.map((rowDays, rowIdx) => {
              const monday = rowDays[0]
              const { year, week } = isoWeekOf(monday)
              const plan = weeklyPlans[`${year}-${week}`]
              const planCount = plan?.items?.length ?? 0
              const wEnd = rowDays[6]
              return (
                <div key={rowIdx}>
                  {/* 주차 띠 */}
                  <button
                    onClick={() => openWeeklyPlan(rowDays)}
                    className="w-full px-4 py-1.5 bg-slate-50/80 hover:bg-amber-50 transition border-b border-slate-100 flex items-center gap-2 text-xs text-left group"
                  >
                    <NotebookPen size={11} className="text-slate-400 group-hover:text-myriad-ink" />
                    <span className="font-semibold text-slate-700">Week {week}</span>
                    <span className="text-slate-400">{formatMD(monday)} ~ {formatMD(wEnd)}</span>
                    <div className="flex-1" />
                    {planCount > 0 ? (
                      <span className="text-myriad-ink font-semibold">📝 이번 주 계획 {planCount}개</span>
                    ) : (
                      <span className="text-slate-400">+ 이번 주 할 일 적어두기</span>
                    )}
                    <Chevron size={11} className="text-slate-300 group-hover:text-myriad-ink" />
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
                      const isWeekend = idx >= 5
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
                            } ${idx === 6 && inMonth && !isToday ? 'text-rose-500' : ''} ${
                              idx === 5 && inMonth && !isToday ? 'text-blue-500' : ''
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
                {selectedDayItems.map((it) => (
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
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        {new Date(it.starts_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                        {it.ends_at && ' ~ ' + new Date(it.ends_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                      {it.description && (
                        <div className="text-xs text-slate-600 mt-1 whitespace-pre-wrap line-clamp-2">{it.description}</div>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button
              onClick={() => openNew(selectedDate)}
              className="mt-4 w-full flex items-center justify-center gap-2 border border-dashed border-slate-300 text-slate-600 hover:text-slate-900 hover:border-myriad-primary py-2 rounded-lg text-sm transition"
            >
              <Plus size={14} /> 이 날 일정 추가
            </button>
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
        </div>
      </div>

      {/* ─── 모달들 ─── */}
      {editor && (
        <ScheduleEditor
          editor={editor} setEditor={setEditor}
          isMine={isEditorMine} saving={saving} error={error}
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

function ScheduleEditor({ editor, setEditor, isMine, saving, error, onSave, onDelete, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-200 flex items-center">
          <h2 className="font-bold text-slate-900">
            {editor.id ? (isMine ? '일정 편집' : '일정 보기') : '새 일정'}
          </h2>
          <div className="flex-1" />
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded">
            <X size={18} />
          </button>
        </div>
        <div className="p-6 space-y-4">
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1">시작 *</label>
              <input
                type="datetime-local"
                value={toInputValue(editor.starts_at)}
                onChange={(e) => setEditor({ ...editor, starts_at: new Date(e.target.value).toISOString() })}
                disabled={!isMine}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40 disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1">종료</label>
              <input
                type="datetime-local"
                value={editor.ends_at ? toInputValue(editor.ends_at) : ''}
                onChange={(e) => setEditor({ ...editor, ends_at: e.target.value ? new Date(e.target.value).toISOString() : null })}
                disabled={!isMine}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40 disabled:bg-slate-50"
              />
            </div>
          </div>
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
              다른 팀원이 등록한 팀 공개 일정입니다. 수정/삭제는 작성자만 가능합니다.
            </p>
          )}
          {error && <div className="text-xs text-rose-600">{error}</div>}
        </div>
        <div className="px-6 py-4 border-t border-slate-200 flex items-center">
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
