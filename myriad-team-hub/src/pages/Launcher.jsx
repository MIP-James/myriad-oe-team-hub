import { useEffect, useState } from 'react'
import {
  Cpu, Copy, RefreshCw, CheckCircle2, XCircle, Loader2, Download, Monitor,
  AlertTriangle, Clock
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

const STALE_THRESHOLD_MS = 60 * 1000
function isFresh(lastSeenAt) {
  if (!lastSeenAt) return false
  return Date.now() - new Date(lastSeenAt).getTime() < STALE_THRESHOLD_MS
}

// 런처 배포 고정 URL — admin-scripts/release_launcher.py 가 이 태그에 업로드
const LAUNCHER_DOWNLOAD_URL =
  'https://github.com/MIP-James/myriad-oe-team-hub/releases/download/launcher-latest/MyriadLauncher.zip'

export default function Launcher() {
  const { session, user } = useAuth()
  const [devices, setDevices] = useState([])
  const [loading, setLoading] = useState(true)
  const [connectionString, setConnectionString] = useState('')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => { load() }, [])

  // Realtime: 본인의 device 상태 변화 구독
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
    const { data, error } = await supabase
      .from('launcher_devices')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) setError(error.message)
    else setDevices(data ?? [])
    setLoading(false)
  }

  async function generateConnection() {
    if (!session) {
      setError('로그인 세션을 확인할 수 없습니다.')
      return
    }
    setError(null)
    // 실제로 Supabase 에 refresh 를 요청해서 "새로운" refresh_token 을 받아야
    // 런처/다른 디바이스가 쓸 수 있는 유효한 토큰이 됨.
    let fresh = session
    try {
      const { data, error } = await supabase.auth.refreshSession()
      if (error) throw error
      if (!data.session) throw new Error('세션 갱신 실패')
      fresh = data.session
    } catch (e) {
      setError(
        '토큰 갱신 실패: ' + (e?.message ?? String(e)) +
        '\n(기존 토큰이 이미 다른 기기에서 소비됐을 수 있습니다. 로그아웃 후 재로그인하세요.)'
      )
      return
    }
    const payload = {
      v: 1,
      url: import.meta.env.VITE_SUPABASE_URL,
      anon_key: import.meta.env.VITE_SUPABASE_ANON_KEY,
      access_token: fresh.access_token,
      refresh_token: fresh.refresh_token,
      user_id: fresh.user.id,
      email: fresh.user.email
    }
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload))))
    setConnectionString('myriadlauncher_v1:' + encoded)
    setCopied(false)
  }

  async function copyToken() {
    if (!connectionString) return
    try {
      await navigator.clipboard.writeText(connectionString)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch (e) {
      setError('클립보드 복사 실패: ' + e.message)
    }
  }

  async function removeDevice(id) {
    if (!window.confirm('이 디바이스 등록을 삭제할까요? 해당 PC의 런처는 재연결해야 합니다.')) return
    const { error } = await supabase.from('launcher_devices').delete().eq('id', id)
    if (error) { setError(error.message); return }
    await load()
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <header className="mb-6 flex items-center gap-3">
        <Cpu className="text-myriad-ink" />
        <h1 className="text-2xl font-bold text-slate-900">내 런처</h1>
      </header>

      <p className="text-sm text-slate-500 mb-6">
        MYRIAD Launcher를 본인 PC에 설치하면 이 웹에서 "실행" 버튼으로 유틸을 원격 실행할 수 있습니다.
      </p>

      {error && (
        <div className="mb-4 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg p-3">
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
              아직 연결된 PC가 없습니다. 아래 "1단계 ~ 3단계" 를 따라 연결하세요.
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

      {/* 연결 단계 */}
      <section className="mb-8">
        <h2 className="font-semibold text-slate-900 mb-3">런처 연결 방법</h2>
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-6">
          <Step n={1} title="런처 설치">
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

          <Step n={2} title="연결 토큰 발급">
            <p className="text-sm text-slate-600 mb-3">
              아래 버튼을 눌러 본인 계정 전용 연결 토큰을 생성한 뒤, 런처 설치 마법사에 붙여넣으세요.
            </p>
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <button
                  onClick={generateConnection}
                  className="flex items-center gap-2 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-4 py-2 rounded-lg text-sm"
                >
                  <RefreshCw size={14} />
                  {connectionString ? '재발급' : '토큰 발급'}
                </button>
                {connectionString && (
                  <button
                    onClick={copyToken}
                    className="flex items-center gap-2 border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold px-4 py-2 rounded-lg text-sm"
                  >
                    {copied ? (
                      <>
                        <CheckCircle2 size={14} className="text-emerald-500" /> 복사됨
                      </>
                    ) : (
                      <>
                        <Copy size={14} /> 복사
                      </>
                    )}
                  </button>
                )}
              </div>
              {connectionString && (
                <>
                  <textarea
                    readOnly
                    value={connectionString}
                    rows={3}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-[11px] font-mono break-all"
                    onClick={(e) => e.target.select()}
                  />
                  <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
                    <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                    <div>
                      이 토큰으로 <b>본인 계정 권한</b>이 런처에 부여됩니다. 타인과 공유하지 마세요.
                      유출 시 이 페이지에서 해당 디바이스를 <b>삭제</b> 하면 즉시 차단됩니다.
                    </div>
                  </div>
                </>
              )}
            </div>
          </Step>

          <Step n={3} title="런처 실행 & 토큰 입력">
            <p className="text-sm text-slate-600">
              설치한 런처를 처음 실행하면 연결 토큰 입력 창이 뜹니다. 위 토큰을 붙여넣고 저장.
              연결 성공 시 위 "연결된 PC" 목록에 표시되고 <b>온라인</b> 뱃지가 뜹니다.
            </p>
          </Step>
        </div>
      </section>
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
