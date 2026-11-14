@echo off
setlocal EnableExtensions
title Code Agent Setup
color 0B

REM Extract this folder to C:\runcalc\ca-src then double-click SETUP.cmd
set "HERE=%~dp0"
if "%HERE:~-1%"=="\" set "HERE=%HERE:~0,-1%"
set "AGENT=C:\runcalc\agent"
set "PS1=%HERE%\setup.ps1"

mkdir "%AGENT%" 2>nul
mkdir "%AGENT%\logs" 2>nul

if not exist "%PS1%" (
  echo Missing setup.ps1 next to SETUP.cmd
  echo HERE=%HERE%
  pause
  exit /b 1
)

net session >nul 2>&1
if not %errorlevel%==0 (
  echo Requesting Administrator...
  powershell.exe -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo Bundle: %HERE%
echo Agent:  %AGENT%
echo.
echo Starting setup with PowerShell...
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -BundleRoot "%HERE%" -AgentRoot "%AGENT%"
set "EC=%ERRORLEVEL%"

echo.
if %EC%==0 (echo Setup finished OK) else (echo Setup FAILED - see %AGENT%\logs)
pause
exit /b %EC%
