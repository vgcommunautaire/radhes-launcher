@echo off
rem Oublie la cle GitHub enregistree et en demande une nouvelle (par exemple quand l'ancienne a expire).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\get-token.ps1 -Reset > nul
if errorlevel 1 (echo Aucune cle saisie.) else (echo Nouvelle cle enregistree.)
pause
