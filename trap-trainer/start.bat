@echo off
rem Starts the Projects server and opens Trap Trainer (the engine needs http, not file://).
cd /d "%~dp0.."
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get it from https://nodejs.org and run this again.
  pause
  exit /b 1
)
node serve.js --open --page=trap-trainer/
pause
