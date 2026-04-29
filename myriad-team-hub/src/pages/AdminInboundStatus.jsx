/**
 * Inbound 자동 케이스화 관리 페이지 (관리자 전용).
 *
 * - Reader 상태 (skylar 등 OAuth 토큰 보유자) + 등록/회수
 * - 매핑 룰 CRUD (브랜드 ↔ 발신자/도메인/그룹메일 + 담당자 + 키워드 매칭)
 * - 키워드 관리 (시스템 전역, chip 토글)
 * - 최근 처리 메일 목록 (24시간)
 * - "지금 폴링" 수동 트리거 (디버그)
 */
import { useEffect, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import {
  Mail, Plus, Edit2, Trash2, RefreshCw, Loader2, CheckCircle2,
  AlertTriangle, Link2, Unlink, Play, Tag, X, Save, ChevronRight
} from 'lucide-react'
import {
  getInboundReaderStatus, startInboundReaderConnect, disconnectInboundReader,
  triggerInboundPoll,
  listInboundMappings, createInboundMapping, updateInboundMapping, deleteInboundMapping,
  listInboundKeywords, createInboundKeyword, toggleInboundKeyword, deleteInboundKeyword,
  listRecentInboundMessages, listProfilesForAssignee
} from '../lib/inboundReader'

export default function AdminInboundStatus() {
  const [params, setParams] = useSearchParams()
  const [toast, setToast] = useState(null)

  // OAuth 콜백 복귀 처리
  useEffect(() => {
    const v = params.get('inbound')
    if (!v) return
    if (v === 'connected') {
      setToast({ kind: 'success', text: 'Inbound Reader 등록이 완료되었습니다. 5분 안에 첫 폴링이 시작됩니다.' })
      reloadAll()
    } else if (v === 'error') {
      const detail = params.get('detail') || '알 수 없는 오류'
      setToast({ kind: 'error', text: 'Reader 등록 실패: ' + detail })
    }
    const next = new URLSearchParams(params)
    next.delete('inbound')
    next.delete('detail')
    setParams(next, { replace: true })
    const timer = setTimeout(() => setToast(null), 8000)
    return () => clearTimeout(timer)
  }, [params])

  // ── 데이터 상태 ─────────────────────────────────────────
  const [status, setStatus] = useState(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [mappings, setMappings] = useState([])
  const [keywords, setKeywords] = useState([])
  const [recent, setRecent] = useState([])
  const [profiles, setProfiles] = useState([])
  const [polling, setPolling] = useState(false)

  async function reloadAll() {
    setStatusLoading(true)
    try {
      const [s, m, k, r, p] = await Promise.all([
        getInboundReaderStatus(),
        listInboundMappings().catch(() => []),
        listInboundKeywords().catch(() => []),
        listRecentInboundMessages(50).catch(() => []),
        listProfilesForAssignee().catch(() => [])
      ])
      setStatus(s)
      setMappings(m)
      setKeywords(k)
      setRecent(r)
      setProfiles(p)
    } catch (e) {
      setToast({ kind: 'error', text: e.message })
    } finally {
      setStatusLoading(false)
    }
  }

  useEffect(() => { reloadAll() }, [])

  // ── 핸들러 ─────────────────────────────────────────────
  async function handleConnect() {
    try {
      await startInboundReaderConnect()
    } catch (e) {
      setToast({ kind: 'error', text: e.message })
    }
  }

  async function handleDisconnect(userId) {
    if (!confirm('Reader 권한을 회수할까요? 이후 자동 폴링이 중단됩니다.')) return
    try {
      await disconnectInboundReader(userId)
      setToast({ kind: 'success', text: 'Reader 권한이 회수되었습니다.' })
      await reloadAll()
    } catch (e) {
      setToast({ kind: 'error', text: e.message })
    }
  }

  async function handleManualPoll() {
    setPolling(true)
    try {
      const data = await triggerInboundPoll()
      const total = (data.readers || []).reduce((s, r) => s + (r.processed || 0), 0)
      setToast({
        kind: 'success',
        text: `폴링 완료 — 신규 ${total}건 처리 (${(data.duration_ms || 0) / 1000}초)`
      })
      await reloadAll()
    } catch (e) {
      setToast({ kind: 'error', text: '폴링 실패: ' + e.message })
    } finally {
      setPolling(false)
    }
  }

  // ── 매핑 추가/편집 모달 ─────────────────────────────────
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorData, setEditorData] = useState(null)

  function openEditor(mapping = null) {
    setEditorData(mapping)
    setEditorOpen(true)
  }

  async function handleSaveMapping(payload) {
    try {
      if (editorData?.id) {
        await updateInboundMapping(editorData.id, payload)
        setToast({ kind: 'success', text: '매핑 수정 완료' })
      } else {
        await createInboundMapping(payload)
        setToast({ kind: 'success', text: '매핑 추가 완료' })
      }
      setEditorOpen(false)
      await reloadAll()
    } catch (e) {
      setToast({ kind: 'error', text: '저장 실패: ' + e.message })
    }
  }

  async function handleDeleteMapping(id) {
    if (!confirm('이 매핑을 삭제할까요? 이후 해당 브랜드 자동 매칭이 중단됩니다.')) return
    try {
      await deleteInboundMapping(id)
      setToast({ kind: 'success', text: '매핑 삭제 완료' })
      await reloadAll()
    } catch (e) {
      setToast({ kind: 'error', text: e.message })
    }
  }

  // ── 키워드 추가/삭제 ───────────────────────────────────
  const [newKeyword, setNewKeyword] = useState('')

  async function handleAddKeyword() {
    const k = newKeyword.trim()
    if (!k) return
    try {
      await createInboundKeyword(k)
      setNewKeyword('')
      await reloadAll()
    } catch (e) {
      setToast({ kind: 'error', text: e.message })
    }
  }

  // ── 렌더 ───────────────────────────────────────────────
  const reader = status?.active_reader
  const stats = status?.stats || { processed_24h: 0, skipped_24h: 0, last_processed_at: null }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {toast && (
        <div className={`mb-4 px-4 py-3 rounded-lg border text-sm flex items-start gap-2 ${
          toast.kind === 'success'
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : 'bg-rose-50 border-rose-200 text-rose-800'
        }`}>
          <span className="font-semibold">{toast.kind === 'success' ? '✅' : '⚠️'}</span>
          <span className="flex-1 whitespace-pre-wrap break-all">{toast.text}</span>
          <button onClick={() => setToast(null)} className="text-xs hover:opacity-60">닫기</button>
        </div>
      )}

      <header className="mb-6 flex items-center gap-3">
        <Mail className="text-myriad-ink" size={24} />
        <h1 className="text-2xl font-bold text-slate-900">Inbound 자동 케이스화</h1>
        <div className="flex-1" />
        <button
          onClick={handleManualPoll}
          disabled={polling || !reader}
          className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold px-4 py-2 rounded-lg text-sm disabled:opacity-50"
          title={reader ? '지금 즉시 폴링 실행' : '활성 Reader 가 없습니다'}
        >
          {polling ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          {polling ? '폴링 중...' : '지금 폴링'}
        </button>
      </header>

      {/* Reader 상태 카드 */}
      <ReaderStatusCard
        loading={statusLoading}
        reader={reader}
        stats={stats}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
        myEmail={status?.my_reader?.email}
        amIReader={!!status?.is_my_reader}
      />

      {/* 매핑 룰 */}
      <section className="bg-white rounded-2xl border border-slate-200 p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <h2 className="font-bold text-slate-900">브랜드 매핑 룰</h2>
          <span className="text-xs text-slate-500">— 발신자 이메일/도메인/그룹메일 매칭 후 자동 케이스화</span>
          <div className="flex-1" />
          <button
            onClick={() => openEditor(null)}
            className="flex items-center gap-1.5 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-3 py-1.5 rounded-lg text-xs"
          >
            <Plus size={14} /> 매핑 추가
          </button>
        </div>

        {mappings.length === 0 ? (
          <p className="text-sm text-slate-500 bg-slate-50 border border-dashed border-slate-200 rounded-lg p-4 text-center">
            등록된 매핑이 없습니다. 위 [매핑 추가] 로 첫 브랜드를 등록하세요.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500 border-b border-slate-200">
                  <th className="text-left py-2 px-2">브랜드</th>
                  <th className="text-left py-2 px-2">발신자 이메일</th>
                  <th className="text-left py-2 px-2">발신자 도메인</th>
                  <th className="text-left py-2 px-2">그룹 메일</th>
                  <th className="text-left py-2 px-2">담당</th>
                  <th className="text-center py-2 px-2">키워드</th>
                  <th className="text-center py-2 px-2">활성</th>
                  <th className="text-right py-2 px-2"></th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((m) => (
                  <tr key={m.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-2 px-2 font-semibold">{m.brand}</td>
                    <td className="py-2 px-2"><ChipList items={m.sender_emails} /></td>
                    <td className="py-2 px-2"><ChipList items={m.sender_domains} /></td>
                    <td className="py-2 px-2"><ChipList items={m.to_patterns} /></td>
                    <td className="py-2 px-2 text-xs">
                      <div>{m.default_assignee?.full_name || '-'}</div>
                      <div className="text-slate-400">↳ {m.secondary_assignee?.full_name || '-'}</div>
                    </td>
                    <td className="py-2 px-2 text-center">
                      {m.require_keyword_match ? '✅' : '—'}
                    </td>
                    <td className="py-2 px-2 text-center">
                      <span className={`inline-block w-2 h-2 rounded-full ${
                        m.is_active ? 'bg-emerald-500' : 'bg-slate-300'
                      }`} />
                    </td>
                    <td className="py-2 px-2 text-right">
                      <button
                        onClick={() => openEditor(m)}
                        className="p-1 hover:bg-slate-200 rounded mr-1"
                        title="편집"
                      ><Edit2 size={14} /></button>
                      <button
                        onClick={() => handleDeleteMapping(m.id)}
                        className="p-1 hover:bg-rose-100 rounded text-rose-600"
                        title="삭제"
                      ><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 키워드 */}
      <section className="bg-white rounded-2xl border border-slate-200 p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Tag size={16} className="text-slate-500" />
          <h2 className="font-bold text-slate-900">전역 키워드</h2>
          <span className="text-xs text-slate-500">— 매핑 통과 + 키워드 1개 이상 포함 시 케이스화 (옵션 B)</span>
        </div>

        <div className="flex flex-wrap gap-2 mb-3">
          {keywords.map((k) => (
            <span
              key={k.id}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border ${
                k.is_active
                  ? 'bg-blue-50 border-blue-200 text-blue-800'
                  : 'bg-slate-100 border-slate-200 text-slate-500 line-through'
              }`}
            >
              <button
                onClick={() => toggleInboundKeyword(k.id, !k.is_active).then(reloadAll)}
                className="hover:opacity-70"
                title={k.is_active ? '비활성화' : '활성화'}
              >
                {k.keyword}
              </button>
              <button
                onClick={() => deleteInboundKeyword(k.id).then(reloadAll)}
                className="hover:text-rose-600"
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={newKeyword}
            onChange={(e) => setNewKeyword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent?.isComposing) handleAddKeyword() }}
            placeholder="새 키워드 (예: 단속 요청)"
            className="flex-1 max-w-xs border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-myriad-primary"
          />
          <button
            onClick={handleAddKeyword}
            className="bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg text-sm flex items-center gap-1"
          >
            <Plus size={14} /> 추가
          </button>
        </div>
      </section>

      {/* 최근 처리 메일 */}
      <section className="bg-white rounded-2xl border border-slate-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <h2 className="font-bold text-slate-900">최근 처리 메일</h2>
          <span className="text-xs text-slate-500">— 최대 50건 (생성 / 댓글 / skip 모두 표시)</span>
          <div className="flex-1" />
          <button
            onClick={reloadAll}
            className="text-slate-500 hover:text-slate-800"
            title="새로고침"
          ><RefreshCw size={14} /></button>
        </div>

        {recent.length === 0 ? (
          <p className="text-sm text-slate-500 bg-slate-50 border border-dashed border-slate-200 rounded-lg p-4 text-center">
            처리한 메일이 아직 없습니다. Reader 등록 + 매핑 추가 후 5분 안에 첫 폴링이 시작됩니다.
          </p>
        ) : (
          <div className="space-y-1.5">
            {recent.map((m) => (
              <div
                key={m.message_id}
                className="flex items-center gap-3 text-xs px-3 py-2 rounded-lg hover:bg-slate-50 border border-slate-100"
              >
                <span className="text-slate-400 w-32 shrink-0">
                  {m.processed_at ? new Date(m.processed_at).toLocaleString('ko-KR', {
                    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
                  }) : '-'}
                </span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-semibold w-24 text-center shrink-0 ${
                  matchReasonStyle(m.match_reason)
                }`}>
                  {matchReasonLabel(m.match_reason)}
                </span>
                <span className="font-semibold text-slate-700 w-20 shrink-0 truncate">{m.brand || '-'}</span>
                <span className="flex-1 truncate text-slate-700">
                  {m.case ? (
                    <Link to={`/community/cases/${m.case.id}`} className="hover:underline text-myriad-primaryDark">
                      {m.case.title}
                    </Link>
                  ) : (
                    <span className="text-slate-400">(케이스 없음)</span>
                  )}
                </span>
                {m.case && (
                  <ChevronRight size={12} className="text-slate-300 shrink-0" />
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 매핑 편집 모달 */}
      {editorOpen && (
        <MappingEditor
          initial={editorData}
          profiles={profiles}
          onClose={() => setEditorOpen(false)}
          onSave={handleSaveMapping}
        />
      )}
    </div>
  )
}

// =============================================================
// Reader 상태 카드
// =============================================================
function ReaderStatusCard({ loading, reader, stats, onConnect, onDisconnect, myEmail, amIReader }) {
  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6 flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="animate-spin" size={14} /> 상태 확인 중...
      </div>
    )
  }

  if (!reader) {
    return (
      <div className="bg-amber-50 rounded-2xl border border-amber-200 p-6 mb-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="text-amber-600 shrink-0 mt-0.5" size={18} />
          <div className="flex-1">
            <h3 className="font-bold text-amber-900 mb-1">Reader 가 등록되지 않았습니다</h3>
            <p className="text-xs text-amber-800 mb-3">
              팀 리더 (예: skylar@myriadip.com) 가 본 페이지에 접속해서 아래 버튼으로
              Gmail readonly 권한을 한 번만 부여하면 5분마다 자동 폴링이 시작됩니다.
              <br />
              Google 측 권한은 언제든 회수 가능합니다 (Google 계정 → 보안 → 연결된 앱).
            </p>
            <button
              onClick={onConnect}
              className="inline-flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white font-semibold px-4 py-2 rounded-lg text-sm"
            >
              <Link2 size={14} /> Reader 로 등록하기 ({myEmail || '본인 계정'})
            </button>
          </div>
        </div>
      </div>
    )
  }

  const lastPolledAgo = reader.last_polled_at
    ? `${Math.round((Date.now() - new Date(reader.last_polled_at).getTime()) / 60000)} 분 전`
    : '없음'
  const statusColor = {
    ok: 'text-emerald-700 bg-emerald-100',
    just_registered: 'text-blue-700 bg-blue-100',
    token_expired: 'text-rose-700 bg-rose-100',
    api_error: 'text-rose-700 bg-rose-100',
    partial_error: 'text-amber-700 bg-amber-100',
    no_active_mappings: 'text-slate-700 bg-slate-100'
  }[reader.last_poll_status] || 'text-slate-700 bg-slate-100'

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6">
      <div className="flex items-start gap-4">
        <div className={`w-2 h-2 rounded-full mt-2 ${reader.is_active ? 'bg-emerald-500' : 'bg-slate-300'}`} />
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-bold text-slate-900">{reader.email}</h3>
            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${statusColor}`}>
              {readerStatusLabel(reader.last_poll_status)}
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs text-slate-600 mt-3">
            <div>
              <div className="text-slate-400">마지막 폴링</div>
              <div className="font-semibold text-slate-800">{lastPolledAgo}</div>
            </div>
            <div>
              <div className="text-slate-400">최근 24시간 신규 케이스</div>
              <div className="font-semibold text-slate-800">{stats.processed_24h} 건</div>
            </div>
            <div>
              <div className="text-slate-400">최근 24시간 skip</div>
              <div className="font-semibold text-slate-800">{stats.skipped_24h} 건</div>
            </div>
            <div>
              <div className="text-slate-400">누적 처리</div>
              <div className="font-semibold text-slate-800">{reader.total_processed_count} 건</div>
            </div>
          </div>

          {reader.last_poll_error && (
            <div className="mt-3 text-xs bg-rose-50 border border-rose-200 rounded-lg p-2 text-rose-800">
              <span className="font-semibold">최근 에러:</span> {reader.last_poll_error}
            </div>
          )}
        </div>

        <button
          onClick={() => onDisconnect(reader.user_id)}
          className="text-rose-600 hover:bg-rose-50 px-3 py-1.5 rounded-lg text-xs flex items-center gap-1 shrink-0"
          title="Reader 권한 회수"
        >
          <Unlink size={12} /> 회수
        </button>
      </div>
    </div>
  )
}

// =============================================================
// 매핑 편집 모달
// =============================================================
function MappingEditor({ initial, profiles, onClose, onSave }) {
  const [brand, setBrand] = useState(initial?.brand || '')
  const [senderEmails, setSenderEmails] = useState(initial?.sender_emails?.join(', ') || '')
  const [senderDomains, setSenderDomains] = useState(initial?.sender_domains?.join(', ') || '')
  const [toPatterns, setToPatterns] = useState(initial?.to_patterns?.join(', ') || '')
  const [defaultAssigneeId, setDefaultAssigneeId] = useState(initial?.default_assignee_id || '')
  const [secondaryAssigneeId, setSecondaryAssigneeId] = useState(initial?.secondary_assignee_id || '')
  const [requireKeyword, setRequireKeyword] = useState(initial?.require_keyword_match !== false)
  const [priority, setPriority] = useState(initial?.priority ?? 100)
  const [isActive, setIsActive] = useState(initial?.is_active !== false)
  const [saving, setSaving] = useState(false)

  function splitCsv(s) {
    return s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean)
  }

  async function handleSubmit() {
    if (!brand.trim()) { alert('브랜드명은 필수입니다.'); return }
    setSaving(true)
    await onSave({
      brand: brand.trim(),
      sender_emails: splitCsv(senderEmails),
      sender_domains: splitCsv(senderDomains),
      to_patterns: splitCsv(toPatterns),
      default_assignee_id: defaultAssigneeId || null,
      secondary_assignee_id: secondaryAssigneeId || null,
      require_keyword_match: requireKeyword,
      priority: Number(priority) || 100,
      is_active: isActive
    })
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <header className="px-6 py-4 border-b border-slate-200 flex items-center gap-3">
          <h2 className="font-bold text-slate-900">{initial ? '매핑 편집' : '새 매핑 추가'}</h2>
          <div className="flex-1" />
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded"><X size={18} /></button>
        </header>

        <div className="p-6 overflow-auto flex-1 space-y-4">
          <Field label="브랜드명" required>
            <input type="text" value={brand} onChange={(e) => setBrand(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-myriad-primary"
              placeholder="코오롱" />
          </Field>

          <Field label="발신자 이메일 (정확 매칭, 쉼표 구분)" hint="예: you7217@kolon.com, heeuni.chun@samsung.com">
            <input type="text" value={senderEmails} onChange={(e) => setSenderEmails(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </Field>

          <Field label="발신자 도메인 (도메인 매칭, 쉼표 구분)" hint="예: tbhglobal.co.kr, kolonmall.com (samsung.com 같은 광범위 도메인은 비추 — 정확 매칭 사용)">
            <input type="text" value={senderDomains} onChange={(e) => setSenderDomains(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </Field>

          <Field label="그룹 메일 To/CC 패턴 (보조, 쉼표 구분)" hint="예: kolon@myriadip.com (현재 정책상 잘 안 쓰임 — 발신자 매칭 권장)">
            <input type="text" value={toPatterns} onChange={(e) => setToPatterns(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="1순위 담당 (실무 처리자)">
              <select value={defaultAssigneeId} onChange={(e) => setDefaultAssigneeId(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white">
                <option value="">(미지정)</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>{p.full_name} ({p.email})</option>
                ))}
              </select>
            </Field>
            <Field label="2순위 담당 (백업/리더)">
              <select value={secondaryAssigneeId} onChange={(e) => setSecondaryAssigneeId(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white">
                <option value="">(미지정)</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>{p.full_name} ({p.email})</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label="우선순위" hint="낮은 숫자 우선 매칭">
              <input type="number" value={priority} onChange={(e) => setPriority(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            </Field>
            <Field label="키워드 매칭">
              <label className="flex items-center gap-2 mt-2 text-sm">
                <input type="checkbox" checked={requireKeyword} onChange={(e) => setRequireKeyword(e.target.checked)} />
                필수 (옵션 B)
              </label>
            </Field>
            <Field label="활성">
              <label className="flex items-center gap-2 mt-2 text-sm">
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                활성화
              </label>
            </Field>
          </div>
        </div>

        <footer className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2">
          <button onClick={onClose} className="text-slate-600 hover:bg-slate-100 px-4 py-2 rounded-lg text-sm">취소</button>
          <button onClick={handleSubmit} disabled={saving}
            className="flex items-center gap-2 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-5 py-2 rounded-lg text-sm disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            저장
          </button>
        </footer>
      </div>
    </div>
  )
}

// =============================================================
// 보조 컴포넌트
// =============================================================
function Field({ label, hint, required, children }) {
  return (
    <div>
      <div className="text-xs font-semibold text-slate-700 mb-1">
        {label}{required && <span className="text-rose-600 ml-1">*</span>}
      </div>
      {children}
      {hint && <div className="text-[11px] text-slate-500 mt-1">{hint}</div>}
    </div>
  )
}

function ChipList({ items }) {
  if (!items || items.length === 0) return <span className="text-slate-300 text-xs">-</span>
  return (
    <div className="flex flex-wrap gap-1">
      {items.slice(0, 3).map((item, i) => (
        <span key={i} className="inline-block px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-[10px] text-slate-700 truncate max-w-[180px]">
          {item}
        </span>
      ))}
      {items.length > 3 && (
        <span className="inline-block px-1.5 py-0.5 text-[10px] text-slate-500">+{items.length - 3}</span>
      )}
    </div>
  )
}

function readerStatusLabel(s) {
  return ({
    ok: '정상',
    just_registered: '방금 등록',
    token_expired: '토큰 만료',
    api_error: 'API 오류',
    partial_error: '일부 오류',
    no_active_mappings: '매핑 없음'
  }[s] || s || '미정')
}

function matchReasonLabel(r) {
  return ({
    sender_email: '✓ 발신자',
    sender_domain: '✓ 도메인',
    to_pattern: '✓ 그룹메일',
    thread_match: '↪ 회신추가',
    skipped: '— 매칭없음',
    skipped_no_keyword: '— 키워드없음',
    error: '⚠ 에러'
  }[r] || r)
}

function matchReasonStyle(r) {
  if (r === 'sender_email' || r === 'sender_domain' || r === 'to_pattern') return 'bg-emerald-100 text-emerald-800'
  if (r === 'thread_match') return 'bg-blue-100 text-blue-800'
  if (r === 'error') return 'bg-rose-100 text-rose-800'
  return 'bg-slate-100 text-slate-600'
}
