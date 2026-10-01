@echo off
cd /d %~dp0
start "" http://localhost:8160
node server.js
pause
