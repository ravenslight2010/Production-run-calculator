@echo off
setlocal EnableExtensions
title Coding Assistant Install (read-only pilot)
color 0B

:: Double-click installer for the local coding assistant pilot.
:: Elevates to Administrator when needed (winget / machine PATH).

set "ROOT=C:\runcalc\agent"
set "LOGDIR=%ROOT%\logs"
set "PS1=%~dp0Install-CodingAssistant.ps1"

mkdir "%ROOT%" 2>nul
mkdir "%LOGDIR%" 2>nul

net session >nul 2>&1
if not %errorlevel%==0 (
  echo Requesting Administrator permission...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo.
echo Coding Assistant installer
echo Profile will be written under %ROOT%\config
echo Plant directory is not modified.
echo.

if not exist "%PS1%" (
  echo ERROR: Missing %PS1%
  pause
  exit /b 1
)

:: Prefer a sibling repo checkout: %~dp0..\..\.. from scripts/self-host/coding-assistant
set "REPO="
if exist "%~dp0..\..\..\package.json" set "REPO=%~dp0..\..\.."

if defined REPO (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -RepoRoot "%REPO%"
) else (
  echo RepoRoot not detected. Pass the checkout path when prompted is not supported in CMD;
  echo run PowerShell: 
  echo   .\Install-CodingAssistant.ps1 -RepoRoot "C:\path\to\Production-run-calculator" -UseFixture
  powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -UseFixture
)

echo.
echo Exit code: %ERRORLEVEL%
pause
exit /b %ERRORLEVEL%
