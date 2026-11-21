@echo off
:: Legacy long name — forwards to short CA-Setup.cmd at repo root
set "ROOT=%~dp0..\..\.."
for %%I in ("%ROOT%") do set "ROOT=%%~fI"
if exist "%ROOT%\CA-Setup.cmd" (
  call "%ROOT%\CA-Setup.cmd"
  exit /b %ERRORLEVEL%
)
echo Missing CA-Setup.cmd at %ROOT%
pause
exit /b 1
