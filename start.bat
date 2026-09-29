@echo off
rem Fengshui luopan local preview: start static server and open browser
cd /d "%~dp0"
start "" http://127.0.0.1:5180/
python -m http.server 5180 --bind 127.0.0.1
