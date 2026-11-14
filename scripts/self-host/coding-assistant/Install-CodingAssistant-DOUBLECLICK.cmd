@echo off
setlocal EnableExtensions
title Coding Assistant — one-click install
color 0B

:: Double-click this file. It elevates, installs missing pieces, sets up
:: shortcuts/icon, and launches the local coding assistant chat UI.

set "AGENT=C:\runcalc\agent"
set "LOGDIR=%AGENT%\logs"
set "PS1=%~dp0Install-CodingAssistant.ps1"

mkdir "%AGENT%" 2>nul
mkdir "%LOGDIR%" 2>nul

net session >nul 2>&1
if not %errorlevel%==0 (
  echo Requesting Administrator permission for installs...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo.
echo ============================================================
echo  Local Coding Assistant — one-click pilot install
echo  Plant data is NOT modified.
echo ============================================================
echo.

if not exist "%PS1%" (
  echo ERROR: Missing Install-CodingAssistant.ps1 next to this file.
  echo Expected: %PS1%
  pause
  exit /b 1
)

:: Resolve repo: scripts\self-host\coding-assistant -> repo root
set "REPO="
for %%I in ("%~dp0..\..\..") do set "REPO=%%~fI"

if not exist "%REPO%\package.json" (
  echo ERROR: Could not find repo root from this script location.
  echo Opened from: %~dp0
  echo Expected package.json at: %REPO%
  echo.
  echo Clone or copy the full Production-run-calculator repo, then
  echo double-click this file from inside that checkout.
  pause
  exit /b 1
)

if not exist "%REPO%\scripts\coding-assistant\bootstrap-local.mjs" (
  echo ERROR: coding-assistant scripts missing under:
  echo   %REPO%
  echo Use branch feature/local-coding-assistant or a release that includes them.
  pause
  exit /b 1
)

echo Repo:  %REPO%
echo Agent: %AGENT%
echo.
echo This will check/install: Node.js, Ollama, model, profile, shortcuts.
echo First model download can take a long time.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -RepoRoot "%REPO%" -UseFixture -LaunchChat
set "EC=%ERRORLEVEL%"

echo.
if %EC%==0 (
  echo Install finished successfully.
) else (
  echo Install finished with errors. See log under %LOGDIR%
)
echo.
pause
exit /b %EC%
