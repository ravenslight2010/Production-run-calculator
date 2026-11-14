@echo off
setlocal EnableExtensions
title Code Agent Setup
color 0B

:: SHORT one-click installer. Double-click this file in the repo root.
set "AGENT=C:\runcalc\agent"
set "SETUP=%~dp0scripts\ca\setup.ps1"

mkdir "%AGENT%" 2>nul
mkdir "%AGENT%\logs" 2>nul

net session >nul 2>&1
if not %errorlevel%==0 (
  echo Requesting Administrator...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

if not exist "%SETUP%" (
  echo Missing %SETUP%
  echo Run this from the repo root after checkout.
  pause
  exit /b 1
)

set "REPO=%~dp0"
:: strip trailing backslash issues
if "%REPO:~-1%"=="\" set "REPO=%REPO:~0,-1%"

if not exist "%REPO%\package.json" (
  echo package.json not found next to CA-Setup.cmd
  echo REPO=%REPO%
  pause
  exit /b 1
)

echo Repo:  %REPO%
echo Agent: %AGENT%
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%SETUP%" -RepoRoot "%REPO%" -UseFixture -LaunchChat
set EC=%ERRORLEVEL%
echo.
if %EC%==0 (echo Setup OK) else (echo Setup FAILED — see %AGENT%\logs)
pause
exit /b %EC%
