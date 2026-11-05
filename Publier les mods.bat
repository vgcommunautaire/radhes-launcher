@echo off
rem Double-clique ici apres avoir change les mods du dossier "mods" :
rem tous les joueurs recevront la nouvelle liste au prochain lancement.
cd /d "%~dp0"
for /f "usebackq delims=" %%t in (`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\get-token.ps1`) do set "GH_TOKEN=%%t"
if not defined GH_TOKEN (
  echo Aucune cle GitHub : rien n'a ete publie.
  pause
  exit /b 1
)
call npm.cmd run publish-mods
if errorlevel 1 (
  echo.
  echo La publication a echoue. Si la cle est refusee, lance "Changer la cle GitHub.bat".
)
pause
