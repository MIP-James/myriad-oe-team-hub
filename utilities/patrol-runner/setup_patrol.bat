@echo off
rem Patrol runner setup (run once on the patrol laptop)
cd /d "%~dp0"
py -3.13 --version >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Python 3.13 not found. Install from https://www.python.org/downloads/ and check "Add python.exe to PATH".
  pause
  exit /b 1
)
py -3.13 -m pip install --upgrade playwright openpyxl imagehash pillow numpy
if not exist keywords.local.json (
  echo [WARN] keywords.local.json missing. Copy it next to patrol.py before running.
)
echo.
echo Setup done. Next: run_patrol.bat --login   (Naver login, once)
pause
