@echo off
:: Convenience launcher at repo root — forwards to the real installer.
set "TARGET=%~dp0scripts\self-host\coding-assistant\Install-CodingAssistant-DOUBLECLICK.cmd"
if not exist "%TARGET%" (
  echo Missing %TARGET%
  pause
  exit /b 1
)
call "%TARGET%"
exit /b %ERRORLEVEL%
