# MYRIAD Enforcement Tools — 빌드 소스 (구 `MYRIAD_Launcher_Packer.zip`)

허브 유틸리티 🛡️ **MYRIAD Enforcement Tools** (slug `myriad-enforcement-tools`) 의 **진짜 소스**.
2026-10-06 부터 zip 첨부 없이 이 폴더가 정본. "통합런처 수정하자" = 이 폴더의 .py 편집.

## 파일 구성
| 파일 | 역할 |
|---|---|
| `MYRIAD_Online_Enforcement_Tools.py` | 통합 런처 (PyInstaller entry) |
| `VeRO_Automation_Launcher.py` | VeRO 하위 런처 → `runpy` 로 아래 매크로 실행 |
| `Auction_VeRO_Macro.py` / `Gmarket_VeRO_Macro.py` | 옥션 / G마켓 VeRO 신고 매크로 |
| `NaverAutomationLauncher.py` | 네이버 권리보호센터 신고 |
| `Image_Crawler.py` / `Image_Uploader.py` | 이미지 수집 / 업로드 |
| `Packer.py` | PyInstaller 빌드 스크립트 (모든 .py 를 `_internal` 에 datas 로 동봉) |

## 수정 → 배포 절차
1. 이 폴더의 .py 편집
2. 빌드 (Python **3.11** 사용 — 기존 배포본과 동일 런타임, 약 15~20분)
   ```cmd
   cd /d "C:\Users\MIP James\Downloads\Claude Project\utilities\enforcement-packer"
   py -3.11 Packer.py
   ```
3. `dist\MYRIAD_Enforcement_Tools\` 를 배포 폴더 `C:\Users\MIP James\Downloads\MYRIAD_Enforcement_Tools\` 에 **통째 교체**
4. 번들 검증: `_internal\<수정한 파일>.py` 에 수정 내용 grep
5. 릴리즈
   ```cmd
   cd /d "C:\Users\MIP James\Downloads\Claude Project\admin-scripts"
   release.bat myriad-enforcement-tools "수정 내용 요약"
   ```
6. 배포 직후 `gh release download` 로 zip 안 .py 가 새 버전인지 확인

`build/`, `dist/`, `*.spec`, `myriad.ico` 는 빌드 산출물(gitignore).
