/**
 * Service worker — 화이트리스트 내려받기 + 캐시.
 *
 * content script 는 네트워크를 직접 안 건드리고 여기서만 받아간다:
 *   content → {type:'GET_WHITELIST'} → 캐시 즉시 반환 (+ 오래됐으면 백그라운드 갱신)
 *
 * 캐시를 두는 이유가 성능만은 아니다. Phase 16 런처가 폴링 빈도로 Cloudflare
 * 무료 한도를 직격한 사고(gotcha #38)가 있었어서, 요청 수를 구조적으로 낮게 묶어둔다.
 * 신고 페이지를 하루 수십 번 열어도 실제 API 호출은 6시간에 1번이다.
 */

const API_BASE_DEFAULT = 'https://myriad-oe-team-hub.pages.dev'
const STALE_MS = 6 * 60 * 60 * 1000   // 6시간

async function getConfig() {
  const s = await chrome.storage.local.get(['token', 'apiBase'])
  return {
    token: s.token || '',
    apiBase: (s.apiBase || API_BASE_DEFAULT).replace(/\/+$/, '')
  }
}

/** 서버에서 화이트리스트를 받아 캐시에 저장. 실패 시 throw. */
async function refreshWhitelist() {
  const { token, apiBase } = await getConfig()
  if (!token) throw new Error('토큰이 설정되지 않았습니다. 확장 옵션에서 토큰을 입력하세요.')

  const res = await fetch(`${apiBase}/api/whitelist-fetch`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` }
  })

  let body
  try { body = await res.json() } catch { body = null }
  if (!res.ok) {
    throw new Error(body?.error || `서버 오류 (HTTP ${res.status})`)
  }

  const cache = {
    sellers: body.sellers || [],
    clients: body.clients || {},
    count: body.count ?? (body.sellers || []).length,
    fetchedAt: Date.now(),
    serverVersion: body.version || null
  }
  await chrome.storage.local.set({ cache, lastError: null })
  await updateBadge(cache.count)
  return cache
}

async function updateBadge(count) {
  try {
    // 배지에 등록 건수를 보여줘서 "연결됨" 을 한눈에 알 수 있게
    await chrome.action.setBadgeText({ text: count > 999 ? '999+' : String(count || 0) })
    await chrome.action.setBadgeBackgroundColor({ color: count ? '#F2B100' : '#8A8580' })
  } catch { /* 배지는 부가 기능 — 실패해도 무시 */ }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  ;(async () => {
    try {
      if (msg?.type === 'GET_WHITELIST') {
        const { cache } = await chrome.storage.local.get('cache')

        if (!cache) {
          // 캐시가 아예 없으면 지금 받아온다 (첫 사용)
          const fresh = await refreshWhitelist()
          sendResponse({ ok: true, cache: fresh })
          return
        }

        // 캐시가 있으면 즉시 응답하고, 오래됐으면 조용히 갱신 (페이지 지연 없음)
        sendResponse({ ok: true, cache })
        if (Date.now() - (cache.fetchedAt || 0) > STALE_MS) {
          refreshWhitelist().catch((e) =>
            chrome.storage.local.set({ lastError: e.message })
          )
        }
        return
      }

      if (msg?.type === 'REFRESH_WHITELIST') {
        const fresh = await refreshWhitelist()
        sendResponse({ ok: true, cache: fresh })
        return
      }

      if (msg?.type === 'GET_STATUS') {
        const s = await chrome.storage.local.get(['cache', 'token', 'apiBase', 'lastError'])
        sendResponse({
          ok: true,
          hasToken: !!s.token,
          apiBase: s.apiBase || API_BASE_DEFAULT,
          cache: s.cache || null,
          lastError: s.lastError || null
        })
        return
      }

      sendResponse({ ok: false, error: '알 수 없는 요청: ' + msg?.type })
    } catch (e) {
      const message = e?.message || String(e)
      await chrome.storage.local.set({ lastError: message })
      sendResponse({ ok: false, error: message })
    }
  })()

  return true   // 비동기 응답 — 이 return 없으면 sendResponse 가 무효화됨
})

// 설치/업데이트 직후 한 번 시도 (토큰이 이미 있으면 바로 준비 완료 상태가 됨)
chrome.runtime.onInstalled.addListener(() => {
  refreshWhitelist().catch(() => { /* 토큰 미설정이 정상 상태 */ })
})

// 브라우저 시작 시 배지 복원
chrome.runtime.onStartup?.addListener(async () => {
  const { cache } = await chrome.storage.local.get('cache')
  if (cache) updateBadge(cache.count)
})
