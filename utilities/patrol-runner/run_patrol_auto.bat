@echo off
rem Auto collect for Task Scheduler (no pause). Progress shows in this window and in output\auto_run.log
cd /d "%~dp0"
if not exist output mkdir output
set PYTHONIOENCODING=utf-8
py -3.13 patrol.py --log output\auto_run.log
