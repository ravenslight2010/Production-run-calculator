@echo off
setlocal EnableExtensions
title Get Code Agent
color 0B

set "AGENT=C:\runcalc\agent"
set "TMP=%TEMP%\ca-get"
mkdir "%TMP%" 2>nul
mkdir "%AGENT%" 2>nul
mkdir "%AGENT%\logs" 2>nul

net session >nul 2>&1
if not %errorlevel%==0 (
  echo Requesting Administrator...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo Downloading latest Code Agent installer from GitHub...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ProgressPreference='SilentlyContinue';" ^
  "Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/ravenslight2010/Production-run-calculator/feature/local-coding-assistant/scripts/ca/setup.ps1' -OutFile '%TMP%\setup.ps1';" ^
  "Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/ravenslight2010/Production-run-calculator/feature/local-coding-assistant/CA-Setup.cmd' -OutFile '%TMP%\CA-Setup.cmd';"

if not exist "%TMP%\setup.ps1" (
  echo Download failed. Check internet and try again.
  pause
  exit /b 1
)

echo.
echo Running setup...
powershell -NoProfile -ExecutionPolicy Bypass -File "%TMP%\setup.ps1" -RepoRoot "%AGENT%\app" -LaunchChat
set EC=%ERRORLEVEL%
echo.
if %EC%==0 (echo Setup OK) else (echo Setup finished with issues — see %AGENT%\logs)
pause
exit /b %EC%
