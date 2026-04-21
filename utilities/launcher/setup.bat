@echo off
chcp 65001 > nul
cd /d "%~dp0"
echo [1/2] Installing Python dependencies...
python -m pip install -r requirements.txt
if errorlevel 1 (
  echo.
  echo [ERROR] pip install failed. Check Python installation / PATH.
  pause
  exit /b 1
)
echo.
echo [2/2] Running interactive setup...
python setup.py
pause
