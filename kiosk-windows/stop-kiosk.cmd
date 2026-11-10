@echo off
rem Asks start-kiosk.ps1 to close the browsers and servers (takes up to ~5 seconds).
type nul > "%~dp0STOP"
echo Encerrando o quiosque. Os sites e navegadores fecham em alguns segundos.
timeout /t 3 >nul
