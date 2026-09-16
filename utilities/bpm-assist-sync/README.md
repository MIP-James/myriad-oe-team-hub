# bpm-assist-sync — 브랜드별 상품 유형 목록 재동기화 도구

확장 소스 `C:\Users\MIP James\Downloads\bpm-assist\brand_types.js` (고객사별 [상품 유형] 드롭다운 값 목록) 를 BPM ADMIN 에서 다시 받아 만드는 도구입니다.
확장 zip 에는 들어가지 않습니다 (관리자용). 이 폴더 위치: `Claude Project\utilities\bpm-assist-sync\` — 확장 소스는 여전히 `Downloads\bpm-assist\` 입니다.

## 언제 하나

- BPM ADMIN 에서 고객사의 상품 유형이 추가/변경됐을 때
- 새 고객사가 생겼는데 어시스트 상태줄에 **"⚠ 유형 목록 미수집"** 이 뜰 때
- 개편 규모가 크면 `Downloads\bpm-assist\dict.js` 의 `PRODUCT_CATEGORIES` (세부 유형·표기 변형) 도 함께 점검

## 절차 (약 5분)

1. 크롬에서 BPM ADMIN 로그인 → **고객사 관리** 목록 (`/oms/config/client_list.do`)
2. `F12` → Console → `collect_product_types.js` 내용 전체 붙여넣기 → Enter
   - [조회]를 한 번 자동 클릭해 인증 헤더를 잡은 뒤, 권리자 고객사 전체(약 640곳)의 상품 유형을 내려받습니다 (10~20초)
   - `collected_YYYY-MM-DD.json` 이 다운로드됩니다
3. 내려받은 파일을 이 폴더로 이동 후:
   ```
   cd /d "C:\Users\MIP James\Downloads\Claude Project\utilities\bpm-assist-sync"
   python build_brand_types.py collected_YYYY-MM-DD.json
   node test_resolver.js
   ```
   - `Downloads\bpm-assist\brand_types.js` 가 다시 생성됩니다 (출력 경로 = `build_brand_types.py` 의 `EXT_DIR`)
   - `test_resolver.js` 로 세부 유형 → 브랜드 값 변환이 잘 되는지 표본 확인 (unresolved 가 급증하면 새 표기가 생긴 것 → `dict.js` aliases 보강)
4. 재배포:
   ```
   cd /d "C:\Users\MIP James\Downloads\Claude Project\admin-scripts"
   release.bat bpm-assist "브랜드별 상품 유형 목록 YYYY-MM-DD 동기화"
   ```

## 파일

| 파일 | 역할 |
|---|---|
| `collect_product_types.js` | 브라우저 콘솔용 수집 스크립트 (내부 API 2개: 고객사 목록 / 고객사별 상품 유형) |
| `build_brand_types.py` | 수집 JSON → `brand_types.js` 생성 |
| `test_resolver.js` | `dict.js` + `brand_types.js` 정합성 · 변환 결과 점검 |
| `collected_2026-09-16.json` | 최초 수집본 (권리자 637곳, 상품 유형 등록 287곳, 유형 2,304개) |

## 데이터 구조 메모 (2026-09-16 기준)

- 상품 유형은 **고객사별 목록**이며, 각 항목은 `표준 상품 유형(std)` 과 브랜드 표기 `상품 유형(name)` 을 가짐. 드롭다운에 보이는 값은 `name`
- 같은 뜻도 표기가 제각각: `Bag / Bags / bag`, `Merchandise (MD) / Merchandise(MD)`, `Eletronic Devices`(오타 그대로) 등 → `dict.js` 의 aliases 로 흡수
- 대표 세트
  - 패션 럭셔리(KOIPA): `Accessory · Apparel · bag · Beanie & Cap · Belts · Etc. · Eyewear · Footwear · Hair Accessory · Key Holder · Key Ring · Necktie · Scarf & Muffler · Small leather Goods`
  - 의류 세분화(베이직하우스 등): `Down Jacket · Hoodie · Jacket · Shirt · Skirt · Sweatshirt & Knitwear · T-shirt & PK shirt · Training suit · Trousers · Vest · Coat · Dress · Bag · Beanie & Cap · Etc.`
  - 아이돌 MD: `Album · Badge · Calendar · Fan · Key Holder · Key Ring · Light stick · Merchandise (MD) · Nail · Notepad · Paper cup · Photocard · Slogan · Sticker · Toy/Doll · Apparel · Bag · Stationery`
  - 캐릭터: `Plush & Toys · Stationery · Home · Key Ring · Bag · Character Merchandise (MD)`
- 일부 브랜드는 상품 유형 자리에 **모델명**을 넣어 둠 (러닝화 모델 18개, 아이웨어 모델 330개 등) → 키워드 매칭 대상이 아니므로 `Etc.` 폴백으로 흐름
