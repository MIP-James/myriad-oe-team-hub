/** 옵션 페이지 — 토큰 저장 + 즉시 동기화로 연결 확인. */

const $ = (id) => document.getElementById(id)
const DEFAULT_BASE = 'https://myriad-oe-team-hub.pages.dev'

function setStatus(kind, msg) {
  const el = $('status')
  el.className = 'status ' + kind
  el.textContent = msg
}

async function load() {
  const s = await chrome.storage.local.get(['token', 'apiBase'])
  $('token').value = s.token || ''
  $('apiBase').value = s.apiBase || DEFAULT_BASE
  await showCache()
}

async function showCache() {
  const { cache, lastError } = await chrome.storage.local.get(['cache', 'lastError'])
  const el = $('cacheInfo')
  if (!cache) {
    el.textContent = lastError
      ? `아직 동기화되지 않았습니다 — ${lastError}`
      : '아직 동기화되지 않았습니다. 토큰을 저장하면 자동으로 받아옵니다.'
    return
  }
  const when = new Date(cache.fetchedAt).toLocaleString('ko-KR')
  const clients = Object.values(cache.clients || {})
  el.innerHTML =
    `<b style="color:#2B2928">화이트리스트 ${cache.count}건</b> 보관 중<br>` +
    `고객사: ${clients.length ? clients.map(escapeHtml).join(', ') : '없음'}<br>` +
    `마지막 동기화: ${when}` +
    (lastError ? `<br><span style="color:#9F1239">최근 오류: ${escapeHtml(lastError)}</span>` : '')
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

$('reveal').addEventListener('click', () => {
  const i = $('token')
  const show = i.type === 'password'
  i.type = show ? 'text' : 'password'
  $('reveal').textContent = show ? '숨기기' : '보기'
})

$('save').addEventListener('click', async () => {
  const token = $('token').value.trim()
  const apiBase = ($('apiBase').value.trim() || DEFAULT_BASE).replace(/\/+$/, '')

  if (!token) { setStatus('err', '토큰을 입력하세요.'); return }
  if (!token.startsWith('myrwl_')) {
    // 형식만 안내하고 막지는 않는다 (나중에 접두어가 바뀔 수 있음)
    setStatus('err', '토큰이 myrwl_ 로 시작하지 않습니다. 허브에서 복사한 값이 맞는지 확인하세요.')
  }

  $('save').disabled = true
  $('save').textContent = '동기화 중...'
  try {
    await chrome.storage.local.set({ token, apiBase, lastError: null })
    const res = await chrome.runtime.sendMessage({ type: 'REFRESH_WHITELIST' })
    if (res?.ok) {
      setStatus('ok', `연결 성공 — 화이트리스트 ${res.cache.count}건을 받았습니다.`)
    } else {
      setStatus('err', res?.error || '동기화에 실패했습니다.')
    }
  } catch (e) {
    setStatus('err', e.message || String(e))
  } finally {
    $('save').disabled = false
    $('save').textContent = '저장 후 동기화'
    await showCache()
  }
})

$('refresh').addEventListener('click', async () => {
  $('refresh').disabled = true
  try {
    const res = await chrome.runtime.sendMessage({ type: 'REFRESH_WHITELIST' })
    setStatus(res?.ok ? 'ok' : 'err',
      res?.ok ? `동기화 완료 — ${res.cache.count}건` : (res?.error || '실패'))
  } finally {
    $('refresh').disabled = false
    await showCache()
  }
})

load()
