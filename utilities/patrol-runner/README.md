# 자동 수집 실행기 (1단계 — 수동 실행, 엑셀 저장)

키워드를 오픈마켓에서 **신규순**으로 검색해, **처음 보는 상품 URL만** 엑셀로 뽑습니다.
상세 수집·스크린샷·중복 체크는 BPM `작업 추가 (URL)` 가 그대로 맡습니다.

## 채집용 노트북으로 옮기기
1. 개발 PC 의 `Downloads\patrol-runner.zip`(keywords.local.json 포함 — 외부 공유 금지)을 노트북에 복사 후 압축 해제
2. Python 3.13 설치 (python.org, "Add python.exe to PATH" 체크) + Chrome 설치 확인
3. `setup_patrol.bat` 실행 (playwright·openpyxl 설치)
4. `run_patrol.bat --login` → 뜬 크롬에서 네이버 로그인 (**로그인 상태 유지** 체크)
   `run_patrol.bat --login coupang` → 열린 쿠팡 홈에서 오른쪽 위 로그인 (**자동 로그인** 체크 필수, 끝나면 크롬을 껐다 켜서 유지 확인) — 로그인 안 하면 쿠팡은 1페이지만 보여 줌
5. 시험: `run_patrol.bat --limit 2 --pages 1 --dry` → 스마트스토어: `run_patrol.bat --platforms smartstore --limit 2 --pages 2 --dry`
- 자동 수집 프로필·본 상품 기록은 PC 마다 따로 → 노트북 첫 자동 수집은 전부 "처음 본 상품"

## 준비 (1회)
```
py -3.13 -m pip install playwright openpyxl
copy keywords.example.json keywords.local.json   (내용 채우기)
```
- 브라우저는 PC 에 설치된 Chrome 을 씁니다 (Playwright 브라우저 다운로드 불필요).
- `keywords.local.json` 은 gitignore — **가격 상한 등 기준값은 공개 레포에 올리지 않습니다.**

## 실행
```
run_patrol.bat                                       전체 (설정 파일 기준)
run_patrol.bat --platforms auction --limit 2 --pages 1 --dry   시험
```
| 옵션 | 뜻 |
|---|---|
| `--platforms` | `gmarket,auction,smartstore,11st,coupang` (기본 = 설정 파일 순서) |
| `--login [coupang]` | 자동 수집 크롬에 로그인 (생략 = 네이버) |
| `--pages` | 키워드당 페이지 수 (기본 = 설정 파일 `pages`) |
| `--limit` | 앞에서부터 키워드 N개만 |
| `--bot-wait` | 봇 확인 대기 분 (기본 30) |
| `--dry` | 본 상품 기록을 남기지 않음 |

결과: `output\patrol_YYYY-MM-DD_HHMM.xlsx` — 시트 `신규` / `제외`(사유 포함) / `실행 요약`.

## 후처리 — 등급 분류 (`triage.py`)
설정 파일에 `"triage"` 가 있으면 자동 수집 엑셀이 등급별 시트로 나옵니다. 이미 나온 엑셀은 `py -3.13 triage.py output\patrol_….xlsx` 로 재분류(`_triage.xlsx`).

| 등급 | 뜻 | 기준 |
|---|---|---|
| A 바로 BPM | 그대로 BPM URL 작업에 넣어도 됨 | 브랜드 **바로 옆** 정품 표방어("애플 정품", "Apple 로고"), 공식 제품 라인명 사칭, 또는 재침해자 판매자 |
| B 검토 | 사람이 디자인 확인 | 관련어 있음 + 판매자 규모 정상. 호환품은 디자인 모방 여부로 갈리므로 제목만으론 A 불가 |
| C 참고 | 우선순위 낮음 | 관련어 없음 / one-off 의심 판매자 / 부속·잡음(카드지갑·그립톡 등) |
| X 제외 | 안 봄 | 공식 판매처, BPM 에 이미 등록된 URL |

- **A 는 확신 근거가 있을 때만**: 정품 표방 / 위반 확정과 같은 사진 / 재침해자. 유사 디자인만으론 B 맨 위
- one-off 판단은 **그날 자동 수집 결과 안의 판매자 리스팅 수**로 셈 (전체 재고 아님 → A 승격만 막음, 같은 사진이면 예외)
- **썸네일 ↔ 위반 확정 이미지 비교** (`imgsim.py`, 기준 DB = `build_ref.py` 로 BPM sell_info_list 썸네일 삽입본에서 생성)
  - pHash + dHash 두 지문 중 큰 거리 사용, **같은 Model Type 묶음 안에서만** 비교 (흰 배경 단순 사진의 우연한 닮음 배제)
  - 거리 ≤4 = 같은 사진(+40), ≤8 = 유사(+15). 2026-10-27 보정: 무관 상품 200건 최소 거리 14, 거리 10 은 링 모양만 닮은 다른 기기
  - 갤럭시용 등 `image_first_terms` 상품: 유사 ≤8 이면 B(통과), 아니면 C
- **MFi·정식 브랜드 제외**: `build_mfi.py` 로 Apple MFi Report 엑셀 → `mfi_brands.local.json`. 영문은 단어 단위, 한글 별칭(`exclude_brand_aliases`)은 단독 단어일 때만 ('링케' ≠ '링케이스'). 수집 단계에서 '제외' 시트로
- 로컬 데이터(gitignore `*.local.*`): `keywords.local.json` / `mfi_brands.local.json` / `ref_hashes.local.npy` / `ref_meta.local.json` — 브랜드사 자료, 공개 레포 금지
- 공식 판매처·재침해자·BPM 등록 여부는 지금은 설정 파일 목록, 2단계에서 BPM client/list·타겟 보드·sell-info 조회로 자동화
- 브랜드 단어·기준값은 `keywords.local.json` 에만 (공개 레포 금지)

## BPM 연동 (`bpm.py`)
자동 수집 시작 때 자동 실행(12시간 안에 받았으면 건너뜀). 설정 = `keywords.local.json` 의 `"bpm"`(host / secret_key / public_api_key / client_id).
| 기능 | 방법 | 결과 |
|---|---|---|
| 등록 중복 제외 | sell-info/list (2025년~, 상태 무관) → 지마켓·옥션·스마트스토어·11번가는 **상품번호**, 그 외는 URL 비교 | X "BPM 등록됨" |
| 공식 판매처 | client/list 의 officialSellers | X "공식 판매처" (Apple 은 2026-10-27 기준 등록 0곳) |
| 위반 이력 판매자 | 위반 확정(INF) 게시물의 스토어명·판매자 계정 | 3건 이상 = "재침해자"(A 근거), 1~2건 = 가점. 몰 채널(`channel_sellers`: 신세계몰·현대Hmall 등)은 가점만 |
| 기준 이미지 갱신 | 기준 DB 에 없는 위반 확정 건의 대표 이미지(media API, thumb) | 자동 수집마다 최신순 최대 600건 추가 |
- 첫 동기화 = 2025·2026 전체(약 9.3만 건, 1분 내외), 이후 `updatedSince` 로 바뀐 것만. 실패하면 이전 캐시로 자동 수집 계속.
- 수동 실행: `py -3.13 bpm.py` (`--force` = 12시간 무시)
- ⚠ 지마켓·옥션 URL 은 상품번호가 `?` 뒤에 있어 URL 비교하면 전부 같은 값이 됨 → 상품번호 비교 필수

## 동작 규칙
- 크롬은 자동 수집 전용 프로필(`%LOCALAPPDATA%\MyriadPatrol\chrome-profile`)로 **평소처럼 실행한 뒤 디버그 포트(9333)로 연결**합니다. 자동 수집이 끝나면 창을 닫습니다.
- 본 상품 기록: `%LOCALAPPDATA%\MyriadPatrol\seen.json` — 한 번 본 상품번호는 다음부터 제외
  - 예외(2026-10-28): 허브에서 **판정 없이 7일이 지나 지워진 상품**은 다시 검색에 걸리면 다시 올림 (허브에 새로 7일). 판정한 상품번호(제외·상세 확인·BPM 전송 완료)는 업로드 응답으로 받아 `%LOCALAPPDATA%\MyriadPatrol\handled.json` 에 누적 → 다시 안 올림. 다시 올린 상품은 조기 종료 판단에 안 셈
- 신규순이라 **한 페이지가 통째로 이미 본 상품이면 그 키워드는 뒤 페이지를 건너뜀** (① 매일 수집)
- 매일 수집 페이지 수 = 설정 `pages` (2026-10-28 사용자 결정 3 → **20**, 결과가 먼저 끝나면 거기서 다음 키워드. 2페이지 이후 0건 = 결과 끝, 1페이지 0건만 구조 변경 의심)
  - **전체 훑기**: 키워드마다 처음 한 번은 1~`pages` 를 조기 종료 없이 끝까지 → `%LOCALAPPDATA%\MyriadPatrol\sweep.json` 기록. 플랫폼당 하루 `sweep_per_day`(기본 8)개, 차례 전 키워드는 예전처럼 3페이지. 깊게 보기는 지마켓·옥션 모두 훑기 끝난 키워드만
- **② 깊게 보기** (`deep.py`, 2026-10-28): ① 이 끝나 1차 업로드한 뒤, 지마켓·옥션만 오늘 차례 키워드를 `pages+1` ~ 마지막 페이지(상한 50)까지 → 2차 업로드(`patrol_…_deep.xlsx`)
  - 그룹 주기 상 7일 / 중 14일 / 하 30일, 하루 `per_day`(5)개, 가장 밀린 것부터. 초기 그룹 = `deep_seed.local.json`
  - 30일마다 지마켓·옥션 A×3+B 점수로 자동 재분류 (상위 1/3 상, 하위 1/3 하). 고정 = 설정 `"deep": {"pin": {"키워드": "상"}}`
  - 봇 확인은 2분만 기다림(사람 대기 없음) · 차단 · 시간 상한(150분) → 멈춘 페이지를 `%LOCALAPPDATA%\MyriadPatrol\deep.json` 에 저장, 다음 실행에서 이어감
  - 설정 `"deep"` 로 조절: `enabled` / `per_day` / `max_page` / `interval_days` / `regroup_days` / `max_minutes` / `bot_wait`. 옵션 `--no-deep`, `--deep-only`(시험)
- **③ 판매자 매장 순회** (`stores.py`, 2026-10-30): 지마켓은 사람이 주 2회 최신순으로 모니터링해 ①② 로는 새로 찾는 게 적음 → BPM 위반 확정 판매자의 미니샵에서 **그 판매자가 위반했던 Model Type 검색어로만** 매장 안 검색 → 3차 업로드(`patrol_…_stores.xlsx`, 근거 맨 앞 "판매자 매장 순회 (판매자명)")
  - 대상 = 최근 90일 안에 위반 확정이 있고 누적 2~300건인 판매자 (홈쇼핑·대형몰 채널 제외), 판매자마다 3일 주기, 최근 위반 많은 순 하루 30곳, 시간 상한 40분 → `%LOCALAPPDATA%\MyriadPatrol\stores.json`
  - 매장 주소 `minishop.gmarket.co.kr/{아이디}/List?keyword=..&page=N&pageSize=60` — Cloudflare 확인 없음. 이미 본 상품(seen.json)·BPM 등록·판정은 ①② 와 같은 규칙
  - 설정 `"stores"` 로 조절: `enabled` / `per_day` / `interval_days` / `recent_days` / `min_violations` / `max_violations` / `max_types` / `max_pages` / `max_minutes` / `exclude`(판매자 아이디) / `terms`(Model Type → 검색어). 옵션 `--no-stores`, `--stores-only`(시험)
  - 실측(10-30, BPM 캐시 10-27): 대상 356곳. 3곳 시험 = 50초, 신규 후보 49건(A 1 / B 48)
- 페이지 사이 3~7초, 스크롤은 사람 속도
- **봇 확인**(지마켓 Cloudflare) → 그 플랫폼만 멈추고 사람 클릭을 기다림 → 통과하면 재개, 시간 초과면 그날 건너뜀. **자동 클릭 없음.**
- **차단 화면**("접속 제한" 문구, 상품 안 뜸) → 같은 주소 다시 열기 최대 3회 → 그래도면 그 플랫폼 중단 + 증거 저장. 상태코드(403/418)만으로는 판정하지 않음
- 결과 0건 → "사이트 구조 변경 의심" 메모

## 플랫폼 상태 (2026-10-27)
| 플랫폼 | 상태 |
|---|---|
| 지마켓 | 동작 확인 (60건/페이지). Cloudflare 확인이 뜨지만 **크롬을 평소처럼 실행 후 연결(기본 방식)이면 몇 초 뒤 저절로 통과**. Playwright 가 직접 띄우면(`--launch`) 체크박스를 눌러도 안 풀림 |
| 옥션 | 동작 확인 (100건/페이지, 상품명·가격·판매자) |
| 11번가 | 동작 확인 (84건/페이지, 상단 광고·추천 자동 제외) |
| 스마트스토어 | 동작 확인 (키워드 2×2페이지 139건, 누락 0). 네이버 로그인 필요(`run_patrol.bat --login`, 자동 수집 크롬에서 사람이 직접 로그인 + 로그인 상태 유지). 검색 = 네이버페이 탭(`productSet=checkout`) 등록일순, 상품 데이터는 페이지의 `__NEXT_DATA__` 에서 읽음. 검색 화면이 거의 매번 418 '접속 제한'으로 먼저 오지만 **같은 주소를 다시 열면(주소창 엔터) 1회에 풀림** — F5 는 잘 안 풀림. 3회 다시 열어도 안 풀리면 차단으로 보고 `output\blocked_*.png/.txt` 남김 |
| 쿠팡 | 2026-10-28 추가, **노트북 첫 실행으로 확인 필요**. 최신순(`sorter=latestAsc`) 60건/페이지, 로그인 필수(비로그인은 2페이지부터 '검색결과가 없습니다'). 목록엔 판매자명 없음 → 판매자 기반 판정 빠짐. **파란 로켓·로켓직구 등 리테일 로켓 제외, 주황 '판매자로켓'만 수집**(배지 이미지 `logo_rocket_filter` / `logo_rocket_merchant`). 차단 화면 '사용권한이 없습니다' → 그날 쿠팡 중단 + 증거 저장. 깊게 보기 대상 아님 |
