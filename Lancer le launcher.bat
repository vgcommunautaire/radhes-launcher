@echo off
rem Double-clique sur ce fichier pour ouvrir le launcher en mode test.
cd /d "%~dp0"
if not exist node_modules (
  echo Installation des dependances, patiente un peu...
  call npm.cmd install
)
call npm.cmd start
if errorlevel 1 pause
