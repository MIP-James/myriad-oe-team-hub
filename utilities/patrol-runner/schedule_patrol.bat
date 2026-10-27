@echo off
rem Register weekday (Mon-Fri) 09:00 auto collect in Windows Task Scheduler (current user, only when logged on).
rem Running again replaces the old schedule. Remove: schtasks /Delete /TN "MyriadAutoCollect" /F
cd /d "%~dp0"
schtasks /Create /F /TN "MyriadAutoCollect" /TR "\"%~dp0run_patrol_auto.bat\"" /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 09:00 /IT
if errorlevel 1 (
  echo [ERROR] Task registration failed.
) else (
  echo [OK] Task "MyriadAutoCollect" runs Mon-Fri at 09:00 while this user is logged on.
)
pause
