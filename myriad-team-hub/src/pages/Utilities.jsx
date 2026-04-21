import { useEffect, useMemo, useState } from 'react'
import { Wrench, Download, Loader2, Search, Tag } from 'lucide-react'
import { supabase } from '../lib/supabase'

export default function Utilities() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [selected, setSelected] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('utilities')
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
        (u.name ?? '').toLowerCase().includes(q) ||
        (u.description ?? '').toLowerCase().includes(q)
      )
    })
  }, [items, query, categoryFilter])

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <header className="mb-6 flex items-center gap-3">
        <Wrench className="text-myriad-ink" />
        <h1 className="text-2xl font-bold text-slate-900">유틸리티</h1>
      </header>

      <p className="text-sm text-slate-500 mb-5">
        팀이 사용하는 업무 자동화 도구 모음입니다. 각 유틸은 본인 PC에 다운로드해서 실행하세요.
        <br />
        <span className="text-xs text-slate-400">
          🛠️ Phase 4에서 웹에서 직접 실행하는 기능이 추가될 예정입니다.
        </span>
      </p>

      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="유틸 이름 또는 설명으로 검색..."
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
          {query || categoryFilter !== 'all' ? '검색 결과가 없습니다.' : '등록된 유틸리티가 없습니다.'}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filtered.map((u) => (
          <button
            key={u.id}
            onClick={() => setSelected(u)}
            className="text-left bg-white border border-slate-200 rounded-2xl p-5 hover:shadow-md hover:border-myriad-primary transition"
          >
            <div className="flex items-start gap-3">
              <div className="w-12 h-12 rounded-xl bg-myriad-primary/10 flex items-center justify-center text-2xl shrink-0">
                {u.icon || '🧰'}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-slate-900 truncate">{u.name}</h3>
                  {u.current_version && (
                    <span className="text-[10px] font-semibold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                      v{u.current_version}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                  {u.description || '설명 없음'}
                </p>
                <div className="flex items-center gap-2 mt-3">
                  {u.category && (
                    <span className="text-[10px] text-slate-500 flex items-center gap-1">
                      <Tag size={10} />
                      {u.category}
                    </span>
                  )}
                  {!u.download_url && (
                    <span className="text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                      다운로드 링크 미등록
                    </span>
                  )}
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>

      {selected && <UtilityDetail utility={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

function UtilityDetail({ utility, onClose }) {
  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-5 border-b border-slate-200 flex items-start gap-4">
          <div className="w-14 h-14 rounded-xl bg-myriad-primary/10 flex items-center justify-center text-3xl shrink-0">
            {utility.icon || '🧰'}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-slate-900">{utility.name}</h2>
              {utility.current_version && (
                <span className="text-xs font-semibold bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                  v{utility.current_version}
                </span>
              )}
            </div>
            <p className="text-sm text-slate-600 mt-1">{utility.description}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none px-1">
            ×
          </button>
        </div>

        <div className="p-6 overflow-auto flex-1">
          {utility.release_notes && (
            <section className="mb-5">
              <h3 className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wider">
                최근 변경사항
              </h3>
              <div className="bg-slate-50 rounded-lg p-3 text-sm text-slate-700 whitespace-pre-wrap">
                {utility.release_notes}
              </div>
            </section>
          )}
          {utility.install_guide && (
            <section>
              <h3 className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wider">
                설치 · 사용 가이드
              </h3>
              <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                {utility.install_guide}
              </div>
            </section>
          )}
          {!utility.release_notes && !utility.install_guide && (
            <p className="text-sm text-slate-400 text-center py-8">
              상세 정보가 아직 등록되지 않았습니다.
            </p>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-end gap-2">
          <button onClick={onClose} className="text-slate-600 hover:bg-slate-100 px-4 py-2 rounded-lg">
            닫기
          </button>
          {utility.download_url ? (
            <a
              href={utility.download_url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-4 py-2 rounded-lg"
            >
              <Download size={16} /> 다운로드
            </a>
          ) : (
            <button
              disabled
              className="flex items-center gap-2 bg-slate-100 text-slate-400 font-semibold px-4 py-2 rounded-lg cursor-not-allowed"
            >
              <Download size={16} /> 다운로드 링크 없음
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
