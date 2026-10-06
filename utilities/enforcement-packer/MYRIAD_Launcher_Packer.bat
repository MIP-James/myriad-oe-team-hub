
@echo off
cd /d "%~dp0"
echo ================================
echo MYRIAD Launcher Build Start
echo ================================
if exist build rmdir /s /q build
if exist dist rmdir /s /q dist
py -3.11 Packer.py
echo ================================
echo Build Complete
echo Output: dist\MYRIAD_Enforcement_Tools\
echo ================================
pause
