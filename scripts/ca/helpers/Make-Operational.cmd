@echo off
setlocal
set "HERE=%~dp0"
echo.
echo Mark Code Agent operational (read-only daily use)
echo Optional: pass a short repo path as first argument
echo   Make-Operational.cmd C:\src\prc
echo.
if "%~1"=="" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%HERE%Make-Operational.ps1" -Launch
) else (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%HERE%Make-Operational.ps1" -RepoPath "%~1" -Launch
)
echo.
pause
