@echo off
setlocal
set "ROOT=%~dp0"

powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\dev.ps1" %*
set "RC=%ERRORLEVEL%"

if not "%RC%"=="0" (
    echo.
    echo OuroNex failed to start. See the error above.
    if not "%OURONEX_NO_PAUSE%"=="1" pause
)

endlocal & exit /b %RC%
