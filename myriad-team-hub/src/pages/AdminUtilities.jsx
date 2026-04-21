import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Wrench, Plus, X, Save, Trash2, Loader2, ChevronLeft, Eye, EyeOff
} from 'lucide-react'
import { supabase } from '../lib/supabase'

const EMPTY = {
  id: null,
  slug: '',
  name: '',
  icon: '🧰',
  description: '',
  category: '',
  download_url: '',
  entry_exe: '',
  current_version: '',
  release_notes: '',
  install_guide: '',
  is_active: true,
  sort_order: 0
}

export default function AdminUtilities() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [editor, setEditor] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('utilities')
      .select('*')
      .order('sort_order', { ascending: true })
    if (error) setError(error.message)
    else setItems(data ?? [])
    setLoading(false)
  }

  async function save() {
    if (!editor.slug.trim() || !editor.name.trim()) {
      setError('slug와 이름은 필수입니다.')
      return
    }
    setSaving(true)
    setError(null)
    const payload = {
      slug: editor.slug.trim(),
      name: editor.name.trim(),
      icon: editor.icon || null,
      description: editor.description?.trim() || null,
      category: editor.category?.trim() || null,
      download_url: editor.download_url?.trim() || null,
      entry_exe: editor.entry_exe?.trim() || null,
      current_version: editor.current_version?.trim() || null,
      release_notes: editor.release_notes || null,
      install_guide: editor.install_guide || null,
      is_active: editor.is_active,
      sort_order: Number(editor.sort_order) || 0
    }
    const { error } = editor.id
      ? await supabase.from('utilities').update(payload).eq('id', editor.id)
      : await supabase.from('utilities').insert(payload)
    setSaving(false)
    if (error) { setError(error.message); return }
    setEditor(null)
    await load()
  }

  async function remove() {
    if (!editor?.id) { setEditor(null); return }
    if (!window.confirm(`"${editor.name}" 유틸을 삭제할까요? (복구 불가)`)) return
    const { error } = await supabase.from('utilities').delete().eq('id', editor.id)
    if (error) { setError(error.message); return }
    setEditor(null)
    await load()
  }

  async function toggleActive(u) {
    const { error } = await supabase
      .from('utilities')
      .update({ is_active: !u.is_active })
      .eq('id', u.id)
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
          <Wrench className="text-myriad-ink" />
          <h1 className="text-2xl font-bold text-slate-900">유틸리티 관리</h1>
          <div className="flex-1" />
          <button
            onClick={() => { setEditor({ ...EMPTY }); setError(null) }}
            className="flex items-center gap-2 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-4 py-2 rounded-lg"
          >
            <Plus size={16} /> 새 유틸
          </button>
        </div>
      </div>

      {error && !editor && (
        <div className="mb-4 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg p-3">
          {error}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="py-12 text-center text-sm text-slate-400 flex items-center justify-center gap-2">
            <Loader2 size={14} className="animate-spin" /> 불러오는 중...
          </div>
        ) : items.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-400">
            등록된 유틸이 없습니다. 우측 상단 "새 유틸" 로 추가하세요.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600 uppercase">
              <tr>
                <th className="text-left px-4 py-3">이름</th>
                <th className="text-left px-4 py-3">분류</th>
                <th className="text-left px-4 py-3">버전</th>
                <th className="text-left px-4 py-3">다운로드</th>
                <th className="text-left px-4 py-3">순서</th>
                <th className="text-left px-4 py-3">상태</th>
                <th className="w-20"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((u) => (
                <tr key={u.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{u.icon || '🧰'}</span>
                      <div>
                        <div className="font-semibold text-slate-900">{u.name}</div>
                        <div className="text-[11px] text-slate-400">{u.slug}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{u.category || '-'}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {u.current_version ? `v${u.current_version}` : '-'}
                  </td>
                  <td className="px-4 py-3">
                    {u.download_url ? (
                      <span className="text-xs text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">있음</span>
                    ) : (
                      <span className="text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded">없음</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{u.sort_order}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleActive(u)}
                      className={`text-xs px-2 py-1 rounded flex items-center gap-1 ${
                        u.is_active
                          ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                      }`}
                    >
                      {u.is_active ? <Eye size={12} /> : <EyeOff size={12} />}
                      {u.is_active ? '공개' : '비공개'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => { setEditor({ ...u }); setError(null) }}
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
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-200 flex items-center">
          <h2 className="font-bold text-slate-900">
            {editor.id ? '유틸 편집' : '새 유틸 등록'}
          </h2>
          <div className="flex-1" />
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 overflow-auto flex-1 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Field label="아이콘 (이모지)">
              <input
                type="text"
                value={editor.icon}
                onChange={(e) => setEditor({ ...editor, icon: e.target.value })}
                placeholder="🧰"
                className="w-full text-2xl text-center px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40"
                maxLength={4}
              />
            </Field>
            <Field label="Slug (고유 ID, 영문소문자) *" span={2}>
              <input
                type="text"
                value={editor.slug}
                onChange={(e) => setEditor({ ...editor, slug: e.target.value })}
                placeholder="예: report-generator"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40 font-mono text-sm"
              />
            </Field>
          </div>

          <Field label="이름 *">
            <input
              type="text"
              value={editor.name}
              onChange={(e) => setEditor({ ...editor, name: e.target.value })}
              placeholder="Report Generator"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40"
            />
          </Field>

          <Field label="짧은 설명">
            <input
              type="text"
              value={editor.description}
              onChange={(e) => setEditor({ ...editor, description: e.target.value })}
              placeholder="한 줄 설명"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40"
            />
          </Field>

          <div className="grid grid-cols-3 gap-3">
            <Field label="분류 (category)">
              <input
                type="text"
                value={editor.category}
                onChange={(e) => setEditor({ ...editor, category: e.target.value })}
                placeholder="automation"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40"
              />
            </Field>
            <Field label="버전">
              <input
                type="text"
                value={editor.current_version}
                onChange={(e) => setEditor({ ...editor, current_version: e.target.value })}
                placeholder="1.0.0"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40 font-mono text-sm"
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

          <Field label="다운로드 URL (ZIP 권장)">
            <input
              type="url"
              value={editor.download_url}
              onChange={(e) => setEditor({ ...editor, download_url: e.target.value })}
              placeholder="https://github.com/.../releases/download/v1.0/tool.zip"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40 font-mono text-sm"
            />
          </Field>

          <Field label="ZIP 내부 실행 파일 경로 (entry_exe)">
            <input
              type="text"
              value={editor.entry_exe}
              onChange={(e) => setEditor({ ...editor, entry_exe: e.target.value })}
              placeholder="예: Report_Generator/Report_Generator.exe"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40 font-mono text-sm"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              ZIP 을 해제한 뒤 실행할 EXE 의 상대 경로. 단일 EXE 를 올린 경우 비워두면 됨.
            </p>
          </Field>

          <Field label="이번 버전 변경사항 (release notes)">
            <textarea
              value={editor.release_notes}
              onChange={(e) => setEditor({ ...editor, release_notes: e.target.value })}
              rows={3}
              placeholder="- 어떤 기능이 추가됐는지&#10;- 어떤 버그가 수정됐는지"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40 resize-none text-sm"
            />
          </Field>

          <Field label="설치 · 사용 가이드">
            <textarea
              value={editor.install_guide}
              onChange={(e) => setEditor({ ...editor, install_guide: e.target.value })}
              rows={6}
              placeholder="팀원이 따라할 수 있는 설치/사용 순서"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40 resize-none text-sm"
            />
          </Field>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is_active"
              checked={editor.is_active}
              onChange={(e) => setEditor({ ...editor, is_active: e.target.checked })}
              className="w-4 h-4"
            />
            <label htmlFor="is_active" className="text-sm text-slate-700">
              팀원에게 공개 (체크 해제 시 카탈로그에서 숨김)
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
