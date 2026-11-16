@echo off
rem Manual / diagnostic start without PowerShell or PM2 (see run-manual.mjs). Double-click or:
rem   run-manual.cmd [--sem-navegador]
title Quiosque - modo manual
"%~dp0node\node.exe" "%~dp0run-manual.mjs" %*
pause
