@echo off
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo [qbrss] Node.js not found. Please install Node.js 18 or newer.
  pause
  exit /b 1
)
if "%QBRSS_PORT%"=="" set QBRSS_PORT=8777
node "%~dp0app\server\index.js"
if errorlevel 1 pause
