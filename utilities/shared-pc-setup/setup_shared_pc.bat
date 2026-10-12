@echo off
REM MYRIAD Shared PC setup - double click (asks for admin rights)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup_shared_pc.ps1"
