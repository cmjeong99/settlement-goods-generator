@echo off
title Danal Settlement Product Generator
cd /d "%~dp0"
node --env-file-if-exists=.env server.js
pause
