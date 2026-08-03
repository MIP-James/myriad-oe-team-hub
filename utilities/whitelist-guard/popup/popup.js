/**
 * 팝업 — 상태 확인 / 이 페이지 재검사 / 진단 / 셀러 이름 테스트.
 *
 * "셀러 이름 테스트" 를 넣은 이유: 화이트리스트는 [가게 이름] 인데 아마존은
 * [셀러 표시명] 이라 이름이 어긋난다. 신고 담당자가 애매한 셀러명을 여기 넣어
 * 미리 확인할 수 있어야 실제로 오신고가 줄어든다.
 */

const $ = (id) => document.getElementById(id)
let index = null

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

async function loadStatus() {
  const res = await chrome.runtime.sendMessage({ type: 'GET_STATUS' })
  const cache = res?.cache

  if (!res?.hasToken) {
    $('pill').className = 'pill off'
    $('pill').textContent = '토큰 필요'
  } else if (cache?.count) {
    $('pill').className = 'pill on'
    $('pill').textContent = '준비됨'
  } else {
    $('pill').className = 'pill off'
    $('pill').textContent = '동기화 필요'
  }

  $('count').textContent = cache ? `${cache.count}건` : '없음'
  const clients = Object.values(cache?.clients || {})
  $('clients').textContent = clients.length ? clients.join(', ') : '—'
  $('synced').textContent = cache?.fetchedAt
    ? new Date(cache.fetchedAt).toLocaleString('ko-KR')
    : '—'
  $('errline').textContent = res?.lastError ? `오류: ${res.lastError}` : ''

  index = cache?.sellers?.length
    ? self.WLMatcher.buildIndex(cache.sellers, cache.clients || {})
    : null
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab
}

/** 콘텐츠 스크립트에 메시지 — 신고 페이지가 아니면 응답이 없다 */
async function askPage(type) {
  const tab = await activeTab()
  if (!tab?.id) return null
  try {
    return await chrome.tabs.sendMessage(tab.id, { type })
  } catch {
    return null   // content script 미주입 (아마존 신고 페이지가 아님)
  }
}

async function loadPageInfo() {
  const d = await askPage('DIAGNOSE')
  if (!d?.ok) {
    $('pgSellers').textContent = '이 페이지 아님'
    $('pgHits').textContent = '—'
    return
  }
  $('pgSellers').textContent = `${d.checkedCount}명`
  const firm = d.findings.filter((f) => f.level === 'firm').length
  const weak = d.findings.filter((f) => f.level === 'weak').length
  $('pgHits').textContent = firm || weak
    ? `${firm ? `일치 ${firm}` : ''}${firm && weak ? ' · ' : ''}${weak ? `의심 ${weak}` : ''}`
    : '없음'
}

$('sync').addEventListener('click', async () => {
  $('sync').disabled = true
  $('sync').textContent = '동기화 중...'
  try {
    await chrome.runtime.sendMessage({ type: 'REFRESH_WHITELIST' })
  } finally {
    $('sync').disabled = false
    $('sync').textContent = '다시 동기화'
    await loadStatus()
  }
})

$('opts').addEventListener('click', () => chrome.runtime.openOptionsPage())

$('rescan').addEventListener('click', async () => {
  $('rescan').disabled = true
  const r = await askPage('RESCAN')
  $('rescan').disabled = false
  if (!r?.ok) {
    $('pgSellers').textContent = '이 페이지 아님'
    return
  }
  await loadPageInfo()
})

$('diag').addEventListener('click', async () => {
  const out = $('diagOut')
  const d = await askPage('DIAGNOSE')
  out.style.display = 'block'
  if (!d?.ok) {
    out.textContent =
      '이 탭에서 확장이 동작하지 않고 있습니다.\n\n' +
      '확인할 것:\n' +
      '  • 아마존 Report Infringement 페이지인지\n' +
      '  • 페이지를 새로고침했는지 (확장 설치 후 첫 로드 필요)\n'
    return
  }
  out.textContent = JSON.stringify({
    주소: d.url,
    신고페이지로_인식: d.isReportPage,
    SoldBy_헤더_개수: d.soldByHeaders,
    보관중_화이트리스트: d.whitelistCount,
    읽은_셀러: d.offersFound,
    검사결과: d.findings
  }, null, 2)
})

let testTimer = null
$('testName').addEventListener('input', () => {
  clearTimeout(testTimer)
  testTimer = setTimeout(runTest, 200)
})

function runTest() {
  const name = $('testName').value.trim()
  const box = $('testRes')
  box.innerHTML = ''
  if (!name) return
  if (!index) {
    box.innerHTML = '<div class="empty">먼저 동기화가 필요합니다.</div>'
    return
  }

  const hits = self.WLMatcher.matchSeller({ name }, index, { maxWeak: 5 })
  if (!hits.length) {
    box.innerHTML = '<div class="empty">화이트리스트에 일치하는 항목이 없습니다.</div>'
    return
  }
  const LABEL = { exact: '확정', strong: '일치', weak: '확인' }
  box.innerHTML = hits.map((h) => `
    <div class="hit ${h.level}">
      <span class="lv ${h.level}">${LABEL[h.level]}</span>
      <b>${escapeHtml(h.entry.raw.store_name)}</b>
      <span style="color:#8A8580">· ${escapeHtml(h.entry.clientName)}</span>
      <span class="why">${escapeHtml(h.reason)}</span>
    </div>`).join('')
}

loadStatus().then(loadPageInfo)
