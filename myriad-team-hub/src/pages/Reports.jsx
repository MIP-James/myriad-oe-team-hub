import { useState, useCallback } from 'react'
import {
  BarChart3, Upload, FileSpreadsheet, Download, Loader2, CheckCircle2,
  AlertCircle, RefreshCw, Calendar
} from 'lucide-react'
import { generateReport, normalizeReportMonth } from '../lib/reportGenerator'

const DEFAULT_REPORT_MONTH = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function Reports() {
  const [prevFile, setPrevFile] = useState(null)
  const [currFile, setCurrFile] = useState(null)
  const [reportMonth, setReportMonth] = useState(DEFAULT_REPORT_MONTH())
  const [topN, setTopN] = useState(3)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [log, setLog] = useState([])

  function appendLog(msg) {
    const ts = new Date().toLocaleTimeString('ko-KR', { hour12: false })
    setLog((prev) => [...prev, `[${ts}] ${msg}`])
  }

  async function handleGenerate() {
    setError(null)
    setResult(null)
    setLog([])
    if (!prevFile) return setError('직전달 엑셀 파일을 선택하세요.')
    if (!currFile) return setError('이번달 엑셀 파일을 선택하세요.')
    let opt
    try {
      opt = {
        reportMonth: normalizeReportMonth(reportMonth),
        topN: Math.max(3, Math.min(5, Number(topN) || 3))
      }
    } catch (e) {
      return setError(e.message)
    }

    setRunning(true)
    try {
      appendLog('직전달 파일 파싱 중...')
      await new Promise((r) => setTimeout(r, 10)) // yield to UI
      appendLog('이번달 파일 파싱 중...')
      const { buffer, fileName, brand, useDivision } = await generateReport(
        prevFile,
        currFile,
        opt
      )
      appendLog(`브랜드 인식: ${brand} · 집계 기준: ${useDivision ? '사업부' : '상품유형'}`)
      appendLog('Excel 생성 완료.')
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      })
      const url = URL.createObjectURL(blob)
      setResult({ url, fileName, brand, useDivision, opt })
      appendLog(`파일 준비됨: ${fileName}`)
    } catch (e) {
      console.error(e)
      setError(e.message || String(e))
      appendLog(`오류: ${e.message || e}`)
    } finally {
      setRunning(false)
    }
  }

  function reset() {
    if (result?.url) URL.revokeObjectURL(result.url)
    setPrevFile(null)
    setCurrFile(null)
    setResult(null)
    setError(null)
    setLog([])
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <header className="mb-6 flex items-center gap-3">
        <BarChart3 className="text-myriad-ink" />
        <h1 className="text-2xl font-bold text-slate-900">월간 동향 보고서</h1>
        <div className="flex-1" />
        {(prevFile || currFile || result) && (
          <button
            onClick={reset}
            className="text-sm text-slate-500 hover:text-slate-900 flex items-center gap-1"
          >
            <RefreshCw size={12} /> 초기화
          </button>
        )}
      </header>

      <p className="text-sm text-slate-500 mb-6">
        직전달/이번달 엑셀 파일을 업로드하면 비교 보고서 Excel 이 생성됩니다.
        모든 처리는 <b>본인 브라우저에서만</b> 이뤄지고 서버로 파일이 전송되지 않습니다.
      </p>

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
      </section>

      {/* 파일 업로드 */}
      <section className="bg-white border border-slate-200 rounded-2xl p-5 mb-4">
        <h2 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
          <Upload size={16} /> 엑셀 파일
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <FileUpload
            label="직전달 엑셀"
            file={prevFile}
            onChange={setPrevFile}
          />
          <FileUpload
            label="이번달 엑셀"
            file={currFile}
            onChange={setCurrFile}
          />
        </div>
        <p className="text-[11px] text-slate-400 mt-3">
          필수 컬럼: <code>Platform</code>, <code>Model Type</code> (또는 <code>Product Model Type</code>), <code>Infringement Type</code>.
          선택 컬럼: <code>Business Division</code> (있으면 사업부 기준 집계), <code>Client</code> (브랜드명 자동 인식).
        </p>
      </section>

      {/* 실행 */}
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

      {/* 진행 로그 */}
      {log.length > 0 && (
        <section className="bg-slate-50 border border-slate-200 rounded-2xl p-4 mb-4">
          <h3 className="text-xs font-semibold text-slate-600 mb-2 uppercase tracking-wider">진행 로그</h3>
          <pre className="text-[11px] text-slate-700 whitespace-pre-wrap font-mono leading-relaxed max-h-48 overflow-auto">
            {log.join('\n')}
          </pre>
        </section>
      )}

      {/* 결과 */}
      {result && (
        <section className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5">
          <div className="flex items-start gap-3 mb-4">
            <CheckCircle2 className="text-emerald-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-bold text-emerald-900">보고서 생성 완료</h3>
              <div className="text-xs text-emerald-800 mt-1 space-y-0.5">
                <div>
                  브랜드: <b>{result.brand}</b>
                </div>
                <div>
                  보고월: <b>{result.opt.reportMonth}</b> · Top {result.opt.topN}
                </div>
                <div>
                  집계 기준: <b>{result.useDivision ? '사업부' : '상품 유형'}</b>
                </div>
                <div>
                  파일명: <code>{result.fileName}</code>
                </div>
              </div>
            </div>
          </div>
          <a
            href={result.url}
            download={result.fileName}
            className="inline-flex items-center gap-2 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-4 py-2 rounded-lg"
          >
            <Download size={16} /> Excel 다운로드
          </a>
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
            <FileSpreadsheet
              size={28}
              className="mx-auto mb-2 text-emerald-600"
            />
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
