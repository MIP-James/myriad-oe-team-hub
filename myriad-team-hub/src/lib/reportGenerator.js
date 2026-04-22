/**
 * Report_Generator.py 의 JS 포팅 (v8 확장판).
 *
 * 입력: 직전달 / 이번달 Excel 두 개
 * 출력: 요약(4분할) + 플랫폼별 상세 시트가 담긴 한 개의 Excel
 *
 * 브라우저에서 완결. 서버/파이썬 불필요. exceljs 사용.
 */
import ExcelJS from 'exceljs'

// ---------------- 상수 ----------------
const REQUIRED_COLUMNS = ['Platform', 'Model Type', 'Infringement Type']
const HEADER_BLUE = 'FF1F4E79'
const BORDER_GRAY = 'FFBFBFBF'
// 기존 Python 프로그램 출력과 맞춤 — 21.75 는 Excel 의 기본 1줄 행 높이
const HEADER_ROW_HEIGHT = 21.75
const BASE_DATA_ROW_HEIGHT = 18

// Worksheet 별로 "autosize 제외할 행(제목 행)" 추적
const titleRowsByWs = new WeakMap()

const INFR_PALETTE = [
  'FFD6EAF8', 'FFFADBD8', 'FFD5F5E3', 'FFFCF3CF',
  'FFE8DAEF', 'FFFDEBD0', 'FFD0ECE7', 'FFEAECEE'
]
const FIXED_INFR_COLOR = {
  '디자인권 침해': 'FFDCE6F1',
  '저작권 침해': 'FFE4DFEC',
  '상표권 침해': 'FFFDE9D9'
}

const THIN_BORDER = {
  top: { style: 'thin', color: { argb: BORDER_GRAY } },
  left: { style: 'thin', color: { argb: BORDER_GRAY } },
  right: { style: 'thin', color: { argb: BORDER_GRAY } },
  bottom: { style: 'thin', color: { argb: BORDER_GRAY } }
}

// ---------------- 유틸 ----------------
function clean(x) {
  if (x == null) return ''
  if (typeof x === 'object' && 'text' in x) return String(x.text).trim()  // ExcelJS rich text
  if (typeof x === 'object' && 'result' in x) return String(x.result).trim() // 공식 결과
  return String(x).trim()
}

function displayValue(x, defaultValue = '(미기재)') {
  const v = clean(x)
  return v || defaultValue
}

function normalizeModelType(s) {
  const v = clean(s)
  if (!v) return ''
  const before = v.split('(')[0].trim()
  return before || v
}

function safeSheetName(s) {
  let r = String(s || '').replace(/[\\/:*?"<>|]+/g, '_').trim()
  return (r || '미기재').substring(0, 31)
}

function prevMonth(yyyymm) {
  const [y, m] = yyyymm.split('-').map(Number)
  if (m === 1) return `${y - 1}-12`
  return `${y}-${String(m - 1).padStart(2, '0')}`
}

export function normalizeReportMonth(s) {
  let v = clean(s)
  if (!v) {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }
  v = v.replace(/\./g, '-').replace(/\//g, '-')
  if (/^\d{6}$/.test(v)) return `${v.slice(0, 4)}-${v.slice(4)}`
  if (/^\d{4}-\d{2}$/.test(v)) return v
  throw new Error('보고월은 YYYY-MM 형식으로 입력해주세요. 예) 2026-02')
}

// ---------------- Excel 파싱 ----------------
export async function parseExcelFile(file) {
  const buffer = await file.arrayBuffer()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const sheet = wb.worksheets[0]
  if (!sheet) throw new Error('엑셀 파일에 시트가 없습니다.')

  // 헤더 추출
  const headerRow = sheet.getRow(1)
  const headers = []
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers[colNumber] = clean(cell.value)
  })

  // 데이터 행 추출
  const rows = []
  const rowCount = sheet.rowCount
  for (let r = 2; r <= rowCount; r++) {
    const excelRow = sheet.getRow(r)
    const rec = {}
    let anyValue = false
    for (let c = 1; c < headers.length; c++) {
      const h = headers[c]
      if (!h) continue
      const v = clean(excelRow.getCell(c).value)
      rec[h] = v
      if (v) anyValue = true
    }
    if (anyValue) rows.push(rec)
  }

  // Model Type 하위호환
  const headerSet = new Set(headers.filter(Boolean))
  if (!headerSet.has('Model Type') && headerSet.has('Product Model Type')) {
    for (const r of rows) r['Model Type'] = r['Product Model Type']
    headerSet.add('Model Type')
  }

  // 필수 컬럼 체크
  const missing = REQUIRED_COLUMNS.filter((c) => !headerSet.has(c))
  if (missing.length) {
    throw new Error(
      `필수 컬럼이 누락되었습니다: ${missing.join(', ')}\n현재 컬럼: ${[...headerSet].join(', ')}`
    )
  }

  // 정규화 컬럼 추가
  for (const r of rows) {
    r['플랫폼(표시)'] = displayValue(r['Platform'])
    r['침해유형(표시)'] = displayValue(r['Infringement Type'])
    r['상품유형(정규화)'] = normalizeModelType(r['Model Type'])
    r['사업부(정규화)'] = clean(r['Business Division'] || '')
  }

  return { rows, hasBusinessDivision: headerSet.has('Business Division') }
}

// ---------------- 집계 ----------------
function useDivisionMode(rows, hasBusinessDivision) {
  if (!hasBusinessDivision) return false
  return rows.some((r) => r['사업부(정규화)'])
}

function countByKey(rows, key) {
  const map = new Map()
  for (const r of rows) {
    const v = r[key]
    if (!v) continue
    map.set(v, (map.get(v) || 0) + 1)
  }
  return [...map.entries()]
    .map(([항목, cnt]) => ({ 항목, '전체 침해 건수': cnt }))
    .sort((a, b) => b['전체 침해 건수'] - a['전체 침해 건수'] || a.항목.localeCompare(b.항목))
}

function buildSummaryTables(rows, useDivision) {
  const plat = countByKey(rows, '플랫폼(표시)')
  const infr = countByKey(rows, '침해유형(표시)')
  let third, thirdTitle
  if (useDivision) {
    third = countByKey(
      rows.filter((r) => r['사업부(정규화)']),
      '사업부(정규화)'
    )
    thirdTitle = '사업부별 전체 침해 건수'
  } else {
    third = countByKey(
      rows.filter((r) => r['상품유형(정규화)']),
      '상품유형(정규화)'
    )
    thirdTitle = '상품 유형별 전체 침해 건수'
  }
  return { 플랫폼: plat, 침해유형: infr, 세번째: third, 세번째_제목: thirdTitle }
}

function buildPlatformBlocks(rows, topN, useDivision) {
  const byPlatform = new Map()
  for (const r of rows) {
    const p = r['플랫폼(표시)']
    if (!byPlatform.has(p)) byPlatform.set(p, [])
    byPlatform.get(p).push(r)
  }

  const out = {}
  for (const [platform, platRows] of byPlatform) {
    const byInfr = new Map()
    for (const r of platRows) {
      const t = r['침해유형(표시)']
      if (!byInfr.has(t)) byInfr.set(t, [])
      byInfr.get(t).push(r)
    }

    const blocks = []
    for (const [infr, sub] of byInfr) {
      const key = useDivision ? '사업부(정규화)' : '상품유형(정규화)'
      const sub2 = sub.filter((r) => r[key])
      if (!sub2.length) continue
      const total = sub2.length

      const vc = new Map()
      for (const r of sub2) {
        const v = r[key]
        vc.set(v, (vc.get(v) || 0) + 1)
      }
      const top = [...vc.entries()]
        .map(([항목, cnt]) => ({ 항목, 건수: cnt }))
        .sort((a, b) => b.건수 - a.건수 || a.항목.localeCompare(b.항목))
        .slice(0, topN)

      const rowsOut = top.map((t) => ({
        항목: t.항목,
        건수: t.건수,
        '비율(%)': Math.round((t.건수 / total) * 1000) / 10
      }))

      blocks.push({ 플랫폼: platform, '침해 유형': infr, '총 건수': total, rows: rowsOut })
    }

    blocks.sort((a, b) => b['총 건수'] - a['총 건수'] || a['침해 유형'].localeCompare(b['침해 유형']))
    out[platform] = blocks
  }
  return out
}

// ---------------- 비교 테이블 ----------------
function countSeriesAll(rows, key) {
  const m = new Map()
  for (const r of rows) {
    const v = clean(r[key])
    if (!v) continue
    m.set(v, (m.get(v) || 0) + 1)
  }
  return m
}

function buildCompareDf(prevRows, currRows, key) {
  const prev = countSeriesAll(prevRows, key)
  const curr = countSeriesAll(currRows, key)
  const allKeys = new Set([...curr.keys(), ...prev.keys()])
  const rows = [...allKeys].map((k) => {
    const p = prev.get(k) || 0
    const c = curr.get(k) || 0
    const diff = c - p
    const rate = p === 0 ? '' : Math.round((diff / p) * 1000) / 10
    return { 항목: k, 직전달: p, 이번달: c, 증감: diff, '증감률(%)': rate }
  })
  rows.sort((a, b) => b.이번달 - a.이번달 || a.항목.localeCompare(b.항목))
  return rows
}

// ---------------- 이슈 텍스트 자동 생성 ----------------
function cleanItemForKw(s) {
  let v = String(s || '')
  v = v.replace(/\([^)]*\)/g, ' ')
  v = v.replace(/\[[^\]]*\]/g, ' ')
  return v.replace(/\s+/g, ' ').trim()
}

function suggestKeywords(item, maxTokens = 3) {
  const base = cleanItemForKw(item)
  if (!base) return ''
  const base2 = base.replace(/[\/\|\-_,;:]+/g, ' ')
  const stop = new Set(['', '및', '등', 'the', 'a', 'an', 'of', 'for', 'to', 'with'])
  const toks = base2.split(' ').filter((t) => t && !stop.has(t.toLowerCase()))
  if (!toks.length) return base
  return toks.slice(0, maxTokens).join(', ')
}

function makeIssueText(currTop, cmp, topN, label) {
  const lines = []
  if (currTop && currTop.length) {
    const top = currTop.slice(0, topN)
    const pairs = top.map((r) => `${r.항목}(${r['전체 침해 건수']}건)`)
    lines.push(`1. 이번달 Top ${Math.min(topN, pairs.length)} ${label}은 ${pairs.join(', ')} 입니다.`)
    const kwPairs = top.map((r) => `${r.항목}: ${suggestKeywords(r.항목)}`)
    lines.push(`   - (추천) 검색키워드: ${kwPairs.join(' / ')}`)
  } else {
    lines.push(`1. 이번달 Top ${topN} ${label} 데이터를 확인할 수 없습니다.`)
  }

  if (!cmp || !cmp.length) {
    lines.push('2. 전월 대비 증감 비교 데이터를 확인할 수 없습니다.')
    lines.push('3. 눈에 띄는 증가 항목을 확인할 수 없습니다.')
    lines.push('4. 신규 발견 항목을 확인할 수 없습니다.')
    return lines.join('\n')
  }

  // 2) 증가 항목 (증감 > 0 AND 직전달 > 0)
  const inc = cmp
    .filter((r) => r.증감 > 0 && r.직전달 > 0)
    .sort((a, b) => b.증감 - a.증감 || b.이번달 - a.이번달)
  if (inc.length) {
    const top = inc.slice(0, 3)
    lines.push(
      `2. 전월 대비 이번달에 많이 증가한 항목은 ${top
        .map((r) => `${r.항목}(+${r.증감}건)`)
        .join(', ')} 입니다.`
    )
  } else {
    lines.push('2. 전월 대비 유의미한 증가 항목이 없습니다.')
  }

  // 3) 눈에 띄는 증가율 (분모 ≥ 10)
  const rateList = cmp
    .filter((r) => r.증감 > 0 && r.직전달 >= 10 && typeof r['증감률(%)'] === 'number')
    .sort((a, b) => b['증감률(%)'] - a['증감률(%)'] || b.증감 - a.증감)
  if (rateList.length) {
    const r = rateList[0]
    lines.push(
      `3. 이번달에는 전체 ${label} 중 '${r.항목}'이(가) 눈에 띄게 늘었습니다. (증가율 +${r['증감률(%)']}%, +${r.증감}건)`
    )
  } else {
    const alt = cmp.filter((r) => r.증감 > 0).sort((a, b) => b.증감 - a.증감)
    if (alt.length) {
      lines.push(`3. 이번달에는 '${alt[0].항목}' 증가가 두드러집니다. (+${alt[0].증감}건)`)
    } else {
      lines.push(`3. 이번달에 눈에 띄는 증가 ${label}이(가) 없습니다.`)
    }
  }

  // 4) 신규 발견 (0 → >0)
  const newItems = cmp
    .filter((r) => r.직전달 === 0 && r.이번달 > 0)
    .sort((a, b) => b.이번달 - a.이번달 || a.항목.localeCompare(b.항목))
  if (newItems.length) {
    const top = newItems.slice(0, 3)
    lines.push(
      `4. 새롭게 발견된 항목은 ${top
        .map((r) => `${r.항목}(${r.이번달}건)`)
        .join(', ')} 입니다. (전월 0건 → 이번달 발생)`
    )
  } else {
    lines.push('4. 전월 대비 신규 발견 항목이 없습니다.')
  }

  return lines.join('\n')
}

// ---------------- 브랜드명 추출 ----------------
function extractBrandName(rows, fallback) {
  const vals = new Set(rows.map((r) => clean(r.Client)).filter(Boolean))
  if (vals.size === 1) return [...vals][0]
  return fallback || '브랜드'
}

// ---------------- Excel 생성 헬퍼 (exceljs) ----------------
function setHeaderCells(ws, rowIdx, colIdx, headers) {
  ws.getRow(rowIdx).height = HEADER_ROW_HEIGHT
  for (let i = 0; i < headers.length; i++) {
    const cell = ws.getCell(rowIdx, colIdx + i)
    cell.value = headers[i]
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BLUE } }
    cell.font = { color: { argb: 'FFFFFFFF' }, bold: true }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = THIN_BORDER
  }
}

function centerWrap(ws, startRow, endRow, startCol, endCol) {
  for (let r = startRow; r <= endRow; r++) {
    for (let c = startCol; c <= endCol; c++) {
      const cell = ws.getCell(r, c)
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    }
  }
}

function applyGridBorder(ws, startRow, endRow, startCol, endCol) {
  for (let r = startRow; r <= endRow; r++) {
    for (let c = startCol; c <= endCol; c++) {
      ws.getCell(r, c).border = THIN_BORDER
    }
  }
}

function applyFill(ws, startRow, endRow, startCol, endCol, argb) {
  for (let r = startRow; r <= endRow; r++) {
    for (let c = startCol; c <= endCol; c++) {
      ws.getCell(r, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }
    }
  }
}

function writeTitle(ws, row, col, title, spanCols) {
  const cell = ws.getCell(row, col)
  cell.value = title
  cell.font = { bold: true }
  cell.alignment = { horizontal: 'left', vertical: 'middle' }
  if (spanCols > 1) {
    ws.mergeCells(row, col, row, col + spanCols - 1)
  }
  ws.getRow(row).height = HEADER_ROW_HEIGHT
  // autosize 가 inflate 못 하도록 제목 행을 추적
  if (!titleRowsByWs.has(ws)) titleRowsByWs.set(ws, new Set())
  titleRowsByWs.get(ws).add(row)
}

function writeTable(ws, startRow, startCol, title, data, headers, colWidths, opts = {}) {
  const ncols = headers.length
  writeTitle(ws, startRow, startCol, title, ncols)
  const hdrRow = startRow + 1
  setHeaderCells(ws, hdrRow, startCol, headers)

  let cur = hdrRow + 1
  for (const r of data) {
    ws.getCell(cur, startCol + 0).value = r.항목
    ws.getCell(cur, startCol + 1).value = Number(r['전체 침해 건수'])
    if (opts.addKeywordCol) {
      ws.getCell(cur, startCol + 2).value = ''
    }
    if (opts.addNoteCol) {
      ws.getCell(cur, startCol + (opts.addKeywordCol ? 3 : 2)).value = ''
    }
    cur++
  }
  const endRow = cur - 1
  applyGridBorder(ws, hdrRow, endRow, startCol, startCol + ncols - 1)
  centerWrap(ws, hdrRow, endRow, startCol, startCol + ncols - 1)

  for (let i = 0; i < colWidths.length; i++) {
    ws.getColumn(startCol + i).width = colWidths[i]
  }
  return endRow
}

function padTable(ws, startCol, hdrRow, curEndRow, targetEndRow, ncols) {
  if (curEndRow >= targetEndRow) return
  for (let r = curEndRow + 1; r <= targetEndRow; r++) {
    for (let i = 0; i < ncols; i++) {
      const cell = ws.getCell(r, startCol + i)
      cell.value = ''
      cell.border = THIN_BORDER
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    }
  }
}

function writeCompareBlock(ws, startRow, startCol, title, data, colWidths) {
  const headers = ['항목', '직전달', '이번달', '증감', '증감률(%)']
  const ncols = headers.length
  writeTitle(ws, startRow, startCol, title, ncols)
  const hdrRow = startRow + 1
  setHeaderCells(ws, hdrRow, startCol, headers)

  let cur = hdrRow + 1
  for (const r of data) {
    ws.getCell(cur, startCol + 0).value = r.항목
    ws.getCell(cur, startCol + 1).value = Number(r.직전달)
    ws.getCell(cur, startCol + 2).value = Number(r.이번달)
    ws.getCell(cur, startCol + 3).value = Number(r.증감)
    ws.getCell(cur, startCol + 4).value = r['증감률(%)']
    cur++
  }
  const endRow = cur - 1
  applyGridBorder(ws, hdrRow, endRow, startCol, startCol + ncols - 1)
  centerWrap(ws, hdrRow, endRow, startCol, startCol + ncols - 1)
  for (let i = 0; i < colWidths.length; i++) {
    ws.getColumn(startCol + i).width = colWidths[i]
  }
  return endRow
}

function writeIssueBox(ws, startRow, startCol, title, widthCols) {
  const left = startCol
  const right = startCol + widthCols - 1

  // 헤더 행
  ws.mergeCells(startRow, left, startRow, right)
  const hdr = ws.getCell(startRow, left)
  hdr.value = title
  hdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BLUE } }
  hdr.font = { color: { argb: 'FFFFFFFF' }, bold: true }
  hdr.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  ws.getRow(startRow).height = HEADER_ROW_HEIGHT
  for (let c = left; c <= right; c++) ws.getCell(startRow, c).border = THIN_BORDER

  // 내용 행 (병합)
  const contentRow = startRow + 1
  for (let c = left; c <= right; c++) {
    const cell = ws.getCell(contentRow, c)
    cell.border = THIN_BORDER
    cell.alignment = { horizontal: 'left', vertical: 'top', wrapText: true }
  }
  ws.mergeCells(contentRow, left, contentRow, right)
  ws.getCell(contentRow, left).value = ''
  ws.getCell(contentRow, left).alignment = { horizontal: 'left', vertical: 'top', wrapText: true }
  return contentRow
}

function buildInfrColorMap(blocksByPlatform) {
  const names = []
  for (const blocks of Object.values(blocksByPlatform)) {
    for (const blk of blocks) {
      const n = String(blk['침해 유형'] || '')
      if (n && !names.includes(n)) names.push(n)
    }
  }
  const map = {}
  let pi = 0
  for (const n of names) {
    if (FIXED_INFR_COLOR[n]) {
      map[n] = FIXED_INFR_COLOR[n]
    } else {
      map[n] = INFR_PALETTE[pi % INFR_PALETTE.length]
      pi++
    }
  }
  return map
}

function autosizeRows(ws, startRow, endRow, endCol) {
  const titleRows = titleRowsByWs.get(ws) || new Set()
  // 병합된 구간의 primary 가 아닌 셀을 파악하기 위해 merge 정보 수집
  const mergeRanges = []
  try {
    // ExcelJS 버전 따라 _merges 또는 model.merges 가 있음
    const merges = ws.model?.merges || ws._merges || []
    for (const m of merges) {
      // m 은 "A1:C1" 같은 문자열
      if (typeof m === 'string') {
        const match = m.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/)
        if (match) {
          const [, c1s, r1s, c2s, r2s] = match
          mergeRanges.push({
            row1: Number(r1s),
            row2: Number(r2s),
            col1: colLetterToNum(c1s),
            col2: colLetterToNum(c2s)
          })
        }
      }
    }
  } catch {
    // merge 정보 실패해도 치명적이지 않음
  }

  function isMergedSecondary(r, c) {
    for (const m of mergeRanges) {
      if (r >= m.row1 && r <= m.row2 && c >= m.col1 && c <= m.col2) {
        // primary (row1, col1) 가 아니면 secondary
        if (!(r === m.row1 && c === m.col1)) return true
      }
    }
    return false
  }

  for (let r = startRow; r <= endRow; r++) {
    // 제목 행은 고정 높이 유지 (autosize 건너뜀)
    if (titleRows.has(r)) continue

    let maxLines = 1
    for (let c = 1; c <= endCol; c++) {
      if (isMergedSecondary(r, c)) continue  // 병합의 secondary cell 건너뜀
      const cell = ws.getCell(r, c)
      const text = cell.value == null ? '' : String(cell.value)
      if (!text) continue
      const width = ws.getColumn(c).width || 12
      const charsPerLine = Math.max(5, Math.floor(width) - 2)
      const softLines = Math.ceil(text.length / charsPerLine)
      const explicitLines = (text.match(/\n/g) || []).length + 1
      maxLines = Math.max(maxLines, softLines, explicitLines)
    }
    const current = ws.getRow(r).height
    const base = current === HEADER_ROW_HEIGHT ? HEADER_ROW_HEIGHT : BASE_DATA_ROW_HEIGHT
    ws.getRow(r).height = Math.max(base, BASE_DATA_ROW_HEIGHT * maxLines)
  }
}

function colLetterToNum(letters) {
  let n = 0
  for (const ch of letters) {
    n = n * 26 + (ch.charCodeAt(0) - 64)
  }
  return n
}

/**
 * 모든 셀의 세로 정렬을 'center' 로 강제.
 * 단, vertical:'top' 으로 명시된 셀(이슈 박스 등)은 유지.
 * ExcelJS 가 기본 'bottom' 으로 내는 걸 막기 위한 최종 패스.
 */
function forceCenterAlignment(ws) {
  // includeEmpty: true 로 모든 존재하는 셀 순회 (padTable 로 생긴 스타일만 있는 셀 포함)
  ws.eachRow({ includeEmpty: true }, (row) => {
    row.eachCell({ includeEmpty: true }, (cell) => {
      const existing = cell.alignment || {}
      // 이미 top 으로 명시된 셀은 건드리지 않음
      if (existing.vertical === 'top') return
      cell.alignment = {
        horizontal: existing.horizontal || 'center',
        vertical: 'middle',
        wrapText: existing.wrapText !== false
      }
    })
  })
  // 기본 style 수준에도 설정 (ExcelJS 가 styles.xml 기본값을 bottom 으로 내보내는 대비)
  ws.properties = {
    ...(ws.properties || {}),
    defaultRowHeight: 15
  }
}

// ---------------- Workbook 생성 ----------------
export async function buildReportWorkbook(prev, curr, opt) {
  const { rows: prevRows } = prev
  const { rows: currRows, hasBusinessDivision } = curr

  const useDivision = useDivisionMode(currRows, hasBusinessDivision)
  const prevSummary = buildSummaryTables(prevRows, useDivision)
  const currSummary = buildSummaryTables(currRows, useDivision)
  const currBlocks = buildPlatformBlocks(currRows, opt.topN, useDivision)

  const wb = new ExcelJS.Workbook()
  wb.creator = 'MYRIAD Team Hub'
  wb.created = new Date()

  const ws0 = wb.addWorksheet('요약')

  const L = 2   // B
  const R = 8   // H
  const prevMonthStr = prevMonth(opt.reportMonth)
  const currMonthStr = opt.reportMonth

  let curStart = 1

  // 1) 플랫폼별
  let lEnd = writeTable(
    ws0, curStart, L, `${prevMonthStr} 플랫폼별 전체 침해 건수`,
    prevSummary.플랫폼, ['항목', '전체 침해 건수', '비고'], [25, 14, 18], { addNoteCol: true }
  )
  let rEnd = writeTable(
    ws0, curStart, R, `${currMonthStr} 플랫폼별 전체 침해 건수`,
    currSummary.플랫폼, ['항목', '전체 침해 건수', '비고'], [25, 14, 18], { addNoteCol: true }
  )
  let pairEnd = Math.max(lEnd, rEnd)
  padTable(ws0, L, curStart + 1, lEnd, pairEnd, 3)
  padTable(ws0, R, curStart + 1, rEnd, pairEnd, 3)
  curStart = pairEnd + 2

  // 2) 침해유형별
  lEnd = writeTable(
    ws0, curStart, L, `${prevMonthStr} 침해 유형별 전체 침해 건수`,
    prevSummary.침해유형, ['항목', '전체 침해 건수', '비고'], [25, 14, 18], { addNoteCol: true }
  )
  rEnd = writeTable(
    ws0, curStart, R, `${currMonthStr} 침해 유형별 전체 침해 건수`,
    currSummary.침해유형, ['항목', '전체 침해 건수', '비고'], [25, 14, 18], { addNoteCol: true }
  )
  pairEnd = Math.max(lEnd, rEnd)
  padTable(ws0, L, curStart + 1, lEnd, pairEnd, 3)
  padTable(ws0, R, curStart + 1, rEnd, pairEnd, 3)
  curStart = pairEnd + 2

  // 3) 상품유형/사업부별 (키워드 포함)
  lEnd = writeTable(
    ws0, curStart, L, `${prevMonthStr} ${prevSummary.세번째_제목}`,
    prevSummary.세번째, ['항목', '전체 침해 건수', '키워드'], [25, 14, 18], { addKeywordCol: true }
  )
  rEnd = writeTable(
    ws0, curStart, R, `${currMonthStr} ${currSummary.세번째_제목}`,
    currSummary.세번째, ['항목', '전체 침해 건수', '키워드'], [25, 14, 18], { addKeywordCol: true }
  )
  pairEnd = Math.max(lEnd, rEnd)
  padTable(ws0, L, curStart + 1, lEnd, pairEnd, 3)
  padTable(ws0, R, curStart + 1, rEnd, pairEnd, 3)
  const topEnd = pairEnd

  // 증감 비교 블록
  const bottomStart = topEnd + 2
  const cmp1 = buildCompareDf(prevRows, currRows, '플랫폼(표시)')
  const cmp2 = buildCompareDf(prevRows, currRows, '침해유형(표시)')
  const cmp3Key = useDivision ? '사업부(정규화)' : '상품유형(정규화)'
  const cmp3Title = useDivision ? '사업부 증감 비교(전체)' : '상품 유형 증감 비교(전체)'
  const cmp3 = buildCompareDf(prevRows, currRows, cmp3Key)

  const c1End = writeCompareBlock(ws0, bottomStart, L, '플랫폼 증감 비교(전체)', cmp1, [25, 10, 10, 10, 12])
  const c2End = writeCompareBlock(ws0, c1End + 2, L, '침해 유형 증감 비교(전체)', cmp2, [25, 10, 10, 10, 12])
  const c3End = writeCompareBlock(ws0, c2End + 2, L, cmp3Title, cmp3, [25, 10, 10, 10, 12])

  const compareBottom = Math.max(c1End, c2End, c3End)
  const issueStart = compareBottom + 2

  const issueLabel = useDivision ? '사업부' : '상품'
  let issueText = ''
  try {
    issueText = makeIssueText(currSummary.세번째, cmp3, opt.topN, issueLabel)
  } catch (e) {
    issueText = `이슈 자동 생성 중 오류가 발생했습니다: ${e.message}`
  }

  writeIssueBox(ws0, issueStart, L, '이슈 사항', 5)
  const issueTopRow = issueStart + 1
  ws0.getCell(issueTopRow, L).value = '\n' + issueText
  ws0.getCell(issueTopRow, L).alignment = { horizontal: 'left', vertical: 'top', wrapText: true }

  // 열 너비 고정
  ws0.getColumn(1).width = 1.5   // A
  ws0.getColumn(2).width = 25    // B
  ws0.getColumn(3).width = 14    // C
  ws0.getColumn(4).width = 18    // D
  ws0.getColumn(5).width = 12    // E
  ws0.getColumn(6).width = 12    // F
  ws0.getColumn(7).width = 2     // G
  ws0.getColumn(8).width = 25    // H
  ws0.getColumn(9).width = 14    // I
  ws0.getColumn(10).width = 18   // J

  centerWrap(ws0, 1, ws0.rowCount, 1, 10)
  autosizeRows(ws0, 1, ws0.rowCount, 10)
  // 이슈 셀은 왼쪽 상단 정렬 유지
  ws0.getCell(issueTopRow, L).alignment = { horizontal: 'left', vertical: 'top', wrapText: true }
  // 전체 셀 vertical 강제 center (이슈 박스처럼 top 으로 명시된 건 유지)
  forceCenterAlignment(ws0)

  // ---- 상세 시트 ----
  const detailHeaders = useDivision
    ? ['플랫폼', '침해 유형', '총 건수', '사업부', '사업부 건수', '비율(%)']
    : ['플랫폼', '침해 유형', '총 건수', '상품 유형', '유형 건수', '비율(%)']
  const sheetPrefix = useDivision ? '사업부' : '모델유형'
  const ncols = detailHeaders.length
  const infrColor = buildInfrColorMap(currBlocks)

  for (const [platform, blocks] of Object.entries(currBlocks)) {
    const ws = wb.addWorksheet(safeSheetName(`${sheetPrefix}_${platform}`))
    setHeaderCells(ws, 1, 1, detailHeaders)
    ws.views = [{ state: 'frozen', ySplit: 1 }]
    ws.getColumn(2).width = 13

    let curRow = 2
    for (const blk of blocks) {
      const blockRows = blk.rows || []
      if (!blockRows.length) continue
      const start = curRow
      for (const r of blockRows) {
        ws.getCell(curRow, 1).value = blk.플랫폼
        ws.getCell(curRow, 2).value = blk['침해 유형']
        ws.getCell(curRow, 3).value = Number(blk['총 건수'])
        ws.getCell(curRow, 4).value = r.항목
        ws.getCell(curRow, 5).value = Number(r.건수)
        ws.getCell(curRow, 6).value = Number(r['비율(%)'])
        curRow++
      }
      const end = curRow - 1
      const fillColor = infrColor[String(blk['침해 유형'])] || INFR_PALETTE[0]
      applyFill(ws, start, end, 1, ncols, fillColor)
      applyGridBorder(ws, start, end, 1, ncols)
      if (end > start) {
        ws.mergeCells(start, 1, end, 1)
        ws.mergeCells(start, 2, end, 2)
        ws.mergeCells(start, 3, end, 3)
      }
    }
    applyGridBorder(ws, 1, Math.max(1, ws.rowCount), 1, ncols)
    centerWrap(ws, 1, ws.rowCount, 1, ncols)
    autosizeRows(ws, 1, ws.rowCount, ncols)
    forceCenterAlignment(ws)
  }

  return { workbook: wb, useDivision, prevSummary, currSummary }
}

// ---------------- 고수준 래퍼 ----------------
export async function generateReport(prevFile, currFile, opt) {
  const prev = await parseExcelFile(prevFile)
  const curr = await parseExcelFile(currFile)
  const brand = extractBrandName(curr.rows, currFile.name?.replace(/\.xlsx?$/i, '') || '브랜드')
  const { workbook, useDivision } = await buildReportWorkbook(prev, curr, opt)

  const buffer = await workbook.xlsx.writeBuffer()
  const safeBrand = brand.replace(/[\\/:*?"<>|]+/g, '_').trim() || '브랜드'
  const fileName = `${safeBrand}_월간동향_${opt.reportMonth}_Top${opt.topN}.xlsx`
  return { buffer, fileName, brand, useDivision }
}
