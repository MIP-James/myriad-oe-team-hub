import { useEffect, useMemo, useState } from 'react'
import { StickyNote, Plus, Pin, PinOff, Trash2, Search, Save, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

const EMPTY_DRAFT = { id: null, title: '', body: '', pinned: false }

export default function Memos() {
  const { user } = useAuth()
  const [memos, setMemos] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [draft, setDraft] = useState(null)
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('memos')
      .select('*')
      .order('pinned', { ascending: false })
      .order('updated_at', { ascending: false })
    if (error) setError(error.message)
    else setMemos(data ?? [])
    setLoading(false)
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return memos
    return memos.filter(
      (m) =>
        (m.title ?? '').toLowerCase().includes(q) ||
        (m.body ?? '').toLowerCase().includes(q)
    )
  }, [memos, query])

  function startNew() {
    setSelected(null)
    setDraft({ ...EMPTY_DRAFT })
  }

  function openMemo(memo) {
    setSelected(memo.id)
    setDraft({ id: memo.id, title: memo.title ?? '', body: memo.body ?? '', pinned: memo.pinned })
  }

  async function save() {
    if (!draft) return
    if (!draft.title.trim() && !draft.body.trim()) {
      setError('제목이나 내용을 입력하세요.')
      return
    }
    setSaving(true)
    setError(null)
    const payload = {
      title: draft.title.trim() || null,
      body: draft.body,
      pinned: draft.pinned,
      user_id: user.id
    }
    const { data, error } = draft.id
      ? await supabase.from('memos').update(payload).eq('id', draft.id).select().single()
      : await supabase.from('memos').insert(payload).select().single()
    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    await load()
    setSelected(data.id)
    setDraft({ id: data.id, title: data.title ?? '', body: data.body ?? '', pinned: data.pinned })
  }

  async function togglePin() {
    if (!draft) return
    if (!draft.id) {
      setDraft((d) => ({ ...d, pinned: !d.pinned }))
      return
    }
    const next = !draft.pinned
    setDraft((d) => ({ ...d, pinned: next }))
    const { error } = await supabase.from('memos').update({ pinned: next }).eq('id', draft.id)
    if (error) setError(error.message)
    await load()
  }

  async function remove() {
    if (!draft?.id) {
      setDraft(null)
      setSelected(null)
      return
    }
    if (!window.confirm('이 메모를 삭제할까요?')) return
    const { error } = await supabase.from('memos').delete().eq('id', draft.id)
    if (error) { setError(error.message); return }
    setDraft(null)
    setSelected(null)
    await load()
  }

  return (
    <div className="h-full flex">
      <aside className="w-80 border-r border-slate-200 bg-white flex flex-col">
        <div className="p-4 border-b border-slate-200 space-y-3">
          <div className="flex items-center gap-2">
            <StickyNote className="text-myriad-ink" size={20} />
            <h1 className="font-bold text-slate-900">내 메모</h1>
          </div>
          <button
            onClick={startNew}
            className="w-full flex items-center justify-center gap-2 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold py-2 rounded-lg transition"
          >
            <Plus size={16} /> 새 메모
          </button>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="검색..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40"
            />
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {loading && (
            <div className="p-6 text-center text-slate-400 text-sm flex items-center justify-center gap-2">
              <Loader2 className="animate-spin" size={14} /> 불러오는 중...
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="p-6 text-center text-slate-400 text-sm">
              {query ? '검색 결과 없음' : '아직 메모가 없습니다'}
            </div>
          )}
          <ul>
            {filtered.map((m) => (
              <li key={m.id}>
                <button
                  onClick={() => openMemo(m)}
                  className={`w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-slate-50 transition ${
                    selected === m.id ? 'bg-amber-50 hover:bg-amber-50' : ''
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {m.pinned && <Pin size={12} className="mt-1 shrink-0 text-amber-500 fill-amber-400" />}
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-slate-900 truncate">
                        {m.title || '(제목 없음)'}
                      </div>
                      <div className="text-xs text-slate-500 line-clamp-2 mt-0.5 whitespace-pre-wrap">
                        {m.body || '(내용 없음)'}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-1">
                        {new Date(m.updated_at).toLocaleString('ko-KR')}
                      </div>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <section className="flex-1 flex flex-col bg-slate-50">
        {draft === null ? (
          <div className="flex-1 flex items-center justify-center text-slate-400">
            <div className="text-center">
              <StickyNote size={48} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">왼쪽에서 메모를 선택하거나 "새 메모"를 눌러주세요.</p>
            </div>
          </div>
        ) : (
          <>
            <div className="p-4 border-b border-slate-200 bg-white flex items-center gap-2">
              <button
                onClick={togglePin}
                title={draft.pinned ? '핀 해제' : '핀 고정'}
                className={`p-2 rounded-lg hover:bg-slate-100 ${
                  draft.pinned ? 'text-amber-500' : 'text-slate-400'
                }`}
              >
                {draft.pinned ? <Pin size={18} className="fill-amber-400" /> : <PinOff size={18} />}
              </button>
              <div className="flex-1" />
              <button
                onClick={remove}
                className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                title="삭제"
              >
                <Trash2 size={18} />
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="flex items-center gap-2 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-4 py-2 rounded-lg transition disabled:opacity-50"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                저장
              </button>
            </div>
            <div className="flex-1 overflow-auto p-8">
              <div className="max-w-3xl mx-auto">
                <input
                  type="text"
                  placeholder="제목"
                  value={draft.title}
                  onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                  className="w-full text-2xl font-bold text-slate-900 bg-transparent focus:outline-none placeholder-slate-300 mb-6"
                />
                <textarea
                  placeholder="메모 내용을 입력하세요..."
                  value={draft.body}
                  onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
                  className="w-full min-h-[60vh] text-base text-slate-800 bg-transparent focus:outline-none placeholder-slate-300 resize-none leading-relaxed"
                />
              </div>
            </div>
          </>
        )}
        {error && (
          <div className="border-t border-rose-200 bg-rose-50 text-rose-700 text-xs p-3 text-center">
            {error}
          </div>
        )}
      </section>
    </div>
  )
}
