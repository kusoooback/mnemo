@echo off
cd /d "%~dp0"
if not exist "out\main\index.js" (
  echo Mnémo n'est pas encore installé : double-clique sur INSTALLER-MNEMO.bat
  pause
  exit /b 1
)
start "" "node_modules\electron\dist\electron.exe" .
