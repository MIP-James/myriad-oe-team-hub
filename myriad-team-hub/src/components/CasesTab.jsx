/**
 * 팀 커뮤니티 > 케이스 탭
 *  - 테이블 형식 리스트 (번호 / 제목 / 브랜드 / 플랫폼 / 유형 / 상태 / 작성자 / 날짜)
 *  - 상단 필터 (브랜드 / 플랫폼 / 유형 / 상태) + 검색
 *  - 페이지네이션 (20건씩)
 *  - 실시간 반영
 */
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Briefcase, Plus, Search, X, Loader2, ChevronLeft, ChevronRight,
  Tag as TagIcon, Globe, AlertTriangle, Circle, Link as LinkIcon
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  listCases, listBrandSuggestions, listTaskSummaries,
  PLATFORMS, INFRINGEMENT_TYPES, STATUS_OPTIONS, STATUS_LABELS, STATUS_COLORS,
  INFRINGEMENT_COLORS
} from '../lib/cases'
import { getProfileShort } from '../lib/community'

const PAGE_SIZE = 20

export default function CasesTab() {
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [profiles, setProfiles] = useState({})

  // 필터 상태
  const [brand, setBrand] = useState('')
  const [platform, setPlatform] = useState('')
  const [infType, setInfType] = useState('')
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [page, setPage] = useState(0)

  const [brandSuggestions, setBrandSuggestions] = useState([])
  const [commentCounts, setCommentCounts] = useState({})
  const [taskSummaries, setTaskSummaries] = useState({})

  useEffect(() => {
    listBrandSuggestions().then(setBrandSuggestions).catch(() => {})
  }, [])

  useEffect(() => { load() }, [brand, platform, infType, status, search, page])

  useEffect(() => {
    // realtime 으로 insert/update 감지 — 첫 페이지만 자동 갱신
    const ch = supabase
      .channel('cases-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cases' }, () => {
        if (page === 0) load()
      })
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [page])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const { rows, total } = await listCases({
        brand: brand || null,
        platform: platform || null,
        infringementType: infType || null,
        status: status || null,
        search: search || null,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE
      })
      setRows(rows)
      setTotal(total)

      // 작성자 프로필
      const uniq = [...new Set(rows.map((r) => r.created_by).filter(Boolean))]
      const pmap = { ...profiles }
      await Promise.all(
        uniq.filter((id) => !pmap[id]).map(async (id) => {
          pmap[id] = await getProfileShort(id)
        })
      )
      setProfiles(pmap)

      // 댓글 개수 + 태스크 진행도 집계
      if (rows.length > 0) {
        const ids = rows.map((r) => r.id)
        const [commentsRes, tasks] = await Promise.all([
          supabase.from('case_comments').select('case_id').in('case_id', ids),
          listTaskSummaries(ids)
        ])
        const counts = {}
        for (const c of commentsRes.data ?? []) counts[c.case_id] = (counts[c.case_id] ?? 0) + 1
        setCommentCounts(counts)
        setTaskSummaries(tasks)
      } else {
        setCommentCounts({})
        setTaskSummaries({})
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function submitSearch(e) {
    e?.preventDefault()
    setPage(0)
    setSearch(searchInput.trim())
  }

  function clearFilters() {
    setBrand(''); setPlatform(''); setInfType(''); setStatus('')
    setSearch(''); setSearchInput(''); setPage(0)
  }

  const hasFilter = !!(brand || platform || infType || status || search)
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-slate-500">
          팀이 발견한 이슈/메일을 공유하는 공간 — 브랜드 · 플랫폼 · 유형별 필터링
        </p>
        <button
          onClick={() => navigate('/community/cases/new')}
          className="flex items-center gap-1.5 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-3 py-1.5 rounded-lg text-sm"
        >
          <Plus size={14} /> 새 케이스
        </button>
      </div>

      {/* 필터바 */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 mb-4 flex flex-wrap items-center gap-2">
        <input
          type="text"
          list="cases-brand-filter"
          value={brand}
          onChange={(e) => { setPage(0); setBrand(e.target.value) }}
          placeholder="브랜드 전체"
          className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40 w-32"
        />
        <datalist id="cases-brand-filter">
          {brandSuggestions.map((b) => <option key={b} value={b} />)}
        </datalist>
        <input
          type="text"
          list="cases-platform-filter"
          value={platform}
          onChange={(e) => { setPage(0); setPlatform(e.target.value) }}
          placeholder="플랫폼 전체"
          className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40 w-32"
        />
        <datalist id="cases-platform-filter">
          {PLATFORMS.map((p) => <option key={p} value={p} />)}
        </datalist>
        <select
          value={infType}
          onChange={(e) => { setPage(0); setInfType(e.target.value) }}
          className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-myriad-primary/40"
        >
          <option value="">유형 전체</option>
          {INFRINGEMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select
          value={status}
          onChange={(e) => { setPage(0); setStatus(e.target.value) }}
          className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-myriad-primary/40"
        >
          <option value="">상태 전체</option>
          {STATUS_OPTIONS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>

        <form onSubmit={submitSearch} className="flex-1 min-w-[180px] relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="제목/본문/브랜드 검색..."
            className="w-full pl-7 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40"
          />
        </form>

        {hasFilter && (
          <button
            onClick={clearFilters}
            className="text-xs text-rose-600 hover:bg-rose-50 px-2.5 py-1.5 rounded-lg flex items-center gap-1"
          >
            <X size={11} /> 초기화
          </button>
        )}
      </div>

      {error && (
        <div className="mb-3 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg p-3 flex items-center gap-2">
          <AlertTriangle size={13} /> {error}
        </div>
      )}

      {/* 테이블 */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-sm text-slate-400 flex items-center justify-center gap-2">
            <Loader2 size={14} className="animate-spin" /> 불러오는 중...
          </div>
        ) : rows.length === 0 ? (
          <EmptyState hasFilter={hasFilter} onNew={() => navigate('/community/cases/new')} onClearFilter={clearFilters} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2 text-left w-10">#</th>
                    <th className="px-3 py-2 text-left">제목</th>
                    <th className="px-3 py-2 text-left w-28">브랜드</th>
                    <th className="px-3 py-2 text-left w-24">플랫폼</th>
                    <th className="px-3 py-2 text-left w-28">유형</th>
                    <th className="px-3 py-2 text-left w-24">상태</th>
                    <th className="px-3 py-2 text-left w-24">작성자</th>
                    <th className="px-3 py-2 text-left w-28">날짜</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c, idx) => {
                    const profile = profiles[c.created_by]
                    const author = profile?.full_name || profile?.email?.split('@')[0] || '—'
                    const commentCount = commentCounts[c.id] || 0
                    const taskSummary = taskSummaries[c.id]
                    const platformLabel = c.platform || '—'
                    const isActionNeeded = c.status === 'action_needed'
                    return (
                      <tr
                        key={c.id}
                        className={`border-b border-slate-100 transition ${
                          isActionNeeded
                            ? 'bg-amber-50/60 hover:bg-amber-100/60 border-l-4 border-l-amber-500'
                            : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="px-3 py-2.5 text-xs text-slate-400">
                          {total - (page * PAGE_SIZE + idx)}
                        </td>
                        <td className="px-3 py-2.5">
                          <Link
                            to={`/community/cases/${c.id}`}
                            className="font-semibold text-slate-900 hover:text-myriad-ink flex items-center gap-1.5"
                          >
                            <span className="truncate">{c.title}</span>
                            {c.post_url && <LinkIcon size={10} className="text-sky-500 shrink-0" />}
                            {commentCount > 0 && (
                              <span className="text-[10px] text-slate-500 bg-slate-100 px-1.5 rounded-full shrink-0">
                                💬 {commentCount}
                              </span>
                            )}
                            {taskSummary && taskSummary.total > 0 && (
                              <span
                                className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${
                                  taskSummary.done === taskSummary.total
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : 'bg-sky-100 text-sky-700'
                                }`}
                                title={`${taskSummary.done}/${taskSummary.total} 완료`}
                              >
                                ✓ {taskSummary.done}/{taskSummary.total}
                              </span>
                            )}
                          </Link>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="inline-flex items-center gap-1 bg-myriad-primary/25 text-myriad-ink font-bold px-2 py-0.5 rounded-md text-[11px]">
                            <TagIcon size={10} />
                            {c.brand}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="inline-flex items-center gap-1 bg-sky-100 text-sky-800 font-bold px-2 py-0.5 rounded-md text-[11px]">
                            <Globe size={10} />
                            {platformLabel}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={`inline-flex items-center gap-1 font-bold px-2 py-0.5 rounded-md text-[11px] ${INFRINGEMENT_COLORS[c.infringement_type] || 'bg-slate-100 text-slate-700'}`}>
                            {c.infringement_type}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${STATUS_COLORS[c.status]}`}>
                            <Circle size={6} className="fill-current" />
                            {STATUS_LABELS[c.status]}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-slate-600">{author}</td>
                        <td className="px-3 py-2.5 text-xs text-slate-500">
                          {new Date(c.created_at).toLocaleDateString('ko-KR', {
                            month: '2-digit', day: '2-digit'
                          })}
                          {' '}
                          {new Date(c.created_at).toLocaleTimeString('ko-KR', {
                            hour: '2-digit', minute: '2-digit'
                          })}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* 페이지네이션 */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-1 p-3 border-t border-slate-100 text-sm">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-40"
                >
                  <ChevronLeft size={14} />
                </button>
                <span className="px-3 text-xs text-slate-600">
                  {page + 1} / {totalPages}
                  <span className="text-slate-400 ml-2">({total}건)</span>
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-40"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}

function EmptyState({ hasFilter, onNew, onClearFilter }) {
  return (
    <div className="py-16 text-center">
      <Briefcase size={36} className="mx-auto mb-3 text-slate-300" />
      <p className="text-sm text-slate-500">
        {hasFilter ? '조건에 맞는 케이스가 없습니다.' : '아직 등록된 케이스가 없습니다.'}
      </p>
      <div className="mt-4 flex items-center justify-center gap-2">
        {hasFilter && (
          <button
            onClick={onClearFilter}
            className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg"
          >
            필터 초기화
          </button>
        )}
        <button
          onClick={onNew}
          className="flex items-center gap-1.5 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-3 py-1.5 rounded-lg text-sm"
        >
          <Plus size={13} /> 첫 케이스 만들기
        </button>
      </div>
    </div>
  )
}
