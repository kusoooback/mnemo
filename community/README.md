# Catalogue communautaire de Mnémo

Des paquets de cartes (`.mnemodeck`) proposés par la communauté. Dans l'application : **Paquets → Parcourir le catalogue**.

> Rien n'est téléchargé tant que tu n'as pas cliqué sur ce bouton. Chaque paquet est vérifié avant d'être proposé : empreinte SHA-256, format, images (voir [vie privée](../README.md#-vie-privée)).

## Proposer ton paquet

Tu n'as besoin ni d'installer quoi que ce soit ni de savoir programmer, juste d'un compte GitHub.

1. Dans Mnémo : **Paquets → Partager un deck** crée un fichier `.mnemodeck` (cartes, étiquettes, images ; jamais ton historique de révision).
2. Sur GitHub, ouvre une *pull request* qui ajoute :
   - ton fichier dans `community/packs/mon-paquet.mnemodeck` ;
   - une ligne dans `community/index.json` (voir ci-dessous).
3. Les mainteneurs relisent le contenu (exactitude, droits d'auteur, pas d'élément personnel) puis fusionnent.

### Une ligne du catalogue

```json
{
  "id": "mon-paquet",
  "title": "Titre lisible",
  "description": "Une ou deux phrases sur le contenu.",
  "author": "Ton pseudo",
  "lang": "fr",
  "tags": ["maths", "prépa"],
  "notes": 120,
  "sha256": "empreinte SHA-256 du fichier .mnemodeck"
}
```

- `id` : minuscules, chiffres et tirets, 2 à 41 caractères ; le fichier doit s'appeler `<id>.mnemodeck`.
- `sha256` : `sha256sum community/packs/mon-paquet.mnemodeck` (Linux/macOS) ou `Get-FileHash -Algorithm SHA256` (Windows PowerShell).

## Écrire un paquet à la main (pour les développeurs)

Les paquets fournis par le projet sont générés depuis un source lisible dans `community/src/*.json`, ce qui permet de relire facilement les cartes en *pull request* :

```bash
node scripts/build-pack.mjs          # génère community/packs/*.mnemodeck et community/index.json
node scripts/build-pack.mjs --check  # vérifie que tout est à jour (utilisé par les tests)
```

Une source contient `id`, `title`, `description`, `author`, `lang`, `tags` et une liste `notes` :

| Carte | Champs |
| --- | --- |
| Question / réponse | `{ "d": "Sous-deck", "k": "basic", "f": "recto", "b": "verso", "t": ["étiquette"] }` |
| Texte à trous | `{ "d": "Sous-deck", "k": "cloze", "t": "Le {{c1::cœur}} pompe le sang.", "tg": ["étiquette"] }` |

Le Markdown, le LaTeX (`$x^2$`) et les blocs de code sont acceptés.

## Règles

- **Contenu exact.** Vérifie tes cartes ; une réponse fausse mémorisée est pire que pas de carte.
- **Ton propre travail ou libre de droits.** Pas de manuel, d'annale ou de cours recopié sans autorisation de son auteur.
- **Rien de personnel** : ni nom d'élève, ni mot de passe, ni lien privé.
- **Images** : PNG, JPEG, GIF ou WebP, 8 Mo maximum chacune (le SVG est refusé).
