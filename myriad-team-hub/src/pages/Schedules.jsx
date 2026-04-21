import { useEffect, useMemo, useState } from 'react'
import {
  CalendarDays, ChevronLeft, ChevronRight, Plus, X, Trash2, Save, Loader2,
  Lock, Users as UsersIcon
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

const pad = (n) => n.toString().padStart(2, '0')

const toDateKey = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

// ISO → <input type="datetime-local"> 값 (로컬 타임존 유지)
const toInputValue = (iso) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function getMonthGrid(year, month) {
  const first = new Date(year, month, 1)
  const startOffset = first.getDay()
  const gridStart = new Date(year, month, 1 - startOffset)
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart)
    d.setDate(gridStart.getDate() + i)
    return d
  })
}

export default function Schedules() {
  const { user } = useAuth()
  const today = new Date()
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1))
  const [selectedDay, setSelectedDay] = useState(toDateKey(today))
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [editor, setEditor] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const grid = useMemo(
    () => getMonthGrid(cursor.getFullYear(), cursor.getMonth()),
    [cursor]
  )

  useEffect(() => {
    load()
  }, [cursor])

  async function load() {
    setLoading(true)
    const rangeStart = grid[0]
    const rangeEnd = new Date(grid[41])
    rangeEnd.setDate(rangeEnd.getDate() + 1)
    const { data, error } = await supabase
      .from('schedules')
      .select('*')
      .gte('starts_at', rangeStart.toISOString())
      .lt('starts_at', rangeEnd.toISOString())
      .order('starts_at', { ascending: true })
    if (error) setError(error.message)
    else setItems(data ?? [])
    setLoading(false)
  }

  const itemsByDay = useMemo(() => {
    const map = {}
    for (const s of items) {
      const key = toDateKey(new Date(s.starts_at))
      if (!map[key]) map[key] = []
      map[key].push(s)
    }
    return map
  }, [items])

  function openNew(date) {
    const start = new Date(date)
    start.setHours(9, 0, 0, 0)
    const end = new Date(start)
    end.setHours(10, 0, 0, 0)
    setEditor({
      id: null,
      title: '',
      description: '',
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      visibility: 'private',
      user_id: user.id
    })
    setError(null)
  }

  function openEdit(item) {
    setEditor({
      id: item.id,
      title: item.title,
      description: item.description ?? '',
      starts_at: item.starts_at,
      ends_at: item.ends_at,
      visibility: item.visibility,
      user_id: item.user_id
    })
    setError(null)
  }

  async function save() {
    if (!editor.title.trim()) {
      setError('제목을 입력하세요.')
      return
    }
    setSaving(true)
    setError(null)
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
    if (error) {
      setError(error.message)
      return
    }
    setEditor(null)
    await load()
  }

  async function remove() {
    if (!editor?.id) {
      setEditor(null)
      return
    }
    if (!window.confirm('이 일정을 삭제할까요?')) return
    const { error } = await supabase.from('schedules').delete().eq('id', editor.id)
    if (error) { setError(error.message); return }
    setEditor(null)
    await load()
  }

  const selectedDayItems = itemsByDay[selectedDay] ?? []
  const isEditorMine = !editor?.id || editor?.user_id === user?.id

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <header className="mb-6 flex items-center gap-3">
        <CalendarDays className="text-myriad-ink" />
        <h1 className="text-2xl font-bold text-slate-900">일정</h1>
        <div className="flex-1" />
        <button
          onClick={() => openNew(new Date(selectedDay))}
          className="flex items-center gap-2 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-4 py-2 rounded-lg transition"
        >
          <Plus size={16} /> 새 일정
        </button>
      </header>

      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          className="p-2 rounded-lg hover:bg-slate-200"
          aria-label="이전 달"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="text-xl font-bold text-slate-900 mx-2 min-w-[8rem] text-center">
          {cursor.getFullYear()}년 {cursor.getMonth() + 1}월
        </div>
        <button
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
          className="p-2 rounded-lg hover:bg-slate-200"
          aria-label="다음 달"
        >
          <ChevronRight size={18} />
        </button>
        <button
          onClick={() => {
            setCursor(new Date(today.getFullYear(), today.getMonth(), 1))
            setSelectedDay(toDateKey(today))
          }}
          className="ml-2 text-sm text-slate-500 hover:text-slate-900 px-3 py-1.5 rounded-lg hover:bg-slate-100"
        >
          오늘
        </button>
        {loading && <Loader2 className="animate-spin text-slate-400 ml-2" size={16} />}
      </div>

      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-12 lg:col-span-8">
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
              {WEEKDAYS.map((d, i) => (
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
            <div className="grid grid-cols-7">
              {grid.map((d, idx) => {
                const key = toDateKey(d)
                const inMonth = d.getMonth() === cursor.getMonth()
                const isToday = key === toDateKey(today)
                const isSelected = key === selectedDay
                const dayItems = itemsByDay[key] ?? []
                return (
                  <button
                    key={idx}
                    onClick={() => setSelectedDay(key)}
                    onDoubleClick={() => openNew(d)}
                    className={`relative h-24 p-1.5 border-b border-r border-slate-100 text-left transition ${
                      isSelected
                        ? 'bg-amber-50 hover:bg-amber-100'
                        : 'hover:bg-slate-50'
                    } ${!inMonth ? 'text-slate-300 bg-slate-50/50' : ''}`}
                  >
                    <div
                      className={`text-xs font-semibold inline-flex items-center justify-center w-5 h-5 ${
                        isToday ? 'rounded-full bg-myriad-primary text-myriad-ink' : ''
                      } ${d.getDay() === 0 && inMonth && !isToday ? 'text-rose-500' : ''} ${
                        d.getDay() === 6 && inMonth && !isToday ? 'text-blue-500' : ''
                      }`}
                    >
                      {d.getDate()}
                    </div>
                    <div className="mt-1 space-y-0.5">
                      {dayItems.slice(0, 3).map((it) => (
                        <div
                          key={it.id}
                          onClick={(e) => {
                            e.stopPropagation()
                            openEdit(it)
                          }}
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
                      {dayItems.length > 3 && (
                        <div className="text-[10px] text-slate-400">
                          +{dayItems.length - 3}
                        </div>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
          <p className="text-xs text-slate-400 mt-2">
            💡 날짜 더블클릭: 해당 날짜에 새 일정 · 일정 클릭: 편집 · 🟠 개인 · 🔵 팀 공개
          </p>
        </div>

        <div className="col-span-12 lg:col-span-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-5 sticky top-4">
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
                        {it.visibility === 'team' ? (
                          <UsersIcon size={14} className="text-sky-500 shrink-0" />
                        ) : (
                          <Lock size={14} className="text-amber-500 shrink-0" />
                        )}
                        <span className="font-semibold text-slate-900 truncate">
                          {it.title}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        {new Date(it.starts_at).toLocaleTimeString('ko-KR', {
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                        {it.ends_at &&
                          ' ~ ' +
                            new Date(it.ends_at).toLocaleTimeString('ko-KR', {
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                      </div>
                      {it.description && (
                        <div className="text-xs text-slate-600 mt-1 whitespace-pre-wrap line-clamp-2">
                          {it.description}
                        </div>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button
              onClick={() => openNew(new Date(selectedDay))}
              className="mt-4 w-full flex items-center justify-center gap-2 border border-dashed border-slate-300 text-slate-600 hover:text-slate-900 hover:border-myriad-primary py-2 rounded-lg text-sm transition"
            >
              <Plus size={14} /> 이 날 일정 추가
            </button>
          </div>
        </div>
      </div>

      {editor && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => setEditor(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-slate-200 flex items-center">
              <h2 className="font-bold text-slate-900">
                {editor.id ? (isEditorMine ? '일정 편집' : '일정 보기') : '새 일정'}
              </h2>
              <div className="flex-1" />
              <button
                onClick={() => setEditor(null)}
                className="p-1 hover:bg-slate-100 rounded"
                aria-label="닫기"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1">
                  제목 *
                </label>
                <input
                  type="text"
                  value={editor.title}
                  onChange={(e) => setEditor({ ...editor, title: e.target.value })}
                  placeholder="일정 제목"
                  disabled={!isEditorMine}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40 disabled:bg-slate-50 disabled:text-slate-500"
                  autoFocus={isEditorMine}
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1">
                  내용
                </label>
                <textarea
                  value={editor.description}
                  onChange={(e) =>
                    setEditor({ ...editor, description: e.target.value })
                  }
                  rows={3}
                  disabled={!isEditorMine}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40 resize-none disabled:bg-slate-50 disabled:text-slate-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-600 block mb-1">
                    시작 *
                  </label>
                  <input
                    type="datetime-local"
                    value={toInputValue(editor.starts_at)}
                    onChange={(e) =>
                      setEditor({
                        ...editor,
                        starts_at: new Date(e.target.value).toISOString()
                      })
                    }
                    disabled={!isEditorMine}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40 disabled:bg-slate-50"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600 block mb-1">
                    종료
                  </label>
                  <input
                    type="datetime-local"
                    value={editor.ends_at ? toInputValue(editor.ends_at) : ''}
                    onChange={(e) =>
                      setEditor({
                        ...editor,
                        ends_at: e.target.value
                          ? new Date(e.target.value).toISOString()
                          : null
                      })
                    }
                    disabled={!isEditorMine}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40 disabled:bg-slate-50"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-2">
                  공개 범위
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={() =>
                      isEditorMine && setEditor({ ...editor, visibility: 'private' })
                    }
                    disabled={!isEditorMine}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border transition ${
                      editor.visibility === 'private'
                        ? 'border-amber-500 bg-amber-50 text-amber-900 font-semibold'
                        : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                    } disabled:opacity-60 disabled:cursor-not-allowed`}
                  >
                    <Lock size={14} /> 나만 보기
                  </button>
                  <button
                    onClick={() =>
                      isEditorMine && setEditor({ ...editor, visibility: 'team' })
                    }
                    disabled={!isEditorMine}
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
              {!isEditorMine && (
                <p className="text-xs text-slate-500 bg-slate-50 rounded-lg p-3">
                  다른 팀원이 등록한 팀 공개 일정입니다. 수정/삭제는 작성자만 가능합니다.
                </p>
              )}
              {error && <div className="text-xs text-rose-600">{error}</div>}
            </div>
            <div className="px-6 py-4 border-t border-slate-200 flex items-center">
              {editor.id && isEditorMine && (
                <button
                  onClick={remove}
                  className="text-rose-600 hover:bg-rose-50 px-3 py-2 rounded-lg flex items-center gap-2 text-sm"
                >
                  <Trash2 size={14} /> 삭제
                </button>
              )}
              <div className="flex-1" />
              <button
                onClick={() => setEditor(null)}
                className="text-slate-600 hover:bg-slate-100 px-4 py-2 rounded-lg"
              >
                {isEditorMine ? '취소' : '닫기'}
              </button>
              {isEditorMine && (
                <button
                  onClick={save}
                  disabled={saving}
                  className="ml-2 flex items-center gap-2 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
                >
                  {saving ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Save size={14} />
                  )}
                  저장
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
