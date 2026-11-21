@echo off
setlocal EnableExtensions
title Code Agent Setup
color 0B

set "AGENT=C:\runcalc\agent"
set "SETUP=%~dp0scripts\ca\setup.ps1"
set "REPAIR="
set "STARTUP="

:parse
if "%~1"=="" goto done
if /i "%~1"=="/repair" set "REPAIR=-Repair"
if /i "%~1"=="/startup" set "STARTUP=-AddStartup"
shift
goto parse
:done

mkdir "%AGENT%" 2>nul
mkdir "%AGENT%\logs" 2>nul

net session >nul 2>&1
if not %errorlevel%==0 (
  echo Requesting Administrator...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -ArgumentList '%*' -Verb RunAs"
  exit /b
)

if not exist "%SETUP%" (
  echo Missing %SETUP%
  echo Run this from the repo root after checkout.
  pause
  exit /b 1
)

set "REPO=%~dp0"
if "%REPO:~-1%"=="\" set "REPO=%REPO:~0,-1%"

if not exist "%REPO%\package.json" (
  echo package.json not found next to CA-Setup.cmd
  echo REPO=%REPO%
  pause
  exit /b 1
)

echo Repo:    %REPO%
echo Agent:   %AGENT%
echo Repair:  %REPAIR%
echo Startup: %STARTUP%
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%SETUP%" -RepoRoot "%REPO%" %REPAIR% %STARTUP% -LaunchChat
set EC=%ERRORLEVEL%
echo.
if %EC%==0 (echo Setup OK) else (echo Setup FAILED — see %AGENT%\logs)
pause
exit /b %EC%
