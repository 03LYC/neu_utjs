@echo off
setlocal
title Ultrasound QC
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0ultrasound-qc\scripts\start.ps1" %*
if errorlevel 1 (
    echo.
    echo Startup failed. The details are shown above.
    echo Local diagnostics: ultrasound-qc\.runtime\logs
    pause
    exit /b 1
)
exit /b 0
