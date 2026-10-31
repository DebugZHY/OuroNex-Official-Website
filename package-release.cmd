@echo off
setlocal
set "ROOT=%~dp0"

powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\Package-Release.ps1" %*
set "RC=%ERRORLEVEL%"

if "%RC%"=="0" (
    echo.
    echo Release package created. The archive path and SHA256 are shown above.
) else (
    echo.
    echo OuroNex release packaging FAILED. See the error above.
)

if not "%OURONEX_NO_PAUSE%"=="1" (
    echo.
    pause
)

endlocal & exit /b %RC%
