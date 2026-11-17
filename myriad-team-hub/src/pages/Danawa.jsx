import { useCallback, useEffect, useState } from 'react'
import {
  TrendingDown, Plus, Settings, RefreshCw, Loader2, AlertTriangle, ExternalLink,
  Store, MapPin, Flag, Pause, Play, Trash2, History, Send, MessageSquare, X, Check
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import {
  listProducts, addProduct, updateProduct, deleteProduct, runCheck, listHistory,
  getSettings, saveSettings, sendTestMessage, sendSummaryNow, danawaUrl
} from '../lib/danawa'

const won = (n) => (n == null ? '-' : `${Number(n).toLocaleString('ko-KR')}원`)

function ago(iso) {
  if (!iso) return null
  const diff = Math.max(0, Date.now() - new Date(iso).getTime())
  const m = Math.floor(diff / 60000)
  if (m < 1) return '방금'
  if (m < 60) return `${m}분 전`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}시간 전`
  return `${Math.floor(h / 24)}일 전`
}

function fmtTime(iso) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function Danawa() {
  const { user, isAdmin } = useAuth()
  const [products, setProducts] = useState(null)
  const [settings, setSettings] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [checking, setChecking] = useState({})   // { [id]: true }
  const [checkingAll, setCheckingAll] = useState(false)

  const reload = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([listProducts(), getSettings().catch(() => null)])
      setProducts(p)
      setSettings(s)
    } catch (e) {
      setError(e.message)
      setProducts((prev) => prev || [])
    }
  }, [])

  useEffect(() => {
    reload()
    const t = setInterval(reload, 60000)   // 1분마다 새로고침 (예약 확인 결과 반영)
    return () => clearInterval(t)
  }, [reload])

  async function check(id) {
    setChecking((c) => ({ ...c, [id]: true }))
    setError(null)
    try {
      const r = await runCheck(id)
      if (r.ok === false) setError(`확인 실패: ${r.error}`)
      else if (r.changed) setNotice(r.notified ? '최저가 판매자가 바뀌어 구글 챗으로 알렸습니다.' : '최저가 판매자가 바뀌었습니다.')
      await reload()
    } catch (e) {
      setError(e.message)
    } finally {
      setChecking((c) => ({ ...c, [id]: false }))
    }
  }

  async function checkAll() {
    setCheckingAll(true)
    for (const p of (products || []).filter((x) => x.active)) {
      await check(p.id)
    }
    setCheckingAll(false)
  }

  const activeCount = (products || []).filter((p) => p.active).length

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      <header className="mb-2 flex items-center gap-3">
        <TrendingDown className="text-myriad-ink" />
        <h1 className="text-2xl font-bold text-slate-900">다나와 최저가 모니터링</h1>
      </header>
      <p className="text-sm text-slate-500 mb-5">
        지정한 상품의 다나와 최저가 판매자를 자동으로 확인합니다. 최저가가 바뀌거나 새 판매자가 최저가로 올라오면
        구글 챗 스페이스로 바로 알립니다. 내려간 판매글도 아래 <b>기록</b>에 남습니다.
      </p>

      {/* 상태 줄 */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <StatusChip ok={settings?.enabled !== false}
          label={settings ? (settings.enabled ? `자동 확인 ${settings.interval_hours}시간마다` : '자동 확인 꺼짐') : '자동 확인 —'} />
        <StatusChip ok={!!settings?.has_webhook}
          label={settings?.has_webhook ? '구글 챗 연결됨' : '구글 챗 미연결'} icon={MessageSquare} />
        <span className="text-xs text-slate-400 ml-1">감시 중 {activeCount}개</span>
        <div className="flex-1" />
        <button
          onClick={checkAll}
          disabled={checkingAll || !activeCount}
          className="flex items-center gap-1.5 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-semibold px-3 py-2 rounded-lg disabled:opacity-50"
        >
          {checkingAll ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          모두 지금 확인
        </button>
        <button
          onClick={() => { setShowAdd((v) => !v); setShowSettings(false) }}
          className="flex items-center gap-1.5 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink text-sm font-semibold px-3 py-2 rounded-lg"
        >
          <Plus size={14} /> 상품 추가
        </button>
        {isAdmin && (
          <button
            onClick={() => { setShowSettings((v) => !v); setShowAdd(false) }}
            className="flex items-center gap-1.5 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-semibold px-3 py-2 rounded-lg"
            title="관리자 설정"
          >
            <Settings size={14} /> 설정
          </button>
        )}
      </div>

      {notice && (
        <Banner kind="ok" onClose={() => setNotice(null)}>{notice}</Banner>
      )}
      {error && (
        <Banner kind="err" onClose={() => setError(null)}>{error}</Banner>
      )}

      {showAdd && (
        <AddPanel
          userId={user?.id}
          onClose={() => setShowAdd(false)}
          onAdded={async (p) => {
            setShowAdd(false)
            await reload()
            check(p.id)
          }}
        />
      )}

      {showSettings && isAdmin && (
        <SettingsPanel
          settings={settings}
          userId={user?.id}
          onClose={() => setShowSettings(false)}
          onSaved={async (msg) => { setNotice(msg); await reload() }}
          onError={setError}
        />
      )}

      {products === null ? (
        <div className="py-16 text-center text-sm text-slate-400 flex items-center justify-center gap-2">
          <Loader2 size={16} className="animate-spin" /> 불러오는 중...
        </div>
      ) : products.length === 0 ? (
        <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-10 text-center text-sm text-slate-500">
          감시 중인 상품이 없습니다. <b>상품 추가</b>로 다나와 상품 주소를 넣어주세요.
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {products.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              checking={!!checking[p.id]}
              onCheck={() => check(p.id)}
              onToggle={async () => {
                try { await updateProduct(p.id, { active: !p.active }); await reload() } catch (e) { setError(e.message) }
              }}
              onDelete={async () => {
                if (!window.confirm(`'${p.brand || ''} ${p.name || p.pcode}' 감시를 삭제할까요?\n지금까지의 기록도 함께 지워집니다.`)) return
                try { await deleteProduct(p.id); await reload() } catch (e) { setError(e.message) }
              }}
              onBrand={async (brand) => {
                try { await updateProduct(p.id, { brand: brand || null }); await reload() } catch (e) { setError(e.message) }
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function StatusChip({ ok, label, icon: Icon }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${
      ok ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-slate-50 border-slate-200 text-slate-500'
    }`}>
      {Icon ? <Icon size={12} /> : <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-slate-400'}`} />}
      {label}
    </span>
  )
}

function Banner({ kind, children, onClose }) {
  return (
    <div className={`mb-4 text-sm rounded-lg p-3 border flex items-start gap-2 ${
      kind === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-rose-50 border-rose-200 text-rose-700'
    }`}>
      {kind === 'ok' ? <Check size={16} className="shrink-0 mt-0.5" /> : <AlertTriangle size={16} className="shrink-0 mt-0.5" />}
      <span className="flex-1">{children}</span>
      <button onClick={onClose} className="opacity-60 hover:opacity-100"><X size={14} /></button>
    </div>
  )
}

// ── 상품 추가 ───────────────────────────────────────────────

function AddPanel({ userId, onClose, onAdded }) {
  const [url, setUrl] = useState('')
  const [brand, setBrand] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      const p = await addProduct({ url, brand, userId })
      onAdded(p)
    } catch (e2) {
      setErr(e2.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="mb-5 bg-white border border-slate-200 rounded-2xl p-5">
      <div className="flex items-center mb-3">
        <h2 className="font-bold text-slate-900">감시할 상품 추가</h2>
        <div className="flex-1" />
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_180px_auto] gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="다나와 상품 주소 (https://prod.danawa.com/info/?pcode=…)"
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-myriad-primary"
          autoFocus
        />
        <input
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          placeholder="브랜드 (예: 아이오페)"
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-myriad-primary"
        />
        <button
          type="submit"
          disabled={busy || !url.trim()}
          className="flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-900 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} 추가하고 바로 확인
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-400">상품명·사진은 첫 확인 때 다나와에서 자동으로 채워집니다.</p>
      {err && <p className="mt-2 text-xs text-rose-600">{err}</p>}
    </form>
  )
}

// ── 관리자 설정 ─────────────────────────────────────────────

function SettingsPanel({ settings, userId, onClose, onSaved, onError }) {
  const [enabled, setEnabled] = useState(settings?.enabled ?? true)
  const [intervalHours, setIntervalHours] = useState(settings?.interval_hours ?? 1)
  const [dailySummary, setDailySummary] = useState(settings?.daily_summary ?? true)
  const [webhookUrl, setWebhookUrl] = useState('')
  const [busy, setBusy] = useState(null)

  async function save() {
    setBusy('save')
    try {
      await saveSettings({ enabled, intervalHours: Number(intervalHours), dailySummary, webhookUrl, userId })
      setWebhookUrl('')
      onSaved('설정을 저장했습니다.')
    } catch (e) {
      onError(e.message)
    } finally {
      setBusy(null)
    }
  }

  async function test(kind) {
    setBusy(kind)
    try {
      if (kind === 'test') await sendTestMessage()
      else await sendSummaryNow()
      onSaved(kind === 'test' ? '구글 챗에 시험 메시지를 보냈습니다.' : '구글 챗에 현황 요약을 보냈습니다.')
    } catch (e) {
      onError(e.message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mb-5 bg-white border border-slate-200 rounded-2xl p-5">
      <div className="flex items-center mb-4">
        <h2 className="font-bold text-slate-900">관리자 설정</h2>
        <div className="flex-1" />
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="accent-amber-500" />
          자동 확인 켜기
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          확인 간격
          <select
            value={intervalHours}
            onChange={(e) => setIntervalHours(e.target.value)}
            className="border border-slate-200 rounded-lg px-2 py-1 text-sm"
          >
            {[1, 2, 3, 6].map((h) => <option key={h} value={h}>{h}시간마다</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={dailySummary} onChange={(e) => setDailySummary(e.target.checked)} className="accent-amber-500" />
          매일 오전 9시 현황 요약 보내기
        </label>
      </div>
      <label className="block text-sm text-slate-700 mb-1">구글 챗 웹훅 주소</label>
      <input
        value={webhookUrl}
        onChange={(e) => setWebhookUrl(e.target.value)}
        placeholder={settings?.has_webhook ? '등록됨 — 바꿀 때만 새 주소를 넣으세요' : 'https://chat.googleapis.com/v1/spaces/…/messages?key=…&token=…'}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-myriad-primary"
      />
      <p className="mt-1 text-xs text-slate-400">
        스페이스 이름 옆 ▾ → 앱 및 통합 → 웹훅 관리에서 만든 주소. 저장 후에는 보안을 위해 다시 표시되지 않습니다.
      </p>
      <div className="flex flex-wrap items-center gap-2 mt-4">
        <button
          onClick={save}
          disabled={!!busy}
          className="flex items-center gap-1.5 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
        >
          {busy === 'save' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} 저장
        </button>
        <button
          onClick={() => test('test')}
          disabled={!!busy || !settings?.has_webhook}
          className="flex items-center gap-1.5 border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-semibold px-3 py-2 rounded-lg disabled:opacity-50"
        >
          {busy === 'test' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} 시험 메시지
        </button>
        <button
          onClick={() => test('summary')}
          disabled={!!busy || !settings?.has_webhook}
          className="flex items-center gap-1.5 border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-semibold px-3 py-2 rounded-lg disabled:opacity-50"
        >
          {busy === 'summary' ? <Loader2 size={14} className="animate-spin" /> : <MessageSquare size={14} />} 현황 요약 지금 보내기
        </button>
      </div>
    </div>
  )
}

// ── 상품 카드 ───────────────────────────────────────────────

function ProductCard({ product: p, checking, onCheck, onToggle, onDelete, onBrand }) {
  const [showHistory, setShowHistory] = useState(false)
  const [editingBrand, setEditingBrand] = useState(false)
  const [brandDraft, setBrandDraft] = useState(p.brand || '')
  const listings = p.last_listings || []

  return (
    <div className={`bg-white border rounded-2xl p-5 flex flex-col ${p.active ? 'border-slate-200' : 'border-slate-200 opacity-60'}`}>
      {/* 머리 */}
      <div className="flex gap-3">
        <div className="w-16 h-16 rounded-lg bg-slate-50 border border-slate-100 overflow-hidden shrink-0">
          {p.image_url && <img src={p.image_url} alt="" className="w-full h-full object-contain" loading="lazy" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-0.5">
            {editingBrand ? (
              <input
                value={brandDraft}
                autoFocus
                onChange={(e) => setBrandDraft(e.target.value)}
                onBlur={() => { setEditingBrand(false); if (brandDraft !== (p.brand || '')) onBrand(brandDraft.trim()) }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent?.isComposing) e.currentTarget.blur()
                  if (e.key === 'Escape') { setBrandDraft(p.brand || ''); setEditingBrand(false) }
                }}
                className="text-xs border border-slate-200 rounded px-1.5 py-0.5 w-28"
              />
            ) : (
              <button
                onClick={() => setEditingBrand(true)}
                className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-myriad-primary/15 text-amber-800 hover:bg-myriad-primary/25"
                title="브랜드 이름 바꾸기"
              >
                {p.brand || '브랜드 없음'}
              </button>
            )}
            {!p.active && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">일시중지</span>}
          </div>
          <a
            href={danawaUrl(p.pcode)}
            target="_blank"
            rel="noreferrer"
            className="block text-sm font-semibold text-slate-900 hover:underline leading-snug line-clamp-2"
          >
            {p.name || `다나와 상품 ${p.pcode}`}
          </a>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[11px] text-slate-400">다나와 최저가</div>
          <div className="text-xl font-bold text-slate-900 tabular-nums">{won(p.last_lowest_price)}</div>
          <div className="text-[11px] text-slate-400">
            {p.last_changed_at ? `${ago(p.last_changed_at)} 변경` : ''}
          </div>
        </div>
      </div>

      {/* 오류 */}
      {p.last_error && (
        <div className="mt-3 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-2 flex gap-1.5">
          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
          <span>마지막 확인 실패 ({fmtTime(p.last_error_at)}): {p.last_error}</span>
        </div>
      )}

      {/* 최저가 판매처 */}
      <div className="mt-3 space-y-2 flex-1">
        {listings.length === 0 && !p.last_error && (
          <div className="text-xs text-slate-400 border border-dashed border-slate-200 rounded-lg p-3 text-center">
            {checking ? '확인 중…' : '아직 확인 전입니다. 지금 확인을 눌러보세요.'}
          </div>
        )}
        {listings.map((l) => <ListingRow key={l.key} l={l} />)}
      </div>

      {/* 하단 */}
      <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-slate-400 mr-auto">
          마지막 확인 {p.last_checked_at ? `${fmtTime(p.last_checked_at)} (${ago(p.last_checked_at)})` : '-'}
        </span>
        <IconBtn onClick={onCheck} disabled={checking} title="지금 확인">
          {checking ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} 지금 확인
        </IconBtn>
        <IconBtn onClick={() => setShowHistory((v) => !v)} title="변경 기록" active={showHistory}>
          <History size={13} /> 기록
        </IconBtn>
        <IconBtn onClick={onToggle} title={p.active ? '자동 확인 일시중지' : '자동 확인 다시 시작'}>
          {p.active ? <Pause size={13} /> : <Play size={13} />}
        </IconBtn>
        <IconBtn onClick={onDelete} title="삭제" danger>
          <Trash2 size={13} />
        </IconBtn>
      </div>

      {showHistory && <HistoryList productId={p.id} />}
    </div>
  )
}

function IconBtn({ children, onClick, disabled, title, danger, active }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-1.5 rounded-md border disabled:opacity-50 ${
        danger
          ? 'border-slate-200 text-slate-500 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50'
          : active
            ? 'border-slate-300 bg-slate-100 text-slate-800'
            : 'border-slate-200 text-slate-600 hover:bg-slate-50'
      }`}
    >
      {children}
    </button>
  )
}

function ListingRow({ l }) {
  const s = l.seller || {}
  const name = s.sellerName || l.mallName
  const sub = [s.company && s.company !== name ? s.company : null, s.ceo].filter(Boolean).join(' · ')
  return (
    <div className={`rounded-xl border p-3 ${s.overseas ? 'border-rose-200 bg-rose-50/40' : 'border-slate-200'}`}>
      <div className="flex items-start gap-2">
        <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-white shrink-0">{l.mallName}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Store size={13} className="text-slate-400" />
            <span className="text-sm font-bold text-slate-900">{name}</span>
            {l.isNew && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-myriad-primary text-myriad-ink">NEW</span>}
            {s.overseas && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-600 text-white">
                <Flag size={10} /> 해외 주소
              </span>
            )}
          </div>
          {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}{s.bizNo ? ` · ${s.bizNo}` : ''}</div>}
          {s.address && (
            <div className="text-xs text-slate-500 mt-0.5 flex gap-1">
              <MapPin size={12} className="shrink-0 mt-0.5 text-slate-400" /> <span>{s.address}</span>
            </div>
          )}
          {l.sellerStatus === 'error' && (
            <div className="text-xs text-amber-700 mt-0.5">판매자 정보를 못 읽었습니다 — 상품 페이지에서 확인해주세요.</div>
          )}
          {s.note && <div className="text-[11px] text-slate-400 mt-0.5 break-all">{s.note}</div>}
          {l.sellerStatus === 'mall_self' && (
            <div className="text-xs text-slate-400 mt-0.5">쇼핑몰이 직접 판매하는 상품입니다.</div>
          )}
          {l.sellerStatus === 'undisclosed' && (
            <div className="text-xs text-amber-700 mt-0.5">쇼핑몰이 이 상품의 판매자를 공개하지 않습니다 (쇼핑몰 고객센터 문의 필요).</div>
          )}
          {(l.sellerStatus === 'danawa' || l.sellerStatus === 'blocked') && (
            <div className="text-xs text-slate-400 mt-0.5">
              {l.sellerStatus === 'danawa' ? '다나와 표시 판매자명입니다. ' : ''}
              이 쇼핑몰은 서버 조회를 막아 상호·주소는 상품 페이지에서 확인해주세요.
            </div>
          )}
          {l.sellerStatus === 'mall_only' && (
            <div className="text-xs text-slate-400 mt-0.5">이 쇼핑몰은 판매자 정보를 자동으로 읽지 못했습니다 — 상품 페이지에서 확인해주세요.</div>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm font-bold text-slate-900 tabular-nums">{won(l.price)}</div>
          <div className="text-[11px] text-slate-400">{l.shipping || ''}</div>
        </div>
      </div>
      <div className="flex gap-1.5 mt-2 pl-[3.25rem]">
        {l.productUrl && (
          <a href={l.productUrl} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-slate-900 border border-slate-200 rounded px-2 py-0.5">
            <ExternalLink size={11} /> 상품
          </a>
        )}
        {s.storeUrl && (
          <a href={s.storeUrl} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-slate-900 border border-slate-200 rounded px-2 py-0.5">
            <Store size={11} /> 판매자 스토어
          </a>
        )}
      </div>
    </div>
  )
}

function HistoryList({ productId }) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    listHistory(productId).then(setRows).catch((e) => { setErr(e.message); setRows([]) })
  }, [productId])

  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <div className="text-xs font-bold text-slate-700 mb-2">최저가 변경 기록 (최근 20건)</div>
      {rows === null && <div className="text-xs text-slate-400">불러오는 중…</div>}
      {err && <div className="text-xs text-rose-600">{err}</div>}
      {rows?.length === 0 && !err && <div className="text-xs text-slate-400">아직 기록이 없습니다.</div>}
      <ul className="space-y-1.5">
        {rows?.map((r) => (
          <li key={r.id} className="text-xs flex gap-2">
            <span className="text-slate-400 tabular-nums shrink-0 w-24">{fmtTime(r.checked_at)}</span>
            {r.error ? (
              <span className="text-amber-700">확인 실패 — {r.error}</span>
            ) : (
              <span className="text-slate-700">
                <b className="tabular-nums">{won(r.lowest_price)}</b>{' '}
                {(r.listings || []).map((l) => `${l.mallName} ${l.seller?.sellerName || ''}`.trim()).join(', ')}
                {r.notified && <span className="ml-1 text-emerald-600">· 챗 알림</span>}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
