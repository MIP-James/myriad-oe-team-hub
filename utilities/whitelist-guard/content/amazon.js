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
  const bootAt = Date.now()              // "아직 펼치는 중" 과 "못 읽음" 을 구분하는 기준
  const clickedToggles = new WeakSet()   // 같은 토글을 반복 클릭하지 않도록

  // ── 0. 페이지 판별 ────────────────────────────────────
  /**
   * "권리침해 신고 페이지" 를 뜻하는 문구 — 21개 마켓플레이스 언어.
   * 영어만 보면 amazon.de 처럼 현지화된 포털에서 확장이 통째로 동작하지 않는다.
   */
  const REPORT_PAGE_RE = new RegExp([
    'report infringement', 'which products would you like to report', 'notice retraction form',
    'report a violation',
    'rechtsverletzung', 'verstoß melden', 'verstoss melden',        // 독일어
    'signaler une contrefaçon', 'atteinte aux droits', 'contrefaçon', // 프랑스어
    'informar de una infracción', 'denunciar una infracción', 'infracción', // 스페인어
    'segnala una violazione', 'violazione dei diritti',              // 이탈리아어
    'denunciar violação', 'violação de propriedade',                 // 포르투갈어
    'inbreuk melden', 'inbreuk op',                                  // 네덜란드어
    'rapportera intrång', 'intrång',                                 // 스웨덴어
    'zgłoś naruszenie', 'naruszenie praw',                           // 폴란드어
    'ihlal bildir', 'ihlali bildir',                                 // 터키어
    '権利侵害', '侵害の申告', '知的財産権の侵害',                      // 일본어
    '권리침해', '침해 신고',                                          // 한국어
    'انتهاك', 'الإبلاغ عن انتهاك'                                    // 아랍어
  ].join('|'), 'i')

  /**
   * 신고 도구 페이지인지 확인. URL 만으로 판단하지 않는 이유:
   * 아마존 신고 포털 경로가 마켓플레이스마다 다르고 바뀌기도 해서,
   * 페이지 내용으로 판단하는 게 훨씬 안 깨진다.
   */
  function looksLikeReportPage() {
    // (1) 경로 — 언어와 무관하게 통하는 신호. amazon.de/report/infringement 처럼
    //     국가 도메인이 달라도 /report/ 경로는 공통이다.
    if (/\/report(\/|$)/i.test(location.pathname)) return true

    // (2) 문구 — 마켓플레이스 언어별 "권리침해 신고" 표현.
    //     경로 검사만 믿으면 안 되는 이유: 포털 경로가 바뀌거나 마켓플레이스마다
    //     다를 수 있고, 그러면 확장이 조용히 아무 일도 안 한다.
    const t = (document.body?.innerText || '').slice(0, 5000)
    if (REPORT_PAGE_RE.test(t)) return true

    // (3) 표 헤더 — 이미 펼쳐진 상태라면 이것만으로도 확실
    return !!findSoldByHeaders().length
  }

  // ── 1. Sold by 헤더 찾기 ──────────────────────────────
  function normText(el) {
    return (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase()
  }

  /**
   * 'Sold by' 로 보이는 헤더 셀들.
   *
   * 아마존 신고 포털은 국가 도메인마다 현지화되므로 영어만 보면 amazon.de 등에서
   * 아무것도 못 읽는다. 21개 마켓플레이스 언어를 모두 넣어둔다.
   * (콜론·공백은 normText 단계에서 정리되고, 마지막에 부분 일치 폴백도 둔다)
   */
  const SOLD_BY_LABELS = [
    // 영어
    'sold by', 'seller', 'sold by:', 'merchant',
    // 독일어
    'verkauft von', 'verkäufer', 'verkaufer', 'verkauf durch', 'angeboten von',
    // 프랑스어
    'vendu par', 'vendeur',
    // 스페인어 (es / mx)
    'vendido por', 'vendedor',
    // 이탈리아어
    'venduto da', 'venditore',
    // 포르투갈어 (br)
    'vendido por', 'vendedor',
    // 네덜란드어 (nl / be)
    'verkocht door', 'verkoper',
    // 스웨덴어
    'säljs av', 'saljs av', 'säljare',
    // 폴란드어
    'sprzedane przez', 'sprzedawca', 'sprzedaje',
    // 터키어
    'satıcı', 'satici', 'satan', 'gönderen',
    // 일본어
    '販売元', '販売業者', '出荷元', '販売者',
    // 한국어
    '판매자', '판매처',
    // 아랍어 (ae / sa / eg)
    'يبيعه', 'البائع'
  ]

  function findSoldByHeaders() {
    const out = []
    for (const cell of document.querySelectorAll('th, td')) {
      const t = normText(cell).replace(/[:：]\s*$/, '')
      if (!t || t.length > 24) continue
      if (SOLD_BY_LABELS.includes(t)) { out.push(cell); continue }
      // 폴백 — 'Verkauft von dem Händler' 처럼 뒤에 말이 붙는 변형 대비.
      // 짧은 헤더 셀에서만 보므로 오탐 위험이 낮다.
      if (SOLD_BY_LABELS.some((l) => l.length >= 6 && t.startsWith(l))) out.push(cell)
    }
    return out
  }

  // ── 2. Show offers 펼치기 ─────────────────────────────
  /**
   * "Show offers (2)" 같은 토글을 눌러 셀러 목록을 DOM 에 올린다.
   * 펼치지 않으면 Sold by 가 존재하지 않아 검사 자체가 불가능하다.
   */
  // 'offers' 계열 키워드 (마켓플레이스 언어별). 확실한 신호라 실제 링크여도 클릭 허용.
  const OFFERS_KEYWORD =
    /(offers?|angebote|offres|ofertas|offerte|aanbiedingen|erbjudanden|oferty|teklif|satıcılar|出品|オファー|販売元|판매자|عروض)/i
  // 끝에 (숫자) — 접힌 디스클로저의 언어 무관 신호. "Show offers (2)" / "Angebote anzeigen (2)"
  const COUNT_SUFFIX = /\(\d{1,3}\)\s*$/

  /** 이 컨테이너에 이미 Sold by 헤더가 보이면 펼칠 필요가 없다 (언어 무관 판정) */
  function containerAlreadyExpanded(container) {
    if (!container) return false
    for (const cell of container.querySelectorAll('th, td')) {
      const t = normText(cell).replace(/[:：]\s*$/, '')
      if (t && t.length <= 24 && SOLD_BY_LABELS.includes(t)) return true
    }
    return false
  }

  /**
   * 셀러 목록을 DOM 에 올리기 위해 접힌 토글을 누른다.
   *
   * ⚠️ 언어 의존을 피하는 게 핵심. "Show offers (2)" 만 찾으면 amazon.de 의
   *    "Angebote anzeigen (2)" 를 놓치고, 그러면 Sold by 가 아예 없어서
   *    조용히 "0명 검사" 가 된다 (경고가 안 뜨는데 안전하다고 착각하는 최악의 실패).
   *    그래서 **끝에 (숫자) 가 붙은 짧은 클릭 요소** 라는 언어 무관 신호를 주로 쓴다.
   *    이러면 "Show all images (8)" 도 같이 눌리는데, 이미지 목록이 펼쳐질 뿐 무해하다.
   *    (놓치는 것보다 여는 게 낫다)
   */
  function expandOffers() {
    let clicked = 0
    for (const el of document.querySelectorAll('a, button, [role="button"], span')) {
      if (clickedToggles.has(el)) continue
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim()
      if (!t || t.length > 40) continue

      const byKeyword = OFFERS_KEYWORD.test(t)
      const byCount = COUNT_SUFFIX.test(t)
      if (!byKeyword && !byCount) continue

      // 실제로 이동하는 링크는 누르지 않는다 — 페이지네이션 "(2)" 같은 걸 밟아
      // 작업 중인 페이지를 떠나버리면 안 되기 때문. 단, offers 키워드가 확실하면 허용.
      if (el.tagName === 'A' && !byKeyword) {
        const href = el.getAttribute('href') || ''
        if (href && !/^#|^javascript:/i.test(href)) continue
      }

      if (containerAlreadyExpanded(el.closest('tr, li, section, div'))) {
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
      // ⚠️ 가장 위험한 실패 모드 — 셀러를 한 명도 못 읽었는데 초록불이 뜨면
      //    "검사했고 안전하다" 고 착각한다. 현지화된 페이지(amazon.de 등)에서
      //    토글 문구를 못 찾으면 정확히 이 상태가 된다. 그래서 구분해서 경고한다.
      //    (로드 직후엔 펼치는 중이라 0명이 정상 → 3초 유예 후에만 경고)
      const stalled = lastScan.checked === 0 && Date.now() - bootAt > 3000
      if (stalled) {
        b.className = `${NS}-banner ${NS}-warn ${NS}-float`
        b.innerHTML = `
          <div class="${NS}-row">
            <span class="${NS}-ico">⚠️</span>
            <span class="${NS}-msg"><b>셀러를 읽지 못했습니다</b> — 검사되지 않았습니다.
              <br><span style="font-size:11px">Show offers 를 직접 펼친 뒤 확장 팝업의 "다시 검사" 를 누르세요.
              계속 실패하면 팝업의 "진단" 내용을 전달해 주세요.</span></span>
            <button class="${NS}-close" title="닫기">✕</button>
          </div>`
        b.querySelector(`.${NS}-close`).addEventListener('click', () => b.remove())
        document.body.style.paddingTop = ''
        return
      }

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

    // 제목의 건수는 "오퍼 수" 가 아니라 "셀러 수" 여야 한다.
    // 한 셀러가 오퍼를 2개 올려두면 2건으로 보여서 실제보다 부풀려진다.
    const firmSellers = groupFindings(firm).length
    const weakSellers = groupFindings(weak).length

    const title = document.createElement('div')
    title.className = `${NS}-row`
    title.innerHTML = `
      <span class="${NS}-ico">${firm.length ? '⛔' : '⚠️'}</span>
      <span class="${NS}-msg"><b>${firm.length
        ? `화이트리스트 셀러 ${firmSellers}명 발견 — 신고하면 안 됩니다`
        : `확인이 필요한 셀러 ${weakSellers}명`}</b></span>
      <span class="${NS}-meta">검사한 셀러 ${lastScan.checked}명</span>
      <button class="${NS}-close" title="닫기">✕</button>`
    title.querySelector(`.${NS}-close`).addEventListener('click', () => {
      b.remove()
      document.body.style.paddingTop = ''
    })
    b.appendChild(title)

    const list = document.createElement('div')
    list.className = `${NS}-list`
    // 같은 셀러가 오퍼를 여러 건 올려두면 배너에 똑같은 줄이 반복된다
    // (실사용에서 MetaRetail 이 2줄로 나왔음) → 한 줄로 합치고 건수를 표시.
    for (const g of groupFindings([...firm, ...weak])) {
      const top = g.first.matches[0]
      const item = document.createElement('div')
      item.className = `${NS}-item ${NS}-item-${g.first.level}`
      item.innerHTML = `
        <span class="${NS}-tag">${g.first.level === 'firm' ? '일치' : '의심'}</span>
        <span class="${NS}-asin">${g.first.offer.asin || 'ASIN?'}</span>
        <b class="${NS}-seller">${escapeHtml(g.first.offer.sellerName)}</b>
        ${g.items.length > 1 ? `<span class="${NS}-count">오퍼 ${g.items.length}건</span>` : ''}
        <span class="${NS}-arrow">→</span>
        <span class="${NS}-store">${escapeHtml(top.entry.raw.store_name)}</span>
        <span class="${NS}-client">${escapeHtml(top.entry.clientName)}</span>
        <span class="${NS}-reason">${escapeHtml(top.reason)}</span>`
      item.addEventListener('click', () => {
        g.first.offer.rowEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
      })
      list.appendChild(item)
    }
    b.appendChild(list)

    // 배너가 페이지 상단을 덮지 않도록 본문을 밀어냄
    requestAnimationFrame(() => {
      document.body.style.paddingTop = b.offsetHeight + 8 + 'px'
    })
  }

  /** (셀러명 + 매칭된 화이트리스트 가게) 기준으로 묶기 — 배너 중복 줄 제거 */
  function groupFindings(findings) {
    const map = new Map()
    for (const f of findings) {
      const key = f.offer.sellerName.trim().toLowerCase() + '|' + (f.matches[0]?.entry.raw.id || '')
      if (map.has(key)) map.get(key).items.push(f)
      else map.set(key, { first: f, items: [f] })
    }
    return [...map.values()]
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

    // 셀러를 한 명도 못 읽은 채로 조용히 끝나는 걸 막는 안전망.
    // 페이지가 더 이상 변하지 않으면 옵저버도 안 깨어나므로, 여기서 한 번 더 확인해
    // "읽지 못했습니다" 경고로 전환한다. (초록불 오해가 이 기능 최악의 실패)
    setTimeout(() => {
      if (lastScan.checked === 0) {
        expandOffers()
        evaluate()
      }
    }, 4000)
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
