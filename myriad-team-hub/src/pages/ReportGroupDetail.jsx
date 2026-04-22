import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  FolderOpen, Loader2, ChevronLeft, Download, Edit3, CheckCircle2,
  Trash2, RefreshCw, FileSpreadsheet, Clock, StickyNote, ExternalLink,
  Maximize2, X, Upload, AlertTriangle, Send, Rocket
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  listBrandReports, getReportSignedUrl, updateBrandReportStatus,
  updateBrandReportNote, deleteBrandReport, updateBrandReportGoogleSheet
} from '../lib/reportStore'
import {
  uploadExcelAsSheet, GoogleAuthRequiredError,
  findOrCreateSubfolder, moveFile, extractFolderId, extractSheetId, folderIdToUrl,
  probeFolder
} from '../lib/googleDrive'
import { logActivity } from '../lib/community'
import { countCommentsForReports } from '../lib/comments'
import BrandReportComments from '../components/BrandReportComments'

// 기본 Drive 루트 폴더 URL (관리자가 모달에서 변경 가능)
// 이 폴더 아래로 {YYYY}년 / {M}월 서브폴더를 자동 생성해서 시트를 이동
const DEFAULT_TARGET_FOLDER_URL =
  import.meta.env.VITE_REPORTS_DRIVE_FOLDER_URL ||
  'https://drive.google.com/drive/folders/1NaTQooL7DC053_awAL-LrBI5meR9rahH'  // [BP] 월간 보고

function parseYearMonth(ym) {
  const [y, m] = String(ym).split('-')
  return {
    yearFolderName: y,                     // "2026"  ← 팀 컨벤션: "년" 접미사 없음
    monthFolderName: `${parseInt(m, 10)}월` // "4월" (leading zero 제거)
  }
}
import { useAuth } from '../contexts/AuthContext'

function toEmbedUrl(url) {
  if (!url) return ''
  const sep = url.includes('?') ? '&' : '?'
  return url + sep + 'rm=minimal'
}

export default function ReportGroupDetail() {
  const { id } = useParams()
  const { user, isAdmin, googleAccessToken } = useAuth()
  const [group, setGroup] = useState(null)
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editingNote, setEditingNote] = useState(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [opened, setOpened] = useState(null)   // 풀스크린 iframe 중인 보고서
  const [uploadingId, setUploadingId] = useState(null)   // Sheet 생성 중인 보고서 id
  const [publishing, setPublishing] = useState(false)
  const [publishDialog, setPublishDialog] = useState(null)  // { targetUrl } when open
  const [publishResult, setPublishResult] = useState(null)  // { folderUrl, errors }
  const [commentCounts, setCommentCounts] = useState({})    // { reportId: { total, open } }

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
        const rs = await listBrandReports(g.id)
        setReports(rs)
        // 댓글 카운트 미리 로드 (뱃지용)
        const counts = await countCommentsForReports(rs.map((r) => r.id))
        setCommentCounts(counts)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // 댓글 변동 시 카운트도 실시간 갱신
  useEffect(() => {
    if (!reports.length) return
    const ch = supabase
      .channel('report-comments-count-' + id)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'brand_report_comments' },
        async () => {
          const counts = await countCommentsForReports(reports.map((r) => r.id))
          setCommentCounts(counts)
        }
      )
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [reports.map((r) => r.id).join(','), id])

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
      const next = r.status === 'done' ? 'editing' : 'done'
      await updateBrandReportStatus(r.id, next)
      logActivity('brand_report_status_changed', {
        target_type: 'brand_report',
        target_id: r.id,
        payload: { brand: r.brand_name, from: r.status, to: next, group_id: r.group_id }
      })
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

  async function handlePublish(targetUrl) {
    if (!googleAccessToken) {
      alert('Google 연결이 필요합니다. 로그아웃 → 재로그인.')
      return
    }
    const rootFolderId = extractFolderId(targetUrl)
    if (!rootFolderId) {
      alert('유효한 Google Drive 폴더 URL 이 아닙니다.\n(예: https://drive.google.com/drive/folders/xxx)')
      return
    }

    const { yearFolderName, monthFolderName } = parseYearMonth(group.year_month)

    setPublishing(true)
    setPublishResult(null)
    try {
      // 0) 루트 폴더 접근 가능한지 먼저 확인 (상세 에러 메시지 위함)
      const rootFolder = await probeFolder(googleAccessToken, rootFolderId)
      console.log('[publish] root folder:', rootFolder)

      // 1) 루트 폴더 아래 {YYYY}년 폴더 확보 (없으면 생성, 있으면 재사용)
      const yearFolder = await findOrCreateSubfolder(
        googleAccessToken,
        rootFolderId,
        yearFolderName
      )

      // 2) 그 안에 {M}월 폴더 확보
      const monthFolder = await findOrCreateSubfolder(
        googleAccessToken,
        yearFolder.id,
        monthFolderName
      )

      // 3) 각 Sheet 를 월 폴더로 이동
      const errors = []
      let movedCount = 0
      for (const r of reports) {
        if (!r.google_sheet_url) {
          errors.push(`${r.brand_name}: Google Sheet 링크 없음 — 먼저 "Sheet 생성" 필요`)
          continue
        }
        const sheetId = extractSheetId(r.google_sheet_url)
        if (!sheetId) {
          errors.push(`${r.brand_name}: URL 파싱 실패 (${r.google_sheet_url})`)
          continue
        }
        try {
          await moveFile(googleAccessToken, sheetId, monthFolder.id)
          movedCount++
        } catch (e) {
          if (e instanceof GoogleAuthRequiredError) {
            throw e
          }
          errors.push(`${r.brand_name}: ${e.message}`)
        }
      }

      // 4) 전부 성공했으면 그룹 상태 업데이트 (month 폴더 ID 저장)
      const folderUrl = folderIdToUrl(monthFolder.id)
      if (errors.length === 0) {
        const { error: updErr } = await supabase
          .from('report_groups')
          .update({
            status: 'published',
            google_drive_folder_id: monthFolder.id
          })
          .eq('id', group.id)
        if (updErr) throw updErr
        logActivity('report_group_published', {
          target_type: 'report_group',
          target_id: group.id,
          payload: {
            year_month: group.year_month,
            group_id: group.id,
            folder_url: folderUrl,
            moved_count: movedCount
          }
        })
      }

      setPublishResult({
        folderUrl,
        folderPath: `${yearFolderName} / ${monthFolderName}`,
        errors,
        movedCount,
        total: reports.length
      })
      setPublishDialog(null)
    } catch (e) {
      if (e instanceof GoogleAuthRequiredError) {
        alert('Google 세션 만료. 로그아웃 후 재로그인 해주세요.')
      } else {
        alert('발행 실패: ' + e.message)
      }
    } finally {
      setPublishing(false)
    }
  }

  async function handleCreateOrRefreshSheet(r) {
    if (!googleAccessToken) {
      alert(
        'Google 연결이 필요합니다. 로그아웃 → 재로그인 시 Google Drive 권한 동의 후 다시 시도하세요.'
      )
      return
    }
    setUploadingId(r.id)
    try {
      // Storage 에서 Excel 다운로드
      const signedUrl = await getReportSignedUrl(r.excel_storage_path)
      const resp = await fetch(signedUrl)
      if (!resp.ok) throw new Error('Storage 다운로드 실패')
      const buffer = await resp.arrayBuffer()

      // Google Drive 로 업로드
      const sheetName = `${r.brand_name} ${r.report_month} 월간동향`
      const driveResult = await uploadExcelAsSheet(googleAccessToken, buffer, sheetName)
      await updateBrandReportGoogleSheet(r.id, driveResult.webViewLink)
    } catch (e) {
      if (e instanceof GoogleAuthRequiredError) {
        alert('Google 세션 만료. 로그아웃 후 재로그인 해주세요.')
      } else {
        alert('Google Sheets 업로드 실패: ' + e.message)
      }
    } finally {
      setUploadingId(null)
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

  // iframe 풀스크린 (Google Sheet 편집)
  if (opened) {
    return (
      <div className="fixed inset-0 z-40 bg-white flex flex-col">
        <div className="h-12 border-b border-slate-200 bg-white flex items-center gap-3 px-4 shrink-0">
          <button
            onClick={() => setOpened(null)}
            className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 px-2 py-1 rounded hover:bg-slate-100"
          >
            <X size={16} /> 그룹으로
          </button>
          <div className="w-px h-5 bg-slate-200" />
          <span className="text-xl">📊</span>
          <span className="font-semibold text-slate-900 truncate">
            {opened.brand_name}
            <span className="text-xs text-slate-500 ml-2">{opened.report_month}</span>
          </span>
          <StatusBadge status={opened.status} />
          <div className="flex-1" />
          <button
            onClick={() => toggleStatus(opened)}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold ${
              opened.status === 'done'
                ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                : 'bg-amber-100 text-amber-800 hover:bg-amber-200'
            }`}
          >
            {opened.status === 'done' ? (
              <><CheckCircle2 size={12} /> 완료</>
            ) : (
              <><Edit3 size={12} /> 수정 중</>
            )}
          </button>
          <a
            href={opened.google_sheet_url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-900 px-2 py-1 rounded hover:bg-slate-100"
          >
            <ExternalLink size={12} /> 새 탭
          </a>
        </div>
        <iframe
          src={toEmbedUrl(opened.google_sheet_url)}
          title={opened.brand_name}
          className="flex-1 w-full border-0"
        />
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

      {!googleAccessToken && (
        <div className="mb-4 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg p-3 flex items-start gap-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <div>
            <b>Google Drive 연결 없음.</b> "Sheet 생성/편집" 기능을 쓰려면 로그아웃 후 재로그인 시 Drive 권한에 동의해주세요.
            Excel 다운로드 기능은 그대로 사용 가능합니다.
          </div>
        </div>
      )}

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
        {group.status === 'published' && group.google_drive_folder_id && (
          <div className="mt-3 flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
            <CheckCircle2 className="text-emerald-600 shrink-0" size={16} />
            <div className="text-xs text-emerald-800 flex-1">
              <b>Drive 발행 완료됨.</b>{' '}
              <a
                href={folderIdToUrl(group.google_drive_folder_id)}
                target="_blank"
                rel="noreferrer"
                className="underline font-semibold"
              >
                Drive 폴더 열기 →
              </a>
            </div>
          </div>
        )}
        {allDone && group.status !== 'published' && (
          <div className="mt-3 flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
            <CheckCircle2 className="text-emerald-600 shrink-0" size={16} />
            <div className="text-xs text-emerald-800 flex-1">
              <b>모든 보고서 완료!</b> 아래 "Drive 로 발행" 으로 지정 폴더에 일괄 이동할 수 있습니다.
            </div>
            {isAdmin && (
              <button
                onClick={() => setPublishDialog({ targetUrl: DEFAULT_TARGET_FOLDER_URL })}
                disabled={publishing}
                className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-3 py-1.5 rounded-lg text-sm disabled:opacity-50"
              >
                {publishing ? (
                  <><Loader2 size={14} className="animate-spin" /> 발행 중...</>
                ) : (
                  <><Rocket size={14} /> Drive 로 발행</>
                )}
              </button>
            )}
          </div>
        )}
      </section>

      {publishResult && (
        <section className={`mb-4 rounded-2xl p-4 border ${
          publishResult.errors.length === 0
            ? 'bg-emerald-50 border-emerald-200'
            : 'bg-amber-50 border-amber-200'
        }`}>
          <div className="flex items-start gap-2">
            {publishResult.errors.length === 0 ? (
              <Rocket className="text-emerald-600 shrink-0 mt-0.5" size={16} />
            ) : (
              <AlertTriangle className="text-amber-600 shrink-0 mt-0.5" size={16} />
            )}
            <div className="flex-1 text-sm">
              <div className="font-semibold text-slate-900">
                {publishResult.errors.length === 0 ? '발행 완료' : '일부 실패'}
              </div>
              <div className="text-xs text-slate-700 mt-1">
                {publishResult.movedCount}/{publishResult.total}개 시트를{' '}
                <code className="bg-white px-1 rounded">{publishResult.folderPath}</code> 폴더로 이동했습니다.
              </div>
              {publishResult.errors.length > 0 && (
                <ul className="text-xs text-rose-700 mt-2 list-disc pl-4">
                  {publishResult.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              )}
              <div className="mt-2">
                <a
                  href={publishResult.folderUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-emerald-800 font-semibold underline"
                >
                  <ExternalLink size={11} /> Drive 폴더 열기
                </a>
              </div>
            </div>
            <button
              onClick={() => setPublishResult(null)}
              className="text-slate-400 hover:text-slate-700"
            >
              <X size={16} />
            </button>
          </div>
        </section>
      )}

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
          {reports.map((r) => {
            const cc = commentCounts[r.id] || { total: 0, open: 0 }
            return (
            <div
              key={r.id}
              className={`bg-white border rounded-2xl p-5 ${
                cc.open > 0 ? 'border-rose-200 ring-1 ring-rose-100' : 'border-slate-200'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-xl bg-myriad-primary/10 flex items-center justify-center text-xl shrink-0">
                  📊
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-bold text-slate-900">{r.brand_name}</h3>
                    <StatusBadge status={r.status} />
                    <span className="text-[10px] text-slate-500">Top {r.top_n}</span>
                    {cc.open > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded-full">
                        💬 미해결 {cc.open}
                      </span>
                    )}
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

              <div className="flex items-center gap-2 mt-4 pt-4 border-t border-slate-100 flex-wrap">
                <button
                  onClick={() => handleDownload(r)}
                  className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-myriad-ink px-3 py-1.5 rounded-lg hover:bg-slate-100"
                >
                  <Download size={12} /> Excel
                </button>
                {r.google_sheet_url ? (
                  <button
                    onClick={() => setOpened(r)}
                    className="flex items-center gap-1.5 text-xs bg-sky-50 text-sky-700 hover:bg-sky-100 px-3 py-1.5 rounded-lg font-semibold"
                  >
                    <Maximize2 size={12} /> Sheet 편집
                  </button>
                ) : (
                  <button
                    onClick={() => handleCreateOrRefreshSheet(r)}
                    disabled={uploadingId === r.id}
                    className="flex items-center gap-1.5 text-xs bg-white border border-sky-300 text-sky-700 hover:bg-sky-50 px-3 py-1.5 rounded-lg disabled:opacity-50"
                    title="Storage 의 Excel 을 Google Sheets 로 변환 업로드"
                  >
                    {uploadingId === r.id ? (
                      <><Loader2 size={12} className="animate-spin" /> 생성 중...</>
                    ) : (
                      <><Upload size={12} /> Sheet 생성</>
                    )}
                  </button>
                )}
                {r.google_sheet_url && isAdmin && (
                  <button
                    onClick={() => handleCreateOrRefreshSheet(r)}
                    disabled={uploadingId === r.id}
                    className="text-xs text-slate-400 hover:text-slate-700 px-1 py-1.5 rounded"
                    title="Excel 로부터 Google Sheet 재생성 (기존 링크는 유지, 새 Sheet 생성됨)"
                  >
                    {uploadingId === r.id ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={11} />}
                  </button>
                )}
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
                    <><CheckCircle2 size={14} /> 완료</>
                  ) : (
                    <><Edit3 size={14} /> 수정 중</>
                  )}
                </button>
              </div>

              {/* 댓글 스레드 — 미해결 있으면 기본 펼침 */}
              <BrandReportComments report={r} defaultOpen={cc.open > 0} />
            </div>
            )
          })}
        </div>
      )}

      {publishDialog && (
        <PublishDialog
          group={group}
          reports={reports}
          defaultTargetUrl={publishDialog.targetUrl}
          onCancel={() => setPublishDialog(null)}
          onConfirm={handlePublish}
          publishing={publishing}
        />
      )}
    </div>
  )
}

function PublishDialog({ group, reports, defaultTargetUrl, onCancel, onConfirm, publishing }) {
  const [targetUrl, setTargetUrl] = useState(defaultTargetUrl)

  const sheetReports = reports.filter((r) => r.google_sheet_url)
  const missingSheets = reports.filter((r) => !r.google_sheet_url)
  const { yearFolderName, monthFolderName } = parseYearMonth(group.year_month)

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-2">
          <Rocket className="text-emerald-600" size={18} />
          <h2 className="font-bold text-slate-900">Drive 로 발행</h2>
          <div className="flex-1" />
          <button onClick={onCancel} className="p-1 hover:bg-slate-100 rounded">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 overflow-auto space-y-4">
          <p className="text-sm text-slate-700">
            아래 루트 폴더 안에{' '}
            <code className="bg-slate-100 px-1 rounded text-xs">{yearFolderName} / {monthFolderName}</code>
            {' '}계층 폴더를 자동 생성/재사용하여 모든 Google Sheets 를 이동합니다.
          </p>

          <div>
            <label className="text-xs font-semibold text-slate-600 block mb-1">
              루트 Drive 폴더 URL (기본: [BP] 월간 보고)
            </label>
            <input
              type="url"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="https://drive.google.com/drive/folders/..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40 text-xs font-mono"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              최종 경로: <b>[지정 루트]</b> / <code>{yearFolderName}</code> / <code>{monthFolderName}</code> / 브랜드 시트들
            </p>
          </div>

          {missingSheets.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
              <div className="font-semibold flex items-center gap-1">
                <AlertTriangle size={12} /> Google Sheet 미생성 {missingSheets.length}건
              </div>
              <ul className="list-disc pl-4 mt-1">
                {missingSheets.map((r) => (
                  <li key={r.id}>{r.brand_name} — 먼저 "Sheet 생성" 필요</li>
                ))}
              </ul>
              <p className="mt-1 text-amber-700">
                발행은 진행되지만 이 보고서들은 제외됩니다. Sheet 생성 후 재발행 권장.
              </p>
            </div>
          )}

          {sheetReports.length > 0 && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
              <div className="text-xs font-semibold text-slate-600 mb-2">
                이동될 Sheets ({sheetReports.length}건)
              </div>
              <ul className="text-xs text-slate-700 space-y-0.5 max-h-40 overflow-auto">
                {sheetReports.map((r) => (
                  <li key={r.id} className="flex items-center gap-2">
                    <FileSpreadsheet size={11} className="text-sky-500 shrink-0" />
                    <span className="truncate">{r.brand_name}</span>
                    <StatusBadge status={r.status} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={publishing}
            className="text-slate-600 hover:bg-slate-100 px-4 py-2 rounded-lg disabled:opacity-50"
          >
            취소
          </button>
          <button
            onClick={() => onConfirm(targetUrl)}
            disabled={publishing || sheetReports.length === 0}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
          >
            {publishing ? (
              <><Loader2 size={14} className="animate-spin" /> 발행 중...</>
            ) : (
              <><Send size={14} /> 발행 확정</>
            )}
          </button>
        </div>
      </div>
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
