/**
 * 화이트리스트 엑셀 업로드 마법사.
 *
 * 고객사마다 파일 양식이 완전히 다르다는 전제로 설계됨:
 *   파일 선택 → (시트/헤더행 확인) → 컬럼 매핑 → 미리보기 → 등록
 *
 * 매핑은 guessMapping() 이 먼저 추측하고, 같은 양식을 전에 올린 적이 있으면
 * header_signature 로 프리셋을 찾아 자동 적용한다. 사용자는 확인만 하면 됨.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  X, Upload, FileSpreadsheet, Loader2, Check, AlertTriangle, ChevronRight,
  ChevronLeft, Save, Sparkles
} from 'lucide-react'
import {
  parseWhitelistFile, rereadSheet, guessMapping, applyMapping,
  bulkUpsertSellers, listPresets, savePreset, findMatchingPreset
} from '../lib/whitelist'

// 매핑 대상 필드 정의 — multi: 여러 컬럼을 합쳐 배열로 담는 필드
const FIELDS = [
  { key: 'store_name', label: '가게/회사 이름', required: true, multi: false,
    hint: '매칭의 기본 후보. 파일의 Customer / Store name 컬럼' },
  { key: 'urls', label: '스토어 URL', required: false, multi: true,
    hint: '여러 컬럼 선택 가능. 도메인에서 이름 후보를 추가로 뽑아냄' },
  { key: 'aliases', label: '다른 이름 (별칭)', required: false, multi: true,
    hint: 'Other name for store 같은 컬럼' },
  { key: 'amazon_seller_name', label: '아마존 셀러 표시명', required: false, multi: false,
    hint: '있으면 정확 매칭됨. 보통 고객사 파일엔 없음' },
  { key: 'amazon_seller_id', label: '아마존 셀러 ID', required: false, multi: false,
    hint: '가장 확실한 키. 있으면 반드시 매핑' },
  { key: 'region', label: '지역/국가', required: false, multi: false, hint: '' },
  { key: 'channel', label: '플랫폼/구분', required: false, multi: false, hint: '' },
  { key: 'note', label: '비고', required: false, multi: false, hint: '' }
]

export default function WhitelistImportModal({ client, userId, onClose, onDone }) {
  const [step, setStep] = useState(1)
  const [parsed, setParsed] = useState(null)      // { fileName, sheets, _wb }
  const [sheetName, setSheetName] = useState('')
  const [sheetMeta, setSheetMeta] = useState(null)
  const [mapping, setMapping] = useState({})
  const [presets, setPresets] = useState([])
  const [appliedPreset, setAppliedPreset] = useState(null)
  const [savePresetName, setSavePresetName] = useState('')
  const [defaultRegion, setDefaultRegion] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [progress, setProgress] = useState(null)  // { done, total }
  const [result, setResult] = useState(null)

  useEffect(() => { listPresets().then(setPresets).catch(() => {}) }, [])

  async function handleFile(file) {
    if (!file) return
    if (!/\.xlsx?$/i.test(file.name)) {
      setError('.xlsx / .xls 파일만 업로드할 수 있습니다.')
      return
    }
    setBusy(true); setError(null)
    try {
      const p = await parseWhitelistFile(file)
      if (!p.sheets.length) throw new Error('시트를 찾을 수 없습니다.')
      setParsed(p)
      // 데이터가 가장 많은 시트를 기본 선택 (표지 시트가 앞에 있는 파일 대응)
      const best = [...p.sheets].sort((a, b) => b.totalRows - a.totalRows)[0]
      selectSheet(p, best.name, best.headerRow)
      setStep(2)
    } catch (e) {
      setError('파일을 읽지 못했습니다: ' + e.message)
    } finally {
      setBusy(false)
    }
  }

  function selectSheet(p, name, headerRow = null) {
    const base = p.sheets.find((s) => s.name === name)
    const meta = headerRow && headerRow !== base.headerRow
      ? rereadSheet(p._wb, name, headerRow)
      : base
    setSheetName(name)
    setSheetMeta(meta)

    // 저장된 프리셋이 같은 양식이면 그 매핑을 그대로 적용
    const hit = findMatchingPreset(presets, meta.headers)
    if (hit) {
      setMapping(hit.mapping)
      setAppliedPreset(hit)
    } else {
      setMapping(guessMapping(meta.headers))
      setAppliedPreset(null)
    }
  }

  function changeHeaderRow(delta) {
    const next = Math.max(1, (sheetMeta?.headerRow || 1) + delta)
    const meta = rereadSheet(parsed._wb, sheetName, next)
    setSheetMeta(meta)
    const hit = findMatchingPreset(presets, meta.headers)
    if (hit) { setMapping(hit.mapping); setAppliedPreset(hit) }
    else { setMapping(guessMapping(meta.headers)); setAppliedPreset(null) }
  }

  // 미리보기 — 실제 등록될 행을 그대로 계산해서 보여준다 (등록 후 놀라지 않도록)
  const preview = useMemo(() => {
    if (!parsed || !sheetMeta || !mapping.store_name) return null
    try {
      return applyMapping(sheetMeta, parsed._wb, mapping, { region: defaultRegion })
    } catch {
      return null
    }
  }, [parsed, sheetMeta, mapping, defaultRegion])

  async function runImport() {
    if (!preview?.rows?.length) { setError('등록할 행이 없습니다.'); return }
    setBusy(true); setError(null); setProgress({ done: 0, total: preview.rows.length })
    try {
      const r = await bulkUpsertSellers(
        client.id, preview.rows, userId, parsed.fileName,
        (done, total) => setProgress({ done, total })
      )
      // 프리셋 저장 — 다음에 같은 양식이 오면 자동 매핑됨
      if (savePresetName.trim()) {
        try {
          await savePreset({
            clientId: client.id,
            name: savePresetName.trim(),
            headerRow: sheetMeta.headerRow,
            headers: sheetMeta.headers,
            mapping
          }, userId)
        } catch { /* 프리셋 저장 실패가 등록을 되돌릴 이유는 없음 */ }
      }
      setResult(r)
      setStep(3)
      onDone?.()
    } catch (e) {
      setError('등록 실패: ' + e.message)
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col">
        <header className="px-6 py-4 border-b border-slate-200 flex items-center gap-3">
          <FileSpreadsheet size={18} className="text-myriad-ink" />
          <h2 className="font-bold text-slate-900">
            엑셀 업로드 — {client.name}
          </h2>
          <div className="flex-1" />
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded"><X size={18} /></button>
        </header>

        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-4 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg p-3 flex items-start gap-2">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" /> <span>{error}</span>
            </div>
          )}

          {step === 1 && <StepFile busy={busy} onFile={handleFile} />}

          {step === 2 && sheetMeta && (
            <StepMapping
              parsed={parsed} sheetName={sheetName} sheetMeta={sheetMeta}
              mapping={mapping} setMapping={setMapping}
              appliedPreset={appliedPreset}
              onSelectSheet={(n) => selectSheet(parsed, n)}
              onHeaderRow={changeHeaderRow}
              preview={preview}
              defaultRegion={defaultRegion} setDefaultRegion={setDefaultRegion}
              savePresetName={savePresetName} setSavePresetName={setSavePresetName}
            />
          )}

          {step === 3 && result && (
            <div className="py-10 text-center">
              <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
                <Check size={26} className="text-emerald-600" />
              </div>
              <h3 className="font-bold text-slate-900 mb-2">등록 완료</h3>
              <p className="text-sm text-slate-600">
                신규 <b className="text-emerald-700">{result.inserted}</b>건 추가,
                기존 <b className="text-sky-700">{result.updated}</b>건 갱신되었습니다.
              </p>
              {savePresetName.trim() && (
                <p className="text-xs text-slate-500 mt-3">
                  매핑을 "{savePresetName.trim()}" 프리셋으로 저장했습니다. 다음에 같은 양식은 자동 인식됩니다.
                </p>
              )}
            </div>
          )}
        </div>

        <footer className="px-6 py-4 border-t border-slate-200 flex items-center gap-2">
          {step === 2 && (
            <button
              onClick={() => { setStep(1); setParsed(null); setError(null) }}
              className="text-slate-600 hover:bg-slate-100 px-3 py-2 rounded-lg text-sm flex items-center gap-1"
            >
              <ChevronLeft size={14} /> 다른 파일
            </button>
          )}
          <div className="flex-1" />
          {progress && (
            <span className="text-xs text-slate-500 mr-2">
              {progress.done} / {progress.total} 처리 중...
            </span>
          )}
          {step === 3 ? (
            <button
              onClick={onClose}
              className="bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-5 py-2 rounded-lg text-sm"
            >
              닫기
            </button>
          ) : (
            <>
              <button onClick={onClose} className="text-slate-600 hover:bg-slate-100 px-4 py-2 rounded-lg text-sm">
                취소
              </button>
              {step === 2 && (
                <button
                  onClick={runImport}
                  disabled={busy || !preview?.rows?.length}
                  className="flex items-center gap-2 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-5 py-2 rounded-lg text-sm disabled:opacity-50"
                >
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                  {preview?.rows?.length ? `${preview.rows.length}건 등록` : '등록'}
                </button>
              )}
            </>
          )}
        </footer>
      </div>
    </div>
  )
}

function StepFile({ busy, onFile }) {
  const [dragging, setDragging] = useState(false)
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault(); setDragging(false)
        onFile(e.dataTransfer.files?.[0])
      }}
      className={`border-2 border-dashed rounded-2xl py-16 text-center transition ${
        dragging ? 'border-myriad-primary bg-myriad-primary/5' : 'border-slate-300'
      }`}
    >
      {busy ? (
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <Loader2 size={28} className="animate-spin" />
          <span className="text-sm">파일 읽는 중...</span>
        </div>
      ) : (
        <>
          <FileSpreadsheet size={36} className="mx-auto mb-3 text-slate-300" />
          <p className="text-sm text-slate-600 mb-1">화이트리스트 엑셀을 여기로 끌어다 놓으세요</p>
          <p className="text-xs text-slate-400 mb-4">컬럼 이름이 달라도 됩니다 — 다음 단계에서 매핑합니다</p>
          <label className="inline-flex items-center gap-2 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-4 py-2 rounded-lg text-sm cursor-pointer">
            <Upload size={14} /> 파일 선택
            <input
              type="file" accept=".xlsx,.xls" className="hidden"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </label>
        </>
      )}
    </div>
  )
}

function StepMapping({
  parsed, sheetName, sheetMeta, mapping, setMapping, appliedPreset,
  onSelectSheet, onHeaderRow, preview, defaultRegion, setDefaultRegion,
  savePresetName, setSavePresetName
}) {
  const headers = sheetMeta.headers

  function setSingle(key, value) {
    setMapping({ ...mapping, [key]: value || null })
  }
  function toggleMulti(key, header) {
    const cur = mapping[key] || []
    const next = cur.includes(header) ? cur.filter((h) => h !== header) : [...cur, header]
    setMapping({ ...mapping, [key]: next })
  }

  return (
    <div className="space-y-5">
      {appliedPreset && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-lg p-3 flex items-center gap-2">
          <Sparkles size={15} className="shrink-0" />
          전에 등록한 <b>"{appliedPreset.name}"</b> 양식과 같아서 매핑을 자동으로 적용했습니다. 확인만 하시면 됩니다.
        </div>
      )}

      {/* 시트 / 헤더 행 */}
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="text-xs font-semibold text-slate-600 block mb-1">시트</label>
          <select
            value={sheetName}
            onChange={(e) => onSelectSheet(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm min-w-48"
          >
            {parsed.sheets.map((s) => (
              <option key={s.name} value={s.name}>{s.name} ({s.totalRows}행)</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-600 block mb-1">헤더 행</label>
          <div className="flex items-center gap-1">
            <button onClick={() => onHeaderRow(-1)} className="px-2 py-2 border border-slate-300 rounded-lg text-sm hover:bg-slate-50">−</button>
            <span className="px-3 py-2 text-sm font-mono w-12 text-center">{sheetMeta.headerRow}</span>
            <button onClick={() => onHeaderRow(+1)} className="px-2 py-2 border border-slate-300 rounded-lg text-sm hover:bg-slate-50">+</button>
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-600 block mb-1">지역 기본값 (선택)</label>
          <input
            type="text" value={defaultRegion}
            onChange={(e) => setDefaultRegion(e.target.value)}
            placeholder="예: North America"
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm w-40"
          />
        </div>
      </div>

      {/* 감지된 헤더 */}
      <div>
        <p className="text-xs font-semibold text-slate-600 mb-2">감지된 컬럼 ({headers.length}개)</p>
        <div className="flex flex-wrap gap-1.5">
          {headers.map((h, i) => (
            <span key={i} className="text-[11px] bg-slate-100 text-slate-700 px-2 py-1 rounded font-mono">
              {h || <i className="text-slate-400">(빈칸)</i>}
            </span>
          ))}
        </div>
      </div>

      {/* 매핑 */}
      <div>
        <p className="text-xs font-semibold text-slate-600 mb-2">컬럼 매핑</p>
        <div className="space-y-2">
          {FIELDS.map((f) => (
            <div key={f.key} className="bg-slate-50 border border-slate-200 rounded-lg p-3">
              <div className="flex items-start gap-3">
                <div className="w-44 shrink-0">
                  <div className="text-sm font-semibold text-slate-800">
                    {f.label} {f.required && <span className="text-rose-500">*</span>}
                  </div>
                  {f.hint && <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">{f.hint}</div>}
                </div>
                <div className="flex-1">
                  {f.multi ? (
                    <div className="flex flex-wrap gap-1.5">
                      {headers.filter(Boolean).map((h) => {
                        const on = (mapping[f.key] || []).includes(h)
                        return (
                          <button
                            key={h} type="button"
                            onClick={() => toggleMulti(f.key, h)}
                            className={`text-[11px] px-2 py-1 rounded border font-mono transition ${
                              on
                                ? 'bg-myriad-primary/20 border-myriad-primary text-myriad-ink font-semibold'
                                : 'bg-white border-slate-300 text-slate-600 hover:border-slate-400'
                            }`}
                          >
                            {on && '✓ '}{h}
                          </button>
                        )
                      })}
                    </div>
                  ) : (
                    <select
                      value={mapping[f.key] || ''}
                      onChange={(e) => setSingle(f.key, e.target.value)}
                      className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm w-full max-w-sm bg-white"
                    >
                      <option value="">— 사용 안 함 —</option>
                      {headers.filter(Boolean).map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 미리보기 */}
      {!mapping.store_name ? (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg p-3 flex items-center gap-2">
          <AlertTriangle size={15} /> "가게/회사 이름" 컬럼을 먼저 선택하세요.
        </div>
      ) : preview ? (
        <div>
          <p className="text-xs font-semibold text-slate-600 mb-2">
            등록 미리보기 — 총 <b className="text-myriad-ink">{preview.rows.length}</b>건
            {preview.skippedRows.length > 0 && (
              <span className="text-slate-400 font-normal">
                {' '}(이름·URL 둘 다 없어 건너뛴 행 {preview.skippedRows.length}개)
              </span>
            )}
          </p>
          <div className="border border-slate-200 rounded-lg overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-myriad-ink text-white">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">이름</th>
                  <th className="px-3 py-2 text-left font-semibold">별칭</th>
                  <th className="px-3 py-2 text-left font-semibold">URL</th>
                  <th className="px-3 py-2 text-left font-semibold">아마존 셀러</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 8).map((r, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-semibold text-slate-800">{r.store_name}</td>
                    <td className="px-3 py-2 text-slate-500">{r.aliases.join(', ') || '—'}</td>
                    <td className="px-3 py-2 text-slate-500 max-w-xs truncate">{r.urls.join(', ') || '—'}</td>
                    <td className="px-3 py-2 text-slate-500">
                      {r.amazon_seller_name || r.amazon_seller_id || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.rows.length > 8 && (
            <p className="text-[11px] text-slate-400 mt-1.5">
              위 8건만 표시 — 나머지 {preview.rows.length - 8}건도 함께 등록됩니다.
            </p>
          )}
        </div>
      ) : null}

      {/* 프리셋 저장 */}
      {!appliedPreset && mapping.store_name && (
        <div className="bg-white border border-slate-200 rounded-lg p-3">
          <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5 mb-1.5">
            <Save size={12} /> 이 매핑을 양식으로 저장 (선택)
          </label>
          <input
            type="text" value={savePresetName}
            onChange={(e) => setSavePresetName(e.target.value)}
            placeholder="예: 북미 화이트리스트 양식"
            className="w-full max-w-md px-3 py-2 border border-slate-300 rounded-lg text-sm"
          />
          <p className="text-[11px] text-slate-500 mt-1.5">
            저장하면 다음에 같은 컬럼 구조의 파일을 올렸을 때 매핑이 자동으로 채워집니다.
          </p>
        </div>
      )}
    </div>
  )
}
