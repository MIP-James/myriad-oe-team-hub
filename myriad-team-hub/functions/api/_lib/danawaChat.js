/**
 * 다나와 최저가 모니터링 — 구글 챗 메시지(cardsV2) 만들기 + 전송.
 */
import { danawaUrl } from './danawa.js'

export async function postChat(webhook, message) {
  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(message)
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    if (/API key not valid/i.test(t)) {
      throw new Error('구글 챗 웹훅 주소의 key 가 올바르지 않습니다 (가려진 •••• 상태로 복사됐을 수 있음). 설정에서 전체 주소를 다시 붙여넣어 주세요.')
    }
    throw new Error(`구글 챗 응답 ${res.status} ${t.slice(0, 200)}`)
  }
}

const won = (n) => (n == null ? '-' : `${Number(n).toLocaleString('ko-KR')}원`)

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function sellerLine(l) {
  const s = l.seller || {}
  const name = s.sellerName || l.mallName
  const extra = [s.company && s.company !== name ? s.company : null, s.ceo].filter(Boolean).join(' · ')
  return `<b>${esc(name)}</b>${extra ? ` (${esc(extra)})` : ''}`
}

function listingSection(l, i, extraButtons = []) {
  const s = l.seller || {}
  const widgets = [
    {
      decoratedText: {
        topLabel: `${l.mallName}${l.isNew ? ' · 🆕 새 판매처' : ''}`,
        text: sellerLine(l),
        startIcon: { knownIcon: 'STORE' },
        wrapText: true
      }
    },
    {
      decoratedText: {
        topLabel: '가격',
        text: `<b>${won(l.price)}</b>${l.shipping ? ` · ${esc(l.shipping)}` : ''}`,
        startIcon: { knownIcon: 'DOLLAR' }
      }
    }
  ]
  if (s.address) {
    widgets.push({
      decoratedText: {
        topLabel: s.overseas ? '🚩 사업장 소재지 (해외 추정)' : '사업장 소재지',
        text: esc(s.address),
        startIcon: { knownIcon: 'MAP_PIN' },
        wrapText: true
      }
    })
  }
  if (s.bizNo) {
    widgets.push({ decoratedText: { topLabel: '사업자등록번호', text: esc(s.bizNo) } })
  }
  if (l.sellerStatus === 'error') {
    widgets.push({ textParagraph: { text: `<i>판매자 정보 조회 실패 — 상품 페이지에서 확인 필요</i>` } })
  }
  const buttons = []
  if (l.productUrl) buttons.push({ text: '상품 보기', onClick: { openLink: { url: l.productUrl } } })
  if (s.storeUrl) buttons.push({ text: '판매자 스토어', onClick: { openLink: { url: s.storeUrl } } })
  buttons.push(...extraButtons)
  if (buttons.length) widgets.push({ buttonList: { buttons } })
  return { header: `${i + 1}. ${l.mallName}`, widgets }
}

export function buildChangeMessage({ product, listings, prevPrice, firstCheck, hubUrl }) {
  const label = product.brand ? `[${product.brand}] ` : ''
  let headline
  if (firstCheck) headline = `👀 ${label}다나와 모니터링 시작 — 현재 최저가 ${won(product.last_lowest_price)}`
  else if (prevPrice != null && product.last_lowest_price < prevPrice) {
    headline = `🔻 ${label}다나와 최저가 하락 ${won(prevPrice)} → ${won(product.last_lowest_price)} (▼${(prevPrice - product.last_lowest_price).toLocaleString('ko-KR')}원)`
  } else if (prevPrice != null && product.last_lowest_price > prevPrice) {
    headline = `🔺 ${label}다나와 최저가 상승 ${won(prevPrice)} → ${won(product.last_lowest_price)}`
  } else headline = `🔄 ${label}다나와 최저가 판매처 변경 — ${won(product.last_lowest_price)}`

  const names = listings.map((l) => `${l.mallName} ${l.seller?.sellerName || ''}`.trim()).join(', ')
  const overseas = listings.some((l) => l.seller?.overseas)

  // '다나와에서 보기'·'허브에서 보기' 는 마지막 판매처의 '판매자 스토어' 버튼 옆에 붙임 (카드당 1번)
  const linkButtons = [
    { text: '다나와에서 보기', onClick: { openLink: { url: danawaUrl(product.pcode) } } },
    { text: '허브에서 보기', onClick: { openLink: { url: hubUrl } } }
  ]
  const sections = listings.map((l, i) => listingSection(l, i, i === listings.length - 1 ? linkButtons : []))
  if (!listings.length) sections.push({ widgets: [{ buttonList: { buttons: linkButtons } }] })

  const card = {
    header: {
      title: product.name || `다나와 상품 ${product.pcode}`,
      subtitle: `최저가 ${won(product.last_lowest_price)} · 판매처 ${listings.length}곳${overseas ? ' · 🚩 해외 주소 판매자 포함' : ''}`
    },
    sections
  }
  if (product.image_url) {
    card.header.imageUrl = product.image_url
    card.header.imageType = 'SQUARE'
  }
  return {
    text: `${headline}\n현재 최저가 판매자: ${names}`,
    cardsV2: [{ cardId: `danawa-${product.id}-${Date.now()}`, card }]
  }
}

export function buildSummaryMessage(products, hubUrl) {
  const sections = products.map((p) => {
    const ls = p.last_listings || []
    const widgets = ls.length
      ? ls.map((l) => ({
          decoratedText: {
            topLabel: `${l.mallName}${l.seller?.overseas ? ' · 🚩 해외 추정' : ''}`,
            text: `${sellerLine(l)} — ${won(l.price)}`,
            wrapText: true,
            button: l.productUrl ? { text: '보기', onClick: { openLink: { url: l.productUrl } } } : undefined
          }
        }))
      : [{ textParagraph: { text: p.last_error ? `⚠️ 확인 실패: ${esc(p.last_error)}` : '아직 확인 전' } }]
    return {
      header: `${p.brand ? `[${esc(p.brand)}] ` : ''}${esc(p.name || p.pcode)} · ${won(p.last_lowest_price)}`,
      collapsible: false,
      widgets
    }
  })
  sections.push({
    widgets: [{ buttonList: { buttons: [{ text: '허브에서 보기', onClick: { openLink: { url: hubUrl } } }] } }]
  })
  const today = new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short' })
  return {
    text: `📋 ${today} 다나와 최저가 현황 (${products.length}개 상품)`,
    cardsV2: [{
      cardId: `danawa-summary-${Date.now()}`,
      card: { header: { title: '다나와 최저가 현황', subtitle: today }, sections }
    }]
  }
}
