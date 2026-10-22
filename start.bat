@echo off
rem Runs all projects on http://localhost:8080 so every link on the index works.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Download it from https://nodejs.org and run this again.
  pause
  exit /b 1
)
node serve.js --open
pause
