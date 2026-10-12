/**
 * 대시보드 — 공용 PC 사용 현황 + [원격 접속] (.rdp 다운로드).
 * 등록된 공용 PC 가 없으면 렌더링 안 함.
 *
 * Win11 Pro 원격 데스크톱 = 화면 1명. 다른 사람이 쓰는 중에 접속하면
 * 그 사람 화면이 끊김(작업은 백그라운드 유지) → 접속 전 확인창.
 */
import { useEffect, useState } from 'react'
import { Monitor, MonitorPlay } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import {
  listSharedPcs, isReportFresh, sessionDisplayName, sessionSince, myAccount, downloadRdpFile
} from '../lib/sharedPcs'

function fmtTime(d) {
  return d ? d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }) : ''
}

function fmtDuration(fromIso) {
  if (!fromIso) return ''
  const min = Math.max(0, Math.round((Date.now() - new Date(fromIso).getTime()) / 60000))
  if (min < 60) return `${min}분`
  const h = Math.floor(min / 60)
  return h < 24 ? `${h}시간 ${min % 60}분` : `${Math.floor(h / 24)}일`
}

export default function SharedPcWidget() {
  const { user } = useAuth()
  const [pcs, setPcs] = useState(null)
  const [, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    const reload = () => listSharedPcs().then((d) => alive && setPcs(d)).catch(() => alive && setPcs([]))
    reload()
    const ch = supabase
      .channel('shared-pcs-widget')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shared_pcs' }, reload)
      .subscribe()
    // 경과 시간 표시 + '확인 불가' 판정 갱신
    const timer = setInterval(() => setTick((t) => t + 1), 60 * 1000)
    return () => { alive = false; supabase.removeChannel(ch); clearInterval(timer) }
  }, [])

  if (!pcs || pcs.length === 0) return null

  return (
    <section className="mb-6 space-y-3">
      {pcs.map((pc) => (
        <SharedPcCard key={pc.id} pc={pc} userId={user?.id} />
      ))}
    </section>
  )
}

function SharedPcCard({ pc, userId }) {
  const fresh = isReportFresh(pc)
  const sessions = pc.sessions ?? []
  const mine = myAccount(pc, userId)
  const active = sessions.find((s) => s.state === 'active')
  const activeIsMe = active && mine && active.win_user.toLowerCase() === mine.windows_username.toLowerCase()
  const disconnected = sessions.filter((s) => s.state === 'disconnected')

  function connect() {
    if (fresh && active && !activeIsMe) {
      const who = sessionDisplayName(pc, active.win_user)
      const ok = window.confirm(
        `${who} 님이 ${fmtTime(sessionSince(active))}부터 사용 중입니다.\n\n` +
        `접속하면 ${who} 님의 화면이 끊깁니다 (실행 중인 작업은 유지).\n그래도 접속할까요?`
      )
      if (!ok) return
    }
    downloadRdpFile(pc, mine?.windows_username)
  }

  let status
  if (!fresh) {
    status = (
      <span className="text-slate-500">
        ○ 상태 확인 불가 — PC 가 꺼져 있거나 네트워크가 끊겼을 수 있습니다
        {pc.reported_at && ` (마지막 확인 ${fmtDuration(pc.reported_at)} 전)`}
      </span>
    )
  } else if (active) {
    status = (
      <span className={activeIsMe ? 'text-emerald-700' : 'text-amber-700'}>
        ● {sessionDisplayName(pc, active.win_user)}{activeIsMe && ' (나)'} 사용 중
        <span className="text-slate-500"> · {fmtTime(sessionSince(active))}~</span>
        {active.via === 'console' && <span className="text-slate-500"> · 노트북 앞에서 직접 사용</span>}
      </span>
    )
  } else {
    status = <span className="text-emerald-700">● 사용 가능</span>
  }

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="w-10 h-10 rounded-lg bg-myriad-primary/10 flex items-center justify-center shrink-0">
        <Monitor size={18} className="text-myriad-ink" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-slate-900">{pc.name}</h2>
          <span className="text-[10px] text-slate-400">{pc.hostname}</span>
        </div>
        <p className="text-sm mt-0.5">{status}</p>
        {fresh && disconnected.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {disconnected.map((s) => (
              <li key={s.win_user} className="text-xs text-slate-500">
                ○ {sessionDisplayName(pc, s.win_user)} 연결 끊김 · 백그라운드 유지 중 ({fmtDuration(s.disconnected_at)})
              </li>
            ))}
          </ul>
        )}
        {!mine && (
          <p className="text-[11px] text-slate-400 mt-1">
            내 윈도우 계정이 아직 연결되지 않았습니다 — 접속 창에서 계정을 직접 입력하거나 관리자에게 연결을 요청하세요.
          </p>
        )}
      </div>
      <button
        onClick={connect}
        className="flex items-center justify-center gap-1.5 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-4 py-2 rounded-lg text-sm shrink-0"
        title="원격 데스크톱 접속 파일(.rdp)을 받아 엽니다"
      >
        <MonitorPlay size={14} /> 원격 접속
      </button>
    </div>
  )
}

