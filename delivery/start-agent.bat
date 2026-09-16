@echo off
setlocal enabledelayedexpansion

title SIMPLEX Desktop Browser Agent

echo ======================================================================
echo           SIMPLEX DESKTOP BROWSER AUTOMATION AGENT
echo ======================================================================
echo.

if not exist "agent\start-agent.bat" (
    echo [ERROR] agent folder not found! Please ensure you extracted the full zip.
    pause
    exit /b 1
)

cd agent
call start-agent.bat
