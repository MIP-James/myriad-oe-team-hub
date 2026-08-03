/**
 * 관리자 — 화이트리스트 셀러 관리 (아마존 오신고 방지).
 *
 * 이 페이지는 "데이터 원천" 만 담당한다. 실제 신고 페이지에서의 실시간 검사는
 * 크롬 확장(🛡️ 화이트리스트 가드)이 하고, 확장은 이 페이지에서 발급한 토큰으로
 * /api/whitelist-fetch 를 호출해 목록을 내려받는다.
 * (허브 웹페이지는 cross-origin 때문에 아마존 페이지 DOM 을 읽을 수 없음)
 */
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ShieldAlert, Plus, X, Save, Trash2, Loader2, ChevronLeft, Search, Upload,
  Building2, KeyRound, Copy, Check, AlertTriangle, Puzzle, Eye, EyeOff
} from 'lucide-react'
import {
  listClients, createClient, deleteClient,
  listSellers, countSellersByClient, createSeller, updateSeller, deleteSeller,
  deleteSellersByClient,
  listExtTokens, issueExtToken, revokeExtToken
} from '../lib/whitelist'
import WhitelistImportModal from '../components/WhitelistImportModal'
import { useAuth } from '../contexts/AuthContext'

const PAGE_SIZE = 50

const EMPTY_SELLER = {
  id: null,
  store_name: '',
  aliases: [],
  urls: [],
  amazon_seller_name: '',
  amazon_seller_id: '',
  region: '',
  channel: '',
  note: '',
  is_active: true
}

export default function AdminWhitelist() {
  const { user } = useAuth()
  const [clients, setClients] = useState([])
  const [counts, setCounts] = useState({})
  const [activeClient, setActiveClient] = useState(null)
  const [sellers, setSellers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [editor, setEditor] = useState(null)
  const [saving, setSaving] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [newClientName, setNewClientName] = useState('')
  const [addingClient, setAddingClient] = useState(false)

  useEffect(() => { loadClients() }, [])
  useEffect(() => { if (activeClient) loadSellers(activeClient.id) }, [activeClient?.id])

  async function loadClients() {
    setLoading(true); setError(null)
    try {
      const [cs, cnt] = await Promise.all([listClients(), countSellersByClient()])
      setClients(cs)
      setCounts(cnt)
      // 첫 진입 시 첫 고객사 자동 선택
      setActiveClient((prev) => prev ? cs.find((c) => c.id === prev.id) || cs[0] || null : cs[0] || null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function loadSellers(clientId) {
    setLoading(true); setError(null)
    try {
      setSellers(await listSellers(clientId))
      setPage(0)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function addClient() {
    if (!newClientName.trim()) return
    setAddingClient(true); setError(null)
    try {
      const c = await createClient(newClientName.trim(), null, user.id)
      setNewClientName('')
      await loadClients()
      setActiveClient(c)
    } catch (e) {
      setError(e.message.includes('duplicate') ? '같은 이름의 고객사가 이미 있습니다.' : e.message)
    } finally {
      setAddingClient(false)
    }
  }

  async function removeClient(c) {
    const n = counts[c.id]?.total || 0
    if (!window.confirm(
      `"${c.name}" 고객사를 삭제할까요?\n등록된 셀러 ${n}건이 함께 삭제됩니다. 되돌릴 수 없습니다.`
    )) return
    try {
      await deleteClient(c.id)
      setActiveClient(null)
      await loadClients()
    } catch (e) { setError(e.message) }
  }

  async function saveSeller() {
    if (!editor.store_name.trim()) { setError('가게/회사 이름은 필수입니다.'); return }
    setSaving(true); setError(null)
    try {
      if (editor.id) await updateSeller(editor.id, editor)
      else await createSeller(activeClient.id, editor, user.id)
      setEditor(null)
      await Promise.all([loadSellers(activeClient.id), refreshCounts()])
    } catch (e) {
      setError(e.message.includes('duplicate')
        ? '같은 이름의 셀러가 이 고객사에 이미 등록돼 있습니다.'
        : e.message)
    } finally {
      setSaving(false)
    }
  }

  async function removeSeller() {
    if (!editor?.id) { setEditor(null); return }
    if (!window.confirm(`"${editor.store_name}" 을 삭제할까요?`)) return
    try {
      await deleteSeller(editor.id)
      setEditor(null)
      await Promise.all([loadSellers(activeClient.id), refreshCounts()])
    } catch (e) { setError(e.message) }
  }

  async function clearClientSellers() {
    if (!window.confirm(
      `"${activeClient.name}" 의 등록된 셀러 ${sellers.length}건을 전부 삭제할까요?\n` +
      `새 파일로 완전히 교체할 때만 사용하세요. 되돌릴 수 없습니다.`
    )) return
    try {
      await deleteSellersByClient(activeClient.id)
      await Promise.all([loadSellers(activeClient.id), refreshCounts()])
    } catch (e) { setError(e.message) }
  }

  async function refreshCounts() {
    try { setCounts(await countSellersByClient()) } catch { /* 표시용이라 실패 무시 */ }
  }

  async function toggleActive(s) {
    try {
      await updateSeller(s.id, { ...s, is_active: !s.is_active })
      await loadSellers(activeClient.id)
    } catch (e) { setError(e.message) }
  }

  // 검색 — 이름/별칭/URL/아마존셀러 전체 대상
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sellers
    return sellers.filter((s) =>
      s.store_name.toLowerCase().includes(q) ||
      (s.aliases || []).some((a) => a.toLowerCase().includes(q)) ||
      (s.urls || []).some((u) => u.toLowerCase().includes(q)) ||
      (s.amazon_seller_name || '').toLowerCase().includes(q) ||
      (s.amazon_seller_id || '').toLowerCase().includes(q)
    )
  }, [sellers, query])

  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const pageCount = Math.ceil(filtered.length / PAGE_SIZE)

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center gap-2 mb-2">
        <Link to="/admin" className="text-sm text-slate-500 hover:text-myriad-ink inline-flex items-center gap-1">
          <ChevronLeft size={14} /> 관리자
        </Link>
      </div>
      <header className="mb-2 flex items-center gap-3">
        <ShieldAlert className="text-myriad-ink" />
        <h1 className="text-2xl font-bold text-slate-900">화이트리스트 셀러 관리</h1>
      </header>
      <p className="text-sm text-slate-500 mb-6">
        고객사의 공식 판매처를 등록해두면, 크롬 확장이 아마존 신고 페이지의 <b>Sold by</b> 셀러와
        자동 대조해서 오신고를 막습니다.
      </p>

      {error && (
        <div className="mb-4 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg p-3 flex items-start gap-2">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" /> <span>{error}</span>
        </div>
      )}

      {/* ── 고객사 선택 ─────────────────────────── */}
      <section className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Building2 size={15} className="text-slate-400" />
          <h2 className="text-sm font-bold text-slate-700">고객사</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {clients.map((c) => {
            const on = activeClient?.id === c.id
            return (
              <button
                key={c.id}
                onClick={() => setActiveClient(c)}
                className={`px-3.5 py-2 rounded-xl text-sm border transition ${
                  on
                    ? 'bg-myriad-primary/15 border-myriad-primary text-myriad-ink font-semibold'
                    : 'bg-white border-slate-200 text-slate-600 hover:border-slate-400'
                }`}
              >
                {c.name}
                <span className="ml-2 text-[11px] text-slate-500">
                  {counts[c.id]?.active ?? 0}
                </span>
              </button>
            )
          })}

          <div className="flex items-center gap-1 ml-1">
            <input
              type="text"
              value={newClientName}
              onChange={(e) => setNewClientName(e.target.value)}
              onKeyDown={(e) => {
                // 한글 IME 안전 — 조합 중 Enter 무시
                if (e.key === 'Enter' && !e.nativeEvent?.isComposing) addClient()
              }}
              placeholder="새 고객사 이름"
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm w-40"
            />
            <button
              onClick={addClient}
              disabled={addingClient || !newClientName.trim()}
              className="p-2 border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-40"
              title="고객사 추가"
            >
              {addingClient ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
            </button>
          </div>
        </div>
      </section>

      {!activeClient ? (
        <div className="py-16 text-center bg-white border border-slate-200 rounded-2xl">
          <Building2 size={32} className="mx-auto mb-3 text-slate-300" />
          <p className="text-sm text-slate-500">먼저 고객사를 추가하세요.</p>
        </div>
      ) : (
        <>
          {/* ── 툴바 ──────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setPage(0) }}
                placeholder="이름 / 별칭 / URL 검색"
                className="pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm w-64"
              />
            </div>
            <span className="text-xs text-slate-500">
              {query ? `${filtered.length} / ${sellers.length}건` : `${sellers.length}건`}
            </span>
            <div className="flex-1" />
            {sellers.length > 0 && (
              <button
                onClick={clearClientSellers}
                className="text-xs text-rose-600 hover:bg-rose-50 px-3 py-2 rounded-lg border border-rose-200"
              >
                전체 삭제
              </button>
            )}
            <button
              onClick={() => setShowImport(true)}
              className="flex items-center gap-2 bg-white border border-slate-300 hover:border-myriad-primary text-slate-700 font-semibold px-4 py-2 rounded-lg text-sm"
            >
              <Upload size={14} /> 엑셀 업로드
            </button>
            <button
              onClick={() => { setEditor({ ...EMPTY_SELLER }); setError(null) }}
              className="flex items-center gap-2 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-4 py-2 rounded-lg text-sm"
            >
              <Plus size={14} /> 셀러 추가
            </button>
          </div>

          {/* ── 목록 ──────────────────────────────── */}
          {loading ? (
            <div className="py-12 text-center text-sm text-slate-400 flex items-center justify-center gap-2">
              <Loader2 size={14} className="animate-spin" /> 불러오는 중...
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center bg-white border border-slate-200 rounded-2xl">
              <ShieldAlert size={32} className="mx-auto mb-3 text-slate-300" />
              <p className="text-sm text-slate-500">
                {query ? '검색 결과가 없습니다.' : '등록된 화이트리스트 셀러가 없습니다. 엑셀을 업로드해보세요.'}
              </p>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-myriad-ink text-white">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold">이름</th>
                      <th className="px-4 py-3 text-left font-semibold">별칭</th>
                      <th className="px-4 py-3 text-left font-semibold">URL</th>
                      <th className="px-4 py-3 text-left font-semibold">아마존 셀러</th>
                      <th className="px-4 py-3 w-20"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((s) => (
                      <tr
                        key={s.id}
                        className={`border-t border-slate-100 hover:bg-slate-50/60 ${
                          s.is_active ? '' : 'opacity-50'
                        }`}
                      >
                        <td className="px-4 py-2.5">
                          <div className="font-semibold text-slate-800">{s.store_name}</div>
                          {(s.region || s.channel) && (
                            <div className="text-[11px] text-slate-400">
                              {[s.region, s.channel].filter(Boolean).join(' · ')}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-500 max-w-[10rem] truncate">
                          {(s.aliases || []).join(', ') || '—'}
                        </td>
                        <td className="px-4 py-2.5 text-xs max-w-[14rem]">
                          {(s.urls || []).length ? (
                            <div className="space-y-0.5">
                              {s.urls.slice(0, 2).map((u, i) => (
                                <div key={i} className="truncate text-sky-600">{u}</div>
                              ))}
                              {s.urls.length > 2 && (
                                <div className="text-slate-400">+{s.urls.length - 2}개</div>
                              )}
                            </div>
                          ) : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-xs">
                          {s.amazon_seller_id ? (
                            <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded font-mono text-[11px]">
                              ID {s.amazon_seller_id}
                            </span>
                          ) : s.amazon_seller_name ? (
                            <span className="bg-sky-50 text-sky-700 px-2 py-0.5 rounded text-[11px]">
                              {s.amazon_seller_name}
                            </span>
                          ) : (
                            <span className="text-slate-400">미확인</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1 justify-end">
                            <button
                              onClick={() => toggleActive(s)}
                              title={s.is_active ? '검사 제외' : '검사 포함'}
                              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded"
                            >
                              {s.is_active ? <Eye size={13} /> : <EyeOff size={13} />}
                            </button>
                            <button
                              onClick={() => { setEditor({ ...s }); setError(null) }}
                              className="text-xs text-slate-600 hover:text-myriad-ink hover:bg-slate-100 px-2 py-1 rounded"
                            >
                              편집
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {pageCount > 1 && (
                <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-center gap-2 text-sm">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="px-3 py-1 rounded border border-slate-200 disabled:opacity-30 hover:bg-slate-50"
                  >
                    이전
                  </button>
                  <span className="text-slate-500 text-xs">{page + 1} / {pageCount}</span>
                  <button
                    onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                    disabled={page >= pageCount - 1}
                    className="px-3 py-1 rounded border border-slate-200 disabled:opacity-30 hover:bg-slate-50"
                  >
                    다음
                  </button>
                </div>
              )}
            </div>
          )}

          {clients.length > 0 && activeClient && (
            <div className="mt-3 text-right">
              <button
                onClick={() => removeClient(activeClient)}
                className="text-xs text-slate-400 hover:text-rose-600"
              >
                "{activeClient.name}" 고객사 삭제
              </button>
            </div>
          )}
        </>
      )}

      {/* ── 확장 연결 ─────────────────────────────── */}
      <ExtensionSection />

      {editor && (
        <SellerEditor
          editor={editor} setEditor={setEditor}
          onSave={saveSeller} onDelete={removeSeller} onClose={() => setEditor(null)}
          saving={saving} error={error}
        />
      )}

      {showImport && activeClient && (
        <WhitelistImportModal
          client={activeClient}
          userId={user.id}
          onClose={() => setShowImport(false)}
          onDone={async () => {
            await Promise.all([loadSellers(activeClient.id), refreshCounts()])
          }}
        />
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────
 * 셀러 추가/편집 모달
 * ───────────────────────────────────────────────── */
function SellerEditor({ editor, setEditor, onSave, onDelete, onClose, saving, error }) {
  // 배열 필드는 줄바꿈 텍스트로 편집 (비개발자에게 가장 직관적)
  const [aliasesText, setAliasesText] = useState((editor.aliases || []).join('\n'))
  const [urlsText, setUrlsText] = useState((editor.urls || []).join('\n'))

  function commit(field, text) {
    const arr = text.split('\n').map((s) => s.trim()).filter(Boolean)
    setEditor({ ...editor, [field]: arr })
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-6 py-4 border-b border-slate-200 flex items-center">
          <h2 className="font-bold text-slate-900">{editor.id ? '셀러 편집' : '셀러 추가'}</h2>
          <div className="flex-1" />
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded"><X size={18} /></button>
        </header>

        <div className="p-6 space-y-4 overflow-y-auto">
          <Field label="가게/회사 이름" required>
            <input
              type="text" value={editor.store_name} autoFocus
              onChange={(e) => setEditor({ ...editor, store_name: e.target.value })}
              placeholder="예: ZONKEY INC"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40"
            />
          </Field>

          <Field label="다른 이름 (별칭)" hint="한 줄에 하나씩. 아마존 표시명이 다를 때 여기에 추가">
            <textarea
              rows={3} value={aliasesText}
              onChange={(e) => setAliasesText(e.target.value)}
              onBlur={() => commit('aliases', aliasesText)}
              placeholder={"Zonkey Toys\nZonkey"}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-myriad-primary/40"
            />
          </Field>

          <Field label="스토어 URL" hint="한 줄에 하나씩. 도메인에서도 이름 후보를 뽑아 매칭에 사용">
            <textarea
              rows={3} value={urlsText}
              onChange={(e) => setUrlsText(e.target.value)}
              onBlur={() => commit('urls', urlsText)}
              placeholder="https://www.zonkeytoys.com/"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-myriad-primary/40"
            />
          </Field>

          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 space-y-3">
            <p className="text-[11px] text-emerald-800 leading-snug">
              아래 2개를 채우면 그 셀러는 <b>100% 정확 매칭</b>됩니다. 신고 화면에서 화이트리스트
              셀러를 확인할 때마다 여기에 기록해두는 게 이 기능의 정확도를 올리는 핵심입니다.
            </p>
            <Field label="아마존 셀러 표시명" small>
              <input
                type="text" value={editor.amazon_seller_name ?? ''}
                onChange={(e) => setEditor({ ...editor, amazon_seller_name: e.target.value })}
                placeholder="예: BCastle"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
              />
            </Field>
            <Field label="아마존 셀러 ID" small hint="셀러 링크의 seller= 뒤 14자리">
              <input
                type="text" value={editor.amazon_seller_id ?? ''}
                onChange={(e) => setEditor({ ...editor, amazon_seller_id: e.target.value })}
                placeholder="예: A1B2C3D4E5F6G7"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono bg-white"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="지역">
              <input
                type="text" value={editor.region ?? ''}
                onChange={(e) => setEditor({ ...editor, region: e.target.value })}
                placeholder="North America"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
            </Field>
            <Field label="플랫폼/구분">
              <input
                type="text" value={editor.channel ?? ''}
                onChange={(e) => setEditor({ ...editor, channel: e.target.value })}
                placeholder="Online"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
            </Field>
          </div>

          <Field label="비고">
            <input
              type="text" value={editor.note ?? ''}
              onChange={(e) => setEditor({ ...editor, note: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
          </Field>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox" checked={editor.is_active}
              onChange={(e) => setEditor({ ...editor, is_active: e.target.checked })}
              className="w-4 h-4"
            />
            검사 대상에 포함
          </label>

          {error && <div className="text-xs text-rose-600">{error}</div>}
        </div>

        <footer className="px-6 py-4 border-t border-slate-200 flex items-center">
          {editor.id && (
            <button onClick={onDelete} className="text-rose-600 hover:bg-rose-50 px-3 py-2 rounded-lg flex items-center gap-2 text-sm">
              <Trash2 size={14} /> 삭제
            </button>
          )}
          <div className="flex-1" />
          <button onClick={onClose} className="text-slate-600 hover:bg-slate-100 px-4 py-2 rounded-lg text-sm">취소</button>
          <button
            onClick={() => {
              // blur 전에 저장 눌렀을 때 배열이 안 반영되는 것 방지
              const aliases = aliasesText.split('\n').map((s) => s.trim()).filter(Boolean)
              const urls = urlsText.split('\n').map((s) => s.trim()).filter(Boolean)
              setEditor((prev) => ({ ...prev, aliases, urls }))
              setTimeout(onSave, 0)
            }}
            disabled={saving}
            className="ml-2 flex items-center gap-2 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-4 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            저장
          </button>
        </footer>
      </div>
    </div>
  )
}

function Field({ label, hint, required, small, children }) {
  return (
    <div>
      <label className={`font-semibold text-slate-600 block mb-1 ${small ? 'text-[11px]' : 'text-xs'}`}>
        {label} {required && <span className="text-rose-500">*</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] text-slate-500 mt-1">{hint}</p>}
    </div>
  )
}

/* ─────────────────────────────────────────────────
 * 크롬 확장 연결 — 토큰 발급/폐기
 * ───────────────────────────────────────────────── */
function ExtensionSection() {
  const [tokens, setTokens] = useState([])
  const [issued, setIssued] = useState(null)   // { token } — 발급 직후 1회만 표시
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    try { setTokens(await listExtTokens()) } catch (e) { setErr(e.message) }
  }

  async function issue() {
    setBusy(true); setErr(null)
    try {
      const r = await issueExtToken('Chrome 확장')
      setIssued(r)
      await load()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  async function revoke(id) {
    if (!window.confirm('이 토큰을 폐기할까요? 해당 확장은 더 이상 목록을 받지 못합니다.')) return
    try { await revokeExtToken(id); await load() } catch (e) { setErr(e.message) }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(issued.token)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* 클립보드 권한 없으면 사용자가 직접 선택복사 */ }
  }

  return (
    <section className="mt-10 bg-white border border-slate-200 rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-1">
        <Puzzle size={16} className="text-myriad-ink" />
        <h2 className="font-bold text-slate-900">크롬 확장 연결</h2>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        확장을 처음 설치할 때 한 번만 토큰을 붙여넣으면 됩니다. 토큰은 발급 직후에만 보이고,
        서버에는 해시만 저장되므로 분실하면 새로 발급해야 합니다.
      </p>

      {err && <div className="mb-3 text-xs text-rose-600">{err}</div>}

      {issued && (
        <div className="mb-4 bg-amber-50 border border-amber-300 rounded-lg p-3">
          <p className="text-xs font-semibold text-amber-900 mb-2">
            아래 토큰을 확장 설정에 붙여넣으세요 — 이 창을 닫으면 다시 볼 수 없습니다.
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

      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={issue}
          disabled={busy}
          className="flex items-center gap-2 bg-white border border-slate-300 hover:border-myriad-primary text-slate-700 font-semibold px-4 py-2 rounded-lg text-sm disabled:opacity-50"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
          토큰 발급
        </button>
      </div>

      {tokens.length > 0 && (
        <ul className="space-y-1.5">
          {tokens.map((t) => (
            <li key={t.id} className="flex items-center gap-3 text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              <KeyRound size={12} className="text-slate-400" />
              <span className="font-semibold text-slate-700">{t.name}</span>
              <span className="text-slate-400">
                발급 {new Date(t.created_at).toLocaleDateString('ko-KR')}
              </span>
              <span className="text-slate-400">
                {t.last_used_at
                  ? `마지막 사용 ${new Date(t.last_used_at).toLocaleString('ko-KR')}`
                  : '아직 사용 안 됨'}
              </span>
              <div className="flex-1" />
              <button onClick={() => revoke(t.id)} className="text-rose-600 hover:underline">폐기</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
