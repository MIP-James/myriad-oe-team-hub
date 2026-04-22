import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  BookOpen, Plus, Search, Pin, Loader2, Tag as TagIcon, Clock, Folder, X
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  listWikiPages, searchWikiPages, listAllTags, DEFAULT_CATEGORIES
} from '../lib/wiki'
import { getProfileShort } from '../lib/community'

export default function Wiki() {
  const navigate = useNavigate()
  const [pages, setPages] = useState([])
  const [tags, setTags] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [category, setCategory] = useState(null)
  const [activeTag, setActiveTag] = useState(null)
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState(null)

  const [profiles, setProfiles] = useState({})

  useEffect(() => { load() }, [category, activeTag])

  useEffect(() => {
    const ch = supabase
      .channel('wiki-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wiki_pages' }, load)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [category, activeTag])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [list, tagList] = await Promise.all([
        listWikiPages({ category, tag: activeTag }),
        listAllTags().catch(() => [])
      ])
      setPages(list)
      setTags(tagList)

      // 업데이트한 사람 프로필 로드
      const uniq = [...new Set(list.map((p) => p.updated_by).filter(Boolean))]
      const pmap = {}
      await Promise.all(uniq.map(async (id) => { pmap[id] = await getProfileShort(id) }))
      setProfiles(pmap)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function runSearch(e) {
    e?.preventDefault()
    const q = query.trim()
    if (!q) {
      setSearchResults(null)
      return
    }
    setSearching(true)
    try {
      const results = await searchWikiPages(q)
      setSearchResults(results)
    } catch (err) {
      setError(err.message)
    } finally {
      setSearching(false)
    }
  }

  function clearSearch() {
    setQuery('')
    setSearchResults(null)
  }

  const displayPages = searchResults ?? pages
  const filterActive = category || activeTag
  const allCategories = useMemo(() => {
    const set = new Set(DEFAULT_CATEGORIES)
    for (const p of pages) if (p.category) set.add(p.category)
    return [...set]
  }, [pages])

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <header className="mb-6 flex items-center gap-3">
        <BookOpen className="text-myriad-ink" />
        <div>
          <h1 className="text-2xl font-bold text-slate-900">위키</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            브랜드 / 플랫폼 / 프로세스 지식을 팀 전체가 함께 관리합니다.
          </p>
        </div>
        <div className="flex-1" />
        <button
          onClick={() => navigate('/wiki/new')}
          className="flex items-center gap-1.5 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-4 py-2 rounded-lg text-sm"
        >
          <Plus size={14} /> 새 페이지
        </button>
      </header>

      {/* 검색 */}
      <form onSubmit={runSearch} className="mb-4 flex gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="제목이나 본문 검색..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full pl-9 pr-9 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-myriad-primary/40"
          />
          {query && (
            <button
              type="button"
              onClick={clearSearch}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <button
          type="submit"
          disabled={searching || !query.trim()}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white text-sm font-semibold rounded-lg disabled:opacity-50"
        >
          {searching ? <Loader2 size={14} className="animate-spin" /> : '검색'}
        </button>
      </form>

      {/* 카테고리 필터 */}
      {!searchResults && (
        <div className="flex flex-wrap gap-2 mb-3">
          <CategoryPill
            active={category === null}
            onClick={() => setCategory(null)}
          >
            전체
          </CategoryPill>
          {allCategories.map((c) => (
            <CategoryPill
              key={c}
              active={category === c}
              onClick={() => setCategory(category === c ? null : c)}
            >
              {c}
            </CategoryPill>
          ))}
        </div>
      )}

      {/* 태그 필터 */}
      {!searchResults && tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-5">
          {activeTag && (
            <button
              onClick={() => setActiveTag(null)}
              className="text-[11px] px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 hover:bg-rose-200 flex items-center gap-1"
            >
              <X size={10} /> 태그 해제
            </button>
          )}
          {tags.slice(0, 20).map(({ tag, count }) => (
            <button
              key={tag}
              onClick={() => setActiveTag(activeTag === tag ? null : tag)}
              className={`text-[11px] px-2 py-0.5 rounded-full flex items-center gap-1 ${
                activeTag === tag
                  ? 'bg-myriad-primary/40 text-myriad-ink font-semibold'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <TagIcon size={9} /> {tag}
              <span className="text-slate-400">{count}</span>
            </button>
          ))}
        </div>
      )}

      {searchResults && (
        <div className="mb-3 text-xs text-slate-500">
          "{query}" 검색 결과 {searchResults.length}건
          <button
            onClick={clearSearch}
            className="ml-2 text-myriad-ink hover:underline"
          >
            (초기화)
          </button>
        </div>
      )}

      {/* 리스트 */}
      {error && (
        <div className="mb-4 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg p-3">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-16 text-center text-sm text-slate-400 flex items-center justify-center gap-2">
          <Loader2 size={14} className="animate-spin" /> 불러오는 중...
        </div>
      ) : displayPages.length === 0 ? (
        <EmptyState
          filterActive={filterActive}
          searching={!!searchResults}
          onNew={() => navigate('/wiki/new')}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {displayPages.map((p) => (
            <PageCard key={p.id} page={p} profile={profiles[p.updated_by]} />
          ))}
        </div>
      )}
    </div>
  )
}

function CategoryPill({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs font-semibold transition ${
        active
          ? 'bg-myriad-ink text-white'
          : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
      }`}
    >
      {children}
    </button>
  )
}

function PageCard({ page, profile }) {
  const editor = profile?.full_name || profile?.email?.split('@')[0]
  return (
    <Link
      to={`/wiki/${page.id}`}
      className="bg-white border border-slate-200 hover:border-myriad-primary hover:shadow-sm rounded-2xl p-5 transition"
    >
      <div className="flex items-start gap-2">
        {page.pinned && (
          <Pin size={13} className="text-amber-500 fill-amber-400 shrink-0 mt-1" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {page.icon && <span className="text-lg">{page.icon}</span>}
            <h3 className="font-bold text-slate-900 truncate">{page.title}</h3>
          </div>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {page.category && (
              <span className="text-[10px] font-semibold bg-myriad-primary/20 text-myriad-ink px-2 py-0.5 rounded-full flex items-center gap-1">
                <Folder size={9} /> {page.category}
              </span>
            )}
            {(page.tags ?? []).slice(0, 4).map((t) => (
              <span
                key={t}
                className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full flex items-center gap-1"
              >
                <TagIcon size={8} /> {t}
              </span>
            ))}
            {(page.tags?.length ?? 0) > 4 && (
              <span className="text-[10px] text-slate-400">
                +{page.tags.length - 4}
              </span>
            )}
          </div>
          <div className="text-[11px] text-slate-400 mt-3 flex items-center gap-1.5">
            <Clock size={10} />
            {new Date(page.updated_at).toLocaleString('ko-KR')}
            {editor && <span>· {editor}</span>}
          </div>
        </div>
      </div>
    </Link>
  )
}

function EmptyState({ filterActive, searching, onNew }) {
  return (
    <div className="py-16 text-center bg-white border border-slate-200 rounded-2xl">
      <BookOpen size={36} className="mx-auto mb-3 text-slate-300" />
      <p className="text-sm text-slate-500">
        {searching
          ? '검색 결과가 없습니다.'
          : filterActive
          ? '선택한 조건에 맞는 페이지가 없습니다.'
          : '아직 위키 페이지가 없습니다.'}
      </p>
      {!searching && !filterActive && (
        <button
          onClick={onNew}
          className="mt-4 inline-flex items-center gap-1.5 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-4 py-2 rounded-lg text-sm"
        >
          <Plus size={14} /> 첫 페이지 만들기
        </button>
      )}
    </div>
  )
}
