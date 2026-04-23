/**
 * 관리자 — 대시보드 외부 바로가기 CRUD.
 * (KIPRIS, 네이버 권리보호센터 등 자주 쓰는 외부 사이트 링크 관리)
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ExternalLink, Plus, X, Save, Trash2, Loader2, ChevronLeft, Eye, EyeOff,
  GripVertical
} from 'lucide-react'
import {
  listAllShortcuts, createShortcut, updateShortcut, deleteShortcut,
  COLOR_PRESETS, getColorClasses
} from '../lib/externalShortcuts'
import { useAuth } from '../contexts/AuthContext'

const EMPTY = {
  id: null,
  name: '',
  url: '',
  description: '',
  icon: '',
  color: 'sky',
  position: 0,
  is_active: true
}

function isValidUrl(s) {
  if (!s) return false
  return /^https?:\/\//i.test(s.trim())
}

export default function AdminExternalShortcuts() {
  const { user } = useAuth()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [editor, setEditor] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const list = await listAllShortcuts()
      setItems(list)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function save() {
    if (!editor.name.trim()) { setError('이름은 필수입니다.'); return }
    if (!editor.url.trim()) { setError('URL 은 필수입니다.'); return }
    if (!isValidUrl(editor.url)) { setError('URL 은 http(s):// 로 시작해야 합니다.'); return }
    setSaving(true); setError(null)
    try {
      if (editor.id) {
        await updateShortcut(editor.id, editor)
      } else {
        await createShortcut(editor, user.id)
      }
      setEditor(null)
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!editor?.id) { setEditor(null); return }
    if (!window.confirm(`"${editor.name}" 바로가기를 삭제할까요?`)) return
    try {
      await deleteShortcut(editor.id)
      setEditor(null)
      await load()
    } catch (e) {
      setError(e.message)
    }
  }

  async function toggleActive(s) {
    try {
      await updateShortcut(s.id, { ...s, is_active: !s.is_active })
      await load()
    } catch (e) {
      setError(e.message)
    }
  }

  async function shiftOrder(s, dir) {
    // dir: -1 (위로), +1 (아래로). position 값 swap
    const idx = items.findIndex((x) => x.id === s.id)
    const swapIdx = idx + dir
    if (swapIdx < 0 || swapIdx >= items.length) return
    const a = items[idx]; const b = items[swapIdx]
    try {
      await Promise.all([
        updateShortcut(a.id, { ...a, position: b.position }),
        updateShortcut(b.id, { ...b, position: a.position })
      ])
      // position 값이 같으면 created_at 으로 정렬되니까, idx 순서를 그대로 position 으로
      // 다시 정상화 (안전망)
      const reordered = [...items]
      ;[reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]]
      await Promise.all(reordered.map((x, i) =>
        x.position !== i ? updateShortcut(x.id, { ...x, position: i }) : null
      ).filter(Boolean))
      await load()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex items-center gap-2 mb-2">
        <Link to="/admin" className="text-sm text-slate-500 hover:text-myriad-ink inline-flex items-center gap-1">
          <ChevronLeft size={14} /> 관리자
        </Link>
      </div>
      <header className="mb-6 flex items-center gap-3">
        <ExternalLink className="text-myriad-ink" />
        <h1 className="text-2xl font-bold text-slate-900">외부 바로가기 관리</h1>
        <div className="flex-1" />
        <button
          onClick={() => { setEditor({ ...EMPTY, position: items.length }); setError(null) }}
          className="flex items-center gap-2 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-4 py-2 rounded-lg"
        >
          <Plus size={16} /> 새 바로가기
        </button>
      </header>

      <p className="text-sm text-slate-500 mb-4">
        대시보드 하단에 카드 형태로 노출됩니다. 자주 쓰는 외부 사이트 (예: KIPRIS, 네이버 권리보호센터) 를 등록해두세요.
      </p>

      {error && !editor && (
        <div className="mb-3 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg p-3">{error}</div>
      )}

      {loading ? (
        <div className="py-12 text-center text-sm text-slate-400 flex items-center justify-center gap-2">
          <Loader2 size={14} className="animate-spin" /> 불러오는 중...
        </div>
      ) : items.length === 0 ? (
        <div className="py-16 text-center bg-white border border-slate-200 rounded-2xl">
          <ExternalLink size={32} className="mx-auto mb-3 text-slate-300" />
          <p className="text-sm text-slate-500">등록된 바로가기가 없습니다.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((s, idx) => {
            const cc = getColorClasses(s.color)
            return (
              <li
                key={s.id}
                className={`bg-white border ${s.is_active ? 'border-slate-200' : 'border-slate-200 opacity-60'} rounded-xl p-4 flex items-center gap-3`}
              >
                {/* 순서 조정 */}
                <div className="flex flex-col">
                  <button onClick={() => shiftOrder(s, -1)} disabled={idx === 0} className="p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-30">▲</button>
                  <button onClick={() => shiftOrder(s, +1)} disabled={idx === items.length - 1} className="p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-30">▼</button>
                </div>

                <div className={`w-10 h-10 rounded-lg ${cc.icon} flex items-center justify-center text-lg shrink-0`}>
                  {s.icon || '🔗'}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900">{s.name}</span>
                    {!s.is_active && <span className="text-[10px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded">숨김</span>}
                  </div>
                  {s.description && (
                    <p className="text-xs text-slate-500 mt-0.5 truncate">{s.description}</p>
                  )}
                  <a href={s.url} target="_blank" rel="noreferrer" className="text-[11px] text-sky-600 hover:underline truncate inline-block max-w-md">
                    {s.url}
                  </a>
                </div>

                <button
                  onClick={() => toggleActive(s)}
                  title={s.is_active ? '숨기기' : '보이기'}
                  className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg"
                >
                  {s.is_active ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
                <button
                  onClick={() => { setEditor({ ...s }); setError(null) }}
                  className="text-xs text-slate-600 hover:text-myriad-ink hover:bg-slate-100 px-3 py-1.5 rounded-lg"
                >
                  편집
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {editor && (
        <ShortcutEditor
          editor={editor} setEditor={setEditor}
          onSave={save} onDelete={remove} onClose={() => setEditor(null)}
          saving={saving} error={error}
        />
      )}
    </div>
  )
}

function ShortcutEditor({ editor, setEditor, onSave, onDelete, onClose, saving, error }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <header className="px-6 py-4 border-b border-slate-200 flex items-center">
          <h2 className="font-bold text-slate-900">{editor.id ? '바로가기 편집' : '새 바로가기'}</h2>
          <div className="flex-1" />
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded"><X size={18} /></button>
        </header>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-[auto,1fr] gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1">아이콘</label>
              <input
                type="text"
                value={editor.icon ?? ''}
                onChange={(e) => setEditor({ ...editor, icon: e.target.value })}
                placeholder="🔗"
                maxLength={4}
                className="w-16 px-3 py-2 text-center text-lg border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1">이름 *</label>
              <input
                type="text"
                value={editor.name}
                onChange={(e) => setEditor({ ...editor, name: e.target.value })}
                placeholder="예: KIPRIS"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40"
                autoFocus
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-600 block mb-1">URL *</label>
            <input
              type="url"
              value={editor.url}
              onChange={(e) => setEditor({ ...editor, url: e.target.value })}
              placeholder="https://www.kipris.or.kr/..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-600 block mb-1">설명 (선택)</label>
            <input
              type="text"
              value={editor.description ?? ''}
              onChange={(e) => setEditor({ ...editor, description: e.target.value })}
              placeholder="예: 특허·실용신안·디자인·상표 검색"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-600 block mb-2">색상</label>
            <div className="flex flex-wrap gap-2">
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setEditor({ ...editor, color: c.key })}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${c.icon} ${
                    editor.color === c.key ? 'ring-2 ring-offset-1 ring-myriad-primary' : ''
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={editor.is_active}
              onChange={(e) => setEditor({ ...editor, is_active: e.target.checked })}
              className="w-4 h-4"
            />
            대시보드에 표시
          </label>

          {error && <div className="text-xs text-rose-600">{error}</div>}
        </div>
        <footer className="px-6 py-4 border-t border-slate-200 flex items-center">
          {editor.id && (
            <button onClick={onDelete} className="text-rose-600 hover:bg-rose-50 px-3 py-2 rounded-lg flex items-center gap-2 text-sm">
              <Trash2 size={14} /> 삭제
            </button>
          )}
          <div className="flex-1" />
          <button onClick={onClose} className="text-slate-600 hover:bg-slate-100 px-4 py-2 rounded-lg text-sm">취소</button>
          <button
            onClick={onSave}
            disabled={saving}
            className="ml-2 flex items-center gap-2 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-4 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            저장
          </button>
        </footer>
      </div>
    </div>
  )
}
