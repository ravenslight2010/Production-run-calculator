@echo off
:: Legacy name — forwards to short CA-Setup.cmd
if exist "%~dp0CA-Setup.cmd" (
  call "%~dp0CA-Setup.cmd"
  exit /b %ERRORLEVEL%
)
echo Missing CA-Setup.cmd
pause
exit /b 1
