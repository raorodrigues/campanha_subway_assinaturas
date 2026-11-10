@echo off
rem Starts the kiosk (servers + browsers). Used by the logon task; can also be double-clicked.
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0start-kiosk.ps1"
