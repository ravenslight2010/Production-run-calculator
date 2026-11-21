@echo off
setlocal
set "HERE=%~dp0"
echo Enable Code Agent WRITE mode (repo folder only)
if "%~1"=="" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%HERE%Enable-Writes.ps1"
) else (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%HERE%Enable-Writes.ps1" -RepoPath "%~1"
)
pause
