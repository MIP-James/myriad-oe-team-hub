@echo off
rem Auto collect for Task Scheduler (no pause). Log: output\auto_run.log
cd /d "%~dp0"
if not exist output mkdir output
set PYTHONIOENCODING=utf-8
echo ==== %date% %time% ==== >> output\auto_run.log
py -3.13 patrol.py >> output\auto_run.log 2>&1
