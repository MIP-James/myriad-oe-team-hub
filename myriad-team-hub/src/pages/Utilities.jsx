import { useEffect, useMemo, useState } from 'react'
import {
  Wrench, Download, Loader2, Search, Tag, Play, CheckCircle2, XCircle, Clock, Cpu
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

const STALE_THRESHOLD_MS = 60 * 1000
function isFresh(lastSeenAt) {
  if (!lastSeenAt) return false
  return Date.now() - new Date(lastSeenAt).getTime() < STALE_THRESHOLD_MS
}

export default function Utilities() {
  const { user } = useAuth()
  const [items, setItems] = useState([])
  const [devices, setDevices] = useState([])
  const [recentJobs, setRecentJobs] = useState({})  // key: utility_id → latest job
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [selected, setSelected] = useState(null)

  useEffect(() => { load() }, [])

  // 내 작업 실시간 구독
  useEffect(() => {
    if (!user?.id) return
    const channel = supabase
      .channel('jobs-utilities-' + user.id)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'launcher_jobs', filter: `user_id=eq.${user.id}` },
        () => loadRecentJobs()
      )
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [user?.id])

  async function load() {
    setLoading(true)
    const [utilsRes, devicesRes] = await Promise.all([
      supabase.from('utilities').select('*').eq('is_active', true).order('sort_order', { ascending: true }),
      supabase.from('launcher_devices').select('*').eq('is_online', true)
    ])
    if (utilsRes.error) setError(utilsRes.error.message)
    else setItems(utilsRes.data ?? [])
    // 하트비트가 60초 이상 끊긴 디바이스는 오프라인으로 간주
    const fresh = (devicesRes.data ?? []).filter((d) => isFresh(d.last_seen_at))
    setDevices(fresh)
    await loadRecentJobs()
    setLoading(false)
  }

  async function loadRecentJobs() {
    const { data } = await supabase
      .from('launcher_jobs')
      .select('*')
      .order('requested_at', { ascending: false })
      .limit(20)
    const map = {}
    for (const j of data ?? []) {
      if (!map[j.utility_id]) map[j.utility_id] = j
    }
    setRecentJobs(map)
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

  const hasOnlineDevice = devices.length > 0

  async function runUtility(utility) {
    if (!hasOnlineDevice) {
      setError('온라인 상태인 런처가 없습니다. "내 런처" 메뉴에서 런처를 연결하세요.')
      return
    }
    const { error } = await supabase.from('launcher_jobs').insert({
      user_id: user.id,
      device_id: devices[0].id,
      utility_id: utility.id,
      utility_slug: utility.slug,
      utility_name: utility.name,
      status: 'pending'
    })
    if (error) setError(error.message)
    else setError(null)
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <header className="mb-6 flex items-center gap-3">
        <Wrench className="text-myriad-ink" />
        <h1 className="text-2xl font-bold text-slate-900">유틸리티</h1>
        <div className="flex-1" />
        <LauncherBadge count={devices.length} />
      </header>

      <p className="text-sm text-slate-500 mb-5">
        각 유틸은 본인 PC에 런처를 설치하면 "실행" 버튼 한 번으로 바로 동작합니다.
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
          <UtilityCard
            key={u.id}
            utility={u}
            latestJob={recentJobs[u.id]}
            canRun={hasOnlineDevice}
            onRun={() => runUtility(u)}
            onOpenDetail={() => setSelected(u)}
          />
        ))}
      </div>

      {selected && (
        <UtilityDetail
          utility={selected}
          latestJob={recentJobs[selected.id]}
          canRun={hasOnlineDevice}
          onRun={() => runUtility(selected)}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}

function LauncherBadge({ count }) {
  return (
    <Link
      to="/launcher"
      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs border transition ${
        count > 0
          ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
          : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'
      }`}
    >
      <Cpu size={12} />
      {count > 0 ? `${count}개 런처 온라인` : '런처 오프라인'}
    </Link>
  )
}

function UtilityCard({ utility, latestJob, canRun, onRun, onOpenDetail }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 hover:shadow-md hover:border-myriad-primary transition flex flex-col">
      <button onClick={onOpenDetail} className="text-left flex items-start gap-3 flex-1">
        <div className="w-12 h-12 rounded-xl bg-myriad-primary/10 flex items-center justify-center text-2xl shrink-0">
          {utility.icon || '🧰'}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-slate-900 truncate">{utility.name}</h3>
            {utility.current_version && (
              <span className="text-[10px] font-semibold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                v{utility.current_version}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-1 line-clamp-2">
            {utility.description || '설명 없음'}
          </p>
          {utility.category && (
            <span className="inline-flex items-center gap-1 text-[10px] text-slate-500 mt-2">
              <Tag size={10} /> {utility.category}
            </span>
          )}
        </div>
      </button>
      <div className="flex items-center gap-2 mt-4 pt-4 border-t border-slate-100">
        {latestJob && <JobStatusChip job={latestJob} />}
        <div className="flex-1" />
        {utility.download_url && (
          <a
            href={utility.download_url}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-slate-500 hover:text-myriad-ink flex items-center gap-1"
            title="수동 다운로드"
          >
            <Download size={12} />
          </a>
        )}
        <button
          onClick={onRun}
          disabled={!canRun || latestJob?.status === 'running' || latestJob?.status === 'dispatched'}
          className="flex items-center gap-1.5 bg-myriad-primary hover:bg-myriad-primaryDark disabled:bg-slate-100 disabled:text-slate-400 text-myriad-ink font-semibold px-3 py-1.5 rounded-lg text-sm disabled:cursor-not-allowed"
          title={!canRun ? '온라인 런처가 없습니다' : '실행'}
        >
          <Play size={12} /> 실행
        </button>
      </div>
    </div>
  )
}

function JobStatusChip({ job }) {
  const s = job.status
  if (s === 'pending' || s === 'dispatched') {
    return (
      <span className="text-[11px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full flex items-center gap-1">
        <Clock size={10} /> 대기 중
      </span>
    )
  }
  if (s === 'running') {
    return (
      <span className="text-[11px] text-sky-700 bg-sky-50 px-2 py-0.5 rounded-full flex items-center gap-1">
        <Loader2 size={10} className="animate-spin" /> 실행 중
      </span>
    )
  }
  if (s === 'done') {
    return (
      <span className="text-[11px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full flex items-center gap-1">
        <CheckCircle2 size={10} /> 완료
      </span>
    )
  }
  if (s === 'error') {
    return (
      <span className="text-[11px] text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full flex items-center gap-1">
        <XCircle size={10} /> 오류
      </span>
    )
  }
  return null
}

function UtilityDetail({ utility, latestJob, canRun, onRun, onClose }) {
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
              {latestJob && <JobStatusChip job={latestJob} />}
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
          {utility.download_url && (
            <a
              href={utility.download_url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold px-4 py-2 rounded-lg"
            >
              <Download size={16} /> 다운로드
            </a>
          )}
          <button
            onClick={onRun}
            disabled={!canRun || latestJob?.status === 'running' || latestJob?.status === 'dispatched'}
            className="flex items-center gap-2 bg-myriad-primary hover:bg-myriad-primaryDark disabled:bg-slate-100 disabled:text-slate-400 text-myriad-ink font-semibold px-4 py-2 rounded-lg disabled:cursor-not-allowed"
            title={!canRun ? '온라인 런처가 없습니다' : '실행'}
          >
            <Play size={16} /> 실행
          </button>
        </div>
      </div>
    </div>
  )
}
