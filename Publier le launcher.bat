@echo off
rem Double-clique ici pour publier une nouvelle version du launcher.
rem Pense d'abord a augmenter "version" dans package.json (ex. 1.0.0 -> 1.0.1),
rem sinon les launchers de tes amis ne verront pas la mise a jour.
cd /d "%~dp0"
for /f "usebackq delims=" %%t in (`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\get-token.ps1`) do set "GH_TOKEN=%%t"
if not defined GH_TOKEN (
  echo Aucune cle GitHub : rien n'a ete publie.
  pause
  exit /b 1
)
call npm.cmd run release
if errorlevel 1 (
  echo.
  echo La publication a echoue. Si la cle est refusee, lance "Changer la cle GitHub.bat".
)
pause
