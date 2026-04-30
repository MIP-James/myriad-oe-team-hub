import { useEffect, useState } from 'react'
import {
  Cpu, Copy, RefreshCw, CheckCircle2, Loader2, Download, Monitor,
  AlertTriangle, Clock, Key, Trash2, X
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

const STALE_THRESHOLD_MS = 60 * 1000
function isFresh(lastSeenAt) {
  if (!lastSeenAt) return false
  return Date.now() - new Date(lastSeenAt).getTime() < STALE_THRESHOLD_MS
}

const LAUNCHER_DOWNLOAD_URL =
  'https://github.com/MIP-James/myriad-oe-team-hub/releases/download/launcher-latest/MyriadLauncher.zip'

export default function Launcher() {
  const { session, user } = useAuth()
  const [devices, setDevices] = useState([])
  const [tokens, setTokens] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [issueModal, setIssueModal] = useState(false)
  const [issueName, setIssueName] = useState('')
  const [issueLoading, setIssueLoading] = useState(false)
  const [issuedToken, setIssuedToken] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => { load() }, [])

  useEffect(() => {
    if (!user?.id) return
    const channel = supabase
      .channel('launcher-devices-' + user.id)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'launcher_devices', filter: `user_id=eq.${user.id}` },
        () => load()
      )
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [user?.id])

  async function load() {
    setLoading(true)
    const [devRes, tokRes] = await Promise.all([
      supabase.from('launcher_devices').select('*').order('created_at', { ascending: false }),
      supabase
        .from('launcher_device_tokens')
        .select('id, name, device_id, created_at, last_used_at, revoked_at')
        .order('created_at', { ascending: false })
    ])
    if (devRes.error) setError(devRes.error.message)
    else setDevices(devRes.data ?? [])
    if (!tokRes.error) setTokens(tokRes.data ?? [])
    setLoading(false)
  }

  function openIssueModal() {
    setError(null)
    setIssuedToken(null)
    setIssueName('')
    setCopied(false)
    setIssueModal(true)
  }

  async function issueToken() {
    if (!session?.access_token) {
      setError('로그인 세션을 확인할 수 없습니다.')
      return
    }
    setIssueLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/launcher-issue-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ name: issueName.trim() || '내 PC' })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || '토큰 발급 실패')
      setIssuedToken(data.token)
      await load()
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setIssueLoading(false)
    }
  }

  async function copyToken() {
    if (!issuedToken) return
    try {
      await navigator.clipboard.writeText(issuedToken)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch (e) {
      setError('클립보드 복사 실패: ' + e.message)
    }
  }

  async function revokeToken(id) {
    if (!window.confirm('이 토큰을 회수하시겠어요? 해당 PC 의 런처는 즉시 작동 중지됩니다.')) return
    const { error } = await supabase
      .from('launcher_device_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id)
    if (error) { setError(error.message); return }
    await load()
  }

  async function removeDevice(id) {
    if (!window.confirm('이 디바이스 등록을 삭제할까요? 토큰도 함께 회수됩니다.')) return
    // 토큰 먼저 회수 (device_id 매칭)
    await supabase
      .from('launcher_device_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('device_id', id)
      .is('revoked_at', null)
    const { error } = await supabase.from('launcher_devices').delete().eq('id', id)
    if (error) { setError(error.message); return }
    await load()
  }

  const activeTokens = tokens.filter((t) => !t.revoked_at)

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <header className="mb-6 flex items-center gap-3">
        <Cpu className="text-myriad-ink" />
        <h1 className="text-2xl font-bold text-slate-900">내 런처</h1>
      </header>

      <p className="text-sm text-slate-500 mb-6">
        MYRIAD Launcher 를 본인 PC 에 설치하면 이 웹에서 "실행" 버튼으로 유틸을 원격 실행할 수 있습니다.
      </p>

      {error && (
        <div className="mb-4 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg p-3 whitespace-pre-wrap">
          {error}
        </div>
      )}

      {/* 연결된 디바이스 */}
      <section className="mb-8">
        <h2 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
          <Monitor size={16} /> 연결된 PC
        </h2>
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          {loading ? (
            <div className="py-8 text-center text-sm text-slate-400 flex items-center justify-center gap-2">
              <Loader2 size={14} className="animate-spin" /> 불러오는 중...
            </div>
          ) : devices.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-400">
              아직 연결된 PC 가 없습니다. 아래 단계를 따라 연결하세요.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {devices.map((d) => {
                const online = d.is_online && isFresh(d.last_seen_at)
                return (
                  <li key={d.id} className="px-5 py-4 flex items-center gap-4">
                    <div className="relative shrink-0">
                      <Monitor size={28} className="text-slate-400" />
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${
                          online ? 'bg-emerald-500' : 'bg-slate-300'
                        }`}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-slate-900">{d.name}</div>
                      <div className="text-xs text-slate-500">
                        {d.platform || '?'} · {d.launcher_version ? `v${d.launcher_version}` : '버전 미상'}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1">
                        <Clock size={10} />
                        {d.last_seen_at
                          ? '최근 연결: ' + new Date(d.last_seen_at).toLocaleString('ko-KR')
                          : '한 번도 연결된 적 없음'}
                      </div>
                    </div>
                    <div className="shrink-0">
                      <span
                        className={`text-xs px-2 py-1 rounded-full ${
                          online
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {online ? '온라인' : '오프라인'}
                      </span>
                    </div>
                    <button
                      onClick={() => removeDevice(d.id)}
                      className="text-xs text-rose-600 hover:underline shrink-0"
                    >
                      삭제
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </section>

      {/* 인증 토큰 관리 */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-slate-900 flex items-center gap-2">
            <Key size={16} /> 인증 토큰
          </h2>
          <button
            onClick={openIssueModal}
            className="flex items-center gap-2 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-4 py-2 rounded-lg text-sm"
          >
            <Key size={14} /> 새 토큰 발급
          </button>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          {activeTokens.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-400">
              발급된 토큰이 없습니다. "새 토큰 발급" 으로 시작하세요.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {activeTokens.map((t) => {
                const linkedDevice = devices.find((d) => d.id === t.device_id)
                return (
                  <li key={t.id} className="px-5 py-3 flex items-center gap-4">
                    <Key size={18} className="text-slate-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-slate-900 text-sm">{t.name}</div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        발급: {new Date(t.created_at).toLocaleString('ko-KR')}
                        {t.last_used_at && (
                          <> · 마지막 사용: {new Date(t.last_used_at).toLocaleString('ko-KR')}</>
                        )}
                      </div>
                      {linkedDevice ? (
                        <div className="text-[11px] text-emerald-600 mt-0.5">
                          연결됨: {linkedDevice.name}
                        </div>
                      ) : (
                        <div className="text-[11px] text-amber-600 mt-0.5">
                          아직 launcher 페어링 안 됨 (setup 마법사에 paste 필요)
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => revokeToken(t.id)}
                      className="text-xs text-rose-600 hover:underline shrink-0 flex items-center gap-1"
                      title="토큰 회수"
                    >
                      <Trash2 size={12} /> 회수
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </section>

      {/* 연결 단계 */}
      <section className="mb-8">
        <h2 className="font-semibold text-slate-900 mb-3">런처 연결 방법</h2>
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-6">
          <Step n={1} title="런처 다운로드 & 설치">
            <p className="text-sm text-slate-600 mb-2">
              <b>MyriadLauncher.zip</b> 을 받아서 원하는 폴더에 압축 풀기.
              안에 <code className="text-xs bg-slate-100 px-1 rounded">MyriadLauncher.exe</code> +
              <code className="text-xs bg-slate-100 px-1 rounded ml-1">MyriadSetup.exe</code> 두 파일이 들어있습니다.
            </p>
            <a
              href={LAUNCHER_DOWNLOAD_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-4 py-2 rounded-lg text-sm transition"
            >
              <Download size={14} /> 런처 다운로드 (ZIP)
            </a>
          </Step>

          <Step n={2} title="인증 토큰 발급 & 복사">
            <p className="text-sm text-slate-600">
              위 "인증 토큰" 섹션에서 <b>새 토큰 발급</b> 클릭 → 모달에서 한 번만 표시되는 토큰 복사.
              <br/>토큰은 <code className="text-xs bg-slate-100 px-1 rounded">myrlnch_</code> 로 시작하는 64자 문자열입니다.
            </p>
          </Step>

          <Step n={3} title="setup 마법사 실행 → 토큰 paste">
            <p className="text-sm text-slate-600">
              <code className="text-xs bg-slate-100 px-1 rounded">MyriadSetup.exe</code> 실행 → 콘솔 창에 토큰 붙여넣기 → PC 이름 입력 → 저장.
              <br/>그 다음 <code className="text-xs bg-slate-100 px-1 rounded">MyriadLauncher.exe</code> 실행하면 트레이 아이콘에 등장하고 위 "연결된 PC" 목록에 자동 등록됩니다.
            </p>
            <div className="mt-2 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded p-2">
              💡 토큰은 한 번 발급되면 <b>회수하기 전까지 영구 유효</b>. refresh / 만료 없음.
              슬립 / 리부팅 / 네트워크 블립 모두 안전하게 자동 복귀.
            </div>
          </Step>
        </div>
      </section>

      {/* 토큰 발급 모달 */}
      {issueModal && (
        <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-xl">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-bold text-slate-900 flex items-center gap-2">
                <Key size={18} /> 새 launcher 토큰
              </h3>
              <button
                onClick={() => setIssueModal(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-5">
              {issuedToken ? (
                <>
                  <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
                    <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                    <div>
                      <b>이 토큰은 한 번만 표시됩니다.</b> 지금 복사해서 setup 마법사에 paste 하세요.
                      <br/>분실 시 새로 발급해야 합니다 (옛 토큰 회수 후 재발급).
                    </div>
                  </div>
                  <textarea
                    readOnly
                    value={issuedToken}
                    rows={3}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-[11px] font-mono break-all"
                    onClick={(e) => e.target.select()}
                  />
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={copyToken}
                      className="flex-1 flex items-center justify-center gap-2 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-4 py-2 rounded-lg text-sm"
                    >
                      {copied ? (
                        <><CheckCircle2 size={14} /> 복사됨</>
                      ) : (
                        <><Copy size={14} /> 복사</>
                      )}
                    </button>
                    <button
                      onClick={() => setIssueModal(false)}
                      className="px-4 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold rounded-lg text-sm"
                    >
                      닫기
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    이 토큰을 어떤 PC 에 쓸 건가요?
                  </label>
                  <input
                    type="text"
                    value={issueName}
                    onChange={(e) => setIssueName(e.target.value)}
                    placeholder="예: 회사 데스크탑"
                    maxLength={60}
                    autoFocus
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-3"
                  />
                  <p className="text-xs text-slate-500 mb-4">
                    PC 의 별명입니다 (목록에서 식별용). 나중에 launcher 가 실제 device 이름으로 덮어씁니다.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={issueToken}
                      disabled={issueLoading}
                      className="flex-1 flex items-center justify-center gap-2 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-4 py-2 rounded-lg text-sm disabled:opacity-50"
                    >
                      {issueLoading ? (
                        <><Loader2 size={14} className="animate-spin" /> 발급 중...</>
                      ) : (
                        <><Key size={14} /> 발급</>
                      )}
                    </button>
                    <button
                      onClick={() => setIssueModal(false)}
                      className="px-4 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold rounded-lg text-sm"
                    >
                      취소
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Step({ n, title, children }) {
  return (
    <div className="flex gap-4">
      <div className="shrink-0 w-8 h-8 rounded-full bg-myriad-primary/20 flex items-center justify-center font-bold text-myriad-ink">
        {n}
      </div>
      <div className="flex-1">
        <h3 className="font-semibold text-slate-900 mb-1">{title}</h3>
        {children}
      </div>
    </div>
  )
}
