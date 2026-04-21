@echo off
chcp 65001 > nul
cd /d "%~dp0"
python myriad_launcher.py
pause
