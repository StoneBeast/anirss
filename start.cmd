@echo off
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo [anirss] Node.js not found. Please install Node.js 18 or newer.
  pause
  exit /b 1
)
if "%ANIRSS_PORT%"=="" set ANIRSS_PORT=%QBRSS_PORT%
if "%ANIRSS_PORT%"=="" set ANIRSS_PORT=8777
node "%~dp0app\server\index.js"
if errorlevel 1 pause
