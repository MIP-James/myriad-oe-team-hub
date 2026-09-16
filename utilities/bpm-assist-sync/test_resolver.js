// node test_resolver.js  — dict.js + brand_types.js 정합성/변환 결과 점검
const fs = require('fs'), path = require('path');
const ext = 'C:\\Users\\MIP James\\Downloads\\bpm-assist'; // 확장 소스 위치 (build_brand_types.py 의 EXT_DIR 과 동일)
eval(fs.readFileSync(path.join(ext, 'dict.js'), 'utf8') + '\n' + fs.readFileSync(path.join(ext, 'brand_types.js'), 'utf8') + `
globalThis.PRODUCT_CATEGORIES=PRODUCT_CATEGORIES; globalThis.CATEGORY_KEYS=CATEGORY_KEYS; globalThis.KEYWORD_DICT=KEYWORD_DICT;
globalThis.GOODS_SEARCH_MAP=GOODS_SEARCH_MAP; globalThis.CAT_CLASSES=CAT_CLASSES; globalThis.normalizeCategory=normalizeCategory;
globalThis.resolveBrandType=resolveBrandType; globalThis.BRAND_PRODUCT_TYPES=BRAND_PRODUCT_TYPES;`);

const tests = [
  ['K_발렌시아가', ['Bag','Wallet','Hoodie','Beanie & Cap','Eyewear','Jewelry','Fragrance','Plush & Toys']],
  ['BASIC HOUSE', ['Down Jacket','Hoodie','Trousers','Bag','Wallet','Shoes','Beanie & Cap','Jewelry']],
  ['K_블랙핑크', ['Photocard','Hoodie','Key Ring','Plush & Toys','Cup','Bag','Wallet']],
  ['Gucci', ['Hoodie','Wallet','Belts','Eyewear','Plush & Toys']],
  ['K_SK-II', ['Cosmetics & Beauty supplies','Fragrance','Hoodie']],
  ['(주)쏠리드', ['Hoodie','Trousers','Bag','Shoes','Wallet']],
  ['K_PXG', ['Club','Ball','Hoodie','Beanie & Cap','Gloves']],
  ['K_헬로키티', ['Plush & Toys','Cup','Wallet','Stationery','Hoodie']],
];
for (const [b, fines] of tests) {
  const t = BRAND_PRODUCT_TYPES[b];
  console.log('\n##', b, t ? t.length + ' types' : 'NO ENTRY');
  for (const f of fines) { const r = resolveBrandType(f, t); console.log('  ', f.padEnd(28), '->', r ? r.name + '  [' + r.via + ']' : 'null'); }
}
let unresolved = 0, etcOnly = 0, total = 0; const noEtcBrands = new Set();
for (const [b, t] of Object.entries(BRAND_PRODUCT_TYPES)) for (const k of CATEGORY_KEYS) {
  total++; const r = resolveBrandType(k, t);
  if (!r) { unresolved++; noEtcBrands.add(b); } else if (r.via === 'etc') etcOnly++;
}
console.log('\ntotal', total, 'unresolved', unresolved, 'etc-fallback', etcOnly, 'brands w/o any Etc:', noEtcBrands.size);
const bad = KEYWORD_DICT.filter(e => !PRODUCT_CATEGORIES[e.cat]); console.log('bad cats in KEYWORD_DICT:', bad.map(e => e.kw + ':' + e.cat));
const dup = KEYWORD_DICT.map(e => e.kw.toLowerCase()).filter((k, i, a) => a.indexOf(k) !== i); console.log('dup kws:', dup);
console.log('GOODS_SEARCH_MAP missing:', CATEGORY_KEYS.filter(k => !GOODS_SEARCH_MAP[k]), 'CAT_CLASSES missing:', CATEGORY_KEYS.filter(k => !CAT_CLASSES[k]));
console.log('normalizeCategory:', ['Bags', 'footwear', 'Fragrance & Cosmetics', 'Small leather Goods', 'down jacket', 'xyz'].map(normalizeCategory));
console.log('KEYWORD_DICT size:', KEYWORD_DICT.length, 'categories:', CATEGORY_KEYS.length);
