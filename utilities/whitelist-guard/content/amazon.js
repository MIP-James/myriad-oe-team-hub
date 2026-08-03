/**
 * 아마존 Report Infringement 페이지 — 화이트리스트 셀러 검사.
 *
 * 동작 순서:
 *   1) 이 페이지가 신고 도구인지 확인 (아니면 아무것도 안 함)
 *   2) "Show offers (n)" 를 자동으로 펼쳐 Sold by 를 DOM 에 올림
 *   3) "Sold by" 헤더가 있는 표에서 셀러 이름을 읽음
 *   4) 화이트리스트와 대조 → 상단 경고 배너 + 해당 행 강조
 *   5) 화이트리스트 셀러의 체크박스를 켜면 즉시 확인 창 (실제 사고 지점 차단)
 *
 * ⚠️ 셀렉터 전략 — 클래스 이름을 절대 쓰지 않는다.
 *   아마존은 내부 클래스를 수시로 바꾸므로 class 기반 셀렉터는 곧 깨진다.
 *   그래서 "Sold by 라는 글자가 있는 헤더 셀" 처럼 사람이 보는 텍스트를 기준으로
 *   찾는다. (네이버 신고 매크로에서 같은 교훈을 얻은 적 있음 — gotcha #42 계열)
 *   그래도 페이지가 바뀌어 못 읽는 경우가 생기므로 팝업에 "진단" 을 넣어
 *   무엇을 찾았는지 그대로 볼 수 있게 했다.
 */
(() => {
  'use strict'

  const NS = 'wlg'                       // 주입 요소 접두어
  const ASIN_RE = /\bB[0-9A-Z]{9}\b/g
  let index = null                       // WLMatcher.buildIndex() 결과
  let clientNames = {}
  let cacheMeta = null
  let lastFindings = []                  // 진단/팝업용
  let lastScan = { checked: 0, offers: [] }  // 마지막 스캔 요약
  let submitConfirmed = false            // 제출 확인을 이미 받았는지
  let observer = null                    // 렌더 중 일시 정지시키려고 참조 보관
  const clickedToggles = new WeakSet()   // 같은 토글을 반복 클릭하지 않도록

  // ── 0. 페이지 판별 ────────────────────────────────────
  /**
   * 신고 도구 페이지인지 확인. URL 만으로 판단하지 않는 이유:
   * 아마존 신고 포털 경로가 마켓플레이스마다 다르고 바뀌기도 해서,
   * 페이지 내용으로 판단하는 게 훨씬 안 깨진다.
   */
  function looksLikeReportPage() {
    const t = document.body?.innerText || ''
    if (/report infringement/i.test(t)) return true
    if (/which products would you like to report/i.test(t)) return true
    if (/notice retraction form/i.test(t)) return true
    // 표 헤더로도 판단 (다국어 포털 대비)
    return !!findSoldByHeaders().length
  }

  // ── 1. Sold by 헤더 찾기 ──────────────────────────────
  function normText(el) {
    return (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase()
  }

  /** 'Sold by' 로 보이는 헤더 셀들 (다국어 일부 포함) */
  function findSoldByHeaders() {
    const LABELS = ['sold by', 'seller', 'sold by:', '판매자', 'verkäufer', 'vendido por', 'vendu par']
    const out = []
    for (const cell of document.querySelectorAll('th, td')) {
      const t = normText(cell)
      if (t.length > 24) continue
      if (LABELS.includes(t)) out.push(cell)
    }
    return out
  }

  // ── 2. Show offers 펼치기 ─────────────────────────────
  /**
   * "Show offers (2)" 같은 토글을 눌러 셀러 목록을 DOM 에 올린다.
   * 펼치지 않으면 Sold by 가 존재하지 않아 검사 자체가 불가능하다.
   */
  function expandOffers() {
    const RE = /^(show|view)\s+(all\s+)?offers?\s*(\(\d+\))?$/i
    let clicked = 0
    for (const el of document.querySelectorAll('a, button, span[role="button"], div[role="button"], span')) {
      if (clickedToggles.has(el)) continue
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim()
      if (t.length > 30 || !RE.test(t)) continue
      // 이미 펼쳐져 있으면(같은 컨테이너에 Sold by 가 보이면) 건드리지 않는다
      const container = el.closest('tr, li, section, div')
      if (container && /sold by/i.test(container.innerText || '')) {
        clickedToggles.add(el)
        continue
      }
      clickedToggles.add(el)
      try { el.click(); clicked++ } catch { /* 클릭 불가 요소는 무시 */ }
    }
    return clicked
  }

  // ── 3. 셀러 읽기 ──────────────────────────────────────
  /** 표에서 헤더 셀의 열 번호 (colspan 고려) */
  function columnIndexOf(cell) {
    const row = cell.closest('tr')
    if (!row) return -1
    let i = 0
    for (const c of row.children) {
      if (c === cell) return i
      i += c.colSpan || 1
    }
    return -1
  }

  function cellAt(row, colIdx) {
    let i = 0
    for (const c of row.children) {
      const span = c.colSpan || 1
      if (colIdx >= i && colIdx < i + span) return c
      i += span
    }
    return null
  }

  /** 오퍼 표 주변에서 ASIN 찾기 — 가장 가까운 "ASIN 이 하나뿐인" 조상 */
  function findAsinFor(el) {
    let node = el
    for (let depth = 0; node && depth < 10; depth++) {
      const text = node.innerText || ''
      const found = [...new Set(text.match(ASIN_RE) || [])]
      if (found.length === 1) return found[0]
      if (found.length > 1) break   // 여러 상품을 포함하는 범위까지 올라감 → 포기
      node = node.parentElement
    }
    return null
  }

  /** 셀러 셀에서 셀러 ID 추출 (링크가 있는 경우에만) */
  function extractSellerId(cell) {
    for (const a of cell.querySelectorAll('a[href]')) {
      const m = a.getAttribute('href').match(/[?&](?:seller|merchantId|me)=([A-Z0-9]{10,})/i)
      if (m) return m[1].toUpperCase()
    }
    return null
  }

  /**
   * 페이지 전체에서 오퍼 행 수집.
   * @returns [{ asin, sellerName, sellerId, rowEl, cellEl, checkbox }]
   */
  function collectOffers() {
    const offers = []
    const seenRows = new Set()

    for (const header of findSoldByHeaders()) {
      const table = header.closest('table')
      if (!table) continue
      const colIdx = columnIndexOf(header)
      if (colIdx < 0) continue

      const headerRow = header.closest('tr')
      const asinHint = findAsinFor(table)

      for (const row of table.querySelectorAll('tr')) {
        if (row === headerRow) continue
        if (seenRows.has(row)) continue
        // 중첩 표의 행이 상위 표 순회에 또 걸리는 걸 방지
        if (row.closest('table') !== table) continue

        const cell = cellAt(row, colIdx)
        if (!cell) continue
        const name = (cell.innerText || '').replace(/\s+/g, ' ').trim()
        if (!name || name.length > 120) continue
        if (/^sold by$/i.test(name)) continue

        seenRows.add(row)
        offers.push({
          asin: asinHint || findAsinFor(row) || null,
          sellerName: name,
          sellerId: extractSellerId(cell),
          rowEl: row,
          cellEl: cell,
          checkbox: row.querySelector('input[type="checkbox"]')
        })
      }
    }
    return offers
  }

  // ── 4. 렌더링 ─────────────────────────────────────────
  function clearInjected() {
    for (const el of document.querySelectorAll(`.${NS}-badge`)) el.remove()
    for (const el of document.querySelectorAll(`.${NS}-hit-firm, .${NS}-hit-weak`)) {
      el.classList.remove(`${NS}-hit-firm`, `${NS}-hit-weak`)
    }
  }

  function render(findings) {
    // clearInjected() 는 evaluate() 진입 시 이미 호출됨 (셀러 이름 오염 방지)
    const firm = findings.filter((f) => f.level === 'firm')
    const weak = findings.filter((f) => f.level === 'weak')

    // 행 강조 + 배지
    for (const f of findings) {
      f.offer.rowEl.classList.add(f.level === 'firm' ? `${NS}-hit-firm` : `${NS}-hit-weak`)
      const badge = document.createElement('div')
      badge.className = `${NS}-badge ${NS}-badge-${f.level}`
      const top = f.matches[0]
      badge.textContent = f.level === 'firm'
        ? `⚠️ 화이트리스트 — ${top.entry.clientName}`
        : `❓ 확인 필요 — ${top.entry.clientName}`
      badge.title = f.matches.map((m) => `${m.entry.raw.store_name} (${m.reason})`).join('\n')
      f.offer.cellEl.appendChild(badge)
    }

    renderBanner(firm, weak)
  }

  function bannerEl() {
    let b = document.getElementById(`${NS}-banner`)
    if (!b) {
      b = document.createElement('div')
      b.id = `${NS}-banner`
      document.documentElement.appendChild(b)
    }
    return b
  }

  function renderBanner(firm, weak) {
    const b = bannerEl()
    b.innerHTML = ''

    if (!firm.length && !weak.length) {
      // 아무것도 안 걸렸을 때도 "검사했다" 는 걸 알려줘야 신뢰가 생긴다
      b.className = `${NS}-banner ${NS}-clear`
      b.innerHTML = `
        <div class="${NS}-row">
          <span class="${NS}-ico">✅</span>
          <span class="${NS}-msg"><b>화이트리스트 일치 없음</b> — 검사한 셀러 ${lastScan.checked}명</span>
          <span class="${NS}-meta">${cacheMeta ? `기준 ${cacheMeta.count}건` : ''}</span>
        </div>`
      document.body.style.paddingTop = ''
      b.classList.add(`${NS}-float`)
      return
    }

    b.classList.remove(`${NS}-float`)
    b.className = `${NS}-banner ${firm.length ? `${NS}-danger` : `${NS}-warn`}`

    const title = document.createElement('div')
    title.className = `${NS}-row`
    title.innerHTML = `
      <span class="${NS}-ico">${firm.length ? '⛔' : '⚠️'}</span>
      <span class="${NS}-msg"><b>${firm.length
        ? `화이트리스트 셀러 ${firm.length}건 발견 — 신고하면 안 됩니다`
        : `확인이 필요한 셀러 ${weak.length}건`}</b></span>
      <button class="${NS}-close" title="닫기">✕</button>`
    title.querySelector(`.${NS}-close`).addEventListener('click', () => {
      b.remove()
      document.body.style.paddingTop = ''
    })
    b.appendChild(title)

    const list = document.createElement('div')
    list.className = `${NS}-list`
    for (const f of [...firm, ...weak]) {
      const top = f.matches[0]
      const item = document.createElement('div')
      item.className = `${NS}-item ${NS}-item-${f.level}`
      item.innerHTML = `
        <span class="${NS}-tag">${f.level === 'firm' ? '일치' : '의심'}</span>
        <span class="${NS}-asin">${f.offer.asin || 'ASIN?'}</span>
        <b class="${NS}-seller">${escapeHtml(f.offer.sellerName)}</b>
        <span class="${NS}-arrow">→</span>
        <span class="${NS}-store">${escapeHtml(top.entry.raw.store_name)}</span>
        <span class="${NS}-client">${escapeHtml(top.entry.clientName)}</span>
        <span class="${NS}-reason">${escapeHtml(top.reason)}</span>`
      item.addEventListener('click', () => {
        f.offer.rowEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
      })
      list.appendChild(item)
    }
    b.appendChild(list)

    // 배너가 페이지 상단을 덮지 않도록 본문을 밀어냄
    requestAnimationFrame(() => {
      document.body.style.paddingTop = b.offsetHeight + 8 + 'px'
    })
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  }

  // ── 5. 사고 지점 차단 ─────────────────────────────────
  /**
   * 실제 오신고는 "체크박스를 켜고 → 신고 버튼" 에서 일어난다.
   * 배너만으로는 놓칠 수 있으니 그 두 지점을 직접 막는다.
   */
  function attachGuards(findings) {
    for (const f of findings) {
      const cb = f.offer.checkbox
      if (!cb || cb.dataset[`${NS}Guard`]) continue
      cb.dataset[`${NS}Guard`] = '1'
      cb.addEventListener('change', () => {
        if (!cb.checked) return
        const top = f.matches[0]
        const msg =
          `⚠️ 화이트리스트 셀러입니다\n\n` +
          `셀러: ${f.offer.sellerName}\n` +
          `일치: ${top.entry.raw.store_name} (${top.entry.clientName})\n` +
          `근거: ${top.reason}\n\n` +
          `이 셀러를 신고 대상에 포함하시겠습니까?\n` +
          `(고객사 공식 판매처일 수 있습니다)`
        if (!window.confirm(msg)) {
          cb.checked = false
          cb.dispatchEvent(new Event('change', { bubbles: true }))
        }
      })
    }
  }

  /**
   * 제출 직전 최종 확인. 캡처 단계에서 듣되, 화이트리스트 셀러가 실제로
   * 체크돼 있을 때만 개입한다 (평상시 페이지 동작에 전혀 간섭 없음).
   */
  function attachSubmitGuard() {
    if (window[`__${NS}_submit_guard`]) return
    window[`__${NS}_submit_guard`] = true

    document.addEventListener('click', (e) => {
      if (submitConfirmed) return
      const btn = e.target.closest('button, a, input[type="submit"], [role="button"]')
      if (!btn) return
      const label = ((btn.innerText || btn.value || '') + ' ' + (btn.getAttribute('aria-label') || ''))
        .replace(/\s+/g, ' ').trim()
      if (!/report|submit|신고|제출/i.test(label)) return
      if (label.length > 60) return

      const checked = lastFindings.filter((f) => f.offer.checkbox?.checked)
      if (!checked.length) return

      const lines = checked.map((f) =>
        `  • ${f.offer.sellerName} → ${f.matches[0].entry.raw.store_name} (${f.matches[0].entry.clientName})`
      ).join('\n')
      const ok = window.confirm(
        `⛔ 화이트리스트 셀러가 신고 대상에 포함되어 있습니다\n\n${lines}\n\n` +
        `그래도 신고를 진행하시겠습니까?`
      )
      if (!ok) {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
      } else {
        submitConfirmed = true
      }
    }, true)
  }

  // ── 6. 메인 검사 루프 ─────────────────────────────────
  function evaluate() {
    if (!index) return

    // ⚠️ 주입한 배지를 먼저 걷어낸다. 배지가 셀러 셀 안에 들어있어서 그대로 두면
    //    다음 스캔에서 cell.innerText 가 "BCastle⚠️ 화이트리스트 — Dreams..." 로 읽혀
    //    셀러 이름이 오염되고 엉뚱한 곳에 매칭된다. (모의 페이지 검증에서 실제로 발생)
    clearInjected()

    // 렌더 중 우리 변경이 옵저버를 다시 깨워 무한 재검사 루프가 되는 것을 차단.
    observer?.disconnect()
    try {
      evaluateInner()
    } finally {
      if (observer && document.body) {
        observer.observe(document.body, { childList: true, subtree: true })
      }
    }
  }

  function evaluateInner() {
    const offers = collectOffers()
    const findings = []
    for (const offer of offers) {
      const matches = window.WLMatcher.matchSeller(
        { name: offer.sellerName, sellerId: offer.sellerId },
        index,
        { maxWeak: 3 }
      )
      if (!matches.length) continue
      const firm = matches.some((m) => m.level === 'exact' || m.level === 'strong')
      findings.push({ offer, matches, level: firm ? 'firm' : 'weak' })
    }

    lastFindings = findings
    lastScan = {
      checked: offers.length,
      offers: offers.map((o) => ({ asin: o.asin, sellerName: o.sellerName, sellerId: o.sellerId }))
    }

    render(findings)
    attachGuards(findings)
    attachSubmitGuard()
  }

  // 변경 감지 — 검색 결과가 AJAX 로 늘어나고, offers 도 클릭 후 비동기로 붙는다
  let timer = null
  function schedule(delay = 400) {
    clearTimeout(timer)
    timer = setTimeout(() => {
      // 우리가 만든 요소 때문에 다시 도는 무한 루프를 피하려고 주입분은 먼저 제거됨
      expandOffers()
      evaluate()
    }, delay)
  }

  function startObserver() {
    observer = new MutationObserver((records) => {
      // 우리 주입 요소만 바뀐 경우는 무시
      const relevant = records.some((r) => {
        const t = r.target
        if (!(t instanceof Element)) return true
        if (t.id === `${NS}-banner` || t.closest?.(`#${NS}-banner`)) return false
        if (t.classList?.contains(`${NS}-badge`)) return false
        return true
      })
      if (relevant) schedule()
    })
    observer.observe(document.body, { childList: true, subtree: true })
  }

  // ── 7. 부팅 ───────────────────────────────────────────
  async function boot() {
    if (!looksLikeReportPage()) return

    let res
    try {
      res = await chrome.runtime.sendMessage({ type: 'GET_WHITELIST' })
    } catch (e) {
      showSetupNotice('확장과 통신할 수 없습니다. 확장을 다시 로드해 주세요.')
      return
    }
    if (!res?.ok) {
      showSetupNotice(res?.error || '화이트리스트를 가져오지 못했습니다.')
      return
    }

    cacheMeta = res.cache
    clientNames = res.cache.clients || {}
    index = window.WLMatcher.buildIndex(res.cache.sellers || [], clientNames)

    if (!index.length) {
      showSetupNotice('등록된 화이트리스트가 없습니다. 팀 허브 → 관리자 → 화이트리스트 셀러 관리에서 등록하세요.')
      return
    }

    expandOffers()
    schedule(600)      // 펼침이 비동기로 끝나기를 기다린 뒤 1차 검사
    startObserver()
  }

  function showSetupNotice(msg) {
    const b = bannerEl()
    b.className = `${NS}-banner ${NS}-warn ${NS}-float`
    b.innerHTML = `
      <div class="${NS}-row">
        <span class="${NS}-ico">🛡️</span>
        <span class="${NS}-msg"><b>화이트리스트 가드</b> — ${escapeHtml(msg)}</span>
        <button class="${NS}-close" title="닫기">✕</button>
      </div>`
    b.querySelector(`.${NS}-close`).addEventListener('click', () => b.remove())
  }

  // 팝업의 "진단" — 실제로 무엇을 찾았는지 그대로 노출.
  // 셀렉터가 깨졌을 때 원인을 즉시 알 수 있는 유일한 창구라서 반드시 필요하다.
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'DIAGNOSE') {
      const headers = findSoldByHeaders()
      sendResponse({
        ok: true,
        isReportPage: looksLikeReportPage(),
        url: location.href,
        soldByHeaders: headers.length,
        offersFound: lastScan.offers,
        checkedCount: lastScan.checked,
        findings: lastFindings.map((f) => ({
          asin: f.offer.asin,
          seller: f.offer.sellerName,
          level: f.level,
          store: f.matches[0].entry.raw.store_name,
          client: f.matches[0].entry.clientName,
          reason: f.matches[0].reason
        })),
        whitelistCount: index ? index.length : 0
      })
      return true
    }
    if (msg?.type === 'RESCAN') {
      expandOffers()
      evaluate()
      sendResponse({ ok: true, checked: lastScan.checked, hits: lastFindings.length })
      return true
    }
  })

  boot()
})()
