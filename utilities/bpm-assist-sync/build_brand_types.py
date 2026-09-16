# -*- coding: utf-8 -*-
"""
collected_YYYY-MM-DD.json (collect_product_types.js 가 내려준 파일) → Downloads\bpm-assist\brand_types.js (EXT_DIR)

사용법:
  python build_brand_types.py collected_2026-09-16.json
"""
import json, sys, os, datetime, collections

src = sys.argv[1] if len(sys.argv) > 1 else sorted(f for f in os.listdir('.') if f.startswith('collected_') and f.endswith('.json'))[-1]
EXT_DIR = r'C:\Users\MIP James\Downloads\bpm-assist'  # 확장 소스 위치 (release.bat bpm-assist 가 zip 으로 묶는 폴더)
out = os.path.join(EXT_DIR, 'brand_types.js')

d = json.load(open(src, encoding='utf-8'))
clients = d['clients']
brands = {}
std_of = {}
for c in clients:
    types = c.get('types') or []
    names = []
    for t in types:
        if (t.get('useYn') or 'Y') != 'Y':
            continue
        n = (t.get('name') or '').strip()
        if not n or n in names:
            continue
        names.append(n)
        std_of[n] = (t.get('std') or '').strip()
    if names:
        brands[c['name'].strip()] = sorted(names, key=lambda s: s.lower())

synced = d.get('fetchedAt', '')[:10] or datetime.date.today().isoformat()
lines = []
lines.append('/**')
lines.append(' * MIP BPM 검수 어시스트 - 브랜드(고객사)별 상품 유형 목록  ※ 자동 생성 파일, 직접 편집 금지')
lines.append(' *')
lines.append(f' * 출처 : BPM ADMIN > 고객사 관리 > (바로 가기) 상품 유형  —  {synced} 동기화')
lines.append(f' * 범위 : 권리자(BRD) 고객사 {d.get("brdClients", len(clients))}곳 중 상품 유형이 등록된 {len(brands)}곳')
lines.append(' * 갱신 : Claude Project/utilities/bpm-assist-sync/README.md 절차 (collect_product_types.js → build_brand_types.py)')
lines.append(' *')
lines.append(' * 값은 BPM 판매 정보 상세의 [상품 유형] 드롭다운에 그대로 나오는 문자열입니다.')
lines.append(' * 같은 뜻이라도 브랜드마다 표기가 다르므로(Bag / Bags / bag …) dict.js 의 세부 유형을')
lines.append(' * resolveBrandType() 으로 이 목록의 실제 값에 맞춰 변환해 사용합니다.')
lines.append(' */')
lines.append(f'const BRAND_TYPES_META = {json.dumps({"syncedAt": synced, "brands": len(brands), "brdClients": d.get("brdClients", len(clients))}, ensure_ascii=False)};')
lines.append('')
lines.append('const BRAND_PRODUCT_TYPES = {')
for name in sorted(brands, key=lambda s: s.lower()):
    lines.append(f'  {json.dumps(name, ensure_ascii=False)}: {json.dumps(brands[name], ensure_ascii=False)},')
lines.append('};')
lines.append('')
lines.append('/** 상품 유형 표기 → BPM 표준 상품 유형 (참고용, 패널 툴팁) */')
lines.append('const BRAND_TYPE_STD = {')
for n in sorted(std_of, key=lambda s: s.lower()):
    lines.append(f'  {json.dumps(n, ensure_ascii=False)}: {json.dumps(std_of[n], ensure_ascii=False)},')
lines.append('};')
lines.append('')
open(out, 'w', encoding='utf-8', newline='\n').write('\n'.join(lines))
print(f'wrote {os.path.normpath(out)}  brands={len(brands)}  distinct type names={len(std_of)}  size={os.path.getsize(out):,} bytes')
