import { useState, useCallback, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  BarChart3, Upload, FileSpreadsheet, Download, Loader2, CheckCircle2,
  AlertCircle, RefreshCw, Calendar, FolderOpen, Save, Layers
} from 'lucide-react'
import { generateReport, normalizeReportMonth, inspectExcelTabs } from '../lib/reportGenerator'
import {
  getOrCreateGroup, uploadBrandReport, listGroups, updateBrandReportGoogleSheet
} from '../lib/reportStore'
import { uploadExcelAsSheet, GoogleAuthRequiredError } from '../lib/googleDrive'
import { logActivity } from '../lib/community'
import { useAuth } from '../contexts/AuthContext'

// 탭 이름 정규화 (대소문자/공백 무시 매칭용 키)
function normTabKey(s) {
  return String(s || '').trim().toLowerCase()
}

const DEFAULT_REPORT_MONTH = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function Reports() {
  const { user, googleAccessToken } = useAuth()
  const [prevFile, setPrevFile] = useState(null)
  const [currFile, setCurrFile] = useState(null)
  const [reportMonth, setReportMonth] = useState(DEFAULT_REPORT_MONTH())
  const [topN, setTopN] = useState(3)
  const [saveToGroup, setSaveToGroup] = useState(true)
  const [running, setRunning] = useState(false)
  // result 는 항상 배열 (단일 모드도 길이 1) — 결과 카드 표시용
  const [results, setResults] = useState(null)
  const [error, setError] = useState(null)
  const [log, setLog] = useState([])
  const [recentGroups, setRecentGroups] = useState([])
  // 다중 시트 탭 합집합 — [{ tabKey, tabDisplay, autoBrand }] (표시용)
  const [tabUnion, setTabUnion] = useState([])
  // 사용자가 입력한 메인 고객사명 (다중 탭일 때만 사용)
  const [mergedBrand, setMergedBrand] = useState('')
  const [inspecting, setInspecting] = useState(false)
  const [inspectError, setInspectError] = useState(null)

  useEffect(() => { loadRecent() }, [])

  // 두 파일 모두 선택되면 탭 합집합 자동 검사 (표시 + 다중 여부 판단용)
  useEffect(() => {
    if (!prevFile || !currFile) {
      setTabUnion([])
      setInspectError(null)
      return
    }
    let cancelled = false
    setInspecting(true)
    setInspectError(null)
    Promise.all([inspectExcelTabs(prevFile), inspectExcelTabs(currFile)])
      .then(([prevTabs, currTabs]) => {
        if (cancelled) return
        const map = new Map()  // tabKey → { tabDisplay }
        for (const t of prevTabs) {
          const k = normTabKey(t.tabName)
          if (!map.has(k)) map.set(k, { tabDisplay: t.tabName })
        }
        for (const t of currTabs) {
          const k = normTabKey(t.tabName)
          map.set(k, { tabDisplay: t.tabName })  // curr 가 표시 우선
        }
        const union = [...map.entries()].map(([tabKey, v]) => ({
          tabKey, tabDisplay: v.tabDisplay
        }))
        setTabUnion(union)
      })
      .catch((e) => {
        if (cancelled) return
        setInspectError(e.message)
        setTabUnion([])
      })
      .finally(() => {
        if (!cancelled) setInspecting(false)
      })
    return () => { cancelled = true }
  }, [prevFile, currFile])

  async function loadRecent() {
    try {
      const groups = await listGroups()
      setRecentGroups(groups.slice(0, 3))
    } catch (e) {
      // 조용히 무시 (DB 테이블 없을 수 있음)
      console.warn('loadRecent:', e.message)
    }
  }

  function appendLog(msg) {
    const ts = new Date().toLocaleTimeString('ko-KR', { hour12: false })
    setLog((prev) => [...prev, `[${ts}] ${msg}`])
  }

  async function handleGenerate() {
    setError(null)
    // 기존 results 의 blob URL 정리
    if (results) {
      for (const r of results) if (r.url) URL.revokeObjectURL(r.url)
    }
    setResults(null)
    setLog([])
    if (!prevFile) return setError('직전달 엑셀 파일을 선택하세요.')
    if (!currFile) return setError('이번달 엑셀 파일을 선택하세요.')

    // 다중 탭 모드면 메인 고객사명 입력 필수
    if (tabUnion.length >= 2 && !mergedBrand.trim()) {
      return setError(
        `다중 시트 탭이 감지됐습니다 (${tabUnion.length}개). 메인 고객사명을 입력해주세요.`
      )
    }

    let opt
    try {
      opt = {
        reportMonth: normalizeReportMonth(reportMonth),
        topN: Math.max(3, Math.min(5, Number(topN) || 3)),
        mergedBrand: tabUnion.length >= 2 ? mergedBrand.trim() : undefined
      }
    } catch (e) {
      return setError(e.message)
    }

    setRunning(true)
    try {
      appendLog('엑셀 파일 파싱 중...')
      await new Promise((r) => setTimeout(r, 10))
      const generated = await generateReport(prevFile, currFile, opt)
      // generated 는 항상 배열 (단일 모드도 길이 1)
      if (generated._errors?.length) {
        for (const msg of generated._errors) appendLog(`⚠ ${msg}`)
      }
      appendLog(`보고서 ${generated.length}건 생성됨`)

      // 그룹 1번만 만들고 모든 보고서를 같은 그룹에 저장
      let group = null
      if (saveToGroup) {
        appendLog(`그룹 확인/생성 중 (${opt.reportMonth})...`)
        group = await getOrCreateGroup(opt.reportMonth, user?.id)
      }

      const finalResults = []
      for (let i = 0; i < generated.length; i++) {
        const g = generated[i]
        const tabLabel = g.tabName ? ` [${g.tabName}]` : ''
        appendLog(
          `(${i + 1}/${generated.length})${tabLabel} 브랜드: ${g.brand} · 집계 기준: ${g.useDivision ? '사업부' : '상품유형'}`
        )

        const blob = new Blob([g.buffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        })
        const url = URL.createObjectURL(blob)
        let savedReport = null

        if (saveToGroup && group) {
          try {
            appendLog(`(${i + 1}/${generated.length}) Storage 업로드 중...`)
            savedReport = await uploadBrandReport({
              groupId: group.id,
              brandName: g.brand,
              reportMonth: opt.reportMonth,
              topN: opt.topN,
              excelBuffer: g.buffer,
              fileName: g.fileName,
              userId: user?.id
            })
            appendLog(`✓ "${g.brand}" 보고서 저장 완료`)
            logActivity('report_generated', {
              target_type: 'brand_report',
              target_id: savedReport.id,
              payload: { brand: g.brand, month: opt.reportMonth, group_id: group.id }
            })
          } catch (e) {
            appendLog(`⚠ "${g.brand}" Storage 저장 실패: ${e.message}`)
          }

          if (savedReport && googleAccessToken) {
            try {
              appendLog(`(${i + 1}/${generated.length}) Google Drive 에 Sheet 로 업로드 중...`)
              const sheetName = `${g.brand} ${opt.reportMonth} 월간동향`
              const driveResult = await uploadExcelAsSheet(
                googleAccessToken,
                g.buffer,
                sheetName
              )
              await updateBrandReportGoogleSheet(savedReport.id, driveResult.webViewLink)
              savedReport.google_sheet_url = driveResult.webViewLink
              appendLog(`✓ Google Sheets 생성: ${sheetName}`)
            } catch (ge) {
              if (ge instanceof GoogleAuthRequiredError) {
                appendLog(`⚠ Google 세션 만료. 재로그인 후 그룹 화면에서 "Sheet 생성" 재시도 가능.`)
              } else {
                appendLog(`⚠ "${g.brand}" Google Sheets 업로드 실패: ${ge.message}`)
              }
            }
          }
        }

        finalResults.push({
          url, fileName: g.fileName, brand: g.brand,
          useDivision: g.useDivision, tabName: g.tabName,
          opt, savedReport
        })
      }

      if (!saveToGroup) appendLog('그룹 저장 스킵 (다운로드만)')
      if (saveToGroup && !googleAccessToken) {
        appendLog('ℹ Google 연결 없음 — 그룹 화면에서 수동으로 "Sheet 생성" 가능')
      }

      appendLog(`완료 — ${finalResults.length}건`)
      setResults(finalResults)
      loadRecent()
    } catch (e) {
      console.error(e)
      setError(e.message || String(e))
      appendLog(`오류: ${e.message || e}`)
    } finally {
      setRunning(false)
    }
  }

  function reset() {
    if (results) {
      for (const r of results) if (r.url) URL.revokeObjectURL(r.url)
    }
    setPrevFile(null)
    setCurrFile(null)
    setResults(null)
    setError(null)
    setLog([])
    setTabUnion([])
    setMergedBrand('')
    setInspectError(null)
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <header className="mb-6 flex items-center gap-3">
        <BarChart3 className="text-myriad-ink" />
        <h1 className="text-2xl font-bold text-slate-900">월간 동향 보고서</h1>
        <div className="flex-1" />
        <Link
          to="/reports/groups"
          className="text-sm text-slate-600 hover:text-myriad-ink flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-slate-100"
        >
          <FolderOpen size={14} /> 전체 보고서 그룹
        </Link>
        {(prevFile || currFile || results) && (
          <button
            onClick={reset}
            className="text-sm text-slate-500 hover:text-slate-900 flex items-center gap-1"
          >
            <RefreshCw size={12} /> 초기화
          </button>
        )}
      </header>

      <p className="text-sm text-slate-500 mb-6">
        직전달/이번달 엑셀 파일을 업로드하면 비교 보고서 Excel 이 생성되어
        월간 보고서 그룹에 자동 저장됩니다. 처리는 <b>본인 브라우저에서만</b>.
      </p>

      {/* 최근 그룹 요약 */}
      {recentGroups.length > 0 && (
        <section className="bg-slate-50 border border-slate-200 rounded-2xl p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
              최근 그룹
            </h3>
            <Link to="/reports/groups" className="text-xs text-myriad-ink hover:underline">
              전체 보기 →
            </Link>
          </div>
          <div className="flex gap-2 flex-wrap">
            {recentGroups.map((g) => (
              <Link
                key={g.id}
                to={`/reports/groups/${g.id}`}
                className="text-xs bg-white border border-slate-200 hover:border-myriad-primary px-3 py-1.5 rounded-lg flex items-center gap-1.5"
              >
                <FolderOpen size={11} /> {g.title}
                {g.status === 'published' && (
                  <span className="bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded text-[10px]">
                    발행
                  </span>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* 옵션 */}
      <section className="bg-white border border-slate-200 rounded-2xl p-5 mb-4">
        <h2 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
          <Calendar size={16} /> 옵션
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-semibold text-slate-600">보고월 (YYYY-MM)</span>
            <input
              type="text"
              value={reportMonth}
              onChange={(e) => setReportMonth(e.target.value)}
              placeholder="2026-04"
              className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40 font-mono text-sm"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-600">Top N (3~5)</span>
            <input
              type="number"
              min={3}
              max={5}
              value={topN}
              onChange={(e) => setTopN(e.target.value)}
              className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40"
            />
          </label>
        </div>
        <label className="flex items-start gap-2 mt-3 p-2 bg-amber-50 border border-amber-200 rounded-lg cursor-pointer">
          <input
            type="checkbox"
            checked={saveToGroup}
            onChange={(e) => setSaveToGroup(e.target.checked)}
            className="w-4 h-4 mt-0.5"
          />
          <span className="text-sm text-slate-700">
            <b>월간 보고서 그룹에 자동 저장</b>
            <span className="block text-xs text-slate-500 mt-0.5">
              체크하면 생성된 Excel 이 팀 공용 워크스페이스 ({reportMonth} 그룹) 에 저장되어
              다른 팀원과 공유되며, "수정 중 / 완료" 상태 추적도 가능합니다.
            </span>
          </span>
        </label>
      </section>

      {/* 파일 업로드 */}
      <section className="bg-white border border-slate-200 rounded-2xl p-5 mb-4">
        <h2 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
          <Upload size={16} /> 엑셀 파일
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <FileUpload label="직전달 엑셀" file={prevFile} onChange={setPrevFile} />
          <FileUpload label="이번달 엑셀" file={currFile} onChange={setCurrFile} />
        </div>
        <p className="text-[11px] text-slate-400 mt-3">
          필수 컬럼: <code>Platform</code>, <code>Model Type</code> (또는 <code>Product Model Type</code>), <code>Infringement Type</code>.
          선택: <code>Business Division</code>, <code>Client</code>.
          <br />
          <b>여러 고객사를 한 파일에 담으려면</b> 시트 탭을 고객사별로 분리해서 업로드하세요.
        </p>
      </section>

      {/* 탭 검사 진행/에러 */}
      {inspecting && (
        <div className="mb-4 bg-slate-50 border border-slate-200 text-slate-600 text-xs rounded-lg p-3 flex items-center gap-2">
          <Loader2 size={12} className="animate-spin" /> 시트 탭 구조 확인 중...
        </div>
      )}
      {inspectError && (
        <div className="mb-4 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg p-3 flex items-start gap-2">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <span className="whitespace-pre-wrap">시트 검사 실패: {inspectError}</span>
        </div>
      )}

      {/* 다중 탭 감지 시 — 메인 고객사명 입력 UI */}
      {tabUnion.length >= 2 && (
        <section className="bg-sky-50 border border-sky-200 rounded-2xl p-5 mb-4">
          <h2 className="font-semibold text-slate-900 mb-1 flex items-center gap-2">
            <Layers size={16} className="text-sky-700" /> 다중 시트 감지 — 메인 고객사명 입력
          </h2>
          <p className="text-xs text-slate-600 mb-3">
            <b>{tabUnion.length}개의 시트 탭</b>(브랜드별)이 발견됐습니다.
            모든 탭의 데이터를 합쳐서 <b>하나의 고객사 보고서</b>로 생성합니다.
            입력하신 이름이 팀 허브 카드 제목 + Google Sheet 제목 (<code>{'{고객사명}'} {reportMonth} 월간동향</code>) 으로 사용됩니다.
          </p>
          <div className="mb-3 flex flex-wrap gap-1.5">
            <span className="text-[11px] text-slate-500">감지된 탭:</span>
            {tabUnion.map((u) => (
              <span
                key={u.tabKey}
                className="text-[11px] font-mono text-slate-600 bg-white border border-slate-200 px-2 py-0.5 rounded"
                title={u.tabDisplay}
              >
                📄 {u.tabDisplay}
              </span>
            ))}
          </div>
          <label className="block">
            <span className="text-xs font-semibold text-slate-700">메인 고객사명</span>
            <input
              type="text"
              value={mergedBrand}
              onChange={(e) => setMergedBrand(e.target.value)}
              placeholder="예: TBH GLOBAL"
              className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-400/40 text-sm"
              autoFocus
            />
          </label>
        </section>
      )}

      <div className="flex gap-3 mb-4">
        <button
          onClick={handleGenerate}
          disabled={running || !prevFile || !currFile}
          className="flex-1 flex items-center justify-center gap-2 bg-myriad-primary hover:bg-myriad-primaryDark disabled:bg-slate-200 disabled:text-slate-400 text-myriad-ink font-semibold px-5 py-3 rounded-xl disabled:cursor-not-allowed transition"
        >
          {running ? (
            <>
              <Loader2 size={18} className="animate-spin" /> 생성 중...
            </>
          ) : saveToGroup ? (
            <>
              <Save size={18} /> 생성 + 그룹 저장
            </>
          ) : (
            <>
              <BarChart3 size={18} /> 보고서 생성
            </>
          )}
        </button>
      </div>

      {error && (
        <div className="mb-4 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg p-3 flex items-start gap-2">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <span className="whitespace-pre-wrap">{error}</span>
        </div>
      )}

      {log.length > 0 && (
        <section className="bg-slate-50 border border-slate-200 rounded-2xl p-4 mb-4">
          <h3 className="text-xs font-semibold text-slate-600 mb-2 uppercase tracking-wider">
            진행 로그
          </h3>
          <pre className="text-[11px] text-slate-700 whitespace-pre-wrap font-mono leading-relaxed max-h-48 overflow-auto">
            {log.join('\n')}
          </pre>
        </section>
      )}

      {results && results.length > 0 && (
        <section className="space-y-3">
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-start gap-3">
            <CheckCircle2 className="text-emerald-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-bold text-emerald-900">
                보고서 생성 완료 — 총 {results.length}건
              </h3>
              <div className="text-xs text-emerald-800 mt-0.5">
                보고월: <b>{results[0].opt.reportMonth}</b> · Top {results[0].opt.topN}
              </div>
            </div>
            {results[0].savedReport?.group_id && (
              <Link
                to={`/reports/groups/${results[0].savedReport.group_id}`}
                className="inline-flex items-center gap-2 bg-white border border-emerald-300 hover:bg-emerald-100 text-emerald-800 font-semibold px-3 py-1.5 rounded-lg text-sm shrink-0"
              >
                <FolderOpen size={14} /> 그룹에서 보기
              </Link>
            )}
          </div>
          {results.map((r, i) => (
            <div key={i} className="bg-white border border-emerald-200 rounded-2xl p-4">
              <div className="flex items-start gap-3 mb-3">
                <div className="w-9 h-9 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center text-base shrink-0">
                  📊
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-slate-900 truncate">
                    {r.brand}
                    {r.tabName && (
                      <span className="ml-2 text-[10px] font-mono text-slate-400">
                        ({r.tabName})
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    집계 기준: {r.useDivision ? '사업부' : '상품 유형'} · <code>{r.fileName}</code>
                  </div>
                  {r.savedReport && (
                    <div className="mt-1 inline-flex items-center gap-1 text-[10px] bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 text-emerald-700">
                      <Save size={10} /> 그룹 저장됨 {r.savedReport.google_sheet_url ? '· Sheet 생성됨' : ''}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex gap-2 flex-wrap">
                <a
                  href={r.url}
                  download={r.fileName}
                  className="inline-flex items-center gap-1.5 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-3 py-1.5 rounded-lg text-sm"
                >
                  <Download size={14} /> Excel
                </a>
                {r.savedReport?.google_sheet_url && (
                  <a
                    href={r.savedReport.google_sheet_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 bg-sky-50 border border-sky-200 text-sky-700 hover:bg-sky-100 font-semibold px-3 py-1.5 rounded-lg text-sm"
                  >
                    <FileSpreadsheet size={14} /> Google Sheet
                  </a>
                )}
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}

function FileUpload({ label, file, onChange }) {
  const [dragOver, setDragOver] = useState(false)

  const onDrop = useCallback(
    (e) => {
      e.preventDefault()
      setDragOver(false)
      const f = e.dataTransfer.files?.[0]
      if (f) onChange(f)
    },
    [onChange]
  )

  return (
    <div>
      <div className="text-xs font-semibold text-slate-600 mb-1">{label}</div>
      <label
        onDrop={onDrop}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        className={`block border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition ${
          dragOver
            ? 'border-myriad-primary bg-amber-50'
            : file
              ? 'border-emerald-300 bg-emerald-50'
              : 'border-slate-300 hover:border-slate-400 bg-slate-50'
        }`}
      >
        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={(e) => e.target.files?.[0] && onChange(e.target.files[0])}
          className="hidden"
        />
        {file ? (
          <div className="text-sm">
            <FileSpreadsheet size={28} className="mx-auto mb-2 text-emerald-600" />
            <div className="font-semibold text-slate-900 truncate">{file.name}</div>
            <div className="text-[10px] text-slate-500 mt-0.5">
              {(file.size / 1024).toFixed(1)} KB · 다시 클릭해서 변경
            </div>
          </div>
        ) : (
          <div className="text-sm text-slate-500 py-4">
            <Upload size={24} className="mx-auto mb-2 text-slate-400" />
            클릭하거나 파일을 드래그 해서 업로드
            <div className="text-[10px] text-slate-400 mt-1">.xlsx / .xls</div>
          </div>
        )}
      </label>
    </div>
  )
}
