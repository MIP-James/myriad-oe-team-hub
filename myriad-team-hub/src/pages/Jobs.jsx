import { useEffect, useState } from 'react'
import { History, Loader2, CheckCircle2, XCircle, Clock, Play, RefreshCw, AlertCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

const STATUS_FILTERS = [
  { key: 'all', label: '전체' },
  { key: 'running', label: '실행 중' },
  { key: 'done', label: '완료' },
  { key: 'error', label: '오류' }
]

export default function Jobs() {
  const { user } = useAuth()
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [error, setError] = useState(null)

  useEffect(() => { load() }, [filter])

  useEffect(() => {
    if (!user?.id) return
    const channel = supabase
      .channel('jobs-page-' + user.id)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'launcher_jobs', filter: `user_id=eq.${user.id}` },
        () => load()
      )
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [user?.id])

  async function load() {
    setLoading(true)
    let q = supabase
      .from('launcher_jobs')
      .select('*')
      .order('requested_at', { ascending: false })
      .limit(100)
    if (filter === 'running') {
      q = q.in('status', ['pending', 'dispatched', 'running'])
    } else if (filter === 'done' || filter === 'error') {
      q = q.eq('status', filter)
    }
    const { data, error } = await q
    if (error) setError(error.message)
    else setJobs(data ?? [])
    setLoading(false)
  }

  async function cancel(job) {
    if (!['pending', 'dispatched'].includes(job.status)) return
    if (!window.confirm('이 작업을 취소할까요?')) return
    const { error } = await supabase
      .from('launcher_jobs')
      .update({ status: 'cancelled', finished_at: new Date().toISOString() })
      .eq('id', job.id)
    if (error) setError(error.message)
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <header className="mb-6 flex items-center gap-3">
        <History className="text-myriad-ink" />
        <h1 className="text-2xl font-bold text-slate-900">작업 이력</h1>
        <div className="flex-1" />
        <button
          onClick={load}
          className="p-2 rounded-lg hover:bg-slate-100"
          title="새로고침"
        >
          <RefreshCw size={14} className="text-slate-500" />
        </button>
      </header>

      <div className="flex gap-1.5 mb-5">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-xs border transition ${
              filter === f.key
                ? 'bg-myriad-primary border-myriad-primary text-myriad-ink font-semibold'
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg p-3">
          {error}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="py-12 text-center text-sm text-slate-400 flex items-center justify-center gap-2">
            <Loader2 size={14} className="animate-spin" /> 불러오는 중...
          </div>
        ) : jobs.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-400">
            작업 이력이 없습니다.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {jobs.map((j) => (
              <li key={j.id} className="px-5 py-4 flex items-center gap-4">
                <StatusIcon status={j.status} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-900 truncate">
                      {j.utility_name || j.utility_slug}
                    </span>
                    <StatusBadge status={j.status} />
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    요청: {new Date(j.requested_at).toLocaleString('ko-KR')}
                    {j.finished_at && ' · 완료: ' + new Date(j.finished_at).toLocaleString('ko-KR')}
                  </div>
                  {j.error_message && (
                    <div className="text-xs text-rose-600 mt-1 flex items-start gap-1">
                      <AlertCircle size={12} className="shrink-0 mt-0.5" />
                      <span className="break-all">{j.error_message}</span>
                    </div>
                  )}
                  {j.output && (
                    <details className="text-xs text-slate-500 mt-1">
                      <summary className="cursor-pointer hover:text-slate-700">출력 보기</summary>
                      <pre className="mt-1 bg-slate-50 p-2 rounded text-[11px] whitespace-pre-wrap break-all max-h-40 overflow-auto">
                        {j.output}
                      </pre>
                    </details>
                  )}
                </div>
                {['pending', 'dispatched'].includes(j.status) && (
                  <button
                    onClick={() => cancel(j)}
                    className="text-xs text-rose-600 hover:underline shrink-0"
                  >
                    취소
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function StatusIcon({ status }) {
  const cls = 'w-8 h-8 rounded-lg flex items-center justify-center shrink-0'
  if (status === 'pending' || status === 'dispatched') {
    return <div className={cls + ' bg-amber-100 text-amber-700'}><Clock size={14} /></div>
  }
  if (status === 'running') {
    return <div className={cls + ' bg-sky-100 text-sky-700'}><Loader2 size={14} className="animate-spin" /></div>
  }
  if (status === 'done') {
    return <div className={cls + ' bg-emerald-100 text-emerald-700'}><CheckCircle2 size={14} /></div>
  }
  if (status === 'error') {
    return <div className={cls + ' bg-rose-100 text-rose-700'}><XCircle size={14} /></div>
  }
  if (status === 'cancelled') {
    return <div className={cls + ' bg-slate-100 text-slate-500'}>✕</div>
  }
  return <div className={cls + ' bg-slate-100'}><Play size={14} /></div>
}

function StatusBadge({ status }) {
  const map = {
    pending: ['text-amber-700 bg-amber-50', '대기'],
    dispatched: ['text-amber-700 bg-amber-50', '전달됨'],
    running: ['text-sky-700 bg-sky-50', '실행 중'],
    done: ['text-emerald-700 bg-emerald-50', '완료'],
    error: ['text-rose-700 bg-rose-50', '오류'],
    cancelled: ['text-slate-500 bg-slate-100', '취소됨']
  }
  const [cls, label] = map[status] ?? ['text-slate-500 bg-slate-100', status]
  return <span className={`text-[10px] px-2 py-0.5 rounded-full ${cls}`}>{label}</span>
}
