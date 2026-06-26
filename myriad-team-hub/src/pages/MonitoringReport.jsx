import { useState, useMemo, useCallback, useRef } from 'react'
import { Upload, Download, GripVertical, ChevronUp, ChevronDown, ListOrdered, FileText } from 'lucide-react'
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import {
  C, LOGO_DARK,
  parseMonitoringExcel, derivePeriod, summarize, uniqBrands, defaultCover,
} from '../lib/monitoringReportEngine'

/* 막대 분포 차트용 색상 팔레트 (브랜드 톤 — 막대마다 순환 적용) */
const BAR_PALETTE = ['#EAA00A', '#17150F', '#B5760C', '#B79A5E', '#6E6757', '#9B8B6A', '#D8B45A', '#3F3A30']

/* ---------- 차트 컴포넌트 ---------- */
function BarChart({ title, en, items }) {
  if (!items || !items.length) return null
  return (
    <div className="mr-chartcard" style={{ marginTop: 30 }}>
      {/* 아이콘을 제목 안 inline 으로 — html2canvas 가 텍스트를 줄 박스 밖으로 밀어도 아이콘이 함께 따라가 수직 정렬 유지(flex align-items:center 는 아이콘만 제자리 남아 PDF 에서 어긋났음) */}
      <div style={{ marginBottom: 12 }}>
        <h3 className="mr-serif" style={{ margin: 0, fontSize: 16, fontWeight: 600, color: C.ink }}><span style={{ color: C.amber, fontSize: 11, marginRight: 7, verticalAlign: '-1px' }}>■</span>{title} <span style={{ fontSize: 11, color: '#A39C8C', fontWeight: 500 }}>{en}</span></h3>
      </div>
      {items.map((p, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '2px 0' }}>
          {/* padding 5px 0 = overflow:hidden 클립이 패딩 박스까지라 글자가 위/아래로 삐져나와도 안 잘림(html2canvas 가 글자를 줄 박스 밖으로 렌더하는 현상 흡수). 가로 말줄임은 유지. */}
          <div style={{ width: 130, flex: 'none', fontSize: 12, lineHeight: 1.4, padding: '5px 0', color: '#332F27', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={p.name}>{p.name}</div>
          <div className="mr-bartrack" style={{ flex: 1, height: 11, background: '#EEE9DC', borderRadius: 3, overflow: 'hidden' }}><div style={{ width: (p.frac * 100) + '%', height: '100%', background: BAR_PALETTE[i % BAR_PALETTE.length], borderRadius: 3 }} /></div>
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
      <div style={{ marginBottom: 10 }}>
        <h3 className="mr-serif" style={{ margin: 0, fontSize: 16, fontWeight: 600, color: C.ink }}><span style={{ color: C.amber, fontSize: 11, marginRight: 7, verticalAlign: '-1px' }}>■</span>침해유형별 분포 <span style={{ fontSize: 11, color: '#A39C8C', fontWeight: 500 }}>By Infringement Type</span></h3>
      </div>
      <div style={{ display: 'flex', height: 16, borderRadius: 4, overflow: 'hidden', marginBottom: 14 }}>
        {items.map((t, i) => (<div key={i} style={{ width: t.segPct + '%', background: t.col, height: '100%' }} />))}
      </div>
      {items.map((t, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '6px 0', borderBottom: '1px solid #EFEADD' }}>
          <div style={{ flex: 1, fontSize: 12.5, color: '#332F27' }}><span style={{ color: t.col, fontSize: 12, marginRight: 9, verticalAlign: '-1px' }}>■</span>{t.ko} <span style={{ color: '#A39C8C', fontSize: 10 }}>{t.en}</span></div>
          <div className="mr-bartrack" style={{ width: 130, height: 9, background: '#EEE9DC', borderRadius: 3, overflow: 'hidden' }}><div style={{ width: (t.frac * 100) + '%', height: '100%', background: t.col, borderRadius: 3 }} /></div>
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

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', borderBottom: '2px solid ' + C.ink, paddingBottom: 14 }}>
        <h2 className="mr-serif" style={{ margin: 0, fontSize: 23, fontWeight: 700, color: C.ink, lineHeight: 1.3 }}>
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
    <div className="mr-noprint mx-auto mb-[18px] bg-white border border-slate-200 rounded-2xl px-4 py-4" style={{ width: 794, maxWidth: '100%' }}>
      <div className="flex items-center gap-2 mb-2.5 text-slate-900">
        <ListOrdered size={16} className="text-myriad-ink" />
        <span className="font-semibold text-sm">페이지 순서 편집</span>
        <span className="text-xs text-slate-400">드래그하거나 ▲▼ 로 순서를 바꾸세요. 표지는 항상 1페이지 고정입니다.</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {order.map((brand, i) => {
          const s = byBrand[brand]
          return (
            <div
              key={brand}
              draggable
              onDragStart={() => { dragIdx.current = i }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => { if (dragIdx.current != null && dragIdx.current !== i) onReorder(dragIdx.current, i); dragIdx.current = null }}
              className="flex items-center gap-2.5 px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg cursor-grab"
            >
              <GripVertical size={16} className="text-slate-400" />
              <span className="w-[22px] h-[22px] flex-none rounded-md bg-myriad-ink text-white text-[11px] font-bold flex items-center justify-center">{i + 1}</span>
              <span className="flex-1 text-sm font-semibold text-slate-800 whitespace-nowrap overflow-hidden text-ellipsis">{brand}</span>
              <span className="text-xs text-slate-400">{s ? s.count + '건' : ''}</span>
              <button onClick={() => onMove(i, -1)} disabled={i === 0} className="border border-slate-200 bg-white rounded-md px-1.5 py-1 text-slate-600 disabled:opacity-35 disabled:cursor-default enabled:hover:border-myriad-primary" title="위로"><ChevronUp size={14} /></button>
              <button onClick={() => onMove(i, 1)} disabled={i === order.length - 1} className="border border-slate-200 bg-white rounded-md px-1.5 py-1 text-slate-600 disabled:opacity-35 disabled:cursor-default enabled:hover:border-myriad-primary" title="아래로"><ChevronDown size={14} /></button>
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

  // PDF 직접 생성 — 각 섹션(표지/브랜드별 요약)을 A4 한 장씩 캔버스로 렌더해 1:1 배치.
  // 브라우저 인쇄 페이지네이션(여백/배율/머리글 변수)을 완전히 제거 → 어느 환경에서도 표지 1장 + 요약 N장 고정.
  const doExport = useCallback(async () => {
    if (!rows.length || busy) return
    setBusy(true)
    setStatus('PDF 생성 중… (폰트 준비)')
    try {
      // 웹폰트(Noto Serif KR 등)가 로드된 뒤에 캡처해야 글자가 정확히 렌더됨
      if (document.fonts && document.fonts.ready) await document.fonts.ready

      const PW = 210, PH = 297               // A4 (mm)
      const RENDER_W = 794                   // 화면 .mr-cover/.mr-page 폭 (= A4 96dpi)
      const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
      const root = document.getElementById('mr-doc')
      const sections = Array.from(root.querySelectorAll('.mr-cover, .mr-page'))

      for (let i = 0; i < sections.length; i++) {
        setStatus('PDF 생성 중… (' + (i + 1) + '/' + sections.length + ' 페이지)')
        const el = sections[i]
        const canvas = await html2canvas(el, {
          scale: 2,
          backgroundColor: '#FBFAF6',
          useCORS: true,
          width: RENDER_W,
          windowWidth: RENDER_W,
          // input(표지 브랜드명) 은 html2canvas 가 값을 못 그리는 경우가 있어 div 로 치환
          onclone: (cdoc) => {
            cdoc.querySelectorAll('.mr-coverInput').forEach((inp) => {
              const div = cdoc.createElement('div')
              div.textContent = inp.value || ''
              div.style.cssText = 'font-family:inherit;font-size:18px;font-weight:700;color:#17150F;padding:1px 4px;margin:2px 0 0 -4px;max-width:340px;line-height:1.3;'
              inp.parentNode.replaceChild(div, inp)
            })
            // html2canvas 는 텍스트를 줄 박스보다 ~5px 아래로 렌더(화면 브라우저와의 고질적 차이).
            // 그 결과 분포 막대 옆 라벨/퍼센트 텍스트가 막대보다 아래로 어긋남. 캡처 복제본에서만
            // 막대 트랙을 그만큼 내려 텍스트와 정렬(화면 미리보기 DOM 은 손대지 않아 그대로 정확).
            // overflow:visible 필수 — overflow:hidden 트랙에 translateY 를 크게 주면 html2canvas 가
            // 색칠된 막대를 잘라내 사라짐(헤드리스 재현 확인). visible 로 두면 색상 유지 + 이동 1:1 적용.
            // (막대 fill 은 트랙 범위 안이라 clip 제거해도 모양 동일.)
            // ⚠ 모든 위치 보정은 캡처 복제본 전용 — 화면 미리보기 DOM 은 절대 안 건드림(미리보기=원본 고정 기준).
            //   막대: overflow:visible(색상보존)+아래 6px / KPI 라벨·설명 위 8px, 숫자 위 14px(html2canvas 하강 보정)
            //   KPI 설명만 아래 3px(숫자↔설명 간격 확대) / 표지 Week 보조텍스트 아래 15px.
            const st = cdoc.createElement('style')
            st.textContent = '.mr-bartrack{overflow:visible !important;transform:translateY(6px)} .mr-kpis>div>div{transform:translateY(-8px)} .mr-kpis>div>.mr-serif{transform:translateY(-14px)} .mr-kpis>div>div:last-child{transform:translateY(-3px)} .mr-weeksub{transform:translateY(14px)}'
            cdoc.head.appendChild(st)
          },
        })
        const imgData = canvas.toDataURL('image/jpeg', 0.92)
        const imgH = (canvas.height * PW) / canvas.width   // 폭을 210mm 로 맞췄을 때의 높이
        if (i > 0) doc.addPage()
        doc.setFillColor(251, 250, 246)                    // 크림 배경 먼저 깔아 빈틈 방지
        doc.rect(0, 0, PW, PH, 'F')
        if (imgH <= PH + 0.5) {
          doc.addImage(imgData, 'JPEG', 0, 0, PW, Math.min(imgH, PH))   // 폭 꽉 채움, 한 페이지
        } else {
          const w = (canvas.width * PH) / canvas.height                // 페이지보다 길면 높이 기준 축소(중앙)
          doc.addImage(imgData, 'JPEG', (PW - w) / 2, 0, w, PH)
        }
      }

      const safe = ((coverBrand || 'Monitoring') + '_' + (meta.tag || '')).replace(/[^\w가-힣.\-]+/g, '_').replace(/^_+|_+$/g, '')
      doc.save(safe + '.pdf')
      setStatus('PDF 저장 완료 · ' + sections.length + '페이지')
    } catch (e) {
      setStatus('PDF 생성 오류: ' + (e?.message || e))
    } finally {
      setBusy(false)
    }
  }, [rows, busy, coverBrand, meta])

  const hasData = rows.length > 0
  const totalPages = orderedSummaries.length + 1

  return (
    <div className="mr-root">
      {/* ===== 툴바 (화면 전용 — 허브 디자인) ===== */}
      <div className="mr-toolbar sticky top-0 z-30 bg-white border-b border-slate-200 flex items-center gap-3 px-6 py-3">
        <FileText className="text-myriad-ink" size={20} />
        <h1 className="text-lg font-bold text-slate-900">모니터링 보고서 <span className="text-sm font-normal text-slate-400">PDF 생성</span></h1>
        <div className="flex-1" />
        <span className="hidden md:block text-xs text-slate-400 max-w-[260px] truncate">{status}</span>
        <label className={`text-sm font-semibold border border-slate-200 text-slate-700 px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5 transition-colors ${busy ? 'opacity-50 cursor-default' : 'cursor-pointer hover:border-myriad-primary hover:bg-slate-50'}`}>
          <Upload size={14} /> 엑셀 업로드
          <input type="file" accept=".xlsx,.xls" onChange={onFile} className="hidden" disabled={busy} />
        </label>
        <button onClick={doExport} disabled={!hasData || busy} className="text-sm font-semibold bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink disabled:bg-slate-100 disabled:text-slate-400 px-3.5 py-1.5 rounded-lg inline-flex items-center gap-1.5 transition-colors">
          <Download size={14} /> {busy ? 'PDF 생성 중…' : 'PDF 다운로드'}
        </button>
      </div>

      {/* ===== 빈 상태 ===== */}
      {!hasData && (
        <div className="max-w-xl mx-auto mt-20 text-center px-6">
          <div className="text-lg font-bold text-slate-900 mb-2">온라인 모니터링 보고서 생성</div>
          <p className="text-sm text-slate-500 leading-relaxed">
            셀러 정보가 담긴 모니터링 엑셀(.xlsx)을 업로드하면, 브랜드별 요약(KPI·플랫폼/침해유형/IPR/상품유형 분포)으로
            자동 구성된 보고서가 생성됩니다. 우측 상단 <b className="text-myriad-ink">엑셀 업로드</b> 버튼을 눌러 시작하세요.
          </p>
        </div>
      )}

      {/* ===== PDF 다운로드 안내 (화면 전용) ===== */}
      {hasData && (
        <div className="mr-noprint mx-auto mt-5 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm text-slate-600 flex gap-2 items-start leading-relaxed" style={{ width: 794, maxWidth: '100%' }}>
          <span>💡</span>
          <span><b className="text-slate-700">PDF 다운로드</b> — 우측 상단 <b className="text-myriad-ink">PDF 다운로드</b> 버튼을 누르면 표지 1장 + 브랜드별 요약이 각각 A4 한 페이지로 정확히 떨어진 PDF 가 바로 저장됩니다. 브라우저 인쇄 설정(여백·배율)과 무관하게 항상 동일하게 출력됩니다.</span>
        </div>
      )}

      {/* ===== 순서 편집 패널 (브랜드 2개 이상일 때만) ===== */}
      {hasData && orderedSummaries.length > 1 && (
        <div className="pt-3.5">
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
                <div className="mr-weeksub" style={{ paddingBottom: 8 }}>
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
