@echo off
REM Kronos Signal Desk - double-click to start. Paper trading only.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1" %*
pause
