// node test_classification.js — KOIPA "AI 온라인 모니터링 품목 분류표(260915)" 회귀 테스트
// 분류표의 상세 품목 단어를 content.js 와 같은 방식(긴 키워드 우선·마스킹·제외 문맥)으로 분석해
// 기대 세부 유형으로 떨어지는지, 그리고 대표 고객사에서 분류표 BPM 유형 값으로 변환되는지 확인.
const fs = require('fs'), path = require('path');
const ext = 'C:\\Users\\MIP James\\Downloads\\bpm-assist';
eval(fs.readFileSync(path.join(ext, 'dict.js'), 'utf8') + '\n' + fs.readFileSync(path.join(ext, 'brand_types.js'), 'utf8') + `
globalThis.PRODUCT_CATEGORIES=PRODUCT_CATEGORIES; globalThis.KEYWORD_DICT=KEYWORD_DICT;
globalThis.resolveBrandType=resolveBrandType; globalThis.BRAND_PRODUCT_TYPES=BRAND_PRODUCT_TYPES;`);

// ── content.js 의 excludedByContext / analyzeText 와 동일 로직 (기본 사전만) ──
function excludedByContext(text, idx, len, nots) {
  if (!nots || !nots.length) return false;
  const end = idx + len;
  for (const raw of nots) {
    const p = String(raw || '').toLowerCase(); if (!p) continue;
    let at = text.indexOf(p, Math.max(0, idx - p.length + 1));
    while (at !== -1 && at < end) { if (at <= idx && at + p.length >= end) return true; at = text.indexOf(p, at + 1); }
  }
  return false;
}
function analyze(raw) {
  const text = raw.toLowerCase();
  const dict = [...KEYWORD_DICT].sort((a, b) => b.kw.length - a.kw.length);
  const mask = new Array(text.length).fill(false); const hits = new Map();
  for (const e of dict) {
    const n = e.kw.toLowerCase(); let i = 0;
    while ((i = text.indexOf(n, i)) !== -1) {
      let free = true; for (let j = i; j < i + n.length; j++) if (mask[j]) { free = false; break; }
      if (free && excludedByContext(text, i, n.length, e.not)) free = false;
      if (free) { for (let j = i; j < i + n.length; j++) mask[j] = true; const r = hits.get(e.kw) || { c: 0, cat: e.cat, weak: !!e.weak }; r.c++; hits.set(e.kw, r); }
      i += n.length;
    }
  }
  const sc = new Map(); for (const [, r] of hits) sc.set(r.cat, (sc.get(r.cat) || 0) + r.c * (r.weak ? 0.5 : 1));
  return [...sc.entries()].sort((a, b) => b[1] - a[1]);
}
const top = (t) => (analyze(t)[0] || [null])[0];

// ── 1) 분류표 상세 품목 → 기대 세부 유형 (1순위) ──
const EXPECT = {
  // 일반
  '가방': 'Bag', '핸드백': 'Bag', '신발': 'Shoes', '운동화': 'Shoes', '슬리퍼': 'Shoes', '구두': 'Shoes',
  '지갑': 'Wallet', '동전지갑': 'Wallet', '머니클립': 'Wallet', '손목시계': 'Watches', '탁상시계': 'Watches', '벽걸이시계': 'Watches',
  '담요': 'Blanket', '커튼': 'Blanket', '카펫': 'Blanket', '매트': 'Blanket', '도어매트': 'Blanket',
  '포토카드': 'Photocard', '스티커': 'Sticker', '앨범': 'Album', '메모지': 'Notepad', '뱃지': 'Badge', '부채': 'Fan', '네일': 'Nail',
  '종이컵': 'Paper cup', '슬로건': 'Slogan', '달력': 'Calendar', '응원봉': 'Light stick', '마그넷': 'Magnet', '자석': 'Magnet',
  '아크릴스탠드': 'Stand', '아크릴 스탠드': 'Stand', '우산': 'Umbrella',
  // 건강&안전 — 의류
  '바지': 'Trousers', '겉옷': 'Apparel', '외투': 'Apparel', '속옷': 'Underwear', '스웨터': 'Sweatshirt & Knitwear', '셔츠': 'Shirt',
  '한복': 'Apparel', '양말': 'Socks', '스타킹': 'Socks',
  // 소품
  '안경': 'Eyewear', '선글라스': 'Eyewear', '휴대폰줄': 'Plush & Toys', '마스크줄': 'Plush & Toys',
  '벨트': 'Belts', '목도리': 'Scarf & Muffler', '스카프': 'Scarf & Muffler', '넥타이': 'Necktie', '장갑': 'Gloves', '모자': 'Beanie & Cap',
  '머리핀': 'Hair Accessory', '헤어밴드': 'Hair Accessory', '가발': 'Hair Accessory',
  '휴대폰케이스': 'Cellphone Case', '명함케이스': 'Cellphone Case', '이어폰케이스': 'Cellphone Case',
  '여권홀더': 'Key Holder', '여권커버': 'Key Holder', '키홀더': 'Key Holder', '키링': 'Key Ring',
  '거울': 'Mirror', '액자': 'Frame',
  // 액세서리
  '귀금속': 'Jewelry', '보석': 'Jewelry', '팔찌': 'Jewelry', '목걸이': 'Jewelry', '반지': 'Jewelry', '귀걸이': 'Jewelry', '피어싱': 'Jewelry', '액세서리': 'Accessory',
  // 화장품
  '화장품': 'Cosmetics & Beauty supplies', '향수': 'Fragrance', '염색약': 'Hair Care', '향초': 'Fragrance', '방향제': 'Fragrance',
  // 유아동
  '완구': 'Plush & Toys', '인형': 'Plush & Toys', '장난감': 'Plush & Toys',
  // 기타(건강&안전)
  '화학제품': 'Household Chemicals', '폭죽': 'Household Chemicals', '세제': 'Household Chemicals',
  '스포츠용품': 'Gear', '라켓': 'Gear', '축구공': 'Ball', '골프클럽': 'Club', '퍼터': 'Club', '게임 콘솔기기': 'Game Console', '닌텐도 스위치': 'Game Console', '보트': 'Gear',
  '가구': 'Furniture', '조명기구': 'Furniture', '장식용품': 'Furniture', '사이드테이블': 'Furniture',
  '가전': 'Home Appliances', '안마기기': 'Home Appliances', '전자제품': 'Electronic Devices',
  '주방소품': 'Home', '접시': 'Plate', '머그컵': 'Cup', '식품': 'Health Supplements', '치약': 'Oral Care',
  // 분류표 빈칸 행 → Etc.
  '애완동물용 의류': 'Etc.', '부품': 'Etc.', '부속품': 'Etc.', '기계류': 'Etc.', '자동차': 'Etc.', '수공구': 'Etc.',
  '라이터': 'Etc.', '승강기': 'Etc.', '건설자재': 'Etc.', '가스기기': 'Etc.', '레이저 포인터': 'Etc.', '보호장비': 'Etc.', '측정장비': 'Etc.',
};

// ── 2) 오탐 차단 (제외 문맥) — 해당 유형이 잡히면 실패 ──
const MUST_NOT = [
  ['측정장비', 'Suit'], ['추가발송', 'Hair Accessory'], ['백화점 정품', 'Bag'], ['백금 반지', 'Bag'],
  ['매트 립스틱', 'Blanket'], ['공구 진행합니다', 'Etc.'], ['카피라이터', 'Etc.'], ['address', 'Dress'], ['coating', 'Coat'],
  ['string', 'Jewelry'], ['capsule', 'Beanie & Cap'], ['what a day', 'Beanie & Cap'], ['쇼케이스', 'Cellphone Case'],
  ['미키마우스 인형', 'Electronic Devices'], ['보드게임', 'Game Console'], ['미개봉', 'Light stick'], ['카펫', 'Etc.'],
];

// ── 3) 대표 고객사에서 분류표 BPM 유형 값으로 변환 ──
const RESOLVE = [
  ['K_발렌시아가', '양말', 'Apparel'],           // 분류표: 양말 = Apparel (v1.1 은 Accessory)
  ['K_발렌시아가', '지갑', 'Small leather Goods'],
  ['K_발렌시아가', '여권홀더', 'Key Holder'],
  ['K_발렌시아가', '운동화', 'Footwear'],
  ['K_블랙핑크', '휴대폰줄', 'Toy/Doll'],        // 분류표: 휴대폰줄 = Toy/Doll
  ['K_블랙핑크', '아크릴스탠드', 'Merchandise (MD)'], // Stand 없음 → MD 폴백
  ['K_헬로키티', '거울', 'Home'],                 // Mirror 없음 → Home
  ['K_헬로키티', '접시', 'Plate'],
  ['K_헬로키티', '자석', 'Magnet'],
  ['K_헬로키티', '도어매트', 'Doormat'],
  ['K_PXG', '축구공', 'Ball'], ['K_PXG', '라켓', 'Gear'], ['K_PXG', '퍼터', 'Club'],
  ['K_애플', '이어폰케이스', 'Cellphone Case'],
  ['K_SK-II', '향초', 'Cosmetics & Beauty supplies'],
];

let fail = 0;
console.log('## 1) 분류표 상세 품목 → 세부 유형');
for (const [t, exp] of Object.entries(EXPECT)) { const got = top(t); const ok = got === exp; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${t.padEnd(12)} → ${String(got).padEnd(28)} (기대 ${exp})`); }
console.log('\n## 2) 오탐 차단');
for (const [t, bad] of MUST_NOT) { const cats = analyze(t).map(([c]) => c); const ok = !cats.includes(bad); if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  "${t}" 에서 ${bad} ${ok ? '미검출' : '검출됨!'}  [${cats.join(', ') || '없음'}]`); }
console.log('\n## 3) 고객사 변환');
for (const [b, t, exp] of RESOLVE) { const cat = top(t); const r = resolveBrandType(cat, BRAND_PRODUCT_TYPES[b]); const got = r ? r.name : null; const ok = got === exp; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${b.padEnd(12)} ${t.padEnd(8)} → ${String(cat).padEnd(20)} → ${String(got).padEnd(24)} (기대 ${exp})`); }
console.log(`\n총 ${Object.keys(EXPECT).length + MUST_NOT.length + RESOLVE.length}건, 실패 ${fail}건`);
process.exit(fail ? 1 : 0);
