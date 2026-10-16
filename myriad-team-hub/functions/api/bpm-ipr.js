/**
 * Cloudflare Pages Function — BPM 등록상표(IPR)·지정상품 목록 중계 (BPM Collector 전용).
 *
 *   POST /api/bpm-ipr
 *   { "secretKey": "<OMS 사용자 ID>", "clientId": "<BPM client_id>", "page": 1 }
 *
 * 응답: BPM MV-05 `POST /oms/ext/api/client/ipr/list` 응답 본문 그대로
 *       ({ code, message, data: { items[ ...goods[] ], page, pageSize, total } })
 *
 * 설계 메모:
 *  - 이 API 는 X-PUBLIC-API-KEY(서비스 간 공유키)가 필수다. 확장(알바 PC 배포)에 키를 넣으면
 *    사실상 공개되므로, 키는 Cloudflare 환경변수 BPM_PUBLIC_API_KEY 에만 두고 여기서 붙인다.
 *  - 호출자 인증 = 요청의 secretKey(OMS 사용자 ID)를 BPM 이 그대로 검증한다(E1003).
 *    즉 BPM 에 유효한 계정이 있는 사람만 결과를 받는다. 허브 토큰을 따로 두지 않은 이유:
 *    Collector 는 이미 이 secretKey 로 BPM 에 직접 등록 중이고, 알바 PC 마다 허브 토큰을
 *    발급·입력시키는 부담이 크다.
 *  - 남용 방지: 경로는 ipr/list 하나로 고정하고, 요청 본문은 받은 값을 그대로 넘기지 않고
 *    여기서 다시 조립한다(clientId 1개·includeGoods 고정·pageSize 200 고정).
 *  - 응답은 파싱하지 않고 스트림으로 그대로 돌려준다. 브랜드에 따라 페이지당 1MB 이상이라
 *    JSON 파싱을 하면 무료 플랜 CPU 한도(10ms)를 넘을 수 있다. 축약·캐시는 확장이 한다.
 */

const BPM_HOST = 'https://bpm-admin.myriadip.com'
const IPR_LIST_PATH = '/oms/ext/api/client/ipr/list'
const PAGE_SIZE = 200 // includeGoods=true 일 때 서버 상한(E2057)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function onRequestPost(context) {
  const { request, env } = context
  try {
    if (!env.BPM_PUBLIC_API_KEY) {
      return json({ code: 'PROXY_CONFIG', message: 'BPM_PUBLIC_API_KEY 환경변수가 없습니다.' }, 500)
    }

    let req
    try {
      req = await request.json()
    } catch {
      return json({ code: 'PROXY_BAD_REQUEST', message: '요청 본문이 JSON 이 아닙니다.' }, 400)
    }

    const secretKey = String(req?.secretKey || '').trim()
    const clientId = String(req?.clientId || '').trim()
    const page = Number(req?.page || 1)
    if (!/^[\w.@-]{4,100}$/.test(secretKey)) {
      return json({ code: 'PROXY_BAD_REQUEST', message: 'secretKey 형식이 올바르지 않습니다.' }, 400)
    }
    if (!/^[\w-]{1,64}$/.test(clientId)) {
      return json({ code: 'PROXY_BAD_REQUEST', message: 'clientId 형식이 올바르지 않습니다.' }, 400)
    }
    if (!Number.isInteger(page) || page < 1 || page > 100) {
      return json({ code: 'PROXY_BAD_REQUEST', message: 'page 는 1~100 정수여야 합니다.' }, 400)
    }

    const upstream = await fetch(BPM_HOST + IPR_LIST_PATH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-PUBLIC-API-KEY': env.BPM_PUBLIC_API_KEY
      },
      body: JSON.stringify({
        secretKey,
        clientIds: [clientId],
        includeGoods: true,
        page,
        pageSize: PAGE_SIZE
      })
    })

    // 본문은 그대로 스트리밍 — 실패 여부는 확장이 body.code 로 판단(BPM 관례: HTTP 200 + code)
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') || 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        ...CORS
      }
    })
  } catch (e) {
    return json({ code: 'PROXY_ERROR', message: '중계 오류: ' + (e?.message || String(e)) }, 502)
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS }
  })
}
