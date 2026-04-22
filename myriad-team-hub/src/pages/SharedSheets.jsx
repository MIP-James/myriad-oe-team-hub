import { useEffect, useMemo, useState } from 'react'
import {
  FileSpreadsheet, Loader2, Search, Tag, ExternalLink, Maximize2, X,
  Download, RefreshCw
} from 'lucide-react'
import { supabase } from '../lib/supabase'

// Google 시트 URL → iframe 임베드용 URL 로 보강
// 예: .../edit  →  .../edit?rm=minimal
//     이미 쿼리스트링 있으면 그대로 두고 &rm=minimal 추가
function toEmbedUrl(url) {
  if (!url) return ''
  // rm=minimal 은 Google Sheets 의 상단 메뉴를 축소 (공식 파라미터)
  const sep = url.includes('?') ? '&' : '?'
  return url + sep + 'rm=minimal'
}

// XLSX 다운로드용 URL (Google 시트 → Excel)
function toXlsxUrl(url) {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)
  if (!m) return null
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=xlsx`
}

export default function SharedSheets() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [opened, setOpened] = useState(null) // 풀스크린 iframe 대상

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('shared_sheets')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
    if (error) setError(error.message)
    else setItems(data ?? [])
    setLoading(false)
  }

  const categories = useMemo(() => {
    const set = new Set(items.map((u) => u.category).filter(Boolean))
    return ['all', ...set]
  }, [items])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter((u) => {
      if (categoryFilter !== 'all' && u.category !== categoryFilter) return false
      if (!q) return true
      return (
        (u.title ?? '').toLowerCase().includes(q) ||
        (u.description ?? '').toLowerCase().includes(q)
      )
    })
  }, [items, query, categoryFilter])

  // iframe 풀스크린 모드
  if (opened) {
    return (
      <div className="fixed inset-0 z-40 bg-white flex flex-col">
        <div className="h-12 border-b border-slate-200 bg-white flex items-center gap-3 px-4 shrink-0">
          <button
            onClick={() => setOpened(null)}
            className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 px-2 py-1 rounded hover:bg-slate-100"
          >
            <X size={16} /> 목록으로
          </button>
          <div className="w-px h-5 bg-slate-200" />
          <span className="text-xl">{opened.icon || '📊'}</span>
          <span className="font-semibold text-slate-900 truncate">{opened.title}</span>
          <div className="flex-1" />
          {toXlsxUrl(opened.google_url) && (
            <a
              href={toXlsxUrl(opened.google_url)}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-900 px-2 py-1 rounded hover:bg-slate-100"
              title="Excel (.xlsx) 로 다운로드"
            >
              <Download size={14} /> Excel
            </a>
          )}
          <a
            href={opened.google_url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-900 px-2 py-1 rounded hover:bg-slate-100"
            title="Google Sheets 에서 새 탭으로 열기"
          >
            <ExternalLink size={14} /> 새 탭
          </a>
        </div>
        <iframe
          src={toEmbedUrl(opened.google_url)}
          title={opened.title}
          className="flex-1 w-full border-0"
        />
      </div>
    )
  }

  // 리스트 뷰
  return (
    <div className="p-8 max-w-6xl mx-auto">
      <header className="mb-6 flex items-center gap-3">
        <FileSpreadsheet className="text-myriad-ink" />
        <h1 className="text-2xl font-bold text-slate-900">공용 시트</h1>
        <div className="flex-1" />
        <button onClick={load} className="p-2 rounded-lg hover:bg-slate-100" title="새로고침">
          <RefreshCw size={14} className="text-slate-500" />
        </button>
      </header>

      <p className="text-sm text-slate-500 mb-5">
        팀 업무에 쓰는 Google Sheets 를 모아둔 곳입니다. 카드를 클릭하면 이 페이지 안에서 바로 편집 가능합니다 (Google 로그인 상태 필요).
      </p>

      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="제목 또는 설명으로 검색..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40"
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategoryFilter(c)}
              className={`whitespace-nowrap px-3 py-1.5 rounded-lg text-xs border transition ${
                categoryFilter === c
                  ? 'bg-myriad-primary border-myriad-primary text-myriad-ink font-semibold'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {c === 'all' ? '전체' : c}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="py-12 text-center text-sm text-slate-400 flex items-center justify-center gap-2">
          <Loader2 size={14} className="animate-spin" /> 불러오는 중...
        </div>
      )}

      {error && (
        <div className="mb-4 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg p-3">
          {error}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="py-12 text-center text-sm text-slate-400">
          {query || categoryFilter !== 'all'
            ? '검색 결과가 없습니다.'
            : '등록된 시트가 없습니다. 관리자에게 등록 요청하세요.'}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filtered.map((s) => (
          <div
            key={s.id}
            className="bg-white border border-slate-200 rounded-2xl p-5 hover:shadow-md hover:border-myriad-primary transition flex flex-col"
          >
            <div className="flex items-start gap-3 flex-1">
              <div className="w-12 h-12 rounded-xl bg-myriad-primary/10 flex items-center justify-center text-2xl shrink-0">
                {s.icon || '📊'}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-bold text-slate-900 truncate">{s.title}</h3>
                {s.description && (
                  <p className="text-xs text-slate-500 mt-1 line-clamp-2">{s.description}</p>
                )}
                {s.category && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-slate-500 mt-2">
                    <Tag size={10} /> {s.category}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 mt-4 pt-4 border-t border-slate-100">
              <a
                href={s.google_url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-slate-500 hover:text-myriad-ink flex items-center gap-1 px-2 py-1 rounded hover:bg-slate-100"
                title="Google Sheets 에서 새 탭으로 열기"
              >
                <ExternalLink size={12} /> 새 탭
              </a>
              <div className="flex-1" />
              <button
                onClick={() => setOpened(s)}
                className="flex items-center gap-1.5 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-3 py-1.5 rounded-lg text-sm"
              >
                <Maximize2 size={12} /> 열기
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
