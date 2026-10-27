# 무인 순찰 실행기 (1단계 — 수동 실행, 엑셀 저장)

키워드를 오픈마켓에서 **신규순**으로 검색해, **처음 보는 상품 URL만** 엑셀로 뽑습니다.
상세 수집·스크린샷·중복 체크는 BPM `작업 추가 (URL)` 가 그대로 맡습니다.

## 채집용 노트북으로 옮기기
1. 개발 PC 의 `Downloads\patrol-runner.zip`(keywords.local.json 포함 — 외부 공유 금지)을 노트북에 복사 후 압축 해제
2. Python 3.13 설치 (python.org, "Add python.exe to PATH" 체크) + Chrome 설치 확인
3. `setup_patrol.bat` 실행 (playwright·openpyxl 설치)
4. `run_patrol.bat --login` → 뜬 크롬에서 네이버 로그인 (**로그인 상태 유지** 체크)
5. 시험: `run_patrol.bat --limit 2 --pages 1 --dry` → 스마트스토어: `run_patrol.bat --platforms smartstore --limit 2 --pages 2 --dry`
- 순찰 프로필·본 상품 기록은 PC 마다 따로 → 노트북 첫 순찰은 전부 "처음 본 상품"

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
| `--platforms` | `gmarket,auction,11st` (스마트스토어 `smartstore` 는 아래 참고) |
| `--pages` | 키워드당 페이지 수 (기본 = 설정 파일 `pages`) |
| `--limit` | 앞에서부터 키워드 N개만 |
| `--bot-wait` | 봇 확인 대기 분 (기본 30) |
| `--dry` | 본 상품 기록을 남기지 않음 |

결과: `output\patrol_YYYY-MM-DD_HHMM.xlsx` — 시트 `신규` / `제외`(사유 포함) / `실행 요약`.

## 동작 규칙
- 크롬은 순찰 전용 프로필(`%LOCALAPPDATA%\MyriadPatrol\chrome-profile`)로 **평소처럼 실행한 뒤 디버그 포트(9333)로 연결**합니다. 순찰이 끝나면 창을 닫습니다.
- 본 상품 기록: `%LOCALAPPDATA%\MyriadPatrol\seen.json` — 한 번 본 상품번호는 다음부터 제외
- 신규순이라 **한 페이지가 통째로 이미 본 상품이면 그 키워드는 뒤 페이지를 건너뜀**
- 페이지 사이 3~7초, 스크롤은 사람 속도
- **봇 확인**(지마켓 Cloudflare) → 그 플랫폼만 멈추고 사람 클릭을 기다림 → 통과하면 재개, 시간 초과면 그날 건너뜀. **자동 클릭 없음.**
- **차단 화면**(403/418/429, "접속 제한") → 그 플랫폼 즉시 중단
- 결과 0건 → "사이트 구조 변경 의심" 메모

## 플랫폼 상태 (2026-10-27)
| 플랫폼 | 상태 |
|---|---|
| 지마켓 | 동작 확인 (60건/페이지). Cloudflare 확인이 뜨지만 **크롬을 평소처럼 실행 후 연결(기본 방식)이면 몇 초 뒤 저절로 통과**. Playwright 가 직접 띄우면(`--launch`) 체크박스를 눌러도 안 풀림 |
| 옥션 | 동작 확인 (100건/페이지, 상품명·가격·판매자) |
| 11번가 | 동작 확인 (84건/페이지, 상단 광고·추천 자동 제외) |
| 스마트스토어 | **기본 제외(시험 중)**. 네이버 로그인 필요(`run_patrol.bat --login`, 순찰 크롬에서 사람이 직접 로그인 + 로그인 상태 유지). 검색 = 네이버페이 탭(`productSet=checkout`) 등록일순, 상품 데이터는 페이지의 `__NEXT_DATA__` 에서 읽음 (40건/페이지, 전부 스마트스토어 확인). 네이버는 정상 화면도 418 + '접속 제한' 문구를 먼저 보여 줌 → 새로고침 1회 후 판정. 2026-10-27 짧은 시간 반복 접속 뒤로는 계속 제한 화면 — 다음 날 재시험 |
