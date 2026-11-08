@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Installation de Mnémo
echo.
echo  ====================================================
echo    Installation de Mnémo  (une seule fois, ~5 minutes)
echo  ====================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  [1/4] Node.js n'est pas installé. Installation en cours...
  where winget >nul 2>nul
  if errorlevel 1 (
    echo.
    echo  Impossible d'installer Node.js automatiquement.
    echo  Va sur https://nodejs.org , télécharge la version "LTS", installe-la,
    echo  puis double-clique à nouveau sur ce fichier.
    start https://nodejs.org
    pause
    exit /b 1
  )
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  echo.
  echo  Node.js est installé. FERME cette fenêtre puis double-clique à nouveau
  echo  sur INSTALLER-MNEMO.bat pour continuer.
  pause
  exit /b 0
) else (
  echo  [1/4] Node.js est déjà installé.
)

echo  [2/4] Téléchargement des composants...
call npm install --no-audit --no-fund
if errorlevel 1 goto :fail

if not exist "node_modules\electron\dist\electron.exe" (
  echo  [3/4] Téléchargement du moteur de l'application...
  node node_modules\electron\install.js
  if errorlevel 1 goto :fail
) else (
  echo  [3/4] Moteur de l'application déjà présent.
)

echo  [4/4] Préparation de Mnémo...
call npx electron-vite build
if errorlevel 1 goto :fail

echo.
echo  ====================================================
echo    C'est prêt ! Pour lancer Mnémo : LANCER-MNEMO.bat
echo  ====================================================
echo.
call LANCER-MNEMO.bat
exit /b 0

:fail
echo.
echo  Une erreur est survenue. Prends une capture de cette fenêtre et envoie-la
echo  avec ta question (voir docs\GUIDE-INSTALLATION.md, section "Ça ne marche pas").
pause
exit /b 1
