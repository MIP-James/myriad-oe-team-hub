/**
 * 노션 주간 보고서 미리보기 + 생성 모달.
 *
 * 흐름:
 *  1) 모달 열면 자동으로 dryRun=true 호출 → 미리보기 텍스트 표시
 *  2) 주차 ◀▶ 로 다른 주 미리보기 가능 (기본: 이번 주)
 *  3) "노션에 보내기" 클릭 → dryRun=false 호출 → 페이지 URL 응답
 *  4) 성공 시 "노션에서 열기" 링크 + 닫기
 */
import { useEffect, useState, useMemo } from 'react'
import { X, Loader2, Send, ChevronLeft, ChevronRight, ExternalLink, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { previewNotionReport, createNotionReport } from '../lib/notionReport'
import { isoWeekStart, isoWeekOf, dateKey, formatMD } from '../lib/dateHelpers'

export default function NotionReportModal({ initialWeekStart, onClose }) {
  const [monday, setMonday] = useState(() => isoWeekStart(initialWeekStart || new Date()))
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)   // { url, pageId }

  const weekInfo = useMemo(() => {
    const { year, week } = isoWeekOf(monday)
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    return { year, week, sunday }
  }, [monday])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setPreview(null)
    setResult(null)
    previewNotionReport(dateKey(monday))
      .then((data) => { if (!cancelled) setPreview(data.preview) })
      .catch((e) => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [monday])

  function shiftWeek(delta) {
    const next = new Date(monday)
    next.setDate(monday.getDate() + delta * 7)
    setMonday(isoWeekStart(next))
  }

  async function handleSend() {
    setSending(true)
    setError(null)
    try {
      const data = await createNotionReport(dateKey(monday))
      setResult({ url: data.url, pageId: data.pageId })
    } catch (e) {
      setError(e.message)
    } finally {
      setSending(false)
    }
  }

  const recCount = preview?.금주기록수 ?? 0
  const planCount = preview?.차주계획수 ?? 0
  const noData = !loading && recCount === 0 && planCount === 0

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-6 py-4 border-b border-slate-200 flex items-center gap-3">
          <div>
            <h2 className="font-bold text-slate-900 flex items-center gap-2">
              📤 노션 주간보고 자동 생성
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              일일 기록 + 다음 주 계획 → 노션 "주간 업무 Snapshot" DB 에 페이지 생성
            </p>
          </div>
          <div className="flex-1" />
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded">
            <X size={18} />
          </button>
        </header>

        <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-2">
          <button
            onClick={() => shiftWeek(-1)}
            disabled={loading || sending}
            className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-40"
            title="지난 주"
          >
            <ChevronLeft size={16} />
          </button>
          <div className="flex-1 text-center">
            <div className="text-sm font-bold text-slate-900">
              Week {weekInfo.week} · {formatMD(monday)} ~ {formatMD(weekInfo.sunday)}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              기준 주차: {dateKey(monday)} (월요일)
            </div>
          </div>
          <button
            onClick={() => shiftWeek(1)}
            disabled={loading || sending}
            className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-40"
            title="다음 주"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        <div className="p-6 overflow-auto flex-1 space-y-5">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-slate-500 py-8 justify-center">
              <Loader2 className="animate-spin" size={16} /> 미리보기 불러오는 중...
            </div>
          )}

          {!loading && error && !result && (
            <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-lg p-3 text-sm text-rose-700">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <div>
                <div className="font-bold mb-1">오류</div>
                <div className="text-xs whitespace-pre-wrap break-all">{error}</div>
              </div>
            </div>
          )}

          {!loading && preview && !result && (
            <>
              {noData && (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                  <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                  <div>
                    이번 주 일일 기록도, 다음 주 계획도 비어 있습니다. 이대로 보내면 빈 보고서가 생성됩니다.
                  </div>
                </div>
              )}

              <Section
                title="금주 주요 업무"
                badge={`기록 ${recCount}일`}
                empty={recCount === 0}
                emptyText="이번 주 일일 기록이 없습니다. 일정 페이지에서 일별 한 일을 먼저 적어주세요."
              >
                {preview.금주주요업무}
              </Section>

              <Section
                title="차주 우선 업무"
                badge={`항목 ${planCount}개`}
                empty={planCount === 0}
                emptyText={`다음 주(Week ${weekInfo.week + 1}) 계획이 비어 있습니다. 일정 페이지에서 미리 채워두세요.`}
              >
                {preview.차주우선업무}
              </Section>

              <Section title="기준 주차 (노션 Date 속성)">
                {preview.기준주차} (월요일)
              </Section>

              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-600 space-y-1">
                <div>📌 노션 보고서에 위 두 항목이 자동 입력됩니다.</div>
                <div>
                  나머지 항목 (이슈/AI 활용/BPM 등) 은 노션에서 직접 작성해주세요.
                </div>
                <div>
                  소속 부서/팀/부서장과 보고서 제목은 노션의 자동 입력 규칙으로 채워집니다.
                </div>
              </div>
            </>
          )}

          {result && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-sm space-y-3">
              <div className="flex items-center gap-2 font-bold text-emerald-800">
                <CheckCircle2 size={18} /> 보고서 페이지가 생성되었습니다.
              </div>
              <a
                href={result.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-myriad-primaryDark hover:underline font-semibold"
              >
                노션에서 열기 <ExternalLink size={14} />
              </a>
              <div className="text-xs text-slate-500 break-all">
                Page ID: {result.pageId}
              </div>
            </div>
          )}
        </div>

        <footer className="px-6 py-4 border-t border-slate-200 flex items-center justify-end gap-2">
          {result ? (
            <button
              onClick={onClose}
              className="bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-5 py-2 rounded-lg text-sm"
            >
              닫기
            </button>
          ) : (
            <>
              <button
                onClick={onClose}
                className="text-slate-600 hover:bg-slate-100 px-4 py-2 rounded-lg text-sm"
              >
                취소
              </button>
              <button
                onClick={handleSend}
                disabled={loading || sending || !preview}
                className="flex items-center gap-2 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-5 py-2 rounded-lg text-sm disabled:opacity-50"
              >
                {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                {sending ? '보내는 중...' : '노션에 보내기'}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  )
}

function Section({ title, badge, children, empty, emptyText }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <h3 className="font-bold text-slate-900 text-sm">{title}</h3>
        {badge && (
          <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full">
            {badge}
          </span>
        )}
      </div>
      {empty ? (
        <p className="text-xs text-slate-500 bg-slate-50 border border-dashed border-slate-200 rounded-lg p-3">
          {emptyText}
        </p>
      ) : (
        <pre className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-lg p-3 whitespace-pre-wrap font-sans leading-relaxed">
          {children}
        </pre>
      )}
    </div>
  )
}
