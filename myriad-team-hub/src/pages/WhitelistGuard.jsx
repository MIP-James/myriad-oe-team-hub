/**
 * 화이트리스트 가드 — 팀원용 셀프 서비스 페이지.
 *
 * 왜 관리자 페이지에서 분리했나:
 *   토큰 발급이 /admin/whitelist 안에 있으면 관리자가 팀원 수만큼 발급해서
 *   문자열을 하나씩 전달해야 한다. 그러면 (1) 토큰이 전부 관리자 계정에 묶여
 *   누구 것인지 알 수 없고 (2) 비밀 문자열이 메신저에 남는다.
 *   화이트리스트 자체는 이미 로그인한 팀원 전원이 볼 수 있는 데이터(mig 035 RLS)라
 *   발급을 막을 근거도 없다. → 각자 본인 토큰을 발급한다. (mig 036)
 *
 * 데이터 관리(엑셀 업로드 / 셀러 편집)는 여전히 관리자 전용 = /admin/whitelist.
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ShieldAlert, KeyRound, Copy, Check, Loader2, Puzzle, Download,
  AlertTriangle, Trash2, ExternalLink
} from 'lucide-react'
import { listExtTokens, issueExtToken, revokeExtToken } from '../lib/whitelist'
import { useAuth } from '../contexts/AuthContext'

export default function WhitelistGuard() {
  const { user, profile } = useAuth()
  const [tokens, setTokens] = useState([])
  const [loading, setLoading] = useState(true)
  const [issued, setIssued] = useState(null)   // 발급 직후 1회만 노출
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    // 기본 토큰 이름 — 목록에서 어느 기기인지 구분되도록 사람 이름을 미리 채움
    const who = profile?.full_name || user?.email?.split('@')[0] || ''
    setName(who ? `${who} 크롬` : 'Chrome 확장')
    load()
  }, [user?.id, profile?.full_name])

  async function load() {
    if (!user?.id) return
    setLoading(true)
    try {
      setTokens(await listExtTokens(user.id))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function issue() {
    setBusy(true); setError(null)
    try {
      setIssued(await issueExtToken(name.trim() || 'Chrome 확장'))
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function revoke(id) {
    if (!window.confirm('이 토큰을 폐기할까요?\n해당 확장은 더 이상 화이트리스트를 받지 못합니다.')) return
    try {
      await revokeExtToken(id)
      await load()
    } catch (e) { setError(e.message) }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(issued.token)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* 권한 없으면 직접 선택복사 */ }
  }

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <header className="mb-2 flex items-center gap-3">
        <ShieldAlert className="text-myriad-ink" />
        <h1 className="text-2xl font-bold text-slate-900">화이트리스트 가드</h1>
      </header>
      <p className="text-sm text-slate-500 mb-6">
        아마존 신고 페이지에서 고객사 <b>공식 판매처</b>를 자동으로 걸러 오신고를 막는 크롬 확장입니다.
        아래에서 본인 토큰을 발급해 확장에 한 번 입력하면 됩니다.
      </p>

      {error && (
        <div className="mb-4 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg p-3 flex items-start gap-2">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" /> <span>{error}</span>
        </div>
      )}

      {/* ── 설치 순서 ─────────────────────────── */}
      <section className="bg-white border border-slate-200 rounded-2xl p-5 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <Puzzle size={16} className="text-myriad-ink" />
          <h2 className="font-bold text-slate-900">설치 순서 (처음 1회)</h2>
        </div>
        <ol className="space-y-2.5 text-sm text-slate-700">
          <Step n={1}>
            <Link to="/utilities" className="text-myriad-accent font-semibold hover:underline inline-flex items-center gap-1">
              유틸리티 <ExternalLink size={11} />
            </Link>
            {' '}에서 <b>🛡️ Amazon Whitelist Guard</b> 를 내려받아 압축을 풀고
            <b> 고정된 위치</b>에 둡니다 (폴더를 옮기거나 지우면 확장이 사라집니다)
          </Step>
          <Step n={2}>
            크롬 주소창에 <Code>chrome://extensions</Code> 입력 → 오른쪽 위 <b>개발자 모드</b> 켜기
          </Step>
          <Step n={3}>
            <b>압축해제된 확장 프로그램을 로드합니다</b> 클릭 → 1번 폴더 선택
          </Step>
          <Step n={4}>
            아래에서 <b>토큰 발급</b> → 복사 → 툴바 <b>🛡️ 아이콘</b> 클릭 → 팝업의 <b>설정</b> →
            토큰 붙여넣고 <b>저장 후 동기화</b>
          </Step>
          <Step n={5}>
            툴바 아이콘에 등록 건수 배지(예: <Code>642</Code>)가 뜨면 완료입니다
          </Step>
        </ol>
      </section>

      {/* ── 토큰 발급 ─────────────────────────── */}
      <section className="bg-white border border-slate-200 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-1">
          <KeyRound size={16} className="text-myriad-ink" />
          <h2 className="font-bold text-slate-900">내 토큰</h2>
        </div>
        <p className="text-xs text-slate-500 mb-4">
          토큰은 <b>발급 직후에만</b> 보입니다. 서버에는 해시만 저장되므로 분실하면 새로 발급하세요.
          기기가 여러 대면 기기별로 발급하는 게 좋습니다.
        </p>

        {issued && (
          <div className="mb-4 bg-amber-50 border border-amber-300 rounded-lg p-3">
            <p className="text-xs font-semibold text-amber-900 mb-2">
              아래 토큰을 확장 설정에 붙여넣으세요 — 이 화면을 벗어나면 다시 볼 수 없습니다.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-white border border-amber-200 rounded px-3 py-2 text-[11px] font-mono break-all">
                {issued.token}
              </code>
              <button
                onClick={copy}
                className="flex items-center gap-1.5 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-3 py-2 rounded-lg text-xs shrink-0"
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied ? '복사됨' : '복사'}
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2 mb-4">
          <div>
            <label className="text-xs font-semibold text-slate-600 block mb-1">
              토큰 이름 (기기 구분용)
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent?.isComposing && !busy) issue()
              }}
              placeholder="예: 지민 노트북"
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm w-56 focus:outline-none focus:ring-2 focus:ring-myriad-primary/40"
            />
          </div>
          <button
            onClick={issue}
            disabled={busy}
            className="flex items-center gap-2 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-4 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
            토큰 발급
          </button>
        </div>

        {loading ? (
          <div className="py-4 text-center text-sm text-slate-400 flex items-center justify-center gap-2">
            <Loader2 size={14} className="animate-spin" /> 불러오는 중...
          </div>
        ) : tokens.length === 0 ? (
          <p className="text-xs text-slate-400 py-2">아직 발급한 토큰이 없습니다.</p>
        ) : (
          <ul className="space-y-1.5">
            {tokens.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2"
              >
                <KeyRound size={12} className="text-slate-400 shrink-0" />
                <span className="font-semibold text-slate-700">{t.name}</span>
                <span className="text-slate-400">
                  발급 {new Date(t.created_at).toLocaleDateString('ko-KR')}
                </span>
                <span className={t.last_used_at ? 'text-emerald-600' : 'text-amber-600'}>
                  {t.last_used_at
                    ? `사용 중 · ${new Date(t.last_used_at).toLocaleString('ko-KR')}`
                    : '아직 확장에 입력되지 않음'}
                </span>
                <div className="flex-1" />
                <button
                  onClick={() => revoke(t.id)}
                  className="text-rose-600 hover:underline inline-flex items-center gap-1"
                >
                  <Trash2 size={11} /> 폐기
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-4 text-xs text-slate-400 flex items-center gap-1.5">
        <Download size={12} />
        화이트리스트 데이터(고객사별 공식 판매처) 등록·수정은 관리자가
        <Link to="/admin/whitelist" className="text-myriad-accent hover:underline">관리자 → 화이트리스트 셀러 관리</Link>
        에서 진행합니다.
      </p>
    </div>
  )
}

function Step({ n, children }) {
  return (
    <li className="flex gap-2.5">
      <span className="w-5 h-5 rounded-full bg-myriad-primary/20 text-myriad-ink text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
        {n}
      </span>
      <span className="leading-relaxed">{children}</span>
    </li>
  )
}

function Code({ children }) {
  return (
    <code className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded text-[11px] font-mono">
      {children}
    </code>
  )
}
