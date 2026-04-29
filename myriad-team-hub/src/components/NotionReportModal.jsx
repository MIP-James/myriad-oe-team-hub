/**
 * 노션 주간 보고서 미리보기 + 생성 모달 (OAuth 버전).
 *
 * 흐름:
 *  1) 모달 열면:
 *     a) 연동 상태 조회 (`getNotionStatus`)
 *     b) 동시에 미리보기 dryRun 호출 (Notion 호출 X — 연동 안 돼도 가능)
 *  2) 연동 안 됐으면 "노션 계정 연결" 버튼 → OAuth 동의 페이지로 이동
 *  3) 연동 됐으면 "노션에 보내기" 버튼 활성화
 *  4) 보내기 시 `notConnected` 에러 받으면 다시 연결 안내
 */
import { useEffect, useState, useMemo } from 'react'
import {
  X, Loader2, Send, ChevronLeft, ChevronRight, ExternalLink,
  AlertTriangle, CheckCircle2, Link2, Unlink, ShieldAlert, RefreshCw
} from 'lucide-react'
import {
  previewNotionReport, createNotionReport,
  getNotionStatus, startNotionConnect, disconnectNotion,
  recheckNotionAccess
} from '../lib/notionReport'
import { isoWeekStart, isoWeekOf, dateKey, formatMD } from '../lib/dateHelpers'

export default function NotionReportModal({ initialWeekStart, onClose }) {
  const [monday, setMonday] = useState(() => isoWeekStart(initialWeekStart || new Date()))
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)             // { url, pageId }

  // 연동 상태
  const [status, setStatus] = useState(null)             // { connected, workspace_name, db_accessible, ... }
  const [statusLoading, setStatusLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [rechecking, setRechecking] = useState(false)
  const [recheckMsg, setRecheckMsg] = useState(null)     // { kind: 'success'|'error', text }

  const weekInfo = useMemo(() => {
    const { year, week } = isoWeekOf(monday)
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    return { year, week, sunday }
  }, [monday])

  // 연동 상태 1회 조회
  useEffect(() => {
    let cancelled = false
    setStatusLoading(true)
    getNotionStatus()
      .then((s) => { if (!cancelled) setStatus(s) })
      .catch(() => { if (!cancelled) setStatus({ connected: false }) })
      .finally(() => { if (!cancelled) setStatusLoading(false) })
    return () => { cancelled = true }
  }, [])

  // 미리보기 (주차 변경 시마다)
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

  async function handleConnect() {
    setConnecting(true)
    setError(null)
    try {
      await startNotionConnect()   // 페이지 redirect — 이후 흐름은 콜백에서
    } catch (e) {
      setError(e.message)
      setConnecting(false)
    }
  }

  async function handleDisconnect() {
    if (!confirm('노션 연동을 해제할까요? 다시 연결할 수 있습니다.')) return
    try {
      await disconnectNotion()
      setStatus({ connected: false })
    } catch (e) {
      setError(e.message)
    }
  }

  async function handleSend() {
    setSending(true)
    setError(null)
    try {
      const data = await createNotionReport(dateKey(monday))
      setResult({ url: data.url, pageId: data.pageId })
      // 성공 시 status 의 db_accessible 도 true 로 갱신
      setStatus((s) => s ? { ...s, db_accessible: true } : s)
    } catch (e) {
      if (e.cause === 'not-connected') {
        // 토큰 만료 등 — 상태 갱신
        setStatus({ connected: false })
        setError('노션 연동이 끊어졌습니다. 다시 연결해주세요.')
      } else if (e.cause === 'requires-share') {
        // DB 권한 부족 — status 의 db_accessible 도 false 로 갱신
        setStatus((s) => s ? { ...s, db_accessible: false } : s)
        setError(null)  // 배너로 안내하므로 별도 에러 박스 X
      } else {
        setError(e.message)
      }
    } finally {
      setSending(false)
    }
  }

  async function handleRecheck() {
    setRechecking(true)
    setRecheckMsg(null)
    try {
      const data = await recheckNotionAccess()
      setStatus((s) => s ? { ...s, db_accessible: data.db_accessible } : s)
      if (data.db_accessible) {
        setRecheckMsg({ kind: 'success', text: '권한이 정상으로 확인되었습니다. 이제 보고서를 보낼 수 있어요.' })
      } else {
        setRecheckMsg({ kind: 'error', text: '아직 접근 권한이 없습니다. 관리자에게 권한 변경을 요청해주세요.' })
      }
    } catch (e) {
      if (e.cause === 'not-connected') {
        setStatus({ connected: false })
        setRecheckMsg({ kind: 'error', text: '노션 연동이 끊어졌습니다. 다시 연결해주세요.' })
      } else {
        setRecheckMsg({ kind: 'error', text: e.message })
      }
    } finally {
      setRechecking(false)
      setTimeout(() => setRecheckMsg(null), 6000)
    }
  }

  const recCount = preview?.금주기록수 ?? 0
  const planCount = preview?.차주계획수 ?? 0
  const noData = !loading && recCount === 0 && planCount === 0
  const isConnected = status?.connected === true
  // db_accessible 이 명시적으로 false 일 때만 차단 (null = 미검증, 구 행 호환)
  const dbBlocked = isConnected && status?.db_accessible === false

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

        {/* 연동 상태 띠 */}
        <ConnectionBanner
          loading={statusLoading}
          isConnected={isConnected}
          workspaceName={status?.workspace_name}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
          connecting={connecting}
        />

        {/* DB 접근 권한 부족 안내 (관리자 권한 변경 필요) */}
        {dbBlocked && (
          <PermissionBanner
            onRecheck={handleRecheck}
            rechecking={rechecking}
            recheckMsg={recheckMsg}
          />
        )}

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
                  소속 부서/팀/부서장과 작성자는 노션에서 작성자 선택 시 자동화로 채워집니다.
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
              {isConnected ? (
                <button
                  onClick={handleSend}
                  disabled={loading || sending || !preview || dbBlocked}
                  title={dbBlocked ? '노션 DB 접근 권한이 없습니다. 위 안내를 확인해주세요.' : undefined}
                  className="flex items-center gap-2 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-5 py-2 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  {sending ? '보내는 중...' : '노션에 보내기'}
                </button>
              ) : (
                <button
                  onClick={handleConnect}
                  disabled={connecting || statusLoading}
                  className="flex items-center gap-2 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-5 py-2 rounded-lg text-sm disabled:opacity-50"
                >
                  {connecting ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
                  {connecting ? '이동 중...' : '노션 계정 연결'}
                </button>
              )}
            </>
          )}
        </footer>
      </div>
    </div>
  )
}

function ConnectionBanner({ loading, isConnected, workspaceName, onConnect, onDisconnect, connecting }) {
  if (loading) {
    return (
      <div className="px-6 py-2.5 border-b border-slate-200 flex items-center gap-2 bg-slate-50 text-xs text-slate-500">
        <Loader2 size={12} className="animate-spin" /> 노션 연동 상태 확인 중...
      </div>
    )
  }
  if (isConnected) {
    return (
      <div className="px-6 py-2.5 border-b border-slate-200 flex items-center gap-2 bg-emerald-50 text-xs text-emerald-800">
        <CheckCircle2 size={14} className="shrink-0" />
        <span className="flex-1">
          노션 연동됨{workspaceName ? ` (워크스페이스: ${workspaceName})` : ''}
        </span>
        <button
          onClick={onDisconnect}
          className="inline-flex items-center gap-1 text-[11px] text-emerald-700 hover:text-emerald-900 hover:underline"
          title="연동 해제"
        >
          <Unlink size={11} /> 해제
        </button>
      </div>
    )
  }
  return (
    <div className="px-6 py-2.5 border-b border-slate-200 flex items-center gap-2 bg-amber-50 text-xs text-amber-900">
      <AlertTriangle size={14} className="shrink-0" />
      <span className="flex-1">
        노션 계정이 연결되지 않았습니다. 보고서를 본인 이름으로 생성하려면 먼저 연결해주세요.
      </span>
      <button
        onClick={onConnect}
        disabled={connecting}
        className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-900 bg-amber-200 hover:bg-amber-300 px-2 py-1 rounded disabled:opacity-50"
      >
        <Link2 size={11} /> 지금 연결
      </button>
    </div>
  )
}

function PermissionBanner({ onRecheck, rechecking, recheckMsg }) {
  return (
    <div className="px-6 py-3 border-b border-rose-200 bg-rose-50">
      <div className="flex items-start gap-2">
        <ShieldAlert size={16} className="shrink-0 mt-0.5 text-rose-600" />
        <div className="flex-1 text-xs text-rose-800 space-y-2">
          <div className="font-bold text-sm">
            노션 "주간 업무 Snapshot" DB 접근 권한이 부족합니다
          </div>
          <div className="leading-relaxed">
            노션 OAuth 페이지 선택 화면에서 팀스페이스의 "주간 업무 Snapshot" DB 가
            보이지 않으셨나요? 그 DB 의 워크스페이스 권한이 "내용 편집 허용" 으로
            제한되어 발생하는 현상입니다. 토큰은 받았지만 DB 에 접근할 수가 없어
            보고서를 만들 수 없습니다.
          </div>
          <div className="bg-white border border-rose-200 rounded p-2.5 space-y-1.5">
            <div className="font-semibold text-rose-900">해결 방법</div>
            <ol className="list-decimal pl-4 space-y-1 text-rose-800">
              <li>
                관리자에게 노션 "주간 업무 Snapshot" DB 공유 목록에{' '}
                <span className="font-semibold">본인을 "전체 허용" 권한으로 추가</span>{' '}
                해달라고 요청해주세요. (DB 우측 상단 [공유] → 본인 이메일 입력 → 권한 "전체 허용" 선택 → [공유하기])
              </li>
              <li>
                권한 추가 완료되면 아래 <span className="font-semibold">[권한 재확인]</span>{' '}
                버튼을 누르세요. (재연결 불필요)
              </li>
              <li>
                재확인이 계속 실패하면 위쪽 띠의 <span className="font-semibold">[해제]</span>{' '}
                후 다시 연결해주세요. 새 OAuth 화면에 팀스페이스 → 주간 업무 Snapshot 이
                보이고 체크할 수 있습니다.
              </li>
            </ol>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={onRecheck}
              disabled={rechecking}
              className="inline-flex items-center gap-1.5 text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white px-3 py-1.5 rounded disabled:opacity-50"
            >
              {rechecking ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RefreshCw size={12} />
              )}
              {rechecking ? '확인 중...' : '권한 재확인'}
            </button>
            {recheckMsg && (
              <span
                className={
                  recheckMsg.kind === 'success'
                    ? 'text-xs text-emerald-700 font-semibold'
                    : 'text-xs text-rose-700 font-semibold'
                }
              >
                {recheckMsg.kind === 'success' ? '✓ ' : '⚠ '}
                {recheckMsg.text}
              </span>
            )}
          </div>
        </div>
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
