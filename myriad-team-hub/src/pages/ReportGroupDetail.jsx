import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  FolderOpen, Loader2, ChevronLeft, Download, Edit3, CheckCircle2,
  Trash2, RefreshCw, FileSpreadsheet, User, Clock, StickyNote
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  listBrandReports, getReportSignedUrl, updateBrandReportStatus,
  updateBrandReportNote, deleteBrandReport
} from '../lib/reportStore'
import { useAuth } from '../contexts/AuthContext'

export default function ReportGroupDetail() {
  const { id } = useParams()
  const { user, isAdmin } = useAuth()
  const [group, setGroup] = useState(null)
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editingNote, setEditingNote] = useState(null) // id of report being edited
  const [noteDraft, setNoteDraft] = useState('')

  useEffect(() => { load() }, [id])

  useEffect(() => {
    if (!id) return
    const ch = supabase
      .channel('report-group-' + id)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'brand_reports', filter: `group_id=eq.${id}` },
        () => load()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'report_groups', filter: `id=eq.${id}` },
        () => load()
      )
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [id])

  async function load() {
    setLoading(true)
    try {
      const { data: g, error: gErr } = await supabase
        .from('report_groups')
        .select('*')
        .eq('id', id)
        .maybeSingle()
      if (gErr) throw gErr
      setGroup(g)
      if (g) {
        setReports(await listBrandReports(g.id))
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleDownload(r) {
    try {
      const url = await getReportSignedUrl(r.excel_storage_path)
      window.open(url, '_blank')
    } catch (e) {
      alert('다운로드 URL 생성 실패: ' + e.message)
    }
  }

  async function toggleStatus(r) {
    try {
      await updateBrandReportStatus(r.id, r.status === 'done' ? 'editing' : 'done')
    } catch (e) {
      alert('상태 변경 실패: ' + e.message)
    }
  }

  async function saveNote(r) {
    try {
      await updateBrandReportNote(r.id, noteDraft)
      setEditingNote(null)
      setNoteDraft('')
    } catch (e) {
      alert('메모 저장 실패: ' + e.message)
    }
  }

  async function handleDelete(r) {
    if (!window.confirm(`"${r.brand_name}" 보고서를 삭제합니다. 계속?`)) return
    try {
      await deleteBrandReport(r.id, r.excel_storage_path)
    } catch (e) {
      alert('삭제 실패: ' + e.message)
    }
  }

  if (loading) {
    return (
      <div className="p-8 max-w-5xl mx-auto">
        <div className="py-12 text-center text-sm text-slate-400 flex items-center justify-center gap-2">
          <Loader2 size={14} className="animate-spin" /> 불러오는 중...
        </div>
      </div>
    )
  }

  if (!group) {
    return (
      <div className="p-8 max-w-5xl mx-auto">
        <Link to="/reports/groups" className="text-sm text-slate-500 hover:text-slate-900 flex items-center gap-1 mb-4">
          <ChevronLeft size={14} /> 그룹 목록
        </Link>
        <div className="py-12 text-center text-sm text-rose-600">
          그룹을 찾을 수 없습니다 (삭제되었거나 권한 없음).
        </div>
      </div>
    )
  }

  const doneCount = reports.filter((r) => r.status === 'done').length
  const total = reports.length
  const progress = total ? Math.round((doneCount / total) * 100) : 0
  const allDone = total > 0 && doneCount === total

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-4">
        <Link
          to="/reports/groups"
          className="text-xs text-slate-500 hover:text-slate-900 flex items-center gap-1 mb-2"
        >
          <ChevronLeft size={14} /> 그룹 목록
        </Link>
        <div className="flex items-center gap-3">
          <FolderOpen className="text-myriad-ink" />
          <h1 className="text-2xl font-bold text-slate-900">{group.title}</h1>
          {group.status === 'published' && (
            <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-semibold">
              Drive 발행됨
            </span>
          )}
          <div className="flex-1" />
          <Link
            to="/reports"
            className="flex items-center gap-1.5 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-3 py-1.5 rounded-lg text-sm"
          >
            + 보고서 추가
          </Link>
        </div>
      </div>

      {/* 진행률 */}
      <section className="bg-white border border-slate-200 rounded-2xl p-5 mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold text-slate-900">진행 상황</div>
          <div className="text-sm text-slate-600">
            {doneCount} / {total} 완료 ({progress}%)
          </div>
        </div>
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all ${allDone ? 'bg-emerald-500' : 'bg-myriad-primary'}`}
            style={{ width: `${progress}%` }}
          />
        </div>
        {allDone && (
          <div className="mt-3 flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
            <CheckCircle2 className="text-emerald-600 shrink-0" size={16} />
            <div className="text-xs text-emerald-800 flex-1">
              <b>모든 보고서 완료 상태!</b> 다음 단계에서 Google Drive 에 일괄 업로드 기능이 추가될 예정입니다. (Phase 5c.3)
            </div>
          </div>
        )}
      </section>

      {error && (
        <div className="mb-4 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg p-3">
          {error}
        </div>
      )}

      {/* 브랜드 보고서 리스트 */}
      {reports.length === 0 ? (
        <div className="py-12 text-center text-sm text-slate-400 bg-white border border-slate-200 rounded-2xl">
          아직 이 그룹에 추가된 보고서가 없습니다.
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map((r) => (
            <div key={r.id} className="bg-white border border-slate-200 rounded-2xl p-5">
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-xl bg-myriad-primary/10 flex items-center justify-center text-xl shrink-0">
                  📊
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-bold text-slate-900">{r.brand_name}</h3>
                    <StatusBadge status={r.status} />
                    <span className="text-[10px] text-slate-500">Top {r.top_n}</span>
                  </div>
                  <div className="text-xs text-slate-500 mt-1 flex items-center gap-3 flex-wrap">
                    <span className="flex items-center gap-1">
                      <Clock size={10} /> {new Date(r.updated_at).toLocaleString('ko-KR')}
                    </span>
                    {r.excel_file_name && (
                      <span className="flex items-center gap-1">
                        <FileSpreadsheet size={10} /> {r.excel_file_name}
                      </span>
                    )}
                  </div>
                  {/* 메모 */}
                  {editingNote === r.id ? (
                    <div className="mt-2 flex gap-2 items-start">
                      <textarea
                        value={noteDraft}
                        onChange={(e) => setNoteDraft(e.target.value)}
                        rows={2}
                        placeholder="작업 메모 (선택)"
                        className="flex-1 text-xs px-2 py-1.5 border border-slate-300 rounded resize-none"
                        autoFocus
                      />
                      <div className="flex flex-col gap-1">
                        <button
                          onClick={() => saveNote(r)}
                          className="text-xs px-2 py-1 bg-myriad-primary text-myriad-ink rounded"
                        >
                          저장
                        </button>
                        <button
                          onClick={() => { setEditingNote(null); setNoteDraft('') }}
                          className="text-xs px-2 py-1 border border-slate-300 text-slate-600 rounded"
                        >
                          취소
                        </button>
                      </div>
                    </div>
                  ) : r.note ? (
                    <div
                      onClick={() => { setEditingNote(r.id); setNoteDraft(r.note) }}
                      className="mt-2 text-xs text-slate-600 bg-amber-50 border border-amber-200 rounded p-2 cursor-pointer hover:bg-amber-100 whitespace-pre-wrap"
                      title="클릭해서 편집"
                    >
                      <StickyNote size={10} className="inline mr-1" />
                      {r.note}
                    </div>
                  ) : (
                    <button
                      onClick={() => { setEditingNote(r.id); setNoteDraft('') }}
                      className="text-[11px] text-slate-400 hover:text-slate-700 mt-2 flex items-center gap-1"
                    >
                      <StickyNote size={10} /> 메모 추가
                    </button>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 mt-4 pt-4 border-t border-slate-100">
                <button
                  onClick={() => handleDownload(r)}
                  className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-myriad-ink px-3 py-1.5 rounded-lg hover:bg-slate-100"
                >
                  <Download size={12} /> Excel
                </button>
                <div className="flex-1" />
                {isAdmin && (
                  <button
                    onClick={() => handleDelete(r)}
                    className="text-xs text-rose-600 hover:bg-rose-50 px-2 py-1.5 rounded-lg flex items-center gap-1"
                  >
                    <Trash2 size={12} /> 삭제
                  </button>
                )}
                <button
                  onClick={() => toggleStatus(r)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold ${
                    r.status === 'done'
                      ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                      : 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                  }`}
                >
                  {r.status === 'done' ? (
                    <>
                      <CheckCircle2 size={14} /> 완료
                    </>
                  ) : (
                    <>
                      <Edit3 size={14} /> 수정 중
                    </>
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }) {
  if (status === 'done') {
    return (
      <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full flex items-center gap-1">
        <CheckCircle2 size={10} /> 완료
      </span>
    )
  }
  return (
    <span className="text-[10px] font-semibold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full flex items-center gap-1">
      <Edit3 size={10} /> 수정 중
    </span>
  )
}
