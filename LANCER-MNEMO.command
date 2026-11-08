#!/bin/bash
cd "$(dirname "$0")" || exit 1
if [ ! -f "out/main/index.js" ]; then
  echo "Mnémo n'est pas encore installé : lance d'abord INSTALLER-MNEMO.command"
  read -r -p "Appuie sur Entrée pour fermer." _
  exit 1
fi
exec npx electron .
