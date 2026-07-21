import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  KeyRound, Lock, Copy, Check, RefreshCw, Loader2, CheckCircle2,
  AlertTriangle, LogIn, ShieldAlert, PlugZap
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import {
  fetchVeroCode, startVeroConnect, getVeroLock, claimVeroLock,
  releaseVeroLock, subscribeVeroLock, isLockActive
} from '../lib/vero'

const AUTO_RETRY_MS = 4000
const MAX_AUTO_RETRIES = 6   // 버튼 클릭 후 최대 ~24초 자동 재조회

export default function Vero() {
  const { user, profile, isAdmin } = useAuth()
  const myId = user?.id
  const [searchParams, setSearchParams] = useSearchParams()

  const [connected, setConnected] = useState(null)   // null=로딩, false=미연동, true=연동됨
  const [readerError, setReaderError] = useState(null)
  const [lock, setLock] = useState(null)
  const [code, setCode] = useState(null)             // {code, receivedAt, expiresAt}
  const [codePending, setCodePending] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [copied, setCopied] = useState(false)
  const [, forceTick] = useState(0)

  const retryRef = useRef({ timer: null, attempts: 0 })

  // 1초 틱 — 카운트다운 + 남의 락 만료 시 UI 갱신
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  // 콜백 쿼리 파라미터 처리 (?vero=connected / ?vero=error&detail=...)
  useEffect(() => {
    const v = searchParams.get('vero')
    if (v === 'connected') {
      setNotice({ kind: 'ok', text: 'James 님 Gmail 연동이 완료되었습니다.' })
      setSearchParams({}, { replace: true })
    } else if (v === 'error') {
      setNotice({ kind: 'err', text: '연동 실패: ' + (searchParams.get('detail') || '알 수 없는 오류') })
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, setSearchParams])

  // 초기 로드 — 연동 여부 + 락 상태 + 실시간 구독
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const data = await fetchVeroCode()   // after 없이 → connected 플래그만 확인
        if (!alive) return
        setConnected(data.connected)
        if (data.connected && data.error === 'token_expired') setReaderError(data.detail)
      } catch (e) {
        if (alive) { setConnected(true); setError(e.message) }  // 조회 실패해도 페이지는 뜸
      }
      try {
        const l = await getVeroLock()
        if (alive) setLock(l)
      } catch {}
    })()
    const unsub = subscribeVeroLock((newLock) => setLock(newLock))
    return () => { alive = false; unsub(); clearRetry() }
  }, [])

  function clearRetry() {
    if (retryRef.current.timer) clearTimeout(retryRef.current.timer)
    retryRef.current = { timer: null, attempts: 0 }
  }

  const heldByMe = lock?.holder_id === myId && isLockActive(lock)
  const heldByOther = lock?.holder_id && lock.holder_id !== myId && isLockActive(lock)

  // ── 코드 조회 (+ 아직이면 자동 재조회) ────────────────────
  async function doFetch(afterIso, isAuto = false) {
    if (!isAuto) clearRetry()
    setFetching(true)
    setError(null)
    try {
      const data = await fetchVeroCode(afterIso || lock?.started_at || null)
      if (data.connected === false) { setConnected(false); return }
      if (data.error) {
        setError(data.detail || data.error)
        setCodePending(false)
        return
      }
      if (data.code) {
        setCode({ code: data.code, receivedAt: data.receivedAt, expiresAt: data.expiresAt })
        setCodePending(false)
        clearRetry()
      } else {
        setCode(null)
        setCodePending(true)
        // 아직 안 옴 → 자동 재조회 예약
        if (retryRef.current.attempts < MAX_AUTO_RETRIES) {
          retryRef.current.attempts += 1
          retryRef.current.timer = setTimeout(() => doFetch(afterIso, true), AUTO_RETRY_MS)
        }
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setFetching(false)
    }
  }

  // ── 세션 시작 (락 점유) ──────────────────────────────────
  async function startSession(force = false) {
    setError(null)
    setCode(null)
    setCodePending(false)
    clearRetry()
    try {
      const name = profile?.full_name || user?.email
      const result = await claimVeroLock({ name, email: user?.email, force })
      setLock(result)
      if (result?.holder_id !== myId) {
        setError('다른 팀원이 방금 먼저 시작했습니다. 잠시 후 다시 시도해주세요.')
        return
      }
      // 시작됨 → 코드 자동 시도 (아직 도착 전일 수 있음)
      setCodePending(true)
      retryRef.current.attempts = 1
      doFetch(result.started_at, true)
    } catch (e) {
      setError(e.message)
    }
  }

  async function endSession() {
    clearRetry()
    try {
      await releaseVeroLock()
    } catch (e) {
      setError(e.message)
    }
    setCode(null)
    setCodePending(false)
    try { setLock(await getVeroLock()) } catch {}
  }

  async function copyCode() {
    if (!code?.code) return
    try {
      await navigator.clipboard.writeText(code.code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  // ── 렌더 ─────────────────────────────────────────────────
  return (
    <div className="p-8 max-w-2xl mx-auto">
      <header className="mb-2 flex items-center gap-3">
        <KeyRound className="text-myriad-ink" />
        <h1 className="text-2xl font-bold text-slate-900">eBay VeRO 인증코드</h1>
      </header>
      <p className="text-sm text-slate-500 mb-6">
        VeRO 포털 로그인 시 James 님 메일로 오는 인증코드(10분 만료)를 팀원이 바로 확인합니다.
        <b> 한 번에 한 명씩</b> 로그인하세요.
      </p>

      {notice && (
        <div className={`mb-4 text-sm rounded-lg p-3 border ${
          notice.kind === 'ok'
            ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
            : 'bg-rose-50 border-rose-200 text-rose-700'
        }`}>
          {notice.text}
        </div>
      )}

      {error && (
        <div className="mb-4 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg p-3 flex items-start gap-2">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" /> <span>{error}</span>
        </div>
      )}

      {connected === null && (
        <div className="py-16 text-center text-sm text-slate-400 flex items-center justify-center gap-2">
          <Loader2 size={16} className="animate-spin" /> 불러오는 중...
        </div>
      )}

      {/* 미연동 상태 */}
      {connected === false && (
        <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center">
          <div className="w-14 h-14 rounded-full bg-amber-50 flex items-center justify-center mx-auto mb-4">
            <PlugZap className="text-amber-500" />
          </div>
          <h2 className="font-bold text-slate-900 mb-1">James 님 Gmail 연동이 필요합니다</h2>
          <p className="text-sm text-slate-500 mb-5 leading-relaxed">
            VeRO 인증코드는 James 님 메일함으로만 옵니다.<br />
            서버가 그 메일을 대신 읽으려면 한 번만 Gmail 연동이 필요합니다.
          </p>
          {isAdmin ? (
            <button
              onClick={() => startVeroConnect().catch((e) => setError(e.message))}
              className="inline-flex items-center gap-2 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-5 py-2.5 rounded-lg"
            >
              <LogIn size={16} /> James 님 Gmail 연동하기
            </button>
          ) : (
            <p className="text-xs text-slate-400">관리자(James)가 연동을 완료해야 사용할 수 있습니다.</p>
          )}
        </div>
      )}

      {/* 연동됨 */}
      {connected === true && (
        <>
          {readerError && (
            <div className="mb-4 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg p-3 flex items-start gap-2">
              <ShieldAlert size={16} className="shrink-0 mt-0.5" />
              <div>
                <div>{readerError}</div>
                {isAdmin && (
                  <button
                    onClick={() => startVeroConnect().catch((e) => setError(e.message))}
                    className="mt-2 text-xs font-semibold underline"
                  >
                    다시 연동하기
                  </button>
                )}
              </div>
            </div>
          )}

          {/* 다른 팀원이 사용 중 */}
          {heldByOther && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-11 h-11 rounded-full bg-rose-50 flex items-center justify-center">
                  <Lock className="text-rose-500" size={20} />
                </div>
                <div>
                  <div className="font-bold text-slate-900">
                    지금 {lock.holder_name || lock.holder_email} 님이 VeRO 로그인 중입니다
                  </div>
                  <div className="text-xs text-slate-500">
                    약 {remainMinutes(lock.expires_at)}분 후 자동 해제 · 코드 혼선을 막기 위해 순서 대기
                  </div>
                </div>
              </div>
              <p className="text-xs text-slate-400 mb-3">
                끝날 때까지 기다려주세요. 상대가 완료하면 이 화면이 자동으로 바뀝니다.
              </p>
              <button
                onClick={() => startSession(true)}
                className="text-xs text-rose-600 hover:text-rose-700 underline"
              >
                상대가 자리를 비웠나요? 이어받기(강제 시작)
              </button>
            </div>
          )}

          {/* 사용 가능 — 세션 시작 전 */}
          {!heldByMe && !heldByOther && (
            <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center">
              <div className="w-14 h-14 rounded-full bg-myriad-primary/10 flex items-center justify-center mx-auto mb-4">
                <KeyRound className="text-myriad-ink" />
              </div>
              <h2 className="font-bold text-slate-900 mb-1">VeRO 로그인 준비됨</h2>
              <p className="text-sm text-slate-500 mb-5 leading-relaxed">
                아래 버튼을 누른 뒤 eBay VeRO 포털에서 로그인하세요.<br />
                버튼을 누른 <b>시점 이후</b> 도착한 코드만 보여드립니다.
              </p>
              <button
                onClick={() => startSession(false)}
                className="inline-flex items-center gap-2 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-5 py-2.5 rounded-lg"
              >
                <LogIn size={16} /> VeRO 로그인 시작
              </button>
            </div>
          )}

          {/* 내 세션 진행 중 */}
          {heldByMe && (
            <div className="bg-white border border-myriad-primary/40 rounded-2xl p-6">
              <div className="flex items-center gap-2 text-xs font-semibold text-emerald-600 mb-4">
                <CheckCircle2 size={14} /> 내 로그인 세션 진행 중
                <span className="text-slate-400 font-normal">
                  (약 {remainMinutes(lock.expires_at)}분 후 자동 종료)
                </span>
              </div>

              {code ? (
                <CodeCard code={code} copied={copied} onCopy={copyCode} />
              ) : (
                <div className="border border-dashed border-slate-200 rounded-xl p-6 text-center">
                  {codePending ? (
                    <div className="text-sm text-slate-500 flex flex-col items-center gap-2">
                      <Loader2 size={20} className="animate-spin text-myriad-ink" />
                      코드 메일을 기다리는 중입니다...
                      <span className="text-xs text-slate-400">
                        eBay에서 로그인하면 여기에 자동으로 표시됩니다.
                      </span>
                    </div>
                  ) : (
                    <div className="text-sm text-slate-400">아직 코드가 없습니다.</div>
                  )}
                </div>
              )}

              <div className="flex items-center gap-2 mt-5">
                <button
                  onClick={() => doFetch(lock?.started_at)}
                  disabled={fetching}
                  className="flex items-center gap-1.5 border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-semibold px-3 py-2 rounded-lg disabled:opacity-50"
                >
                  {fetching
                    ? <Loader2 size={14} className="animate-spin" />
                    : <RefreshCw size={14} />}
                  {code ? '새 코드 다시 가져오기' : '지금 가져오기'}
                </button>
                <div className="flex-1" />
                <button
                  onClick={endSession}
                  className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-900 text-white text-sm font-semibold px-4 py-2 rounded-lg"
                >
                  <Check size={14} /> 완료 (다음 사람에게)
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function CodeCard({ code, copied, onCopy }) {
  const remain = code.expiresAt ? Math.max(0, new Date(code.expiresAt).getTime() - Date.now()) : null
  const expired = remain !== null && remain <= 0
  return (
    <div className={`rounded-xl p-6 text-center ${expired ? 'bg-slate-50' : 'bg-myriad-primary/5'}`}>
      <div className="text-xs text-slate-400 mb-2">인증 코드</div>
      <div className="flex items-center justify-center gap-3">
        <span className={`text-4xl font-bold tracking-[0.3em] tabular-nums ${expired ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
          {code.code}
        </span>
        <button
          onClick={onCopy}
          className="p-2 rounded-lg border border-slate-200 hover:bg-white text-slate-600"
          title="코드 복사"
        >
          {copied ? <Check size={18} className="text-emerald-600" /> : <Copy size={18} />}
        </button>
      </div>
      <div className="mt-3 text-xs">
        {expired ? (
          <span className="text-rose-500 font-semibold">
            만료됨 — eBay에서 다시 로그인 후 "새 코드 다시 가져오기"
          </span>
        ) : remain !== null ? (
          <span className="text-slate-500">
            약 <b className="text-slate-700">{fmtMMSS(remain)}</b> 후 만료
          </span>
        ) : null}
      </div>
      {code.receivedAt && (
        <div className="mt-1 text-[11px] text-slate-400">
          도착: {new Date(code.receivedAt).toLocaleTimeString('ko-KR')}
        </div>
      )}
    </div>
  )
}

function remainMinutes(expiresAt) {
  if (!expiresAt) return 10
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 60000))
}

function fmtMMSS(ms) {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
