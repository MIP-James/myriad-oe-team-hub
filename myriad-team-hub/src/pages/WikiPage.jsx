import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  BookOpen, ArrowLeft, Edit3, Eye, Columns, Save, Trash2, Loader2, Pin,
  Tag as TagIcon, Clock, X, Folder
} from 'lucide-react'
import {
  getWikiPage, createWikiPage, updateWikiPage, deleteWikiPage,
  DEFAULT_CATEGORIES, CATEGORY_TEMPLATES
} from '../lib/wiki'
import { getProfileShort } from '../lib/community'
import { useAuth } from '../contexts/AuthContext'

const EMPTY_DRAFT = {
  title: '',
  body: '',
  category: '브랜드',
  tags: [],
  pinned: false,
  icon: ''
}

export default function WikiPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, isAdmin } = useAuth()

  const isNew = id === 'new'
  const [page, setPage] = useState(null)           // 저장된 원본 (view 모드용)
  const [draft, setDraft] = useState(null)         // 편집 중 상태
  const [mode, setMode] = useState(isNew ? 'edit' : 'view')  // 'view' | 'edit' | 'split'
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState(null)
  const [createdProfile, setCreatedProfile] = useState(null)
  const [updatedProfile, setUpdatedProfile] = useState(null)

  useEffect(() => {
    if (isNew) {
      setDraft({ ...EMPTY_DRAFT, body: CATEGORY_TEMPLATES['브랜드'] })
      setPage(null)
      return
    }
    load()
  }, [id])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const data = await getWikiPage(id)
      if (!data) {
        setError('페이지를 찾을 수 없습니다.')
        setLoading(false)
        return
      }
      setPage(data)
      setDraft({
        title: data.title,
        body: data.body,
        category: data.category ?? '',
        tags: data.tags ?? [],
        pinned: data.pinned,
        icon: data.icon ?? ''
      })
      // 프로필 병렬 로드
      const [cp, up] = await Promise.all([
        data.created_by ? getProfileShort(data.created_by) : Promise.resolve(null),
        data.updated_by ? getProfileShort(data.updated_by) : Promise.resolve(null)
      ])
      setCreatedProfile(cp)
      setUpdatedProfile(up)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function save() {
    if (!draft.title.trim()) {
      setError('제목을 입력하세요.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (isNew) {
        const created = await createWikiPage(draft, user.id)
        navigate(`/wiki/${created.id}`, { replace: true })
      } else {
        const updated = await updateWikiPage(id, draft, user.id)
        setPage(updated)
        setMode('view')
        const up = await getProfileShort(updated.updated_by)
        setUpdatedProfile(up)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!window.confirm('이 페이지를 삭제할까요? 복구할 수 없습니다.')) return
    setDeleting(true)
    try {
      await deleteWikiPage(id)
      navigate('/wiki')
    } catch (e) {
      setError(e.message)
      setDeleting(false)
    }
  }

  function cancelEdit() {
    if (isNew) {
      navigate('/wiki')
      return
    }
    // draft 복원
    setDraft({
      title: page.title,
      body: page.body,
      category: page.category ?? '',
      tags: page.tags ?? [],
      pinned: page.pinned,
      icon: page.icon ?? ''
    })
    setMode('view')
    setError(null)
  }

  if (loading) {
    return (
      <div className="p-8 max-w-5xl mx-auto py-20 text-center text-sm text-slate-400 flex items-center justify-center gap-2">
        <Loader2 size={14} className="animate-spin" /> 불러오는 중...
      </div>
    )
  }

  if (!draft) return null

  return (
    <div className="h-full flex flex-col">
      {/* 헤더 (sticky) */}
      <div className="border-b border-slate-200 bg-white sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-8 py-3 flex items-center gap-2">
          <Link
            to="/wiki"
            className="flex items-center gap-1 text-sm text-slate-500 hover:text-myriad-ink"
          >
            <ArrowLeft size={14} /> 위키 목록
          </Link>
          <div className="flex-1" />

          {mode === 'view' ? (
            <button
              onClick={() => setMode('split')}
              className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm px-3 py-1.5 rounded-lg font-semibold"
            >
              <Edit3 size={13} /> 편집
            </button>
          ) : (
            <>
              <ModeTab active={mode === 'edit'} onClick={() => setMode('edit')}>
                <Edit3 size={12} /> 편집
              </ModeTab>
              <ModeTab active={mode === 'split'} onClick={() => setMode('split')}>
                <Columns size={12} /> 나란히
              </ModeTab>
              <ModeTab active={mode === 'preview'} onClick={() => setMode('preview')}>
                <Eye size={12} /> 미리보기
              </ModeTab>
              <div className="w-2" />
              <button
                onClick={cancelEdit}
                className="text-sm text-slate-500 hover:text-slate-800 px-3 py-1.5"
              >
                취소
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="flex items-center gap-1.5 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold text-sm px-4 py-1.5 rounded-lg disabled:opacity-50"
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                저장
              </button>
            </>
          )}

          {mode === 'view' && !isNew && isAdmin && (
            <button
              onClick={remove}
              disabled={deleting}
              title="삭제 (관리자)"
              className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg disabled:opacity-50"
            >
              {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            </button>
          )}
        </div>
      </div>

      {/* 본문 영역 */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-6xl mx-auto px-8 py-6">
          {error && (
            <div className="mb-4 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg p-3">
              {error}
            </div>
          )}

          {mode === 'view' ? (
            <ViewPanel
              page={page}
              createdProfile={createdProfile}
              updatedProfile={updatedProfile}
            />
          ) : (
            <EditPanel
              draft={draft}
              setDraft={setDraft}
              mode={mode}
              isNew={isNew}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function ModeTab({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
        active
          ? 'bg-myriad-primary/30 text-myriad-ink'
          : 'text-slate-500 hover:bg-slate-100'
      }`}
    >
      {children}
    </button>
  )
}

// ─────────────────────────────────────────────────────
// View 모드
// ─────────────────────────────────────────────────────

function ViewPanel({ page, createdProfile, updatedProfile }) {
  if (!page) return null
  const createdName = createdProfile?.full_name || createdProfile?.email?.split('@')[0]
  const updatedName = updatedProfile?.full_name || updatedProfile?.email?.split('@')[0]

  return (
    <article className="bg-white border border-slate-200 rounded-2xl p-8">
      {/* 제목 + 메타 */}
      <header className="mb-6 pb-6 border-b border-slate-100">
        <div className="flex items-center gap-2 flex-wrap mb-3">
          {page.category && (
            <span className="text-[11px] font-semibold bg-myriad-primary/20 text-myriad-ink px-2 py-0.5 rounded-full flex items-center gap-1">
              <Folder size={10} /> {page.category}
            </span>
          )}
          {page.pinned && (
            <span className="text-[11px] font-semibold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full flex items-center gap-1">
              <Pin size={10} className="fill-amber-400" /> 고정됨
            </span>
          )}
          {(page.tags ?? []).map((t) => (
            <span
              key={t}
              className="text-[11px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full flex items-center gap-1"
            >
              <TagIcon size={9} /> {t}
            </span>
          ))}
        </div>
        <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-2">
          {page.icon && <span>{page.icon}</span>}
          {page.title}
        </h1>
        <div className="text-xs text-slate-500 mt-3 flex items-center gap-3 flex-wrap">
          <span className="flex items-center gap-1">
            <Clock size={11} /> 최근 수정 {new Date(page.updated_at).toLocaleString('ko-KR')}
            {updatedName && <span className="text-slate-400">· {updatedName}</span>}
          </span>
          {createdName && createdProfile?.id !== updatedProfile?.id && (
            <span className="text-slate-400">
              작성 {createdName} · {new Date(page.created_at).toLocaleDateString('ko-KR')}
            </span>
          )}
        </div>
      </header>

      {/* 본문 */}
      {page.body.trim() ? (
        <div className="wiki-prose">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {page.body}
          </ReactMarkdown>
        </div>
      ) : (
        <p className="text-sm text-slate-400 italic">내용이 없습니다. "편집"을 눌러 작성해주세요.</p>
      )}
    </article>
  )
}

// ─────────────────────────────────────────────────────
// Edit 모드
// ─────────────────────────────────────────────────────

function EditPanel({ draft, setDraft, mode, isNew }) {
  const categoriesSet = useMemo(() => {
    const s = new Set(DEFAULT_CATEGORIES)
    if (draft.category) s.add(draft.category)
    return [...s]
  }, [draft.category])

  function applyTemplate(cat) {
    setDraft((d) => {
      const next = { ...d, category: cat }
      // 본문이 비어있거나 기존 카테고리 템플릿과 동일하면 새 템플릿 주입
      const prevTpl = CATEGORY_TEMPLATES[d.category] ?? ''
      const newTpl = CATEGORY_TEMPLATES[cat] ?? ''
      if (!d.body.trim() || d.body === prevTpl) {
        next.body = newTpl
      }
      return next
    })
  }

  function addTag(raw) {
    const t = raw.trim().replace(/^#/, '')
    if (!t) return
    if (draft.tags.includes(t)) return
    setDraft((d) => ({ ...d, tags: [...d.tags, t] }))
  }

  function removeTag(t) {
    setDraft((d) => ({ ...d, tags: d.tags.filter((x) => x !== t) }))
  }

  return (
    <div className="space-y-4">
      {/* 메타 입력 */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-[auto,1fr] gap-3">
          <input
            type="text"
            value={draft.icon}
            onChange={(e) => setDraft({ ...draft, icon: e.target.value })}
            placeholder="🔖"
            maxLength={4}
            className="w-16 px-2 py-2 text-center text-lg border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40"
            title="아이콘 이모지 (선택)"
          />
          <input
            type="text"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="페이지 제목 *"
            autoFocus={isNew}
            className="w-full px-3 py-2 text-lg font-bold border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40"
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-slate-500">카테고리:</span>
          {categoriesSet.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => applyTemplate(c)}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition ${
                draft.category === c
                  ? 'bg-myriad-ink text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {c}
            </button>
          ))}
          <input
            type="text"
            placeholder="+ 직접 입력"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                const v = e.currentTarget.value.trim()
                if (v) {
                  applyTemplate(v)
                  e.currentTarget.value = ''
                }
              }
            }}
            className="px-2 py-1 text-xs border border-slate-200 rounded-full w-24 focus:outline-none focus:ring-2 focus:ring-myriad-primary/40"
          />
        </div>

        <TagEditor tags={draft.tags} onAdd={addTag} onRemove={removeTag} />

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={draft.pinned}
            onChange={(e) => setDraft({ ...draft, pinned: e.target.checked })}
            className="w-4 h-4"
          />
          <Pin size={12} className="text-amber-500" /> 상단 고정
        </label>
      </div>

      {/* 편집/미리보기 */}
      <div
        className={`grid gap-4 ${
          mode === 'split' ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'
        }`}
      >
        {(mode === 'edit' || mode === 'split') && (
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="px-4 py-2 border-b border-slate-100 bg-slate-50 text-xs font-semibold text-slate-500 flex items-center gap-1.5">
              <Edit3 size={11} /> 마크다운
            </div>
            <textarea
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              placeholder="# 제목\n\n## 소제목\n\n- 항목\n- **굵게** / *기울임*\n- [링크](https://...)\n- `코드`\n\n| 표 | 도 | 가능 |\n|---|---|---|\n| 1 | 2 | 3 |"
              className="w-full min-h-[60vh] p-5 text-sm font-mono text-slate-800 focus:outline-none resize-none leading-relaxed"
              spellCheck={false}
            />
          </div>
        )}

        {(mode === 'preview' || mode === 'split') && (
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="px-4 py-2 border-b border-slate-100 bg-slate-50 text-xs font-semibold text-slate-500 flex items-center gap-1.5">
              <Eye size={11} /> 미리보기
            </div>
            <div className="p-5 min-h-[60vh]">
              {draft.body.trim() ? (
                <div className="wiki-prose">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {draft.body}
                  </ReactMarkdown>
                </div>
              ) : (
                <p className="text-sm text-slate-400 italic">본문을 입력하면 여기에 미리보기가 표시됩니다.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function TagEditor({ tags, onAdd, onRemove }) {
  const [input, setInput] = useState('')
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs font-semibold text-slate-500 flex items-center gap-1">
        <TagIcon size={11} /> 태그:
      </span>
      {tags.map((t) => (
        <span
          key={t}
          className="text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full flex items-center gap-1"
        >
          {t}
          <button
            type="button"
            onClick={() => onRemove(t)}
            className="text-slate-400 hover:text-rose-600"
          >
            <X size={10} />
          </button>
        </span>
      ))}
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            onAdd(input)
            setInput('')
          } else if (e.key === 'Backspace' && !input && tags.length > 0) {
            onRemove(tags[tags.length - 1])
          }
        }}
        onBlur={() => {
          if (input.trim()) {
            onAdd(input)
            setInput('')
          }
        }}
        placeholder="태그 입력 후 Enter"
        className="px-2 py-1 text-xs border border-slate-200 rounded-full min-w-[140px] focus:outline-none focus:ring-2 focus:ring-myriad-primary/40"
      />
    </div>
  )
}
