/**
 * 화이트리스트 셀러 — CRUD + 엑셀 업로드/컬럼 매핑.
 *
 * 읽기는 팀 전원, 쓰기는 관리자 (RLS: mig 035).
 *
 * 이 파일의 핵심은 "고객사마다 다른 엑셀 양식을 흡수하는" 파서다.
 * 컬럼명을 하드코딩하지 않고:
 *   1) 헤더 행을 자동 탐색 (제목/빈 행이 위에 있는 파일 대응)
 *   2) 컬럼명을 보고 store_name / aliases / urls 후보를 추측 (guessMapping)
 *   3) 사용자가 확인/수정한 매핑을 header_signature 와 함께 프리셋으로 저장
 *   4) 다음에 같은 양식이 오면 signature 로 자동 적용
 */
import ExcelJS from 'exceljs'
import { supabase } from './supabase'

// ───── 고객사 ─────────────────────────────────

export async function listClients() {
  const { data, error } = await supabase
    .from('whitelist_clients')
    .select('*')
    .order('name', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function createClient(name, note, userId) {
  const { data, error } = await supabase
    .from('whitelist_clients')
    .insert({ name: name.trim(), note: note?.trim() || null, created_by: userId })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateClient(id, patch) {
  const { error } = await supabase.from('whitelist_clients').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteClient(id) {
  // cascade 로 셀러/프리셋도 함께 삭제됨 (mig 035 on delete cascade)
  const { error } = await supabase.from('whitelist_clients').delete().eq('id', id)
  if (error) throw error
}

// ───── 셀러 엔트리 ─────────────────────────────

/** 고객사별 엔트리 목록. clientId 없으면 전체. */
export async function listSellers(clientId = null) {
  let q = supabase
    .from('whitelist_sellers')
    .select('*')
    .order('store_name', { ascending: true })
  if (clientId) q = q.eq('client_id', clientId)
  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

export async function countSellersByClient() {
  // 고객사 카드에 "N개 등록" 표시용. 행 수만 필요해서 client_id 만 select.
  const { data, error } = await supabase
    .from('whitelist_sellers')
    .select('client_id, is_active')
  if (error) throw error
  const map = {}
  for (const r of data ?? []) {
    if (!map[r.client_id]) map[r.client_id] = { total: 0, active: 0 }
    map[r.client_id].total += 1
    if (r.is_active) map[r.client_id].active += 1
  }
  return map
}

function normalizeSellerPayload(p) {
  return {
    store_name: (p.store_name || '').trim(),
    aliases: cleanArray(p.aliases),
    urls: cleanArray(p.urls),
    amazon_seller_name: p.amazon_seller_name?.trim() || null,
    amazon_seller_id: p.amazon_seller_id?.trim() || null,
    region: p.region?.trim() || null,
    channel: p.channel?.trim() || null,
    note: p.note?.trim() || null,
    is_active: p.is_active !== false
  }
}

export async function createSeller(clientId, payload, userId) {
  const row = {
    ...normalizeSellerPayload(payload),
    client_id: clientId,
    source_file: payload.source_file || null,
    created_by: userId
  }
  const { data, error } = await supabase
    .from('whitelist_sellers')
    .insert(row)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateSeller(id, payload) {
  const { error } = await supabase
    .from('whitelist_sellers')
    .update(normalizeSellerPayload(payload))
    .eq('id', id)
  if (error) throw error
}

export async function deleteSeller(id) {
  const { error } = await supabase.from('whitelist_sellers').delete().eq('id', id)
  if (error) throw error
}

/** 고객사 엔트리 전체 삭제 — 재업로드 전 초기화용 */
export async function deleteSellersByClient(clientId) {
  const { error } = await supabase.from('whitelist_sellers').delete().eq('client_id', clientId)
  if (error) throw error
}

/**
 * 엑셀 파싱 결과를 일괄 등록.
 * (client_id, lower(store_name)) unique index 라 같은 가게명은 덮어씀(upsert).
 * → 재업로드 시 중복 폭증 없이 갱신됨.
 *
 * ⚠️ upsert 의 onConflict 에 표현식 인덱스(lower(store_name))는 쓸 수 없어서,
 *    기존 행을 먼저 읽어 이름으로 매칭해 insert/update 를 나눈다.
 */
export async function bulkUpsertSellers(clientId, rows, userId, sourceFile, onProgress) {
  const existing = await listSellers(clientId)
  const byName = new Map(existing.map((e) => [e.store_name.trim().toLowerCase(), e]))

  const toInsert = []
  const toUpdate = []
  for (const r of rows) {
    const key = (r.store_name || '').trim().toLowerCase()
    if (!key) continue
    const hit = byName.get(key)
    if (hit) {
      // 기존 행 갱신 — 배열은 합집합으로 병합해서 기존에 쌓인 별칭/URL 을 잃지 않음.
      toUpdate.push({
        id: hit.id,
        payload: {
          ...r,
          aliases: unionArray(hit.aliases, r.aliases),
          urls: unionArray(hit.urls, r.urls),
          // 수동으로 확인해둔 아마존 정보는 엑셀이 비어있으면 보존 (덮어쓰기 금지)
          amazon_seller_name: r.amazon_seller_name || hit.amazon_seller_name,
          amazon_seller_id: r.amazon_seller_id || hit.amazon_seller_id
        }
      })
    } else {
      toInsert.push({
        ...normalizeSellerPayload(r),
        client_id: clientId,
        source_file: sourceFile || null,
        created_by: userId
      })
    }
  }

  // INSERT — 500행씩 청크 (payload 크기 제한 회피)
  const CHUNK = 500
  let done = 0
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const slice = toInsert.slice(i, i + CHUNK)
    const { error } = await supabase.from('whitelist_sellers').insert(slice)
    if (error) throw error
    done += slice.length
    onProgress?.(done, toInsert.length + toUpdate.length)
  }

  // UPDATE — 행별 (Supabase JS 는 서로 다른 값의 일괄 update 를 지원 안 함)
  for (const u of toUpdate) {
    await updateSeller(u.id, u.payload)
    done += 1
    onProgress?.(done, toInsert.length + toUpdate.length)
  }

  return { inserted: toInsert.length, updated: toUpdate.length }
}

// ───── 엑셀 파싱 ───────────────────────────────

/** ExcelJS 셀 값 → 문자열. rich text / hyperlink / formula 결과 모두 처리. */
function cellText(v) {
  if (v == null) return ''
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('').trim()
    // 하이퍼링크 셀 — 표시 텍스트보다 실제 주소가 유용 (URL 컬럼이 링크로 들어온 경우)
    if (v.hyperlink) return String(v.hyperlink).trim()
    if ('text' in v) return String(v.text).trim()
    if ('result' in v) return cellText(v.result)
  }
  return String(v).trim()
}

/**
 * 시트에서 헤더 행을 자동 탐색.
 * Korea 파일처럼 제목/빈 행이 위에 있는 경우를 흡수하려고, 위에서 15행까지 훑어
 * "채워진 셀이 2개 이상이고 그 아래 행에도 데이터가 있는" 첫 행을 헤더로 본다.
 */
function detectHeaderRow(ws, maxScan = 15) {
  const limit = Math.min(maxScan, ws.rowCount)
  for (let r = 1; r <= limit; r++) {
    const cells = rowTexts(ws, r)
    const filled = cells.filter((c) => c !== '').length
    if (filled < 2) continue
    const next = rowTexts(ws, r + 1)
    if (next.filter((c) => c !== '').length >= 1) return r
  }
  return 1
}

function rowTexts(ws, rowNumber) {
  const row = ws.getRow(rowNumber)
  const out = []
  const colCount = Math.max(ws.columnCount || 0, row.cellCount || 0)
  for (let c = 1; c <= colCount; c++) out.push(cellText(row.getCell(c).value))
  return out
}

/** 헤더명 정규화 — 공백/기호/대소문자 무시하고 비교하기 위한 키 */
function normHeader(h) {
  return String(h || '').toLowerCase().replace(/[\s_\-().*]/g, '')
}

/**
 * 파일 → { sheets: [{ name, headerRow, headers, sampleRows, totalRows }] }
 * 사용자가 시트/헤더행을 고를 수 있도록 원자료를 그대로 넘긴다.
 */
export async function parseWhitelistFile(file) {
  const buffer = await file.arrayBuffer()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)

  const sheets = wb.worksheets.map((ws) => {
    const headerRow = detectHeaderRow(ws)
    const headers = rowTexts(ws, headerRow)
    // 뒤쪽 빈 컬럼 잘라내기
    let last = headers.length
    while (last > 0 && headers[last - 1] === '') last -= 1
    const trimmed = headers.slice(0, last)

    const sampleRows = []
    for (let r = headerRow + 1; r <= Math.min(headerRow + 5, ws.rowCount); r++) {
      sampleRows.push(rowTexts(ws, r).slice(0, last))
    }
    return {
      name: ws.name,
      headerRow,
      headers: trimmed,
      sampleRows,
      totalRows: Math.max(0, ws.rowCount - headerRow)
    }
  })

  return { fileName: file.name, sheets, _wb: wb }
}

/**
 * 사용자가 헤더 행을 직접 바꿨을 때 시트 메타를 다시 계산.
 * (자동 탐색이 틀린 파일 — 예: 부제목이 2행에 또 있는 경우 — 을 수동 교정)
 */
export function rereadSheet(wb, sheetName, headerRow) {
  const ws = wb.getWorksheet(sheetName)
  const headers = rowTexts(ws, headerRow)
  let last = headers.length
  while (last > 0 && headers[last - 1] === '') last -= 1
  const trimmed = headers.slice(0, last)

  const sampleRows = []
  for (let r = headerRow + 1; r <= Math.min(headerRow + 5, ws.rowCount); r++) {
    sampleRows.push(rowTexts(ws, r).slice(0, last))
  }
  return {
    name: sheetName,
    headerRow,
    headers: trimmed,
    sampleRows,
    totalRows: Math.max(0, ws.rowCount - headerRow)
  }
}

/** 헤더 배열 → 지문. 같은 양식 재업로드 자동 감지용. */
export function headerSignature(headers) {
  return headers
    .map(normHeader)
    .filter(Boolean)
    .sort()
    .join('|')
    .slice(0, 500)
}

// 컬럼명 추측 규칙 — 앞쪽이 우선순위 높음.
// 고객사가 새 양식을 줘도 대개 이 단어들 중 하나는 쓰기 때문에 첫 시도에 대부분 맞음.
const GUESS = {
  store_name: ['customer', 'storename', 'store', 'seller', 'sellername', 'shopname',
    'company', 'companyname', 'name', '판매자', '스토어', '상호', '업체', '회사', '가게'],
  urls: ['storeurl', 'url', 'link', 'website', 'homepage', 'shopurl', 'additionalwhitelistedurls',
    '주소', '링크', '사이트'],
  aliases: ['othernameforstore', 'othername', 'alias', 'aka', 'alternatename', 'dba',
    '별칭', '다른이름'],
  amazon_seller_name: ['amazonsellername', 'amazonseller', 'amazonstorefront', 'sellerdisplayname'],
  amazon_seller_id: ['amazonsellerid', 'sellerid', 'merchantid'],
  region: ['region', 'country', 'market', '국가', '지역'],
  channel: ['platform', 'channel', 'type', '플랫폼', '채널', '구분'],
  note: ['note', 'notes', 'remark', 'comment', 'memo', '비고', '메모']
}

/**
 * 헤더 배열 → 초기 매핑 추측.
 * urls / aliases 는 여러 컬럼을 받을 수 있어서 배열, 나머지는 단일 컬럼명.
 * 매칭은 (1) 완전일치 → (2) 부분포함 순. 이미 배정된 컬럼은 재사용 안 함.
 */
export function guessMapping(headers) {
  const used = new Set()
  const norm = headers.map(normHeader)
  const pick = (keys, multi) => {
    const found = []
    // (1) 완전 일치 우선
    for (const k of keys) {
      for (let i = 0; i < norm.length; i++) {
        if (used.has(i) || !norm[i]) continue
        if (norm[i] === k) { found.push(headers[i]); used.add(i); if (!multi) return found[0] }
      }
    }
    // (2) 부분 포함 (짧은 키가 오탐 내는 걸 막으려고 3자 이상만)
    for (const k of keys) {
      if (k.length < 3) continue
      for (let i = 0; i < norm.length; i++) {
        if (used.has(i) || !norm[i]) continue
        if (norm[i].includes(k)) { found.push(headers[i]); used.add(i); if (!multi) return found[0] }
      }
    }
    return multi ? found : null
  }

  // 순서 중요 — 구체적인 것부터 배정해야 'url' 이 'storeurl' 을 가로채지 않음
  const amazon_seller_id = pick(GUESS.amazon_seller_id, false)
  const amazon_seller_name = pick(GUESS.amazon_seller_name, false)
  const aliases = pick(GUESS.aliases, true)
  const urls = pick(GUESS.urls, true)
  const store_name = pick(GUESS.store_name, false)
  const region = pick(GUESS.region, false)
  const channel = pick(GUESS.channel, false)
  const note = pick(GUESS.note, false)

  return { store_name, aliases, urls, amazon_seller_name, amazon_seller_id, region, channel, note }
}

/**
 * 매핑 적용 → DB 등록용 행 배열.
 * store_name 이 빈 행은 건너뜀. urls/aliases 는 쉼표·개행 분리도 지원.
 */
export function applyMapping(sheet, wb, mapping, extra = {}) {
  const ws = wb.getWorksheet(sheet.name)
  const colIndex = {}
  sheet.headers.forEach((h, i) => { if (h) colIndex[h] = i + 1 })

  const get = (row, header) => (header && colIndex[header] ? cellText(row.getCell(colIndex[header]).value) : '')
  const getMulti = (row, headers) => {
    const out = []
    for (const h of headers || []) {
      const v = get(row, h)
      if (v) out.push(...splitMulti(v))
    }
    return out
  }

  const rows = []
  const skipped = []
  for (let r = sheet.headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const store_name = get(row, mapping.store_name)
    const urls = getMulti(row, mapping.urls)
    const aliases = getMulti(row, mapping.aliases)

    if (!store_name) {
      // 이름이 없어도 URL 이 있으면 URL 의 도메인을 이름으로 승격 — 데이터 손실 방지
      if (urls.length) {
        rows.push({
          store_name: domainCore(urls[0]) || urls[0],
          aliases, urls,
          amazon_seller_name: get(row, mapping.amazon_seller_name) || null,
          amazon_seller_id: get(row, mapping.amazon_seller_id) || null,
          region: get(row, mapping.region) || extra.region || null,
          channel: get(row, mapping.channel) || null,
          note: get(row, mapping.note) || null,
          is_active: true
        })
      } else {
        const any = rowTexts(ws, r).some((c) => c !== '')
        if (any) skipped.push(r)
      }
      continue
    }

    rows.push({
      store_name,
      aliases,
      urls,
      amazon_seller_name: get(row, mapping.amazon_seller_name) || null,
      amazon_seller_id: get(row, mapping.amazon_seller_id) || null,
      region: get(row, mapping.region) || extra.region || null,
      channel: get(row, mapping.channel) || null,
      note: get(row, mapping.note) || null,
      is_active: true
    })
  }

  // 같은 파일 안에서 이름 중복 → 병합 (북미 파일처럼 행이 나뉘어 오는 경우)
  const merged = new Map()
  for (const r of rows) {
    const key = r.store_name.trim().toLowerCase()
    if (merged.has(key)) {
      const m = merged.get(key)
      m.aliases = unionArray(m.aliases, r.aliases)
      m.urls = unionArray(m.urls, r.urls)
      m.amazon_seller_name = m.amazon_seller_name || r.amazon_seller_name
      m.amazon_seller_id = m.amazon_seller_id || r.amazon_seller_id
      m.note = m.note || r.note
    } else {
      merged.set(key, { ...r })
    }
  }

  return { rows: [...merged.values()], skippedRows: skipped }
}

// ───── 프리셋 ─────────────────────────────────

export async function listPresets() {
  const { data, error } = await supabase
    .from('whitelist_import_presets')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function savePreset({ clientId, name, headerRow, headers, mapping }, userId) {
  const { data, error } = await supabase
    .from('whitelist_import_presets')
    .insert({
      client_id: clientId,
      name: name.trim(),
      header_row: headerRow,
      header_signature: headerSignature(headers),
      mapping,
      created_by: userId
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deletePreset(id) {
  const { error } = await supabase.from('whitelist_import_presets').delete().eq('id', id)
  if (error) throw error
}

/** 헤더 지문이 일치하는 프리셋 찾기 → 있으면 매핑 자동 적용 */
export function findMatchingPreset(presets, headers) {
  const sig = headerSignature(headers)
  return presets.find((p) => p.header_signature === sig) || null
}

// ───── 확장 토큰 ───────────────────────────────

/**
 * 내 토큰 목록.
 *
 * ⚠️ `user_id` 를 명시적으로 거는 게 중요하다. mig 036 이후 관리자에게는
 *    "전원 조회" RLS 정책이 붙어서, 필터가 없으면 관리자 화면의 "내 토큰" 에
 *    팀원 전원 토큰이 섞여 나온다.
 * ⚠️ token_hash 는 절대 select 하지 않음.
 */
export async function listExtTokens(userId) {
  const { data, error } = await supabase
    .from('whitelist_ext_tokens')
    .select('id, name, created_at, last_used_at, revoked_at')
    .eq('user_id', userId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

/**
 * 관리자 — 팀원 전원 토큰 + 소유자 이름.
 *
 * PostgREST 임베딩(`profiles(...)`)을 안 쓰는 이유: whitelist_ext_tokens.user_id 는
 * auth.users 를 참조하고 profiles 를 직접 참조하지 않아 관계 추론이 안 된다.
 * 팀 규모가 작아서 profiles 를 따로 읽어 붙이는 게 제약 추가보다 안전하다.
 */
export async function listAllExtTokens() {
  const { data, error } = await supabase
    .from('whitelist_ext_tokens')
    .select('id, user_id, name, created_at, last_used_at, revoked_at')
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
  if (error) throw error
  const tokens = data ?? []
  if (!tokens.length) return []

  const { data: profs, error: pErr } = await supabase
    .from('profiles')
    .select('id, email, full_name')
    .in('id', [...new Set(tokens.map((t) => t.user_id))])
  if (pErr) throw pErr

  const byId = new Map((profs ?? []).map((p) => [p.id, p]))
  return tokens.map((t) => {
    const p = byId.get(t.user_id)
    return { ...t, ownerName: p?.full_name || p?.email || '(알 수 없음)', ownerEmail: p?.email || null }
  })
}

/** Cloudflare Function 으로 발급 — plain 토큰은 응답에 1회만 노출됨 */
export async function issueExtToken(name) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('로그인이 필요합니다.')
  const res = await fetch('/api/whitelist-issue-token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`
    },
    body: JSON.stringify({ name })
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || '토큰 발급 실패')
  return json
}

export async function revokeExtToken(id) {
  const { error } = await supabase
    .from('whitelist_ext_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

// ───── 공용 유틸 ───────────────────────────────

function cleanArray(a) {
  if (!a) return []
  const arr = Array.isArray(a) ? a : splitMulti(String(a))
  const seen = new Set()
  const out = []
  for (const v of arr) {
    const t = String(v).trim()
    if (!t) continue
    const k = t.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(t)
  }
  return out
}

function unionArray(a, b) {
  return cleanArray([...(a || []), ...(b || [])])
}

/** 한 셀에 여러 값이 쉼표/개행/세미콜론으로 들어온 경우 분리 */
function splitMulti(s) {
  return String(s).split(/[\n;,]+/).map((x) => x.trim()).filter(Boolean)
}

/** URL → 도메인 코어 (https://www.zonkeytoys.com/ → zonkeytoys) */
export function domainCore(url) {
  if (!url) return ''
  let s = String(url).trim().toLowerCase()
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '')
  s = s.split(/[/?#]/)[0]
  const parts = s.split('.').filter(Boolean)
  if (!parts.length) return ''
  // smartstore.naver.com/babywatch 처럼 플랫폼 도메인이면 경로가 더 식별력 있음
  return parts[0]
}
