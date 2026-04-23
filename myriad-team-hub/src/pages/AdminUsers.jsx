/**
 * 관리자 — 사용자 관리.
 *  - 모든 팀원 리스트 표시 (이름/이메일/역할/가입일)
 *  - 역할 변경 (member ↔ admin) — 본인 변경 불가, 마지막 admin 강등 불가
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Users, ShieldCheck, ChevronLeft, Loader2, ArrowUpCircle, ArrowDownCircle,
  AlertTriangle, X, Save
} from 'lucide-react'
import { listAllProfiles, updateUserRole, countAdmins } from '../lib/users'
import { useAuth } from '../contexts/AuthContext'

export default function AdminUsers() {
  const { user, reloadProfile } = useAuth()
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [confirm, setConfirm] = useState(null)   // { profile, newRole }
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setError(null)
    try {
      const list = await listAllProfiles()
      setProfiles(list)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function applyChange() {
    if (!confirm) return
    setSaving(true); setError(null)
    try {
      // 마지막 admin 강등 방지 (서버 측에선 검증 안 됨, 클라 가드)
      if (confirm.newRole === 'member' && confirm.profile.role === 'admin') {
        const adminCount = await countAdmins()
        if (adminCount <= 1) {
          throw new Error('마지막 관리자는 강등할 수 없습니다. 다른 사람을 먼저 관리자로 승격해주세요.')
        }
      }
      await updateUserRole(confirm.profile.id, confirm.newRole)
      // 만약 본인 역할이 바뀌었다면 (실제로는 본인 변경 불가지만 안전망)
      if (confirm.profile.id === user?.id) {
        await reloadProfile?.()
      }
      setConfirm(null)
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const adminCount = profiles.filter((p) => p.role === 'admin').length
  const memberCount = profiles.filter((p) => p.role === 'member').length

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center gap-2 mb-2">
        <Link to="/admin" className="text-sm text-slate-500 hover:text-myriad-ink inline-flex items-center gap-1">
          <ChevronLeft size={14} /> 관리자
        </Link>
      </div>
      <header className="mb-6 flex items-center gap-3">
        <Users className="text-myriad-ink" />
        <h1 className="text-2xl font-bold text-slate-900">사용자 관리</h1>
        <div className="flex-1" />
        <div className="text-xs text-slate-500 flex gap-3">
          <span>전체 <b className="text-slate-800">{profiles.length}</b>명</span>
          <span>관리자 <b className="text-amber-700">{adminCount}</b></span>
          <span>일반 <b className="text-slate-700">{memberCount}</b></span>
        </div>
      </header>

      <p className="text-sm text-slate-500 mb-4">
        팀원 역할을 관리합니다. 관리자는 유틸/시트/공지/케이스/외부 바로가기 등록 + 사용자 권한 관리가 가능합니다.
      </p>

      {error && (
        <div className="mb-3 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg p-3 flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-rose-500 hover:text-rose-700"><X size={14} /></button>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-sm text-slate-400 flex items-center justify-center gap-2">
            <Loader2 size={14} className="animate-spin" /> 불러오는 중...
          </div>
        ) : profiles.length === 0 ? (
          <div className="py-16 text-center text-sm text-slate-400">
            팀원이 없습니다.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2 text-left">이름</th>
                <th className="px-4 py-2 text-left">이메일</th>
                <th className="px-4 py-2 text-left w-32">역할</th>
                <th className="px-4 py-2 text-left w-32">가입일</th>
                <th className="px-4 py-2 text-left w-44">작업</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => {
                const isMe = p.id === user?.id
                const isAdmin = p.role === 'admin'
                return (
                  <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-myriad-primary/20 text-myriad-ink flex items-center justify-center text-[11px] font-bold">
                          {(p.full_name || p.email || '?')[0]?.toUpperCase()}
                        </div>
                        <span className="font-semibold text-slate-900">
                          {p.full_name || '(이름 없음)'}
                        </span>
                        {isMe && <span className="text-[10px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded">나</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">{p.email}</td>
                    <td className="px-4 py-3">
                      {isAdmin ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-md">
                          <ShieldCheck size={11} /> 관리자
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md">
                          일반
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {new Date(p.created_at).toLocaleDateString('ko-KR', {
                        year: '2-digit', month: '2-digit', day: '2-digit'
                      })}
                    </td>
                    <td className="px-4 py-3">
                      {isMe ? (
                        <span className="text-xs text-slate-400">본인 변경 불가</span>
                      ) : isAdmin ? (
                        <button
                          onClick={() => setConfirm({ profile: p, newRole: 'member' })}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-rose-700 hover:bg-rose-50 px-2.5 py-1 rounded-lg border border-slate-200"
                        >
                          <ArrowDownCircle size={12} /> 일반으로 강등
                        </button>
                      ) : (
                        <button
                          onClick={() => setConfirm({ profile: p, newRole: 'admin' })}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-amber-800 hover:text-amber-900 hover:bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-300"
                        >
                          <ArrowUpCircle size={12} /> 관리자로 승격
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* 확인 모달 */}
      {confirm && (
        <RoleChangeConfirm
          profile={confirm.profile}
          newRole={confirm.newRole}
          saving={saving}
          onConfirm={applyChange}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  )
}

function RoleChangeConfirm({ profile, newRole, saving, onConfirm, onCancel }) {
  const isPromote = newRole === 'admin'
  const name = profile.full_name || profile.email
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <header className="px-6 py-4 border-b border-slate-200 flex items-center">
          <h2 className="font-bold text-slate-900">역할 변경 확인</h2>
          <div className="flex-1" />
          <button onClick={onCancel} className="p-1 hover:bg-slate-100 rounded"><X size={18} /></button>
        </header>
        <div className="p-6 space-y-4">
          <div className="bg-slate-50 rounded-lg p-4">
            <div className="text-xs text-slate-500 mb-1">대상</div>
            <div className="font-semibold text-slate-900">{name}</div>
            <div className="text-xs text-slate-500 mt-0.5">{profile.email}</div>
          </div>
          <p className="text-sm text-slate-700">
            <b>{name}</b> 님을 <b className={isPromote ? 'text-amber-700' : 'text-slate-700'}>
              {isPromote ? '관리자' : '일반 사용자'}
            </b> 로 변경합니다.
          </p>
          {isPromote ? (
            <p className="text-xs text-slate-500 bg-amber-50 border border-amber-200 rounded p-3">
              관리자 권한 부여 시 모든 데이터(공지, 유틸, 시트, 케이스 등) 의 등록/편집/삭제 가 가능해집니다.
            </p>
          ) : (
            <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded p-3">
              일반 사용자로 변경되면 관리자 메뉴 접근이 제한됩니다.
            </p>
          )}
        </div>
        <footer className="px-6 py-4 border-t border-slate-200 flex items-center justify-end gap-2">
          <button onClick={onCancel} className="text-slate-600 hover:bg-slate-100 px-4 py-2 rounded-lg text-sm">취소</button>
          <button
            onClick={onConfirm}
            disabled={saving}
            className={`flex items-center gap-2 font-semibold px-4 py-2 rounded-lg text-sm disabled:opacity-50 ${
              isPromote
                ? 'bg-amber-500 hover:bg-amber-600 text-white'
                : 'bg-slate-700 hover:bg-slate-800 text-white'
            }`}
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            확인
          </button>
        </footer>
      </div>
    </div>
  )
}
