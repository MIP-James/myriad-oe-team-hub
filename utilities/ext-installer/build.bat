@echo off
chcp 65001 > nul
cd /d "%~dp0"
echo =====================================
echo  MYRIAD Extension Installer - Build
echo =====================================

echo Step 1/4: Verify Python
python -c "import sys; print('Python', sys.version)"
if errorlevel 1 goto err

echo Step 2/4: Deps
python -m pip install --upgrade pyinstaller truststore certifi pillow > nul
if errorlevel 1 goto err

echo Step 3/4: Icon
python make_icon.py
if errorlevel 1 goto err

echo Step 4/4: PyInstaller (onefile)
python -m PyInstaller --noconfirm --clean ExtInstaller.spec
if errorlevel 1 goto err
if not exist dist\MYRIAD_Extension_Installer.exe goto err

REM Release folder = dist\MYRIAD_Extension_Installer\ (exe + usage txt) for release.py zip
if not exist dist\MYRIAD_Extension_Installer mkdir dist\MYRIAD_Extension_Installer
move /Y dist\MYRIAD_Extension_Installer.exe dist\MYRIAD_Extension_Installer\MYRIAD_Extension_Installer.exe > nul
copy /Y USAGE.txt dist\MYRIAD_Extension_Installer\ > nul

echo.
echo Build complete: dist\MYRIAD_Extension_Installer\
dir /B dist\MYRIAD_Extension_Installer
exit /b 0

:err
echo.
echo [ERROR] build failed - see output above.
exit /b 1
