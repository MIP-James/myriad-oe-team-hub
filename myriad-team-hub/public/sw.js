// =============================================================
// MYRIAD Team Hub — Service Worker (PWA push notifications only)
//
// 역할:
//   1. push 이벤트 수신 → 윈도우 토스트 표시
//   2. notificationclick 이벤트 → 해당 URL 로 탭 focus 또는 새 창
//
// 캐시/오프라인 기능은 의도적으로 안 넣음 — 팀 허브는 항상 최신 데이터가
// 중요해서 SW 가 stale 응답 캐싱하면 오히려 문제. push 전용 SW.
// =============================================================

self.addEventListener('install', (event) => {
  // 즉시 활성화 — 신버전 SW 가 deploy 되면 바로 적용
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: 'MYRIAD Team Hub', body: event.data ? event.data.text() : '' }
  }

  const title = data.title || 'MYRIAD Team Hub'
  const options = {
    body: data.body || '',
    // 아이콘 자산 추가 시 sw.js 의 이 경로 갱신 (없으면 브라우저 기본 아이콘 사용)
    icon: data.icon,
    badge: data.badge,
    tag: data.tag || 'myriad-notif',
    // tag 같으면 같은 알림으로 합쳐짐. renotify=true 면 같은 tag 라도
    // 새로 도착했음을 알림 (소리/진동 다시 울림).
    renotify: data.renotify === true,
    requireInteraction: data.requireInteraction === true,
    data: {
      url: data.url || '/',
      notification_id: data.notification_id || null,
      ...(data.data || {})
    }
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = event.notification.data?.url || '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      const origin = self.location.origin

      // 팀 허브 탭이 이미 열려있으면 거기서 navigate
      for (const client of clientList) {
        try {
          const clientUrl = new URL(client.url)
          if (clientUrl.origin === origin) {
            client.focus()
            // 클라이언트 측에서 받아서 react-router navigate 처리
            client.postMessage({ type: 'navigate', url: targetUrl })
            return
          }
        } catch { /* ignore parse errors */ }
      }

      // 열린 탭 없으면 새 창
      return self.clients.openWindow(targetUrl)
    })
  )
})

// pushsubscriptionchange — 푸시 서비스가 endpoint 를 갱신할 때 발생.
// 새 구독 생성 + 백엔드에 알림. 현재 단순화 위해 로깅만 — 다음 페이지 진입 시
// 프론트가 자동 재구독 하는 패턴으로 처리.
self.addEventListener('pushsubscriptionchange', (event) => {
  console.log('[sw] pushsubscriptionchange — 다음 페이지 진입 시 재구독 예정')
})
