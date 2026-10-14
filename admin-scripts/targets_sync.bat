@echo off
REM Repeat-infringer target board - weekly BPM sync
REM   targets_sync.bat               collect from BPM and update the hub
REM   targets_sync.bat --dry-run     collect and score only (no hub update)
REM   targets_sync.bat --clients X   search BPM client names
REM   targets_sync.bat --scheduled   weekly task mode (output to logs\targets_sync.log)
cd /d "%~dp0..\myriad-team-hub"
if /i "%~1"=="--scheduled" goto scheduled
node scripts\targets-bpm-sync.mjs %*
exit /b %ERRORLEVEL%

:scheduled
if not exist "%~dp0logs" mkdir "%~dp0logs"
echo ===== %date% %time% >> "%~dp0logs\targets_sync.log"
node scripts\targets-bpm-sync.mjs >> "%~dp0logs\targets_sync.log" 2>&1
exit /b %ERRORLEVEL%
