@echo off
chcp 65001 > nul
cd /d "%~dp0"

echo ============================================================
echo  MYRIAD Launcher - PyInstaller build
echo ============================================================
echo.

echo [1/4] Installing PyInstaller if missing...
python -m pip install --quiet pyinstaller
if errorlevel 1 goto :error

echo [2/4] Ensuring runtime dependencies are installed...
python -m pip install --quiet -r requirements.txt
if errorlevel 1 goto :error

REM Optional: generate a basic .ico next to this script the first time
python -c "from PIL import Image,ImageDraw,ImageFont; import os, sys; p='launcher.ico'; \
img=Image.new('RGBA',(256,256),(0,0,0,0)); d=ImageDraw.Draw(img); d.ellipse([16,16,240,240], fill=(255,179,0,255)); \
ft=ImageFont.truetype('arialbd.ttf',140) if os.path.exists('C:/Windows/Fonts/arialbd.ttf') else ImageFont.load_default(); \
b=d.textbbox((0,0),'M',font=ft); w=b[2]-b[0]; h=b[3]-b[1]; d.text((128-w//2-b[0],128-h//2-b[1]-6),'M',fill=(17,17,17,255),font=ft); \
img.save(p,sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])" 2>nul

set ICON_ARG=
if exist launcher.ico set ICON_ARG=--icon=launcher.ico

echo [3/4] Building MyriadLauncher.exe (tray, no console)...
pyinstaller --onefile --windowed %ICON_ARG% --name MyriadLauncher ^
  --collect-all supabase --collect-all gotrue --collect-all postgrest ^
  --collect-all realtime --collect-all storage3 --collect-all supafunc ^
  --clean myriad_launcher.py
if errorlevel 1 goto :error

echo [4/4] Building MyriadSetup.exe (console-based setup)...
pyinstaller --onefile --console %ICON_ARG% --name MyriadSetup ^
  --collect-all supabase --collect-all gotrue --collect-all postgrest ^
  --collect-all realtime --collect-all storage3 --collect-all supafunc ^
  --clean setup.py
if errorlevel 1 goto :error

echo.
echo ============================================================
echo  Build complete!
echo ============================================================
echo   dist\MyriadLauncher.exe  (tray launcher - run after setup)
echo   dist\MyriadSetup.exe     (first-run setup / reconfigure)
echo.
echo  Distribute BOTH .exe files together to team members.
echo ============================================================
pause
exit /b 0

:error
echo.
echo [ERROR] Build failed. See output above.
pause
exit /b 1
