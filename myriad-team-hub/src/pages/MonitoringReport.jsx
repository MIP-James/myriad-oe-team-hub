import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { Upload, Printer, GripVertical, ChevronUp, ChevronDown, ListOrdered } from 'lucide-react'
import {
  C, LOGO_WHITE, LOGO_DARK,
  parseMonitoringExcel, derivePeriod, summarize, uniqBrands, defaultCover,
} from '../lib/monitoringReportEngine'

/* 막대 분포 차트용 색상 팔레트 (브랜드 톤 — 막대마다 순환 적용) */
const BAR_PALETTE = ['#EAA00A', '#17150F', '#B5760C', '#B79A5E', '#6E6757', '#9B8B6A', '#D8B45A', '#3F3A30']

/* ---------- 차트 컴포넌트 ---------- */
function BarChart({ title, en, items }) {
  if (!items || !items.length) return null
  return (
    <div className="mr-chartcard" style={{ marginTop: 30 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div style={{ width: 6, height: 6, background: C.amber }} />
        <h3 className="mr-serif" style={{ margin: 0, fontSize: 16, fontWeight: 600, color: C.ink }}>{title} <span style={{ fontSize: 11, color: '#A39C8C', fontWeight: 500 }}>{en}</span></h3>
      </div>
      {items.map((p, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '5px 0' }}>
          <div style={{ width: 130, flex: 'none', fontSize: 12, color: '#332F27', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={p.name}>{p.name}</div>
          <div style={{ flex: 1, height: 11, background: '#EEE9DC', borderRadius: 3, overflow: 'hidden' }}><div style={{ width: (p.frac * 100) + '%', height: '100%', background: BAR_PALETTE[i % BAR_PALETTE.length], borderRadius: 3 }} /></div>
          <div style={{ width: 64, flex: 'none', textAlign: 'right', fontSize: 11, color: '#6E6757' }}><b style={{ color: C.ink }}>{p.count}</b> · {p.pct}%</div>
        </div>
      ))}
    </div>
  )
}
function TypeChart({ items }) {
  if (!items || !items.length) return null
  return (
    <div className="mr-chartcard" style={{ marginTop: 30 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={{ width: 6, height: 6, background: C.amber }} />
        <h3 className="mr-serif" style={{ margin: 0, fontSize: 16, fontWeight: 600, color: C.ink }}>침해유형별 분포 <span style={{ fontSize: 11, color: '#A39C8C', fontWeight: 500 }}>By Infringement Type</span></h3>
      </div>
      <div style={{ display: 'flex', height: 16, borderRadius: 4, overflow: 'hidden', marginBottom: 14 }}>
        {items.map((t, i) => (<div key={i} style={{ width: t.segPct + '%', background: t.col, height: '100%' }} />))}
      </div>
      {items.map((t, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '6px 0', borderBottom: '1px solid #EFEADD' }}>
          <div style={{ width: 10, height: 10, borderRadius: 2, background: t.col, flex: 'none' }} />
          <div style={{ flex: 1, fontSize: 12.5, color: '#332F27' }}>{t.ko} <span style={{ color: '#A39C8C', fontSize: 10 }}>{t.en}</span></div>
          <div style={{ width: 130, height: 9, background: '#EEE9DC', borderRadius: 3, overflow: 'hidden' }}><div style={{ width: (t.frac * 100) + '%', height: '100%', background: t.col, borderRadius: 3 }} /></div>
          <div style={{ width: 54, textAlign: 'right', fontSize: 11, color: '#6E6757' }}><b style={{ color: C.ink }}>{t.count}</b> · {t.pct}%</div>
        </div>
      ))}
    </div>
  )
}

/* ---------- 브랜드 요약 페이지 ---------- */
function BrandSummary({ sum, period, idx, total, brandIndex, brandCount }) {
  return (
    <section className="mr-page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #E2DCCC', paddingBottom: 9, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <img src={LOGO_DARK} alt="MYRIAD IP" style={{ height: 20, display: 'block' }} />
          <span style={{ fontSize: 10, color: '#A39C8C' }}>Online Monitoring Report</span>
        </div>
        <div className="mr-mono" style={{ fontSize: 10, letterSpacing: '.04em', color: C.amberDk }}>요약 · Executive Summary</div>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', borderBottom: '2px solid ' + C.ink, paddingBottom: 10 }}>
        <h2 className="mr-serif" style={{ margin: 0, fontSize: 23, fontWeight: 700, color: C.ink }}>
          {sum.brand} <span style={{ fontSize: 13, color: '#A39C8C', fontWeight: 500 }}>Executive Summary</span>
        </h2>
        <div className="mr-mono" style={{ fontSize: 11, color: C.amberDk }}>
          {brandCount > 1 ? ('브랜드 ' + brandIndex + '/' + brandCount + ' · ') : ''}{period.tag}{period.range ? (' · ' + period.range) : ''}
        </div>
      </div>

      <div className="mr-kpis" style={{ display: 'flex', border: '1px solid #E6E1D5', borderRadius: 4, marginTop: 22, background: '#fff' }}>
        {sum.kpis.map((k, i) => (
          <div key={i} style={{ flex: 1, padding: '18px 20px', borderLeft: i ? '1px solid #EFEADD' : 'none' }}>
            <div style={{ fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: '#A39C8C' }}>{k.en}</div>
            <div className="mr-serif" style={{ fontSize: 40, fontWeight: 700, color: C.ink, lineHeight: 1.05, marginTop: 6 }}>{k.val}</div>
            <div style={{ fontSize: 11, color: '#6E6757', marginTop: 3 }}>{k.ko} · {k.sub}</div>
          </div>
        ))}
      </div>

      <BarChart title="플랫폼별 분포" en="By Platform" items={sum.platform} />
      <TypeChart items={sum.types} />
      <BarChart title="IPR별 분포" en="By IPR No." items={sum.ipr} />
      <BarChart title="상품 유형별 분포" en="By Line" items={sum.line} />

      <div style={{ marginTop: 'auto', paddingTop: 12, borderTop: '1px solid #E2DCCC', display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#A39C8C' }}>
        <span>{sum.brand} · {period.tag} · Confidential</span>
        <span className="mr-mono">{('0' + (idx + 2)).slice(-2)} / {('0' + total).slice(-2)}</span>
      </div>
    </section>
  )
}

/* ---------- 순서 변경 패널 (화면 전용) ---------- */
function ReorderPanel({ order, summaries, onMove, onReorder }) {
  const dragIdx = useRef(null)
  const byBrand = useMemo(() => Object.fromEntries(summaries.map((s) => [s.brand, s])), [summaries])
  return (
    <div className="mr-noprint" style={{ width: 794, margin: '0 auto 18px', background: '#fff', border: '1px solid #E2DCCC', borderRadius: 10, padding: '14px 18px', boxShadow: '0 2px 10px rgba(0,0,0,.06)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, color: C.ink }}>
        <ListOrdered size={16} />
        <span style={{ fontWeight: 700, fontSize: 13 }}>페이지 순서 편집</span>
        <span style={{ fontSize: 11, color: '#94918A' }}>드래그하거나 ▲▼ 로 순서를 바꾸세요. 표지는 항상 1페이지 고정입니다.</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {order.map((brand, i) => {
          const s = byBrand[brand]
          return (
            <div
              key={brand}
              draggable
              onDragStart={() => { dragIdx.current = i }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => { if (dragIdx.current != null && dragIdx.current !== i) onReorder(dragIdx.current, i); dragIdx.current = null }}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: '#FBFAF6', border: '1px solid #ECE6D8', borderRadius: 8, cursor: 'grab' }}
            >
              <GripVertical size={16} color="#B3AC9C" />
              <span style={{ width: 22, height: 22, flex: 'none', borderRadius: 6, background: C.ink, color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
              <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{brand}</span>
              <span style={{ fontSize: 11, color: '#8A857A' }}>{s ? s.count + '건' : ''}</span>
              <button onClick={() => onMove(i, -1)} disabled={i === 0} style={{ border: '1px solid #DED7C6', background: '#fff', borderRadius: 6, padding: '3px 6px', cursor: i === 0 ? 'default' : 'pointer', opacity: i === 0 ? 0.35 : 1 }} title="위로"><ChevronUp size={14} /></button>
              <button onClick={() => onMove(i, 1)} disabled={i === order.length - 1} style={{ border: '1px solid #DED7C6', background: '#fff', borderRadius: 6, padding: '3px 6px', cursor: i === order.length - 1 ? 'default' : 'pointer', opacity: i === order.length - 1 ? 0.35 : 1 }} title="아래로"><ChevronDown size={14} /></button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ---------- 페이지 ---------- */
export default function MonitoringReport() {
  const [rows, setRows] = useState([])
  const [meta, setMeta] = useState({ tag: '—', range: '', mode: '기간 Period', issued: new Date().toISOString().slice(0, 10) })
  const [coverBrand, setCoverBrand] = useState('')
  const [order, setOrder] = useState([])           // 브랜드명 배열 (사용자 순서)
  const [status, setStatus] = useState('엑셀 파일을 업로드하세요')
  const [busy, setBusy] = useState(false)

  const brands = useMemo(() => uniqBrands(rows), [rows])
  const multi = brands.length > 1

  // 브랜드별 요약
  const summaries = useMemo(() => {
    if (!rows.length) return []
    if (!brands.length) return [summarize(coverBrand || '(브랜드 미상)', rows)]
    return brands.map((b) => summarize(b, rows.filter((r) => (r.brand || '').trim() === b)))
  }, [rows, brands, coverBrand])

  // 사용자 순서대로 정렬된 요약 (없는 브랜드 방어)
  const orderedSummaries = useMemo(() => {
    const map = Object.fromEntries(summaries.map((s) => [s.brand, s]))
    const seq = order.length ? order : summaries.map((s) => s.brand)
    return seq.map((b) => map[b]).filter(Boolean)
  }, [summaries, order])

  // 인쇄 모드 토글 — body 클래스로 print CSS 격리, 인쇄 후 자동 해제
  useEffect(() => {
    const after = () => document.body.classList.remove('mr-printing')
    window.addEventListener('afterprint', after)
    return () => { window.removeEventListener('afterprint', after); document.body.classList.remove('mr-printing') }
  }, [])

  const ingest = useCallback(async (file) => {
    setBusy(true)
    setStatus('분석 중…')
    try {
      const { rows: rs, weeks } = await parseMonitoringExcel(file)
      if (!rs.length) { setStatus('인식된 행 없음 — 헤더 매핑을 확인하세요'); setBusy(false); return }
      const stem = file.name.replace(/\.(xlsx|xls)$/i, '')
      const dp = derivePeriod(weeks, stem)
      setRows(rs)
      setMeta({ tag: dp.tag, range: dp.range, mode: dp.mode, issued: new Date().toISOString().slice(0, 10) })
      setCoverBrand(defaultCover(rs))
      setOrder(uniqBrands(rs))
      const b = uniqBrands(rs)
      setStatus(file.name + ' · ' + rs.length + '건 · 브랜드 ' + b.length + '개' + (b.length > 1 ? ' (표지명 직접 수정 가능)' : ''))
    } catch (err) {
      setStatus('오류: ' + (err?.message || err))
    } finally {
      setBusy(false)
    }
  }, [])

  const onFile = (e) => { const f = e.target.files && e.target.files[0]; if (f) ingest(f); e.target.value = '' }

  const move = (i, dir) => {
    setOrder((prev) => {
      const base = prev.length ? [...prev] : summaries.map((s) => s.brand)
      const j = i + dir
      if (j < 0 || j >= base.length) return base
      ;[base[i], base[j]] = [base[j], base[i]]
      return base
    })
  }
  const reorder = (from, to) => {
    setOrder((prev) => {
      const base = prev.length ? [...prev] : summaries.map((s) => s.brand)
      const [m] = base.splice(from, 1)
      base.splice(to, 0, m)
      return base
    })
  }

  const doPrint = () => {
    if (!rows.length) return
    document.body.classList.add('mr-printing')
    window.print()
  }

  const hasData = rows.length > 0
  const totalPages = orderedSummaries.length + 1

  return (
    <div className="mr-root">
      {/* ===== 툴바 (화면 전용) ===== */}
      <div className="mr-toolbar" style={{ position: 'sticky', top: 0, zIndex: 30, background: '#17150F', color: '#fff', display: 'flex', alignItems: 'center', gap: 14, padding: '10px 22px', boxShadow: '0 1px 6px rgba(0,0,0,.25)' }}>
        <img src={LOGO_WHITE} alt="MYRIAD IP" style={{ height: 24, display: 'block' }} />
        <span style={{ color: '#8A857A', fontSize: 11 }}>온라인 모니터링 보고서 · 자동 생성</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <label style={{ background: '#EAA00A', color: '#17150F', borderRadius: 6, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Upload size={14} /> 엑셀 업로드
            <input type="file" accept=".xlsx,.xls" onChange={onFile} style={{ display: 'none' }} disabled={busy} />
          </label>
          <span style={{ fontSize: 11, color: '#9A938A', maxWidth: 320, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{status}</span>
          <button onClick={doPrint} disabled={!hasData} style={{ background: hasData ? '#fff' : '#5a564d', color: hasData ? '#17150F' : '#9A938A', border: 'none', borderRadius: 6, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: hasData ? 'pointer' : 'default', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Printer size={14} /> PDF / 인쇄
          </button>
        </div>
      </div>

      {/* ===== 빈 상태 ===== */}
      {!hasData && (
        <div style={{ maxWidth: 560, margin: '80px auto', textAlign: 'center', color: '#6E6757' }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: C.ink, marginBottom: 8 }}>온라인 모니터링 보고서 생성</div>
          <p style={{ fontSize: 13, lineHeight: 1.7 }}>
            셀러 정보가 담긴 모니터링 엑셀(.xlsx)을 업로드하면, 브랜드별 요약(KPI·플랫폼/침해유형/IPR/상품유형 분포)으로<br />
            자동 구성된 보고서가 생성됩니다. 우측 상단 <b style={{ color: C.amberDk }}>엑셀 업로드</b> 버튼을 눌러 시작하세요.
          </p>
        </div>
      )}

      {/* ===== 순서 편집 패널 (브랜드 2개 이상일 때만) ===== */}
      {hasData && orderedSummaries.length > 1 && (
        <div style={{ paddingTop: 22 }}>
          <ReorderPanel order={order.length ? order : summaries.map((s) => s.brand)} summaries={summaries} onMove={move} onReorder={reorder} />
        </div>
      )}

      {/* ===== 문서 ===== */}
      {hasData && (
        <div id="mr-doc" className="mr-doc" style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
          {/* 표지 */}
          <section className="mr-cover">
            <div style={{ height: 6, background: C.amber }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '30px 56px 0' }}>
              <img src={LOGO_DARK} alt="MYRIAD IP" style={{ height: 40, display: 'block' }} />
              <div className="mr-mono" style={{ fontSize: 10, letterSpacing: '.1em', color: '#A39C8C', textTransform: 'uppercase' }}>Confidential</div>
            </div>

            <div style={{ padding: '0 56px', marginTop: 96 }}>
              <div style={{ fontSize: 13, letterSpacing: '.04em', color: C.amberDk, fontWeight: 600 }}>온라인 침해 모니터링 · 단속 보고서</div>
              <h1 className="mr-serif" style={{ margin: '14px 0 0', fontWeight: 700, fontSize: 46, lineHeight: 1.18, color: C.ink, letterSpacing: '-.01em' }}>Online Infringement<br />Monitoring &amp; Enforcement<br />Report</h1>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 18, marginTop: 42 }}>
                <div className="mr-serif" style={{ fontSize: 58, fontWeight: 700, color: C.amber, lineHeight: 0.9 }}>{meta.tag}</div>
                <div style={{ paddingBottom: 8 }}>
                  <div style={{ fontSize: 13, color: '#332F27', fontWeight: 600 }}>{meta.range || meta.tag}</div>
                  <div style={{ fontSize: 11, color: '#8A857A' }}>{meta.mode} 보고</div>
                </div>
              </div>
            </div>

            <div style={{ padding: '0 56px', marginTop: 'auto' }}>
              <div style={{ height: 1, background: '#E2DCCC', marginBottom: 22 }} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px 40px', paddingBottom: 30 }}>
                <div>
                  <div style={{ fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: '#A39C8C' }}>대상 브랜드 / Brand {multi && <span style={{ color: C.amberDk, textTransform: 'none', letterSpacing: 0 }}>· {brands.length}개 (편집 가능)</span>}</div>
                  <input className="mr-coverInput" value={coverBrand} onChange={(e) => setCoverBrand(e.target.value)} spellCheck={false} title="표지에 표시할 브랜드명 (직접 수정 가능)" />
                </div>
                <div>
                  <div style={{ fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: '#A39C8C' }}>발행 / Prepared by</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: C.ink, marginTop: 3 }}>Myriad IP</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: '#A39C8C' }}>보고 주기 / Cadence</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#332F27', marginTop: 3 }}>{meta.mode}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: '#A39C8C' }}>발행일 / Issued</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#332F27', marginTop: 3 }}>{meta.issued}</div>
                </div>
              </div>
            </div>
            <div style={{ background: '#17150F', color: '#C9C3B6', fontSize: 10, padding: '13px 56px', display: 'flex', justifyContent: 'space-between', letterSpacing: '.03em' }}>
              <span>본 보고서는 대상 브랜드 전용 기밀 문서입니다. · Confidential — prepared for the client brand only.</span>
              <span className="mr-mono">01 / {('0' + totalPages).slice(-2)}</span>
            </div>
          </section>

          {/* 브랜드별 요약 (사용자 순서) */}
          {orderedSummaries.map((s, i) => (
            <BrandSummary key={s.brand} sum={s} period={meta} idx={i} total={totalPages} brandIndex={i + 1} brandCount={orderedSummaries.length} />
          ))}
        </div>
      )}
    </div>
  )
}
