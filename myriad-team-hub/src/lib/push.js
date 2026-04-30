// =============================================================
// PWA push subscription 헬퍼
//
// 흐름:
//   isPushSupported() → 브라우저 호환성 체크
//   getPermissionState() → granted/denied/default/unsupported
//   subscribePush() → 권한 요청 + SW 구독 + 백엔드 등록
//   unsubscribePush() → SW 구독 해제 + 백엔드 회수
//   getCurrentSubscription() → 현재 구독 객체 (없으면 null)
// =============================================================
import { supabase } from './supabase'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY

export function isPushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

export function getPermissionState() {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission   // 'default' | 'granted' | 'denied'
}

export async function getCurrentSubscription() {
  if (!isPushSupported()) return null
  try {
    const reg = await navigator.serviceWorker.ready
    return await reg.pushManager.getSubscription()
  } catch {
    return null
  }
}

/** 권한 요청 + 구독 + 백엔드 저장. 이미 구독돼있으면 그대로 반환. */
export async function subscribePush() {
  if (!isPushSupported()) {
    throw new Error('이 브라우저는 PC 알림을 지원하지 않습니다.')
  }
  if (!VAPID_PUBLIC_KEY) {
    throw new Error('VAPID 공개키가 설정되지 않았습니다 (관리자 환경변수 확인).')
  }

  const perm = await Notification.requestPermission()
  if (perm !== 'granted') {
    if (perm === 'denied') {
      throw new Error('알림이 차단되었습니다. Chrome 주소창 왼쪽 자물쇠 → 알림 → 허용으로 변경 후 다시 시도하세요.')
    }
    throw new Error('알림 권한 요청이 닫혔습니다.')
  }

  const reg = await navigator.serviceWorker.ready
  let subscription = await reg.pushManager.getSubscription()
  if (!subscription) {
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    })
  }

  // 백엔드 저장
  const json = subscription.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error('subscription 정보가 불완전합니다.')
  }

  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) {
    throw new Error('로그인 세션을 확인할 수 없습니다.')
  }

  const res = await fetch('/api/push-subscribe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`
    },
    body: JSON.stringify({
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      user_agent: navigator.userAgent.slice(0, 200)
    })
  })
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}))
    throw new Error(errBody?.error || `구독 저장 실패: HTTP ${res.status}`)
  }
  return subscription
}

/** SW + 백엔드 양쪽 모두 회수. */
export async function unsubscribePush() {
  if (!isPushSupported()) return
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return

  const endpoint = sub.endpoint
  await sub.unsubscribe()

  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) return
  await fetch('/api/push-unsubscribe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`
    },
    body: JSON.stringify({ endpoint })
  }).catch(() => {})
}

// =============================================================
// SW 등록 + 메시지 핸들러
// =============================================================
let swRegistered = false

export async function registerServiceWorker() {
  if (swRegistered) return
  if (!('serviceWorker' in navigator)) return
  try {
    await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    swRegistered = true
  } catch (e) {
    console.warn('[sw] 등록 실패:', e?.message)
  }
}

/** SW 가 알림 클릭 시 보내는 'navigate' 메시지 처리.
 *  React Router 의 navigate() 를 받아서 라우팅 이동. */
export function attachSwNavigationListener(navigate) {
  if (!('serviceWorker' in navigator)) return () => {}
  const handler = (event) => {
    if (event.data?.type === 'navigate' && typeof event.data.url === 'string') {
      try {
        navigate(event.data.url)
      } catch {
        window.location.href = event.data.url
      }
    }
  }
  navigator.serviceWorker.addEventListener('message', handler)
  return () => navigator.serviceWorker.removeEventListener('message', handler)
}

// =============================================================
// VAPID base64url → Uint8Array (PushManager subscribe 인자용)
// =============================================================
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i)
  return out
}
