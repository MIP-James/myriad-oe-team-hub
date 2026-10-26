@echo off
rem Patrol runner (stage 1, manual). Results: output\patrol_*.xlsx
cd /d "%~dp0"
py -3.13 patrol.py %*
pause
