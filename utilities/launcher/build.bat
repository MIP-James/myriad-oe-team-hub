@echo off
cd /d "%~dp0"

echo =====================================
echo  MYRIAD Launcher - Build
echo =====================================

REM 재빌드 시 기존 config.json 이 dist 정리로 날아가지 않도록 임시 백업
if exist dist\config.json (
  echo [preserve] backing up dist\config.json ...
  copy /Y dist\config.json config.json.bak > nul
)

echo.
echo Step 1/5: Verify Python
python -c "import sys; print('Python', sys.version); print('Exe:', sys.executable)"
if errorlevel 1 goto err

echo.
echo Step 2/5: Install runtime deps (same Python as above)
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
if errorlevel 1 goto err

echo.
echo Step 3/5: Install PyInstaller (into same Python)
python -m pip install --upgrade pyinstaller
if errorlevel 1 goto err

echo.
echo Step 4/5: Verify imports + supabase location
python -c "import supabase, pystray; from PIL import Image; import os; print('supabase at:', os.path.dirname(supabase.__file__)); print('imports OK')"
if errorlevel 1 goto err

python make_icon.py

echo.
echo Step 5/5: Build using spec files (via python -m PyInstaller)

echo   --^> MyriadLauncher.exe (tray, no console)
python -m PyInstaller --clean --noconfirm MyriadLauncher.spec
if errorlevel 1 goto err

echo   --^> MyriadSetup.exe (console setup)
python -m PyInstaller --clean --noconfirm MyriadSetup.spec
if errorlevel 1 goto err

REM 백업해뒀던 config.json 복구
if exist config.json.bak (
  echo [restore] restoring config.json to dist\
  if not exist dist mkdir dist
  move /Y config.json.bak dist\config.json > nul
)

echo.
echo =====================================
echo  Build complete
echo =====================================
echo  dist\MyriadLauncher.exe
echo  dist\MyriadSetup.exe
if exist dist\config.json (
  echo  dist\config.json              [preserved]
)
echo =====================================
pause
exit /b 0

:err
echo.
echo [ERROR] Build failed. See output above.
pause
exit /b 1
