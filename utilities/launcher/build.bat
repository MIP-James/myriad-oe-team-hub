@echo off
chcp 65001 > nul
cd /d "%~dp0"

echo =====================================
echo  MYRIAD Launcher - Build
echo =====================================

REM Preserve config.json across rebuilds (backup before dist cleanup)
if exist dist\config.json (
  echo [preserve] backing up dist\config.json
  copy /Y dist\config.json config.json.bak > nul
)

REM Remove stray EXEs at root (leftover from interrupted builds)
if exist MyriadLauncher.exe (
  echo [cleanup] removing stray root MyriadLauncher.exe
  del /Q MyriadLauncher.exe
)
if exist MyriadSetup.exe (
  echo [cleanup] removing stray root MyriadSetup.exe
  del /Q MyriadSetup.exe
)

echo.
echo Step 1/6: Verify Python
python -c "import sys; print('Python', sys.version); print('Exe:', sys.executable)"
if errorlevel 1 goto err_py

echo.
echo Step 2/6: Install runtime deps
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
if errorlevel 1 goto err_deps

echo.
echo Step 3/6: Install PyInstaller
python -m pip install --upgrade pyinstaller
if errorlevel 1 goto err_pyi

echo.
echo Step 4/6: Verify imports
python -c "import supabase, pystray; from PIL import Image; import winotify; import os; print('supabase at:', os.path.dirname(supabase.__file__)); print('imports OK')"
if errorlevel 1 goto err_imports

python make_icon.py

echo.
echo Step 5/6: Build MyriadLauncher (tray, onedir for fast startup)
REM onedir build: creates dist\MyriadLauncher\MyriadLauncher.exe + dist\MyriadLauncher\_internal\
REM No --clean: reuse PyInstaller build cache for faster incremental rebuilds.
REM If a dep upgrade causes stale-cache issues, manually delete build\ and retry.
python -m PyInstaller --noconfirm MyriadLauncher.spec
if errorlevel 1 goto err_build_launcher
if not exist dist\MyriadLauncher\MyriadLauncher.exe goto err_missing_launcher

REM Flatten: move exe + _internal up one level to dist\ root (matches prior UX)
if exist dist\_internal (
  echo [flatten] removing stale dist\_internal
  rmdir /S /Q dist\_internal
)
if exist dist\MyriadLauncher.exe (
  del /Q dist\MyriadLauncher.exe
)
echo [flatten] moving dist\MyriadLauncher\MyriadLauncher.exe -> dist\MyriadLauncher.exe
move /Y dist\MyriadLauncher\MyriadLauncher.exe dist\MyriadLauncher.exe > nul
echo [flatten] moving dist\MyriadLauncher\_internal -> dist\_internal
move /Y dist\MyriadLauncher\_internal dist\_internal > nul
rmdir dist\MyriadLauncher
echo   OK: dist\MyriadLauncher.exe + dist\_internal\

REM Hide _internal folder so end users don't see the clutter
attrib +h dist\_internal
echo [hide] dist\_internal is now hidden

echo.
echo Step 6/6: Build MyriadSetup (onedir, shares dist\_internal with Launcher)
python -m PyInstaller --noconfirm MyriadSetup.spec
if errorlevel 1 goto err_build_setup
if not exist dist\MyriadSetup\MyriadSetup.exe goto err_missing_setup

REM Merge Setup's _internal into shared dist\_internal then move exe to root.
REM Launcher and Setup share supabase/httpx/etc. - same file bytes, safe to overwrite.
echo [merge] merging MyriadSetup\_internal into dist\_internal (shared)
attrib -h dist\_internal
xcopy /Y /E /Q dist\MyriadSetup\_internal\* dist\_internal\ > nul
if errorlevel 1 goto err_merge_setup
attrib +h dist\_internal

echo [flatten] moving dist\MyriadSetup\MyriadSetup.exe -> dist\MyriadSetup.exe
move /Y dist\MyriadSetup\MyriadSetup.exe dist\MyriadSetup.exe > nul
rmdir /S /Q dist\MyriadSetup
echo   OK: dist\MyriadSetup.exe (shares dist\_internal, cold start ~1-2s)

REM Restore backed-up config.json
if exist config.json.bak (
  echo [restore] restoring config.json to dist
  if not exist dist mkdir dist
  move /Y config.json.bak dist\config.json > nul
)

echo.
echo =====================================
echo  Build complete - dist contents:
echo =====================================
dir /B dist
echo =====================================
pause
exit /b 0

:err_py
echo.
echo [ERROR] Python check failed. Install / PATH.
goto cleanup

:err_deps
echo.
echo [ERROR] pip install requirements failed.
goto cleanup

:err_pyi
echo.
echo [ERROR] PyInstaller install failed.
goto cleanup

:err_imports
echo.
echo [ERROR] Required module import failed (see output above).
goto cleanup

:err_build_launcher
echo.
echo [ERROR] MyriadLauncher build failed (PyInstaller non-zero exit).
goto cleanup

:err_missing_launcher
echo.
echo [ERROR] MyriadLauncher.exe not found in dist\ after build.
goto cleanup

:err_build_setup
echo.
echo [ERROR] MyriadSetup build failed (PyInstaller non-zero exit).
goto cleanup

:err_missing_setup
echo.
echo [ERROR] MyriadSetup.exe not found after build (expected dist\MyriadSetup\MyriadSetup.exe).
goto cleanup

:err_merge_setup
echo.
echo [ERROR] Failed to merge MyriadSetup _internal into dist\_internal.
goto cleanup

:cleanup
if exist config.json.bak (
  if not exist dist mkdir dist
  move /Y config.json.bak dist\config.json > nul
)
echo.
pause
exit /b 1
