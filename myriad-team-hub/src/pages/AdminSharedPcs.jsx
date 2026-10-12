/**
 * 관리자 — 공용 PC 원격 접속 (Phase 24).
 * 공용 PC 등록(컴퓨터 이름) + 윈도우 계정 ↔ 허브 사용자 매핑.
 * 세션 상태는 공용 PC 의 에이전트가 보고 (utilities/shared-pc-setup/setup_shared_pc.bat).
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Monitor, ChevronLeft, Plus, Trash2, Loader2, X, Eye, EyeOff } from 'lucide-react'
import {
  listSharedPcs, createSharedPc, updateSharedPc, deleteSharedPc,
  addSharedPcAccount, removeSharedPcAccount, isReportFresh, sessionDisplayName
} from '../lib/sharedPcs'
import { listAllProfiles } from '../lib/users'

export default function AdminSharedPcs() {
  const [pcs, setPcs] = useState([])
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [newPc, setNewPc] = useState({ name: '', hostname: '' })

  useEffect(() => { load() }, [])

  async function load() {
    try {
      const [p, profs] = await Promise.all([listSharedPcs({ includeInactive: true }), listAllProfiles()])
      setPcs(p)
      setProfiles(profs)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function run(fn) {
    setError(null)
    try {
      await fn()
      await load()
    } catch (e) {
      setError(e.message?.includes('duplicate') ? '이미 등록된 값입니다 (컴퓨터 이름/계정명/사용자 중복).' : e.message)
    }
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <Link to="/admin" className="text-sm text-slate-500 hover:text-slate-800 flex items-center gap-1 mb-4">
        <ChevronLeft size={14} /> 관리자
      </Link>
      <header className="mb-2 flex items-center gap-3">
        <Monitor className="text-myriad-ink" />
        <h1 className="text-2xl font-bold text-slate-900">공용 PC 원격 접속</h1>
      </header>
      <p className="text-sm text-slate-500 mb-6">
        공용 PC 에서 <code className="text-xs bg-slate-100 px-1 rounded">setup_shared_pc.bat</code> 을 실행해 에이전트를 설치하면
        사용 현황이 대시보드에 표시됩니다. 윈도우 계정을 연결하면 [원격 접속] 파일에 계정명이 자동으로 채워집니다.
      </p>

      {error && (
        <div className="mb-4 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg p-3">{error}</div>
      )}

      {loading ? (
        <div className="py-12 text-center text-sm text-slate-400 flex items-center justify-center gap-2">
          <Loader2 size={14} className="animate-spin" /> 불러오는 중...
        </div>
      ) : (
        <div className="space-y-4">
          {pcs.map((pc) => (
            <PcCard key={pc.id} pc={pc} profiles={profiles} run={run} />
          ))}

          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (!newPc.name.trim() || !newPc.hostname.trim()) return
              run(async () => {
                await createSharedPc(newPc)
                setNewPc({ name: '', hostname: '' })
              })
            }}
            className="bg-slate-50 border border-dashed border-slate-300 rounded-2xl p-4 flex flex-col sm:flex-row gap-2"
          >
            <input
              value={newPc.name}
              onChange={(e) => setNewPc({ ...newPc, name: e.target.value })}
              placeholder="표시 이름 (예: 공용 노트북 2)"
              className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg"
            />
            <input
              value={newPc.hostname}
              onChange={(e) => setNewPc({ ...newPc, hostname: e.target.value })}
              placeholder="컴퓨터 이름 (cmd 에서 hostname)"
              className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
            />
            <button className="flex items-center justify-center gap-1 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-4 py-2 rounded-lg text-sm">
              <Plus size={14} /> 공용 PC 추가
            </button>
          </form>
        </div>
      )}
    </div>
  )
}

function PcCard({ pc, profiles, run }) {
  const [winUser, setWinUser] = useState('')
  const [userId, setUserId] = useState('')
  const fresh = isReportFresh(pc)
  const mappedIds = new Set(pc.accounts.map((a) => a.user_id))

  return (
    <div className={`bg-white border border-slate-200 rounded-2xl p-5 ${pc.is_active ? '' : 'opacity-60'}`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-slate-900">{pc.name}</h3>
            <span className="text-xs font-mono text-slate-500">{pc.hostname}</span>
            {!pc.is_active && <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded">비활성</span>}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {pc.reported_at ? (
              <>
                <span className={fresh ? 'text-emerald-700' : 'text-rose-600'}>
                  {fresh ? '● 에이전트 정상' : '● 에이전트 응답 없음'}
                </span>
                {' · '}마지막 보고 {new Date(pc.reported_at).toLocaleString('ko-KR')}
                {pc.lan_ip && <> · IP {pc.lan_ip}</>}
                {pc.agent_version && <> · v{pc.agent_version}</>}
              </>
            ) : (
              <span className="text-amber-700">● 아직 보고 없음 — 공용 PC 에서 setup_shared_pc.bat 5단계(에이전트) 실행 필요</span>
            )}
          </p>
          {fresh && (pc.sessions ?? []).length > 0 && (
            <p className="text-xs text-slate-500 mt-1">
              세션: {pc.sessions.map((s) => `${sessionDisplayName(pc, s.win_user)}(${s.state === 'active' ? '사용 중' : '끊김'})`).join(', ')}
            </p>
          )}
        </div>
        <button
          onClick={() => run(() => updateSharedPc(pc.id, { is_active: !pc.is_active }))}
          className="text-slate-400 hover:text-slate-700 p-1"
          title={pc.is_active ? '대시보드에서 숨기기' : '대시보드에 표시'}
        >
          {pc.is_active ? <Eye size={16} /> : <EyeOff size={16} />}
        </button>
        <button
          onClick={() => {
            if (window.confirm(`'${pc.name}' 을(를) 삭제할까요? 계정 연결도 함께 삭제됩니다.`)) {
              run(() => deleteSharedPc(pc.id))
            }
          }}
          className="text-slate-400 hover:text-rose-600 p-1"
          title="삭제"
        >
          <Trash2 size={16} />
        </button>
      </div>

      <div className="mt-4 pt-4 border-t border-slate-100">
        <h4 className="text-xs font-semibold text-slate-500 mb-2">윈도우 계정 연결</h4>
        <ul className="space-y-1 mb-3">
          {pc.accounts.length === 0 && <li className="text-xs text-slate-400">연결된 계정이 없습니다.</li>}
          {pc.accounts.map((a) => (
            <li key={a.id} className="flex items-center gap-2 text-sm">
              <span className="font-mono text-slate-700">{a.windows_username}</span>
              <span className="text-slate-400">→</span>
              <span className="text-slate-800">{a.display_name}</span>
              <button
                onClick={() => run(() => removeSharedPcAccount(a.id))}
                className="text-slate-300 hover:text-rose-600"
                title="연결 해제"
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!winUser.trim() || !userId) return
            run(async () => {
              await addSharedPcAccount(pc.id, winUser, userId)
              setWinUser('')
              setUserId('')
            })
          }}
          className="flex flex-col sm:flex-row gap-2"
        >
          <input
            value={winUser}
            onChange={(e) => setWinUser(e.target.value)}
            placeholder="윈도우 계정명 (예: kim)"
            className="flex-1 px-3 py-1.5 text-sm border border-slate-200 rounded-lg font-mono"
          />
          <select
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="flex-1 px-3 py-1.5 text-sm border border-slate-200 rounded-lg bg-white"
          >
            <option value="">허브 사용자 선택</option>
            {profiles.filter((p) => !mappedIds.has(p.id)).map((p) => (
              <option key={p.id} value={p.id}>{p.full_name || p.email}</option>
            ))}
          </select>
          <button className="flex items-center justify-center gap-1 border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold px-3 py-1.5 rounded-lg text-sm">
            <Plus size={14} /> 연결
          </button>
        </form>
      </div>
    </div>
  )
}
