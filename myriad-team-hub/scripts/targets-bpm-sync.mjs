#!/usr/bin/env node
/**
 * 재침해자 타겟 보드 — BPM 실데이터 주간 동기화 (PC 실행용).
 *
 *   node scripts/targets-bpm-sync.mjs                 BPM 수집 → 점수 계산 → 허브 반영
 *   node scripts/targets-bpm-sync.mjs --dry-run       수집 + 점수 계산만 (허브 반영 안 함)
 *   node scripts/targets-bpm-sync.mjs --clients 몽클   BPM 고객사 이름/ID 검색 (대상 브랜드 설정용)
 *   node scripts/targets-bpm-sync.mjs --from-file x.json [--dry-run]
 *                                                     API 대신 리스팅 JSON 파일로 실행 (테스트용)
 *
 * 왜 Cloudflare 함수가 아니라 PC 스크립트인가:
 *   enforcement/listings API 는 브랜드(clientId)별 · 500건 단위 호출 → 수백 번 호출이 필요.
 *   Cloudflare 무료 플랜 함수 1회 한도(외부 호출 50개, CPU 10ms)로는 불가. API 키도 공개 레포/브라우저에 두지 않는다.
 *
 * 설정:
 *   admin-scripts/.env              BPM_SECRET_KEY, BPM_PUBLIC_API_KEY, SUPABASE_SERVICE_ROLE_KEY
 *                                   (선택) BPM_BASE_URL, SUPABASE_URL
 *   admin-scripts/targets_brands.json  대상 브랜드 목록 + 보고 주기
 *
 * 점수 계산·반영은 functions/api/_lib 의 scoreEngine / targetsSyncCore 를 그대로 import (웹 함수와 동일 코드).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { listingsToInfringers } from '../functions/api/_lib/bpmListings.js'
import { scoreInfringers } from '../functions/api/_lib/scoreEngine.js'
import { syncTargets, recordRun } from '../functions/api/_lib/targetsSyncCore.js'

const HUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ADMIN = path.resolve(HUB, '..', 'admin-scripts')

// 보고 주기 → 파이프라인 점유율 창(개월). 미지정 브랜드는 엔진 기본(6개월).
const CADENCE_MONTHS = { daily: 2, weekly: 3, monthly: 6, quarterly: 12 }

// ── 인자 ──────────────────────────────────────────────
const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const valueOf = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null }
const DRY = has('--dry-run')

// ── 설정 로드 ─────────────────────────────────────────
function loadEnvFile(p) {
  const out = {}
  if (!fs.existsSync(p)) return out
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}
const env = { ...loadEnvFile(path.join(HUB, '.env.local')), ...loadEnvFile(path.join(ADMIN, '.env')), ...process.env }
const BPM_BASE = (env.BPM_BASE_URL || 'https://bpm-admin.myriadip.com').replace(/\/+$/, '')
const SUPABASE_URL = env.SUPABASE_URL || env.VITE_SUPABASE_URL

function need(key, why) {
  if (env[key]) return env[key]
  fail(`admin-scripts\\.env 에 ${key} 가 없습니다 — ${why}`)
}
function fail(msg) {
  console.error(`\n[오류] ${msg}\n`)
  process.exit(1)
}

// ── BPM API 호출 ──────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function bpm(pathname, body, { headerKey = true } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (headerKey) headers['X-PUBLIC-API-KEY'] = need('BPM_PUBLIC_API_KEY', '개발팀에 외부 API용 public.api.key 값을 요청하세요')
  const payload = JSON.stringify({ secretKey: need('BPM_SECRET_KEY', 'OMS 사용자 ID'), ...body })
  const waits = [5000, 15000, 30000]
  for (let attempt = 0; ; attempt++) {
    let res, json
    try {
      res = await fetch(BPM_BASE + pathname, { method: 'POST', headers, body: payload })
      json = await res.json().catch(() => null)
    } catch (e) {
      if (attempt < waits.length) { console.log(`  · 네트워크 오류, ${waits[attempt] / 1000}초 후 재시도 (${e.message})`); await sleep(waits[attempt]); continue }
      throw new Error(`BPM 접속 실패: ${e.message}`)
    }
    const code = json?.code
    if (code === 'OK') return json.data
    // 조회 시간 초과(E2050) / 서버 오류는 재시도
    const retryable = code === 'E2050' || res.status >= 500
    if (retryable && attempt < waits.length) {
      console.log(`  · ${code || res.status} 응답, ${waits[attempt] / 1000}초 후 재시도`)
      await sleep(waits[attempt]); continue
    }
    const hint = res.status === 401 && /E20\d\d/.test(code || '') ? ' (X-PUBLIC-API-KEY 값 확인)'
      : code === 'E1003' ? ' (BPM_SECRET_KEY = 활성 OMS 사용자 ID 인지 확인)'
      : code === 'COM.ERR_9000' ? ' (BPM 서버 내부 오류 — 개발팀 문의 필요)' : ''
    throw new Error(`BPM ${pathname} 실패: ${code || res.status} ${json?.message || ''}${hint}`)
  }
}

async function fetchAllClients() {
  const all = []
  for (let page = 1; ; page++) {
    // client/list 는 기존 연동 호환 때문에 헤더 키 없이 secretKey 만으로 동작
    const d = await bpm('/oms/ext/api/client/list', { page, pageSize: 500 }, { headerKey: false })
    all.push(...(d.items || []))
    if (!d.items || d.items.length < 500 || all.length >= (d.total || 0)) return all
  }
}

async function fetchListings(clientId, fromDate, toDate) {
  const out = []
  for (let page = 1; ; page++) {
    const d = await bpm('/oms/ext/api/enforcement/listings', {
      clientId, fromDate, toDate, dateBasis: 'any', page, pageSize: 500,
    })
    out.push(...(d.items || []))
    process.stdout.write(`\r  · ${out.length}${d.total != null ? ' / ' + d.total : ''}건`)
    if (!d.items || d.items.length < 500 || (d.total != null && out.length >= d.total)) break
    await sleep(300)
  }
  process.stdout.write('\n')
  return out
}

// ── 대상 브랜드 해석 ──────────────────────────────────
function loadBrandConfig() {
  const p = path.join(ADMIN, 'targets_brands.json')
  if (!fs.existsSync(p)) fail(`설정 파일이 없습니다: ${p}`)
  const cfg = JSON.parse(fs.readFileSync(p, 'utf8'))
  if (!Array.isArray(cfg.brands) || !cfg.brands.length) fail('targets_brands.json 의 brands 가 비어 있습니다')
  return cfg
}

function resolveBrands(cfg, clients) {
  const norm = (s) => String(s || '').trim().toLowerCase()
  return cfg.brands.map((b) => {
    if (b.clientId) {
      const c = clients.find((x) => x.id === b.clientId)
      return { clientId: b.clientId, name: c?.name || b.name || b.clientId, cadence: b.cadence }
    }
    const exact = clients.filter((c) => norm(c.name) === norm(b.name) || norm(c.abbr) === norm(b.name))
    if (exact.length === 1) return { clientId: exact[0].id, name: exact[0].name, cadence: b.cadence }
    const near = clients.filter((c) => norm(c.name).includes(norm(b.name)))
    const list = (exact.length ? exact : near).slice(0, 10).map((c) => `    ${c.id}  ${c.name}`).join('\n')
    fail(`브랜드 "${b.name}" 를 하나로 특정할 수 없습니다 (${exact.length ? '동명 ' + exact.length + '곳' : '정확히 일치 없음'}).\n`
      + (list ? `  후보 — targets_brands.json 에 "clientId" 로 지정하세요:\n${list}` : '  --clients 로 이름을 검색해 보세요.'))
  })
}

// ── 실행 ─────────────────────────────────────────────
async function main() {
  if (has('--clients')) {
    const q = String(valueOf('--clients') || '').toLowerCase()
    const clients = await fetchAllClients()
    const hit = clients.filter((c) => !q || `${c.name} ${c.abbr || ''} ${c.holdingClient?.name || ''}`.toLowerCase().includes(q))
    console.log(`\nBPM 고객사 ${clients.length}곳 중 ${hit.length}곳 일치\n`)
    for (const c of hit.slice(0, 50)) console.log(`  ${c.id}  ${c.name}${c.abbr ? ' (' + c.abbr + ')' : ''}${c.holdingClient?.name ? '  · 홀딩: ' + c.holdingClient.name : ''}`)
    if (hit.length > 50) console.log(`  … 외 ${hit.length - 50}곳 (검색어를 좁혀 주세요)`)
    return
  }

  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10) // KST 기준일
  const cfg = loadBrandConfig()
  const months = Number(cfg.months) || 24
  const from = new Date(today); from.setMonth(from.getMonth() - months)
  const fromDate = from.toISOString().slice(0, 10)

  let listings = [], brands
  const file = valueOf('--from-file')
  if (file) {
    listings = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'))
    if (!Array.isArray(listings)) listings = listings.items || listings.data?.items || []
    const ids = [...new Set(listings.map((l) => l.clientId))]
    brands = ids.map((id) => ({ clientId: id, name: listings.find((l) => l.clientId === id)?.brand || id,
      cadence: cfg.brands.find((b) => b.clientId === id)?.cadence }))
    console.log(`\n파일에서 리스팅 ${listings.length}건 로드 (${file})`)
  } else {
    console.log(`\nBPM 고객사 목록 조회…`)
    brands = resolveBrands(cfg, await fetchAllClients())
    console.log(`대상 브랜드 ${brands.length}곳 · 기간 ${fromDate} ~ ${today} (${months}개월)\n`)
    for (const b of brands) {
      console.log(`▶ ${b.name} (${b.clientId})`)
      const items = await fetchListings(b.clientId, fromDate, today)
      b.listings = items.length
      listings.push(...items)
    }
  }

  const { rows, dayHist, brandLabels, stats: conv } = listingsToInfringers(listings)
  console.log(`\n리스팅 ${conv.listings}건 → 판매자 ${conv.rows}행 (공식 판매처 제외 ${conv.official} · 판매자 정보 없음 ${conv.noSeller})`)
  if (!rows.length) fail('점수를 매길 판매자가 없습니다 — 기간/브랜드 설정을 확인하세요')

  const cadence = Object.fromEntries(brands.filter((b) => b.cadence).map((b) => [b.clientId, b.cadence]))
  for (const [id, c] of Object.entries(cadence)) if (!CADENCE_MONTHS[c]) fail(`보고 주기 "${c}" 는 daily/weekly/monthly/quarterly 중 하나여야 합니다 (${id})`)
  const scoreOpts = {
    rows, dayHist, today,
    brandName: (id) => brandLabels[id] || brands.find((b) => b.clientId === id)?.name || id,
    brandWindowMonths: (id) => CADENCE_MONTHS[cadence[id]] || null,
  }

  if (DRY) {
    const { operators, stats, cuts } = scoreInfringers(rows, { refDate: today, ...scoreOpts })
    console.log(`\n[미리보기 — 허브 반영 안 함]`)
    console.log(`운영자 ${stats.clusters}명 · 등급 ${JSON.stringify(stats.counts)} · 교차브랜드 ${stats.cross_brand} · 주력공급원 ${stats.pipeline}`)
    console.log(`컷: 법적가치 ${cuts.enf_hi} / 생산성 ${cuts.yield_hi}\n`)
    const top = operators.filter((o) => o.grade === 'A' || o.grade === 'B')
      .sort((a, b) => b.enf_score - a.enf_score).slice(0, 15)
    for (const o of top) {
      console.log(`  ${o.grade}  법적 ${String(o.enf_score).padStart(5)}  생산성 ${String(o.yield_score).padStart(5)}  삭제 ${String(o.deleted_sum).padStart(5)}  ${o.rep_store}  [${o.brands.join(', ')} · ${o.platforms}]`)
    }
    return
  }

  const admin = createClient(
    SUPABASE_URL || fail('Supabase URL 을 찾을 수 없습니다 (myriad-team-hub/.env.local 의 VITE_SUPABASE_URL)'),
    need('SUPABASE_SERVICE_ROLE_KEY', 'Supabase service role 키'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  console.log(`\n허브 반영 중…`)
  const result = await syncTargets(admin, { ...scoreOpts, source: 'bpm' })
  const logged = await recordRun(admin, {
    source: 'bpm',
    brands: brands.map((b) => ({ clientId: b.clientId, name: b.name, listings: b.listings ?? null })),
    stats: { ...result.stats, cuts: result.cuts, conversion: conv, months },
  })
  console.log(`완료 — 운영자 ${result.stats.clusters}명 · 등급 ${JSON.stringify(result.stats.counts)} · 정리 ${result.removed}명`)
  if (!logged) console.log('⚠ 실행 기록 저장 실패 — Supabase 에 039_targets_sync_runs.sql 이 실행됐는지 확인하세요')
}

main().catch((e) => fail(e.message))
