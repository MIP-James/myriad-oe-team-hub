import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  FileSpreadsheet, Plus, X, Save, Trash2, Loader2, ChevronLeft, Eye, EyeOff,
  ExternalLink
} from 'lucide-react'
import { supabase } from '../lib/supabase'

const EMPTY = {
  id: null,
  title: '',
  description: '',
  icon: '📊',
  google_url: '',
  category: '',
  is_active: true,
  sort_order: 0
}

function isValidSheetUrl(url) {
  if (!url) return false
  return /^https?:\/\/docs\.google\.com\/spreadsheets\/d\//i.test(url.trim())
}

export default function AdminSharedSheets() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [editor, setEditor] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('shared_sheets')
      .select('*')
      .order('sort_order', { ascending: true })
    if (error) setError(error.message)
    else setItems(data ?? [])
    setLoading(false)
  }

  async function save() {
    if (!editor.title.trim()) {
      setError('제목은 필수입니다.')
      return
    }
    if (!editor.google_url.trim()) {
      setError('Google 시트 URL 은 필수입니다.')
      return
    }
    if (!isValidSheetUrl(editor.google_url)) {
      setError('Google Sheets URL 형식이 아닙니다. (docs.google.com/spreadsheets/d/... 형태)')
      return
    }
    setSaving(true)
    setError(null)
    const payload = {
      title: editor.title.trim(),
      description: editor.description?.trim() || null,
      icon: editor.icon || null,
      google_url: editor.google_url.trim(),
      category: editor.category?.trim() || null,
      is_active: editor.is_active,
      sort_order: Number(editor.sort_order) || 0
    }
    const { error } = editor.id
      ? await supabase.from('shared_sheets').update(payload).eq('id', editor.id)
      : await supabase.from('shared_sheets').insert(payload)
    setSaving(false)
    if (error) { setError(error.message); return }
    setEditor(null)
    await load()
  }

  async function remove() {
    if (!editor?.id) { setEditor(null); return }
    if (!window.confirm(`"${editor.title}" 시트 등록을 삭제할까요?`)) return
    const { error } = await supabase.from('shared_sheets').delete().eq('id', editor.id)
    if (error) { setError(error.message); return }
    setEditor(null)
    await load()
  }

  async function toggleActive(s) {
    const { error } = await supabase
      .from('shared_sheets')
      .update({ is_active: !s.is_active })
      .eq('id', s.id)
    if (error) { setError(error.message); return }
    await load()
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-6">
        <Link
          to="/admin"
          className="text-xs text-slate-500 hover:text-slate-900 flex items-center gap-1 mb-2"
        >
          <ChevronLeft size={14} /> 관리자 홈
        </Link>
        <div className="flex items-center gap-3">
          <FileSpreadsheet className="text-myriad-ink" />
          <h1 className="text-2xl font-bold text-slate-900">공용 시트 관리</h1>
          <div className="flex-1" />
          <button
            onClick={() => { setEditor({ ...EMPTY }); setError(null) }}
            className="flex items-center gap-2 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-4 py-2 rounded-lg"
          >
            <Plus size={16} /> 새 시트 등록
          </button>
        </div>
      </div>

      {error && !editor && (
        <div className="mb-4 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg p-3">
          {error}
        </div>
      )}

      <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg p-3 mb-4">
        💡 <b>시트 공유 설정 체크</b>: 등록할 시트는 팀원이 접근 가능하도록 Google 에서 미리 공유돼 있어야 합니다.
        (공유 → Myriad 도메인 전체 또는 개별 팀원 이메일 추가)
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="py-12 text-center text-sm text-slate-400 flex items-center justify-center gap-2">
            <Loader2 size={14} className="animate-spin" /> 불러오는 중...
          </div>
        ) : items.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-400">
            등록된 시트가 없습니다. 우측 상단 "새 시트 등록" 버튼으로 추가하세요.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600 uppercase">
              <tr>
                <th className="text-left px-4 py-3">제목</th>
                <th className="text-left px-4 py-3">분류</th>
                <th className="text-left px-4 py-3">URL</th>
                <th className="text-left px-4 py-3">순서</th>
                <th className="text-left px-4 py-3">상태</th>
                <th className="w-20"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{s.icon || '📊'}</span>
                      <div>
                        <div className="font-semibold text-slate-900">{s.title}</div>
                        {s.description && (
                          <div className="text-[11px] text-slate-500 max-w-md truncate">
                            {s.description}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{s.category || '-'}</td>
                  <td className="px-4 py-3">
                    <a
                      href={s.google_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-slate-500 hover:text-myriad-ink inline-flex items-center gap-1"
                    >
                      <ExternalLink size={10} /> 열기
                    </a>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{s.sort_order}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleActive(s)}
                      className={`text-xs px-2 py-1 rounded flex items-center gap-1 ${
                        s.is_active
                          ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                      }`}
                    >
                      {s.is_active ? <Eye size={12} /> : <EyeOff size={12} />}
                      {s.is_active ? '공개' : '비공개'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => { setEditor({ ...s }); setError(null) }}
                      className="text-xs text-myriad-ink font-semibold hover:underline"
                    >
                      편집
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editor && (
        <Editor
          editor={editor}
          setEditor={setEditor}
          onSave={save}
          onClose={() => setEditor(null)}
          onDelete={remove}
          saving={saving}
          error={error}
        />
      )}
    </div>
  )
}

function Editor({ editor, setEditor, onSave, onClose, onDelete, saving, error }) {
  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-200 flex items-center">
          <h2 className="font-bold text-slate-900">
            {editor.id ? '시트 편집' : '새 시트 등록'}
          </h2>
          <div className="flex-1" />
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 overflow-auto flex-1 space-y-4">
          <div className="grid grid-cols-4 gap-3">
            <Field label="아이콘" span={1}>
              <input
                type="text"
                value={editor.icon}
                onChange={(e) => setEditor({ ...editor, icon: e.target.value })}
                placeholder="📊"
                className="w-full text-2xl text-center px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40"
                maxLength={4}
              />
            </Field>
            <Field label="제목 *" span={3}>
              <input
                type="text"
                value={editor.title}
                onChange={(e) => setEditor({ ...editor, title: e.target.value })}
                placeholder="예: 브랜드A 침해 이력 2026"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40"
                autoFocus
              />
            </Field>
          </div>

          <Field label="Google 시트 URL *">
            <input
              type="url"
              value={editor.google_url}
              onChange={(e) => setEditor({ ...editor, google_url: e.target.value })}
              placeholder="https://docs.google.com/spreadsheets/d/.../edit"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40 font-mono text-xs"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Google Sheets 주소창의 URL 을 그대로 복사해서 붙여넣기.
              팀원에게 "공유" 설정으로 접근 권한 부여된 시트여야 합니다.
            </p>
          </Field>

          <Field label="설명">
            <textarea
              value={editor.description}
              onChange={(e) => setEditor({ ...editor, description: e.target.value })}
              rows={2}
              placeholder="어떤 목적의 시트인지 한 줄 설명"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40 resize-none text-sm"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="분류 (category)">
              <input
                type="text"
                value={editor.category}
                onChange={(e) => setEditor({ ...editor, category: e.target.value })}
                placeholder="예: 브랜드, 마스터, 이력"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40"
              />
            </Field>
            <Field label="정렬 순서">
              <input
                type="number"
                value={editor.sort_order}
                onChange={(e) => setEditor({ ...editor, sort_order: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40"
              />
            </Field>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="ss_is_active"
              checked={editor.is_active}
              onChange={(e) => setEditor({ ...editor, is_active: e.target.checked })}
              className="w-4 h-4"
            />
            <label htmlFor="ss_is_active" className="text-sm text-slate-700">
              팀원에게 공개 (체크 해제 시 /sheets 목록에서 숨김)
            </label>
          </div>

          {error && <div className="text-xs text-rose-600 bg-rose-50 p-2 rounded">{error}</div>}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex items-center">
          {editor.id && (
            <button
              onClick={onDelete}
              className="text-rose-600 hover:bg-rose-50 px-3 py-2 rounded-lg flex items-center gap-2 text-sm"
            >
              <Trash2 size={14} /> 삭제
            </button>
          )}
          <div className="flex-1" />
          <button onClick={onClose} className="text-slate-600 hover:bg-slate-100 px-4 py-2 rounded-lg">
            취소
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="ml-2 flex items-center gap-2 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            저장
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children, span = 1 }) {
  return (
    <div style={{ gridColumn: `span ${span} / span ${span}` }}>
      <label className="text-xs font-semibold text-slate-600 block mb-1">{label}</label>
      {children}
    </div>
  )
}
