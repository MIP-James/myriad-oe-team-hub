# MYRIAD 확장 프로그램 설치 도우미 (ext-installer)

컴퓨터에 익숙하지 않은 실무자(알바)에게 크롬 확장(BPM Collector, BAND URL Collector)을
배포·업데이트하기 위한 단일 EXE. 크롬이 스토어 외부 확장의 자동 설치를 막고 있어
"압축해제된 확장 로드" 클릭 3번만 사람이 하고, 나머지(다운로드·폴더 교체·버전 확인·
자동 업데이트)는 전부 도우미가 합니다.

## 동작
| 단계 | 내용 |
|---|---|
| 최신 확인 | GitHub 릴리즈 API(공개 저장소, 로그인 불필요)에서 `<slug>-v*` 태그 중 최신 zip |
| 설치 폴더 | `%LOCALAPPDATA%\Myriad\Extensions\<slug>\` (고정 경로 → 크롬 등록 1회로 영구) |
| 등록 판별 | 크롬 프로필 `Secure Preferences` → `extensions.settings[*].path` (location=4) 와 경로 비교 |
| 미등록 안내 | 경로 클립보드 복사 + `chrome://extensions` 열기 + 3단계 그림 안내, 2초마다 재판별 |
| 업데이트 | 폴더 통째 교체(`.new` → rename). 크롬이 핸들 잡고 있으면 파일 단위 제자리 덮어쓰기 폴백 |
| 자동 실행 | 시작 프로그램 `.lnk` → `--silent` (변화 없으면 창 없이 종료, 교체 시 "크롬 다시 열기" 안내) |
| 자기 설치 | EXE 를 `%LOCALAPPDATA%\Myriad\ExtInstaller\` 로 복사해 시작 프로그램이 항상 같은 경로를 가리킴 |
| 상태/로그 | 같은 폴더의 `state.json`(설치된 태그) / `installer.log` |

`다른 위치에 있음`: 같은 이름의 확장이 다른 폴더(예: `Downloads\BPM_Collector`)에서 로드돼 있을 때.
크롬에서 그 항목을 삭제한 뒤 도우미 폴더로 다시 등록해야 자동 업데이트를 받습니다(팀원 PC 해당).

## 포함 확장 변경
`ext_installer.py` 의 `EXTENSIONS` 리스트(slug = release_config.json 슬러그). 추가 후 재빌드·재배포.

## 빌드 / 배포
```cmd
cd /d "C:\Users\MIP James\Downloads\Claude Project\utilities\ext-installer"
build.bat

cd /d "C:\Users\MIP James\Downloads\Claude Project\admin-scripts"
release.bat myriad-ext-installer "변경 내용"
```
`dist\MYRIAD_Extension_Installer\` (EXE + USAGE.txt) 가 릴리즈 소스. 알바 분에게는 EXE 파일 하나만 전달해도 됩니다.

## 알려진 제약
- 코드 서명 없음 → 첫 실행 시 SmartScreen "PC 보호" 창 (추가 정보 → 실행). USAGE.txt 에 안내.
- 크롬 `Secure Preferences` 갱신은 로드 직후 수초 내. 판별은 읽기 전용이며 파일을 수정하지 않음.
- 개발 모드(`python ext_installer.py`)에서는 시작 프로그램 등록을 건너뜀. `--screenshot out.png` 로 UI 캡처 가능.
