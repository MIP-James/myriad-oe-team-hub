@echo off
rem Register daily 09:00 auto collect in Windows Task Scheduler (current user, only when logged on).
rem Remove: schtasks /Delete /TN "MyriadAutoCollect" /F
cd /d "%~dp0"
schtasks /Create /F /TN "MyriadAutoCollect" /TR "\"%~dp0run_patrol_auto.bat\"" /SC DAILY /ST 09:00 /IT
if errorlevel 1 (
  echo [ERROR] Task registration failed.
) else (
  echo [OK] Task "MyriadAutoCollect" runs every day at 09:00 while this user is logged on.
)
pause
