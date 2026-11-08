#!/bin/bash
# Installation de Mnémo depuis les sources, sur Mac (une seule fois, ~5 minutes).
# Double-clique sur ce fichier (la première fois : clic droit › Ouvrir), ou lance « bash INSTALLER-MNEMO.command ».
cd "$(dirname "$0")" || exit 1

echo
echo " ===================================================="
echo "   Installation de Mnémo  (une seule fois, ~5 minutes)"
echo " ===================================================="
echo

if ! command -v node >/dev/null 2>&1; then
  echo " [1/4] Node.js n'est pas installé."
  if command -v brew >/dev/null 2>&1; then
    echo "       Installation avec Homebrew..."
    brew install node || exit 1
  else
    echo
    echo " Va sur https://nodejs.org , télécharge la version « LTS », installe-la,"
    echo " puis relance ce fichier."
    open https://nodejs.org
    read -r -p "Appuie sur Entrée pour fermer." _
    exit 1
  fi
else
  echo " [1/4] Node.js est déjà installé ($(node -v))."
fi

if ! xcode-select -p >/dev/null 2>&1; then
  echo " Les outils de développement Apple sont nécessaires : une fenêtre va s'ouvrir, accepte l'installation,"
  echo " puis relance ce fichier."
  xcode-select --install
  read -r -p "Appuie sur Entrée pour fermer." _
  exit 1
fi

echo " [2/4] Téléchargement des composants..."
npm install --no-audit --no-fund || { echo " Échec de l'installation des composants."; read -r -p "Entrée pour fermer." _; exit 1; }

echo " [3/4] Préparation de Mnémo..."
npx electron-vite build || { echo " Échec de la préparation."; read -r -p "Entrée pour fermer." _; exit 1; }

echo " [4/4] Terminé."
echo
echo " Pour lancer Mnémo : double-clique sur LANCER-MNEMO.command"
echo
read -r -p "Appuie sur Entrée pour fermer." _
