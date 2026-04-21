@echo off
REM 최초 설정 + 의존성 설치
cd /d "%~dp0"
echo [1/2] Python 의존성 설치 중...
python -m pip install -r requirements.txt
if errorlevel 1 (
  echo [오류] pip install 실패. Python 설치/PATH 를 확인하세요.
  pause
  exit /b 1
)
echo.
echo [2/2] 대화형 설정 시작...
python setup.py
pause
