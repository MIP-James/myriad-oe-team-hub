/**
 * Cloudflare Pages Function — Web Push 발송 (internal — Postgres trigger 가 호출).
 *
 *   POST /api/push-send
 *   Authorization: Bearer <PUSH_SEND_SECRET>
 *   Body: {
 *     notification_id, recipient_id, type, title, body, link, payload
 *   }
 *
 * 동작:
 *   1. recipient_id 의 활성 push_subscriptions 조회
 *   2. 각 구독에 대해 VAPID JWT 서명 + payload 암호화 후 endpoint 로 POST
 *   3. 응답 코드별 처리:
 *      - 2xx: last_used_at 갱신, failure_count 리셋
 *      - 404/410: 영구 만료 — 즉시 revoke
 *      - 429/5xx: failure_count 증가, 5회 누적 시 revoke
 *
 * Web Push 프로토콜 (RFC 8030/8188/8291) 을 Web Crypto API 로 hand-rolled 구현.
 * 외부 라이브러리 의존 없음 (Cloudflare Workers 환경 호환).
 */
import { createClient } from '@supabase/supabase-js'

export async function onRequestPost(context) {
  const { request, env } = context
  try {
    // ── 인증 (PUSH_SEND_SECRET) ────────────────────────────
    const authHeader = request.headers.get('Authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '')
    if (!env.PUSH_SEND_SECRET || token !== env.PUSH_SEND_SECRET) {
      return json({ error: '인증 실패' }, 401)
    }

    if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) {
      return json({ error: 'VAPID 환경변수 누락' }, 500)
    }
    if (!env.SUPABASE_SERVICE_ROLE_KEY) {
      return json({ error: 'SUPABASE_SERVICE_ROLE_KEY 누락' }, 500)
    }

    let body
    try {
      body = await request.json()
    } catch {
      return json({ error: 'JSON parse 실패' }, 400)
    }

    const recipientId = body.recipient_id
    if (!recipientId) return json({ error: 'recipient_id 필수' }, 400)

    const adminSb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    })

    // 활성 구독 fetch
    const { data: subs, error } = await adminSb
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth, failure_count')
      .eq('user_id', recipientId)
      .is('revoked_at', null)
    if (error) return json({ error: 'subs 조회 실패: ' + error.message }, 500)
    if (!subs || subs.length === 0) {
      return json({ ok: true, sent: 0, no_subs: true })
    }

    // SW 에 전달할 payload
    const targetUrl = body.link || resolveDefaultUrl(body.type, body.payload)
    const pushPayload = {
      title: body.title || 'MYRIAD Team Hub',
      body: body.body || '',
      url: targetUrl,
      notification_id: body.notification_id,
      tag: 'myriad-' + (body.type || 'general'),
      renotify: false
    }
    const payloadStr = JSON.stringify(pushPayload)

    const results = []
    for (const sub of subs) {
      try {
        const status = await sendPush(sub, payloadStr, env)
        if (status === 410 || status === 404) {
          await adminSb
            .from('push_subscriptions')
            .update({
              revoked_at: new Date().toISOString(),
              last_error: `HTTP ${status}`
            })
            .eq('id', sub.id)
          results.push({ id: sub.id, status, action: 'revoked' })
        } else if (status >= 200 && status < 300) {
          await adminSb
            .from('push_subscriptions')
            .update({
              last_used_at: new Date().toISOString(),
              failure_count: 0,
              last_error: null
            })
            .eq('id', sub.id)
          results.push({ id: sub.id, status, action: 'sent' })
        } else {
          // transient 실패 — 5회 누적 시 revoke
          const newCount = (sub.failure_count || 0) + 1
          const updates = {
            failure_count: newCount,
            last_error: `HTTP ${status}`
          }
          if (newCount >= 5) {
            updates.revoked_at = new Date().toISOString()
          }
          await adminSb
            .from('push_subscriptions')
            .update(updates)
            .eq('id', sub.id)
          results.push({
            id: sub.id,
            status,
            action: newCount >= 5 ? 'revoked' : 'failed'
          })
        }
      } catch (e) {
        results.push({
          id: sub.id,
          error: String(e?.message || e),
          action: 'error'
        })
      }
    }

    return json({
      ok: true,
      sent: results.filter((r) => r.action === 'sent').length,
      total: subs.length,
      results
    })
  } catch (e) {
    return json({ error: '서버 오류: ' + (e?.message || String(e)) }, 500)
  }
}

// =============================================================
// Web Push 단일 발송
// =============================================================
async function sendPush(subscription, payloadStr, env) {
  const endpoint = subscription.endpoint
  const url = new URL(endpoint)
  const audience = `${url.protocol}//${url.host}`

  const jwt = await createVapidJwt(
    audience,
    env.VAPID_SUBJECT,
    env.VAPID_PRIVATE_KEY,
    env.VAPID_PUBLIC_KEY
  )

  const encryptedBody = await encryptPayload(
    payloadStr,
    subscription.p256dh,
    subscription.auth
  )

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400'                          // 1일 보관 후 푸시 서비스가 폐기
    },
    body: encryptedBody
  })

  return res.status
}

// =============================================================
// VAPID JWT 서명 (ES256)
// =============================================================
async function createVapidJwt(audience, subject, privateKeyB64, publicKeyB64) {
  const header = { typ: 'JWT', alg: 'ES256' }
  const claims = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,    // 12시간 유효
    sub: subject
  }

  const encoder = new TextEncoder()
  const headerB64 = b64urlEncode(encoder.encode(JSON.stringify(header)))
  const claimsB64 = b64urlEncode(encoder.encode(JSON.stringify(claims)))
  const signingInput = `${headerB64}.${claimsB64}`

  const cryptoKey = await importVapidKey(privateKeyB64, publicKeyB64)
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    cryptoKey,
    encoder.encode(signingInput)
  )

  return `${signingInput}.${b64urlEncode(new Uint8Array(sig))}`
}

async function importVapidKey(privateKeyB64, publicKeyB64) {
  const pubBytes = b64urlDecode(publicKeyB64)
  if (pubBytes.length !== 65 || pubBytes[0] !== 0x04) {
    throw new Error('VAPID public key must be uncompressed P-256 (65 bytes)')
  }
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    d: privateKeyB64,
    x: b64urlEncode(pubBytes.slice(1, 33)),
    y: b64urlEncode(pubBytes.slice(33, 65)),
    ext: true
  }
  return await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  )
}

// =============================================================
// Payload 암호화 (RFC 8291 + RFC 8188 aes128gcm)
// =============================================================
async function encryptPayload(payload, recipientP256dhB64, recipientAuthB64) {
  const recipientPubBytes = b64urlDecode(recipientP256dhB64)
  const recipientAuthBytes = b64urlDecode(recipientAuthB64)

  // 1. ephemeral ECDH key pair (application server)
  const ephemeralKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  )
  const ephemeralPubRaw = await crypto.subtle.exportKey('raw', ephemeralKeyPair.publicKey)
  const ephemeralPubBytes = new Uint8Array(ephemeralPubRaw)

  // 2. recipient public key import
  const recipientPubKey = await crypto.subtle.importKey(
    'raw',
    recipientPubBytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  )

  // 3. ECDH shared secret
  const sharedSecretBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: recipientPubKey },
    ephemeralKeyPair.privateKey,
    256
  )
  const sharedSecret = new Uint8Array(sharedSecretBits)

  // 4. PRK_key = HKDF(salt=auth, IKM=shared, info="WebPush: info\0"||ua_pub||as_pub, L=32)
  const wpInfo = concatBytes(
    new TextEncoder().encode('WebPush: info\0'),
    recipientPubBytes,
    ephemeralPubBytes
  )
  const ikm = await hkdf(recipientAuthBytes, sharedSecret, wpInfo, 32)

  // 5. random salt (16 bytes)
  const salt = crypto.getRandomValues(new Uint8Array(16))

  // 6. CEK + nonce (HKDF with salt as salt, ikm as IKM)
  const cek = await hkdf(
    salt,
    ikm,
    new TextEncoder().encode('Content-Encoding: aes128gcm\0'),
    16
  )
  const nonce = await hkdf(
    salt,
    ikm,
    new TextEncoder().encode('Content-Encoding: nonce\0'),
    12
  )

  // 7. plaintext = payload || 0x02 (delimiter — last record)
  const payloadBytes = typeof payload === 'string'
    ? new TextEncoder().encode(payload)
    : payload
  const plaintext = new Uint8Array(payloadBytes.length + 1)
  plaintext.set(payloadBytes)
  plaintext[payloadBytes.length] = 0x02

  // 8. AES-128-GCM encrypt
  const cekKey = await crypto.subtle.importKey(
    'raw',
    cek,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  )
  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    cekKey,
    plaintext
  )
  const ciphertext = new Uint8Array(ciphertextBuf)

  // 9. aes128gcm encoded message:
  //    salt(16) || rs(4) || idlen(1) || keyid(idlen=65) || ciphertext
  const recordSize = 4096
  const rs = new Uint8Array([
    (recordSize >>> 24) & 0xff,
    (recordSize >>> 16) & 0xff,
    (recordSize >>> 8) & 0xff,
    recordSize & 0xff
  ])
  return concatBytes(
    salt,
    rs,
    new Uint8Array([ephemeralPubBytes.length]),
    ephemeralPubBytes,
    ciphertext
  )
}

// =============================================================
// HKDF (HMAC-SHA256, 단일 블록 출력)
// =============================================================
async function hkdf(salt, ikm, info, length) {
  if (length > 32) throw new Error('hkdf length > 32 not supported here')
  // Extract: PRK = HMAC(salt, IKM)
  const saltKey = await crypto.subtle.importKey(
    'raw',
    salt,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const prkBuf = await crypto.subtle.sign('HMAC', saltKey, ikm)
  // Expand: T(1) = HMAC(PRK, info||0x01) [첫 32바이트 — length<=32 이라 충분]
  const prkKey = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(prkBuf),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const t1Buf = await crypto.subtle.sign(
    'HMAC',
    prkKey,
    concatBytes(info, new Uint8Array([0x01]))
  )
  return new Uint8Array(t1Buf).slice(0, length)
}

// =============================================================
// 유틸
// =============================================================
function concatBytes(...arrays) {
  let total = 0
  for (const a of arrays) total += a.length
  const out = new Uint8Array(total)
  let offset = 0
  for (const a of arrays) {
    out.set(a, offset)
    offset += a.length
  }
  return out
}

function b64urlEncode(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let str = ''
  for (let i = 0; i < u8.length; i++) str += String.fromCharCode(u8[i])
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(s) {
  let normalized = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = (4 - (normalized.length % 4)) % 4
  normalized += '='.repeat(pad)
  const bin = atob(normalized)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function resolveDefaultUrl(type, payload) {
  // 알림 종류별 기본 navigate URL — notifications.link 가 비어있을 때 fallback
  const caseId = payload?.case_id
  if (caseId && (type === 'case_inbound_assigned' || type?.startsWith('case_') || type?.startsWith('task_'))) {
    return `/cases/${caseId}`
  }
  if (type?.startsWith('team_schedule')) return '/schedules'
  return '/'
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  })
}
