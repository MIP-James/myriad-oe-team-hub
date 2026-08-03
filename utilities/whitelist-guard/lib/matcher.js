/**
 * 화이트리스트 매칭 엔진.
 *
 * ⚠️ 이 파일이 이 확장의 심장부다. 왜 "느슨한" 매칭이 필요한지:
 *
 *   고객사가 주는 화이트리스트는 [가게 이름 + 홈페이지 URL] 인데,
 *   아마존 Sold by 에 뜨는 건 [아마존 셀러 표시명] 이라 둘이 항상 같지 않다.
 *     화이트리스트: 'ZONKEY INC'  /  https://www.zonkeytoys.com/
 *     아마존 표시명: 'Zonkey Toys'
 *   이름이 완전히 같기를 기대하면 대부분 놓치고, 놓치면 곧 오신고다.
 *
 * 그래서 정밀도보다 재현율을 우선한다:
 *   - 놓친 매칭  = 오신고 (막으려던 그 사고, 비용 큼)
 *   - 과잉 경고  = 사람이 몇 초 확인 (비용 작음)
 *
 * 대신 확신도를 3단계로 나눠서 표시해 사람이 빨리 판단하게 한다:
 *   exact  — 셀러 ID 또는 확인된 아마존 표시명 일치. 사실상 확정.
 *   strong — 이름/별칭/도메인이 정규화 후 완전 일치. 거의 확정.
 *   weak   — 부분 포함 / 토큰 공유 / 오타 수준 유사. 사람이 확인 필요.
 *
 * self 에 붙이는 이유: content script(window) 와 popup 양쪽에서 같은 파일을 쓴다.
 */
self.WLMatcher = (function () {
  // 회사 형태·유통 관련 접미어. 제거해도 식별력이 남을 때만 떼어낸다.
  const LEGAL_SUFFIX = new Set([
    'inc', 'llc', 'ltd', 'limited', 'co', 'corp', 'corporation', 'company',
    'gmbh', 'sarl', 'bv', 'pty', 'plc', 'lp', 'llp', 'pte', 'kk',
    'group', 'holdings', 'enterprise', 'enterprises', 'trading', 'trade',
    'official', 'store', 'stores', 'shop', 'shops', 'usa', 'us',
    '주식회사', '유한회사'
  ])

  // 너무 흔해서 이것만 겹쳐도 같은 가게라고 볼 수 없는 토큰.
  // (weak 매칭의 오탐 폭증을 막는 안전장치)
  const STOPWORD = new Set([
    'store', 'stores', 'shop', 'shops', 'shopping', 'online', 'official',
    'toys', 'toy', 'kids', 'kid', 'baby', 'babies', 'gift', 'gifts',
    'market', 'marketplace', 'mall', 'world', 'house', 'home', 'direct',
    'deals', 'deal', 'sales', 'sale', 'outlet', 'supply', 'supplies',
    'wholesale', 'distribution', 'distributor', 'trading', 'trade',
    'boutique', 'collection', 'company', 'group', 'global', 'international',
    'products', 'product', 'goods', 'brands', 'brand', 'korea', 'america',
    'american', 'usa', 'shopee', 'amazon', 'llc', 'inc'
  ])

  // 스토어가 입점하는 플랫폼 도메인 — 이 경우 도메인이 아니라 경로가 식별자다.
  // (smartstore.naver.com/babywatch → 'babywatch' 가 가게 이름)
  const PLATFORM_HOSTS = [
    'smartstore.naver.com', 'store.naver.com', 'shopping.naver.com',
    'amazon.com', 'amazon.ca', 'ebay.com', 'etsy.com', 'coupang.com',
    'shopify.com', 'myshopify.com', 'cafe24.com', 'facebook.com',
    'instagram.com', 'aliexpress.com', 'walmart.com', 'gmarket.co.kr',
    '11st.co.kr', 'auction.co.kr', 'tmon.co.kr', 'wemakeprice.com'
  ]

  /** 기본 정규화 — 소문자, 영숫자·한글만 남김 */
  function norm(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9가-힣]/g, '')
  }

  /** 토큰 분리 — 단어 단위 (공백·기호 기준) */
  function tokens(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .split(/[^a-z0-9가-힣]+/)
      .filter(Boolean)
  }

  /** 법인/유통 접미어를 뗀 정규화. 떼고 나서 4자 미만이 되면 포기(식별력 소실). */
  function normStripped(s) {
    const t = tokens(s).filter((w) => !LEGAL_SUFFIX.has(w))
    const joined = t.join('')
    return joined.length >= 4 ? joined : ''
  }

  /**
   * 도메인 라벨 중 가게를 식별하지 못하는 흔한 것들.
   * 이게 없으면 store.swarthmore.edu 의 'store' 가 키로 잡혀서
   * 이름에 "Store" 가 들어간 모든 셀러가 이 가게와 오탐 매칭된다.
   */
  const GENERIC_HOST_LABEL = new Set([
    'store', 'stores', 'shop', 'shops', 'shopping', 'www', 'web', 'online',
    'mall', 'buy', 'order', 'cart', 'secure', 'checkout', 'my', 'new', 'old',
    'blog', 'info', 'mobile', 'com', 'net', 'org', 'site', 'home', 'main',
    'official', 'sales', 'usa'
  ])

  /** URL → 식별 후보들 (도메인 코어 또는 플랫폼 경로) */
  function urlKeys(url) {
    if (!url) return []
    let s = String(url).trim().toLowerCase()
    s = s.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '')
    const slash = s.indexOf('/')
    const host = slash === -1 ? s : s.slice(0, slash)
    const path = slash === -1 ? '' : s.slice(slash + 1)

    const out = []
    const isPlatform = PLATFORM_HOSTS.some((p) => host === p || host.endsWith('.' + p))
    if (isPlatform) {
      // 경로 첫 세그먼트가 가게 식별자 (smartstore.naver.com/babywatch)
      const seg = path.split(/[/?#]/).filter(Boolean)[0]
      if (seg) out.push(norm(seg))
    } else {
      // 마지막 라벨(TLD)을 떼고, 남은 라벨 중 식별력 있는 것만 후보로.
      // co/kr/com 같은 잔여 접미어는 길이 4 미만 또는 GENERIC 필터에서 걸러진다.
      const parts = host.split('.').filter(Boolean)
      const labels = parts.length > 1 ? parts.slice(0, -1) : parts
      for (const l of labels) {
        const k = norm(l)
        if (k.length >= 4 && !GENERIC_HOST_LABEL.has(k)) out.push(k)
      }
    }
    return out.filter((k) => k.length >= 4)
  }

  /**
   * 화이트리스트 엔트리 → 비교용 키 묶음.
   * 한 번 계산해서 재사용 (엔트리 수백 개 × 셀러 수 개를 매번 정규화하면 느려짐)
   */
  function buildIndex(sellers, clientNames) {
    return sellers.map((s) => {
      const exactKeys = new Set()   // strong 판정용 (정규화 완전일치)
      const nameSources = []        // weak 판정 + 사람에게 보여줄 근거

      const push = (raw, kind) => {
        if (!raw) return
        const n = norm(raw)
        if (n.length >= 3) { exactKeys.add(n); nameSources.push({ raw, n, kind }) }
        const st = normStripped(raw)
        if (st && st !== n) exactKeys.add(st)
      }

      push(s.store_name, 'name')
      for (const a of s.aliases || []) push(a, 'alias')
      if (s.amazon_seller_name) push(s.amazon_seller_name, 'amazon')
      for (const u of s.urls || []) {
        for (const k of urlKeys(u)) {
          if (k) { exactKeys.add(k); nameSources.push({ raw: u, n: k, kind: 'url' }) }
        }
      }

      // weak 매칭용 식별력 있는 토큰 (흔한 단어·짧은 단어 제외)
      const distinct = new Set()
      for (const src of [s.store_name, ...(s.aliases || [])]) {
        for (const t of tokens(src)) {
          if (t.length >= 5 && !STOPWORD.has(t)) distinct.add(t)
        }
      }

      return {
        raw: s,
        clientName: clientNames?.[s.client_id] || '알 수 없는 고객사',
        amazonId: (s.amazon_seller_id || '').trim().toUpperCase() || null,
        amazonName: s.amazon_seller_name ? norm(s.amazon_seller_name) : null,
        exactKeys,
        nameSources,
        distinct
      }
    })
  }

  /** 레벤슈타인 거리 (길이 차가 클 때는 호출 전에 걸러서 씀) */
  function editDistance(a, b) {
    const m = a.length, n = b.length
    if (!m) return n
    if (!n) return m
    let prev = Array.from({ length: n + 1 }, (_, i) => i)
    for (let i = 1; i <= m; i++) {
      const cur = [i]
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(
          prev[j] + 1,
          cur[j - 1] + 1,
          prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        )
      }
      prev = cur
    }
    return prev[n]
  }

  function similarity(a, b) {
    const longer = Math.max(a.length, b.length)
    if (!longer) return 0
    return 1 - editDistance(a, b) / longer
  }

  /**
   * 관측된 셀러 1명 → 매칭 결과 배열 (확신도 높은 순).
   *
   * @param observed { name, sellerId? }
   * @param index    buildIndex() 결과
   * @param opt      { maxWeak }  weak 결과 개수 상한 (경고 벽 방지)
   */
  function matchSeller(observed, index, opt = {}) {
    const maxWeak = opt.maxWeak ?? 3
    const name = observed?.name || ''
    const sellerId = (observed?.sellerId || '').trim().toUpperCase()
    const n = norm(name)
    const nStripped = normStripped(name)
    const obsTokens = new Set(tokens(name).filter((t) => t.length >= 5 && !STOPWORD.has(t)))

    if (!n && !sellerId) return []

    const hits = []
    for (const e of index) {
      // ── 1. 셀러 ID 일치 — 가장 확실 ───────────────────
      if (sellerId && e.amazonId && e.amazonId === sellerId) {
        hits.push({ entry: e, level: 'exact', score: 100, reason: `아마존 셀러 ID 일치 (${sellerId})` })
        continue
      }

      // ── 2. 확인된 아마존 표시명 일치 ───────────────────
      if (n && e.amazonName && e.amazonName === n) {
        hits.push({ entry: e, level: 'exact', score: 98, reason: `등록된 아마존 표시명 일치 ("${e.raw.amazon_seller_name}")` })
        continue
      }

      if (!n) continue

      // ── 3. 이름/별칭/도메인 정규화 완전 일치 ───────────
      let strong = null
      if (e.exactKeys.has(n)) strong = n
      else if (nStripped && e.exactKeys.has(nStripped)) strong = nStripped
      if (strong) {
        const src = e.nameSources.find((s) => s.n === strong)
        hits.push({
          entry: e, level: 'strong', score: 90,
          reason: src
            ? `${kindLabel(src.kind)} 일치 ("${src.raw}")`
            : '이름 정규화 일치'
        })
        continue
      }

      // ── 4. 부분 포함 — 짧은 쪽이 5자 이상일 때만 ───────
      let weak = null
      for (const src of e.nameSources) {
        const k = src.n
        if (k.length < 5) continue
        if (n.includes(k) || (k.length >= n.length && k.includes(n) && n.length >= 5)) {
          weak = { score: 70, reason: `${kindLabel(src.kind)} 부분 포함 ("${src.raw}")` }
          break
        }
      }

      // ── 5. 식별력 있는 토큰 공유 ───────────────────────
      if (!weak && obsTokens.size) {
        for (const t of obsTokens) {
          if (e.distinct.has(t)) {
            weak = { score: 62, reason: `공통 단어 "${t}"` }
            break
          }
        }
      }

      // ── 6. 오타 수준 유사 (길이 차 3 이내에서만 계산) ──
      if (!weak && n.length >= 5) {
        for (const src of e.nameSources) {
          const k = src.n
          if (k.length < 5 || Math.abs(k.length - n.length) > 3) continue
          const sim = similarity(n, k)
          if (sim >= 0.92) { weak = { score: 85, reason: `이름이 거의 같음 ("${src.raw}", 유사도 ${Math.round(sim * 100)}%)`, promote: true }; break }
          if (sim >= 0.85) { weak = { score: 66, reason: `이름 유사 ("${src.raw}", 유사도 ${Math.round(sim * 100)}%)` }; break }
        }
      }

      if (weak) {
        hits.push({
          entry: e,
          level: weak.promote ? 'strong' : 'weak',
          score: weak.score,
          reason: weak.reason
        })
      }
    }

    hits.sort((a, b) => b.score - a.score)

    const firm = hits.filter((h) => h.level !== 'weak')

    // 확정/일치가 이미 있으면 weak 는 버린다.
    // 답이 나온 상태에서 "공통 단어 monkey" 같은 항목을 5개 더 붙이면
    // 정작 중요한 경고가 노이즈에 묻힌다. (실측: "Zilly Monkey" 가 weak 5건 유발)
    if (firm.length) return firm

    return hits.filter((h) => h.level === 'weak').slice(0, maxWeak)
  }

  function kindLabel(kind) {
    return { name: '가게 이름', alias: '별칭', url: '스토어 도메인', amazon: '아마존 표시명' }[kind] || '이름'
  }

  /** 여러 셀러 일괄 검사 */
  function matchAll(observedList, index, opt) {
    return observedList.map((o) => ({ observed: o, matches: matchSeller(o, index, opt) }))
  }

  return { norm, normStripped, tokens, urlKeys, buildIndex, matchSeller, matchAll, similarity }
})()
