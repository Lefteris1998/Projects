@echo off
rem Starts Blindfold Chess on http://localhost:8080 so the browser remembers mic permission.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get it from https://nodejs.org and run this again.
  pause
  exit /b 1
)
start "" http://localhost:8080
node serve.js
