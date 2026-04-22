import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  FolderOpen, Loader2, BarChart3, ChevronRight, CheckCircle2, Edit3, Trash2, RefreshCw
} from 'lucide-react'
import { listGroups, listBrandReports, deleteGroup } from '../lib/reportStore'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

export default function ReportGroups() {
  const { isAdmin } = useAuth()
  const [groups, setGroups] = useState([])
  const [counts, setCounts] = useState({})  // { groupId: { total, done } }
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => { load() }, [])

  // Realtime: 그룹/브랜드 보고서 변경 자동 반영
  useEffect(() => {
    const ch = supabase
      .channel('report-groups-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'report_groups' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'brand_reports' }, load)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [])

  async function load() {
    setLoading(true)
    try {
      const gs = await listGroups()
      setGroups(gs)
      const cmap = {}
      for (const g of gs) {
        const reports = await listBrandReports(g.id)
        cmap[g.id] = {
          total: reports.length,
          done: reports.filter((r) => r.status === 'done').length
        }
      }
      setCounts(cmap)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(group) {
    if (!window.confirm(`"${group.title}" 그룹과 안의 모든 보고서를 삭제합니다. 되돌릴 수 없습니다. 계속?`)) return
    try {
      await deleteGroup(group.id)
      await load()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <header className="mb-6 flex items-center gap-3">
        <FolderOpen className="text-myriad-ink" />
        <h1 className="text-2xl font-bold text-slate-900">월간 보고서 그룹</h1>
        <div className="flex-1" />
        <Link
          to="/reports"
          className="flex items-center gap-1.5 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-4 py-2 rounded-lg text-sm"
        >
          <BarChart3 size={14} /> 새 보고서 생성
        </Link>
        <button onClick={load} className="p-2 rounded-lg hover:bg-slate-100" title="새로고침">
          <RefreshCw size={14} className="text-slate-500" />
        </button>
      </header>

      <p className="text-sm text-slate-500 mb-5">
        월별로 생성된 브랜드 보고서를 한 곳에서 관리합니다. 각 그룹을 클릭하면 해당 월의
        브랜드별 보고서 목록과 진행 상태를 볼 수 있습니다.
      </p>

      {error && (
        <div className="mb-4 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg p-3">
          {error}
        </div>
      )}

      {loading && (
        <div className="py-12 text-center text-sm text-slate-400 flex items-center justify-center gap-2">
          <Loader2 size={14} className="animate-spin" /> 불러오는 중...
        </div>
      )}

      {!loading && groups.length === 0 && (
        <div className="py-16 text-center text-sm text-slate-400 bg-white border border-slate-200 rounded-2xl">
          <FolderOpen size={36} className="mx-auto mb-3 text-slate-300" />
          아직 생성된 보고서 그룹이 없습니다.
          <div className="mt-2">
            <Link to="/reports" className="text-myriad-ink font-semibold hover:underline">
              첫 보고서를 만들어보세요 →
            </Link>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {groups.map((g) => {
          const c = counts[g.id] || { total: 0, done: 0 }
          const progress = c.total ? Math.round((c.done / c.total) * 100) : 0
          return (
            <div
              key={g.id}
              className="bg-white border border-slate-200 rounded-2xl p-5 hover:shadow-md hover:border-myriad-primary transition relative group"
            >
              <Link to={`/reports/groups/${g.id}`} className="block">
                <div className="flex items-start gap-3">
                  <div className="w-12 h-12 rounded-xl bg-myriad-primary/10 flex items-center justify-center text-xl shrink-0">
                    📁
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-slate-900 truncate">{g.title}</h3>
                    <div className="text-xs text-slate-500 mt-1">
                      연월: <b>{g.year_month}</b>
                      {g.status === 'published' && (
                        <span className="ml-2 bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded text-[10px]">
                          Drive 발행됨
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-slate-400 shrink-0" />
                </div>

                {/* 진행률 바 */}
                <div className="mt-4">
                  <div className="flex justify-between text-[11px] text-slate-500 mb-1">
                    <span>
                      브랜드 {c.total}개 · 완료 {c.done}개
                    </span>
                    <span className="font-semibold">{progress}%</span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 transition-all"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              </Link>

              {isAdmin && (
                <button
                  onClick={() => handleDelete(g)}
                  className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition p-1.5 bg-rose-50 text-rose-600 rounded-lg hover:bg-rose-100"
                  title="그룹 삭제"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
