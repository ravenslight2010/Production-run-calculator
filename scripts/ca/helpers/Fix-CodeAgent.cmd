@echo off
setlocal EnableExtensions
title Fix Code Agent
color 0B

echo.
echo Code Agent repair
echo.

echo [1] Kill old node servers on port 7843 (if any)...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr :7843 ^| findstr LISTENING') do (
  echo   Stopping PID %%P
  taskkill /F /PID %%P >nul 2>&1
)

echo [2] Start Ollama...
where ollama >nul 2>&1
if %errorlevel%==0 (
  start "" /MIN ollama serve
) else (
  echo   ollama not on PATH - open Ollama from Start Menu
)
timeout /t 3 /nobreak >nul

echo [3] Check Ollama API...
powershell.exe -NoProfile -Command "try { (Invoke-WebRequest -Uri http://127.0.0.1:11434/api/tags -UseBasicParsing -TimeoutSec 5).StatusCode } catch { Write-Host 'OLLAMA DOWN'; exit 1 }"
if errorlevel 1 (
  echo Ollama is not responding. Open the Ollama app, wait until it is ready, run this again.
  pause
  exit /b 1
)

echo [4] Start chat server...
set "APP=C:\runcalc\agent\app"
set "SERVER=%APP%\ui\server.mjs"
if not exist "%SERVER%" (
  echo Missing %SERVER%
  echo Re-run SETUP from C:\runcalc\ca-src
  pause
  exit /b 1
)

set "PATH=%ProgramFiles%\nodejs;%LOCALAPPDATA%\Programs\Ollama;%ProgramFiles%\Ollama;%PATH%"
set "RUNCALC_REPO=%APP%"

start "CodeAgentServer" /MIN cmd /c "node \"%SERVER%\" --port 7843 --model qwen2.5-coder:7b"
timeout /t 2 /nobreak >nul

echo [5] Open browser...
start http://127.0.0.1:7843/

echo.
echo If the page loads but chat still fails, wait 30-60s for the model to load, then send again.
echo.
pause
