/**
 * 자동 수집 결과 — 노트북 자동 수집 실행기가 찾은 신규 상품을 실무자가 고르는 페이지 (mig 040).
 *
 * 실무자에겐 썸네일·상품명·가격만 (판단 근거·점수는 화면에 안 보임 — 사용자 결정 2026-10-27).
 * 카드 클릭 = 선택 → '선택 URL 복사' → BPM Collector 대량 캡처(URL 목록) / BPM 작업 추가(URL)에 붙여넣기.
 * 선택한 카드는 '일괄 상세 확인' / '일괄 제외' 로 한 번에 처리 가능 (2026-10-29).
 * BPM 판매정보 등록은 그 재수집이 담당 (스크린샷·상세 정보가 필요하므로 자동 수집에서 하지 않음).
 * '제외' = 같은 사진은 다음 자동 수집부터 자동으로 빠짐 (아예 필요 없는 것만).
 * '상세 확인' = 지금 목록에선 빠지지만, 같은 사진이 다음에 다시 수집되면 빨간 테두리로 표시 (mig 041).
 * 'BPM 전송 완료' = 복사한 카드들을 목록에서 뺌 (mig 042). BPM 에 등록된 건은 BPM 동기화로 자동 표시.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ScanSearch, Copy, Check, Loader2, AlertTriangle, ImageOff, CheckSquare, Square, X, Eye, Undo2, Send } from 'lucide-react'
import { TIERS, listDates, listFacets, countByTier, listItems, markItems, restoreItems } from '../lib/autoCollect'
import { useAuth } from '../contexts/AuthContext'

const PAGE = 120

// 쿠팡은 접속 확인 쿠키가 없으면 상품 주소로 바로 들어갈 때 차단 화면(사용권한이 없습니다)을 띄움.
// 쿠팡 홈을 한 번 열면 쿠키가 생겨 그 뒤로는 바로 열림 (사용자 실측 2026-10-28) → 새 탭에서 홈 먼저, 잠시 뒤 상품으로.
const COUPANG_WARM_KEY = 'autoCollect.coupangWarmAt'
const COUPANG_WARM_MS = 20 * 60 * 1000 // 이 시간 안에 홈을 거쳤으면 바로 상품으로

function openCoupang(url) {
  let warmAt = 0
  try { warmAt = Number(localStorage.getItem(COUPANG_WARM_KEY)) || 0 } catch { /* 저장소 막힘 → 매번 홈 경유 */ }
  if (Date.now() - warmAt < COUPANG_WARM_MS) {
    window.open(url, '_blank', 'noopener')
    return
  }
  const win = window.open('https://www.coupang.com/', '_blank')
  if (!win) { // 팝업 차단 → 그냥 상품으로
    window.open(url, '_blank', 'noopener')
    return
  }
  try { localStorage.setItem(COUPANG_WARM_KEY, String(Date.now())) } catch { /* 무시 */ }
  setTimeout(() => {
    try { win.location.href = url } catch { /* 탭이 닫힘 */ }
  }, 3500)
}

export default function AutoCollect() {
  const { user } = useAuth()
  const [dates, setDates] = useState([])
  const [date, setDate] = useState('')
  const [tier, setTier] = useState('A')
  const [platform, setPlatform] = useState('')
  const [productType, setProductType] = useState('')
  const [modelType, setModelType] = useState('')
  const [hideRegistered, setHideRegistered] = useState(true)
  const [facets, setFacets] = useState({ platforms: [], productTypes: [], modelTypes: [] })
  const [counts, setCounts] = useState({})
  const [items, setItems] = useState([])
  const [hasMore, setHasMore] = useState(false)
  const [selected, setSelected] = useState(() => new Set())
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState(null)
  const [copiedIds, setCopiedIds] = useState(() => new Set()) // 마지막으로 URL 복사한 카드 → 'BPM 전송 완료' 대상
  const [undo, setUndo] = useState(null) // { entries: [{ it, index }], status, tier } — 방금 처리한 것 되돌리기
  const undoTimer = useRef(null)
  const [marking, setMarking] = useState(false) // 일괄 처리 중 — 중복 클릭 방지

  const filters = useMemo(
    () => ({ date, tier, platform, productType, modelType, hideRegistered }),
    [date, tier, platform, productType, modelType, hideRegistered]
  )

  useEffect(() => {
    listDates()
      .then((d) => { setDates(d); setDate(d[0] || '') })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!date) return
    setPlatform(''); setProductType(''); setModelType('')
    listFacets(date).then(setFacets).catch((e) => setError(e.message))
  }, [date])

  useEffect(() => {
    if (!date) return
    let alive = true
    setLoading(true); setError(null); setSelected(new Set()); setCopiedIds(new Set()); setUndo(null)
    Promise.all([countByTier(filters), listItems(filters, { offset: 0, limit: PAGE })])
      .then(([c, rows]) => {
        if (!alive) return
        setCounts(c); setItems(rows); setHasMore(rows.length === PAGE)
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [filters])

  async function loadMore() {
    try {
      const rows = await listItems(filters, { offset: items.length, limit: PAGE })
      setItems((prev) => [...prev, ...rows]); setHasMore(rows.length === PAGE)
    } catch (e) {
      setError(e.message)
    }
  }

  function toggle(it) {
    if (it.bpm_registered) return
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(it.id) ? next.delete(it.id) : next.add(it.id)
      return next
    })
  }

  function selectAll() {
    const pickable = items.filter((it) => !it.bpm_registered)
    setSelected((prev) => (prev.size === pickable.length ? new Set() : new Set(pickable.map((it) => it.id))))
  }

  async function copyUrls() {
    const picked = items.filter((it) => selected.has(it.id))
    if (!picked.length) return
    await navigator.clipboard.writeText(picked.map((it) => it.url).join('\n'))
    setCopiedIds(new Set(picked.map((it) => it.id)))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  async function mark(targets, status) {
    if (!targets.length) return
    try {
      await markItems(targets.map((it) => it.id), status, user?.id)
      const ids = new Set(targets.map((it) => it.id))
      const entries = items.map((it, index) => ({ it, index })).filter((e) => ids.has(e.it.id))
      const drop = (prev) => { const n = new Set(prev); ids.forEach((id) => n.delete(id)); return n }
      setItems((prev) => prev.filter((x) => !ids.has(x.id)))
      setSelected(drop)
      setCopiedIds(drop)
      setCounts((c) => ({ ...c, [tier]: Math.max(0, (c[tier] || 0) - entries.length) }))
      clearTimeout(undoTimer.current)
      setUndo({ entries, status, tier })
      undoTimer.current = setTimeout(() => setUndo(null), 8000)
    } catch (e) {
      setError(e.message)
    }
  }

  async function markSelected(status) {
    if (marking) return
    // A(대표 이미지 일치) = 위반 확정과 같은 사진 → 제외하면 그 사진의 이후 수집분도 자동으로 빠짐
    if (status === 'excluded' && tier === 'A' && !window.confirm(
      `선택한 ${selected.size}건은 위반 확정 사진과 같은 사진입니다.\n` +
      '제외하면 앞으로 이 사진을 쓰는 상품도 자동 수집에서 자동으로 빠집니다.\n\n그래도 제외할까요?'
    )) return
    setMarking(true)
    try {
      await mark(items.filter((it) => selected.has(it.id)), status)
    } finally {
      setMarking(false)
    }
  }

  async function revert() {
    const u = undo
    if (!u) return
    clearTimeout(undoTimer.current)
    setUndo(null)
    try {
      await restoreItems(u.entries.map((e) => e.it.id))
      if (u.tier !== tier) return
      setItems((prev) => {
        const next = [...prev]
        for (const e of u.entries) next.splice(Math.min(e.index, next.length), 0, e.it) // index 오름차순
        return next
      })
      setCounts((c) => ({ ...c, [u.tier]: (c[u.tier] || 0) + u.entries.length }))
    } catch (e) {
      setError(e.message)
    }
  }

  const pickableCount = items.filter((it) => !it.bpm_registered).length

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <header className="mb-2 flex items-center gap-3 flex-wrap">
        <ScanSearch className="text-myriad-ink" />
        <h1 className="text-2xl font-bold text-slate-900">자동 수집 결과</h1>
        {dates.length > 0 && (
          <select
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="ml-2 text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white"
          >
            {dates.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
      </header>
      <p className="text-sm text-slate-500 mb-5">
        카드를 눌러 고른 뒤 <b>선택 URL 복사</b> → BPM Collector 대량 캡처 또는 BPM 작업 추가(URL)에 붙여넣으세요.
        상품명을 누르면 판매 페이지가 새 창으로 열립니다.
        여러 장을 고른 뒤 <b>일괄 상세 확인</b> / <b>일괄 제외</b>로 한 번에 처리할 수도 있습니다.
      </p>
      <ul className="text-sm text-slate-500 mb-5 -mt-3 space-y-0.5">
        <li>
          <b className="text-slate-700">상세 확인</b> — 이번엔 못 쓰지만 같은 썸네일이라도 상세 페이지가 다를 수 있는 건.
          목록에서 빠지고, 같은 사진이 다음에 다시 수집되면 <b className="text-rose-600">빨간 테두리</b>로 맨 앞에 표시됩니다.
        </li>
        <li>
          <b className="text-slate-700">제외</b> — 아예 필요 없는 건. 같은 사진은 다음 자동 수집부터 자동으로 빠집니다.
        </li>
        <li>
          <b className="text-slate-700">BPM 전송 완료</b> — URL 복사 후 BPM 으로 보냈으면 눌러 주세요. 복사한 카드들이 목록에서 빠집니다.
        </li>
        <li>
          결과는 <b className="text-slate-700">최근 7일치만 보관</b>됩니다. 7일 지나도록 처리하지 않은 상품은 자동으로 지워집니다.
        </li>
      </ul>

      {error && (
        <div className="mb-4 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg p-3 flex items-start gap-2">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" /> <span>{error}</span>
        </div>
      )}

      {!loading && dates.length === 0 && !error && (
        <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-sm text-slate-500">
          아직 올라온 자동 수집 결과가 없습니다. 노트북에서 자동 수집을 실행하면 여기에 표시됩니다.
        </div>
      )}

      {dates.length > 0 && (
        <>
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            {TIERS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setTier(key)}
                className={`text-sm px-3.5 py-1.5 rounded-lg border ${
                  tier === key
                    ? 'bg-myriad-primary/15 border-myriad-primary text-myriad-ink font-semibold'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {label} <span className="text-xs opacity-70">{(counts[key] ?? 0).toLocaleString()}</span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <Filter value={platform} onChange={setPlatform} all="전체 플랫폼" options={facets.platforms} />
            <Filter value={productType} onChange={setProductType} all="전체 상품 유형" options={facets.productTypes} />
            <Filter value={modelType} onChange={setModelType} all="전체 모델 유형" options={facets.modelTypes} />
            <label className="text-sm text-slate-600 flex items-center gap-1.5 ml-1 select-none cursor-pointer">
              <input type="checkbox" checked={hideRegistered} onChange={(e) => setHideRegistered(e.target.checked)} />
              BPM 등록된 건 숨기기
            </label>
            <div className="flex-1" />
            <button
              onClick={selectAll}
              disabled={!pickableCount}
              className="text-sm px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 flex items-center gap-1.5 disabled:opacity-40"
            >
              {selected.size && selected.size === pickableCount ? <CheckSquare size={15} /> : <Square size={15} />}
              보이는 것 전체 선택
            </button>
            <button
              onClick={copyUrls}
              disabled={!selected.size}
              className="text-sm px-3.5 py-1.5 rounded-lg bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold flex items-center gap-1.5 disabled:opacity-40"
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? '복사됨' : `선택 URL 복사 (${selected.size})`}
            </button>
            <button
              onClick={() => mark(items.filter((it) => copiedIds.has(it.id)), 'sent')}
              disabled={!copiedIds.size}
              title="URL 복사한 카드들을 BPM 으로 보냈으면 눌러 목록에서 빼세요"
              className="text-sm px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-900 text-white font-semibold flex items-center gap-1.5 disabled:opacity-30"
            >
              <Send size={15} /> BPM 전송 완료{copiedIds.size ? ` (${copiedIds.size})` : ''}
            </button>
          </div>

          {selected.size > 0 && (
            <div className="flex items-center gap-2 mb-4 -mt-1 flex-wrap justify-end">
              <span className="text-sm text-slate-500 mr-1">선택한 {selected.size}건을</span>
              <button
                onClick={() => markSelected('review')}
                disabled={marking}
                title="목록에서 빼되, 같은 사진이 다음에 다시 수집되면 빨간 테두리로 표시"
                className="text-sm px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 flex items-center gap-1.5 disabled:opacity-40"
              >
                <Eye size={15} /> 일괄 상세 확인
              </button>
              <button
                onClick={() => markSelected('excluded')}
                disabled={marking}
                title="아예 필요 없는 건 — 같은 사진은 다음 자동 수집부터 자동으로 빠짐"
                className="text-sm px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 flex items-center gap-1.5 disabled:opacity-40"
              >
                <X size={15} /> 일괄 제외
              </button>
              <button
                onClick={() => setSelected(new Set())}
                className="text-sm px-2.5 py-1.5 rounded-lg text-slate-400 hover:text-slate-600"
              >
                선택 해제
              </button>
            </div>
          )}

          {loading ? (
            <div className="py-16 flex justify-center text-slate-400"><Loader2 className="animate-spin" /></div>
          ) : items.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-sm text-slate-500">
              이 조건에 해당하는 상품이 없습니다.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                {items.map((it) => (
                  <Card
                    key={it.id}
                    it={it}
                    selected={selected.has(it.id)}
                    onToggle={() => toggle(it)}
                    onReview={() => mark([it], 'review')}
                    onExclude={() => mark([it], 'excluded')}
                  />
                ))}
              </div>
              {hasMore && (
                <div className="flex justify-center mt-5">
                  <button onClick={loadMore} className="text-sm px-4 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50">
                    더 보기
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {undo && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-slate-900 text-white text-sm rounded-xl shadow-lg pl-4 pr-2 py-2 flex items-center gap-3">
          <span>
            {undo.status === 'sent' ? `BPM 전송 완료 ${undo.entries.length}건을 목록에서 뺐습니다`
              : undo.status === 'review'
                ? `${undo.entries.length > 1 ? `${undo.entries.length}건을 ` : ''}상세 확인으로 넘겼습니다`
                : `${undo.entries.length > 1 ? `${undo.entries.length}건을 ` : ''}제외했습니다`}
          </span>
          <button onClick={revert} className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 flex items-center gap-1.5">
            <Undo2 size={14} /> 되돌리기
          </button>
        </div>
      )}
    </div>
  )
}

function Filter({ value, onChange, all, options }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white max-w-[220px]"
    >
      <option value="">{all}</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

function Card({ it, selected, onToggle, onReview, onExclude }) {
  const [broken, setBroken] = useState(false)
  const done = it.bpm_registered
  const again = it.review_match
  return (
    <div
      onClick={onToggle}
      className={`relative bg-white rounded-xl overflow-hidden cursor-pointer border transition ${
        again
          ? `border-2 border-rose-500 ${selected ? 'ring-2 ring-myriad-primary ring-offset-1' : ''}`
          : selected ? 'border-2 border-myriad-primary shadow-sm' : 'border-slate-200 hover:border-slate-300'
      } ${done ? 'opacity-45 cursor-default' : ''}`}
    >
      <div className="relative aspect-square bg-slate-50 flex items-center justify-center">
        {again && (
          <span className="absolute bottom-1.5 left-1.5 text-[11px] font-semibold px-1.5 py-0.5 rounded-md bg-rose-600 text-white">
            다시 나온 사진 · 상세 확인
          </span>
        )}
        {it.image && !broken ? (
          <img
            src={it.image}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setBroken(true)}
            className="w-full h-full object-contain"
          />
        ) : (
          <ImageOff className="text-slate-300" />
        )}
      </div>
      {!done && (
        <span className={`absolute top-2 left-2 w-5 h-5 rounded-md border flex items-center justify-center ${
          selected ? 'bg-myriad-primary border-myriad-primary' : 'bg-white/90 border-slate-300'
        }`}>
          {selected && <Check size={13} className="text-myriad-ink" />}
        </span>
      )}
      <span className="absolute top-2 right-2 text-[11px] px-1.5 py-0.5 rounded-md bg-white/90 border border-slate-200 text-slate-600">
        {it.platform}
      </span>
      <div className="p-2.5">
        <a
          href={it.url}
          target="_blank"
          rel={it.platform === '쿠팡' ? 'noopener' : 'noreferrer'}
          onClick={(e) => {
            e.stopPropagation()
            if (it.platform === '쿠팡' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
              e.preventDefault()
              openCoupang(it.url)
            }
          }}
          className="text-[13px] leading-snug text-slate-800 hover:underline line-clamp-2 min-h-[2.4em]"
          title={it.title}
        >
          {it.title || '(상품명 없음)'}
        </a>
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-[15px] font-bold text-slate-900">
            {it.price != null ? `${it.price.toLocaleString()}원` : '-'}
          </span>
          {done && <span className="text-[11px] text-emerald-600">BPM 등록됨</span>}
        </div>
        {!done && (
          <div className="grid grid-cols-2 gap-1.5 mt-2">
            <button
              onClick={(e) => { e.stopPropagation(); onReview() }}
              title="목록에서 빼되, 같은 사진이 다음에 다시 수집되면 빨간 테두리로 표시"
              className="text-[12px] py-1 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center justify-center gap-1"
            >
              <Eye size={12} /> 상세 확인
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onExclude() }}
              title="아예 필요 없는 건 — 같은 사진은 다음 자동 수집부터 자동으로 빠짐"
              className="text-[12px] py-1 rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 flex items-center justify-center gap-1"
            >
              <X size={12} /> 제외
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
