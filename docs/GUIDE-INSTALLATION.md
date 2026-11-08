# Installer et utiliser Mnémo — le guide pour tout le monde

Pas besoin de savoir ce qu'est GitHub, un terminal ou du code. Ce guide t'explique, pas à pas, comment installer Mnémo sur Windows et t'en servir. Compte 5 minutes.

> **Mnémo, c'est quoi ?** Une application de révision par cartes (comme Anki), qui marche **sans internet et sans compte**. Tes cartes restent sur ton PC.

---

## Méthode 1 — La plus simple : télécharger l'installateur

1. Ouvre la **page des versions** de Mnémo (le lien t'a été donné avec ce guide ; elle ressemble à `github.com/…/mnemo/releases`).
2. Tout en haut, repère la dernière version (par exemple **v1.0.0**), puis cherche la section **Assets** (« Fichiers »). Si elle est repliée, clique sur la petite flèche pour la déplier.
3. Clique sur le fichier qui se termine par **`-setup.exe`** (par exemple `mnemo-1.0.0-setup.exe`). Le téléchargement démarre.
4. Quand c'est fini, ouvre ton dossier **Téléchargements** et double-clique sur le fichier.
5. **Windows affiche « Windows a protégé votre ordinateur »** ? C'est normal : Mnémo est un logiciel libre, pas signé par une grande entreprise.
   - Clique sur **Informations complémentaires**,
   - puis sur **Exécuter quand même**.
6. Laisse l'installation se terminer. Un raccourci **Mnémo** apparaît sur ton bureau et dans le menu Démarrer.

C'est tout. Passe directement à « Tes premiers pas ».

---

## Méthode 2 — Si tu n'as pas de fichier `.exe` : installer depuis le code

Cette méthode télécharge Mnémo sous forme de dossier et le prépare automatiquement.

1. Sur la page principale de Mnémo (GitHub), clique sur le bouton vert **`< > Code`**, puis sur **Download ZIP**.
2. Ouvre ton dossier **Téléchargements**, fais un clic droit sur le fichier ZIP → **Extraire tout…** → **Extraire**.
3. Ouvre le dossier extrait, puis le dossier **`mnemo`** à l'intérieur.
4. Double-clique sur **`INSTALLER-MNEMO.bat`**. Une fenêtre noire s'ouvre : c'est normal, elle fait le travail à ta place.
   - Si **Node.js** n'est pas installé, elle l'installe pour toi. **Ferme alors la fenêtre et double-clique à nouveau** sur `INSTALLER-MNEMO.bat`.
   - Laisse-la tourner (2 à 5 minutes, il faut de la connexion internet cette fois-ci seulement).
5. À la fin, Mnémo s'ouvre tout seul.

**Les fois suivantes**, double-clique simplement sur **`LANCER-MNEMO.bat`**. Tu peux faire un clic droit dessus → *Envoyer vers* → *Bureau (créer un raccourci)* pour l'avoir sous la main.

---

## Tes premiers pas

Au premier lancement, Mnémo te propose trois étapes, **toutes facultatives** :

| Étape | À quoi ça sert |
| --- | --- |
| Importer un deck Anki ou un fichier | Récupérer tes cartes, images et historique |
| Synchroniser tes PC | Retrouver tes cartes sur un second ordinateur |
| Activer l'IA | Générer des cartes depuis un cours |

Tu peux cliquer sur **« Commencer sans rien configurer »** ou **« Essayer avec un deck d'exemple »** : tu verras comment ça marche en 2 minutes.

### Créer ta première carte
1. Clique sur **+ Nouvelle carte** en haut à gauche (ou touches **Ctrl + N**).
2. Choisis ou crée un **deck** (un paquet de cartes, par exemple « Histoire »).
3. Écris la **question** (Recto) et la **réponse** (Verso).
4. **Ctrl + Entrée** pour enregistrer et passer à la suivante.

Astuces d'écriture : `**gras**`, `*italique*`, `$x^2$` pour une formule, trois accents graves pour du code, et **Ctrl + Maj + C** sur un mot pour le transformer en **trou** (« texte à trous »). Tu peux **coller une image** directement.

### Réviser
1. Sur l'accueil, clique sur **Commencer la révision**.
2. Lis la question, réfléchis, puis appuie sur **Espace** pour voir la réponse.
3. Note-toi honnêtement avec **1** (À revoir), **2** (Difficile), **3** (Bien) ou **4** (Facile). Mnémo calcule tout seul quand te reposer la question.
4. Une erreur ? **Z** annule la dernière réponse.

Révise un petit peu **chaque jour** : c'est la régularité qui compte, pas la durée.

### Les raccourcis à retenir
| Touche | Action |
| --- | --- |
| `Ctrl + K` | Recherche et commandes rapides |
| `Ctrl + N` | Nouvelle carte |
| `Espace` | Voir la réponse / répondre « Bien » |
| `1` `2` `3` `4` | Noter la réponse |
| `Z` | Annuler |
| `E` | Modifier la carte en cours |
| `S` / `B` | Suspendre / reporter à demain |

---

## Passer d'Anki (ou d'autre chose) à Mnémo, sans douleur

Clique sur **Importer** dans le menu de gauche, ou **glisse simplement un fichier dans la fenêtre**. Mnémo reconnaît le format tout seul et te montre ce qui va se passer avant d'importer.

| Tu viens de… | Ce que tu fais |
| --- | --- |
| **Anki installé sur ce PC** | Ferme Anki, puis **Importer → Anki installé sur ce PC**. Un clic : cartes, images, historique. Ta collection Anki n'est jamais modifiée. |
| **Anki sur un autre PC** | Dans Anki : *Fichier → Exporter…* → *Paquet Anki (.apkg)*, avec médias et historique. Glisse le fichier dans Mnémo. |
| **Anki, export en texte** | *Fichier → Exporter…* → *Notes en texte brut*. Les colonnes (deck, type, étiquettes) sont reconnues. |
| **Quizlet** | *Exporter* sur ton jeu de cartes, copie le texte, **Importer → Coller du texte**. |
| **Excel, Google Sheets, Brainscape, Memrise…** | Enregistre en **CSV**, puis glisse le fichier. Tu choisis ce que contient chaque colonne dans l'aperçu. |
| **Obsidian, Notion, Markdown** | **Importer → Dossier de notes** ou Notion (voir *Intégrations*). |
| **Un cours en PDF ou Word** | Glisse le fichier : l'IA propose des cartes, tu valides. |

**Tu peux utiliser les deux en parallèle quelque temps.** Relance l'import quand tu veux : Mnémo n'ajoute que les nouvelles cartes et les révisions faites entre-temps. Rien n'est jamais dupliqué.

> L'audio n'est pas encore repris. Si un fichier pose problème, garde-le : on pourra corriger l'import.

---

## Synchroniser deux ordinateurs (sans compte, sans serveur)

Il te faut un dossier que **OneDrive, Dropbox ou Google Drive** synchronise déjà sur tes deux PC.

**Sur le premier PC**
1. **Synchronisation** (clic sur « Local · hors ligne » en bas à gauche) → **Choisir un dossier** (ex. `OneDrive\Mnemo`).
2. Invente une **phrase de récupération** (8 caractères minimum, par exemple une phrase que tu retiens facilement). **Note-la quelque part de sûr** : sans elle, les données synchronisées sont perdues.
3. **Activer la synchronisation**.

**Sur le second PC**
1. Installe Mnémo, ouvre **Synchronisation**.
2. Choisis **le même dossier** (attends que OneDrive/Dropbox l'ait synchronisé), saisis **la même phrase**.
3. Activer. Tes cartes arrivent, et tes révisions des deux PC s'**additionnent** : rien n'est écrasé.

Tout est **chiffré** dans le dossier : même quelqu'un qui accède à ton Drive ne peut rien lire sans ta phrase. Avant chaque fusion, une copie de sécurité est faite automatiquement.

---

## Générer des cartes avec l'IA (facultatif)

Mnémo marche très bien sans. Si tu veux gagner du temps :

**Option A — 100 % sur ton PC, gratuit (Ollama)**
1. Installe Ollama depuis [ollama.com](https://ollama.com).
2. Ouvre l'invite de commandes (touche Windows, tape `cmd`, Entrée) et tape : `ollama pull llama3.1`
3. Dans Mnémo : **Réglages → Intégrations → Intelligence artificielle** → fournisseur **Ollama (local)** → **Tester la connexion**.

**Option B — avec ta propre clé d'API (Claude, OpenAI…)**
1. Crée une clé chez le fournisseur de ton choix.
2. Dans Mnémo : même page, choisis le fournisseur, colle ta **clé** (elle est chiffrée par Windows, jamais écrite dans tes fichiers), fixe un **plafond mensuel**.

**Utilisation** : **Génération IA** dans le menu de gauche → colle ton cours ou choisis un PDF/Word → **Vérifier avant l'envoi** (tu vois le texte exact et le coût estimé) → **Envoyer et générer** → corrige, décoche ou rejette → **Ajouter**. L'IA propose, **toi tu valides** : rien n'entre dans tes decks sans ton accord.

---

## Le cahier de texte et le planning

1. **Cahier de texte → Matières** : crée tes matières (couleur, coefficient).
2. **Nouvelle entrée** : choisis *Examen*, une date, la matière, et **relie un ou plusieurs decks**.
3. L'onglet **Planning** te dit : *« Pour tout avoir vu 2 jours avant, vise 12 nouvelles cartes par jour »*. Un clic sur **Appliquer cette limite** règle tes decks. Tu es toujours libre de refuser.
4. Le calendrier montre les jours chargés. **.ics** exporte tes échéances vers Google Agenda, Outlook ou Apple Calendrier.
5. **Réglages → Intégrations → Rappel quotidien** : une notification Windows avec le nombre de cartes du jour.

---

## Tes données

- Elles sont dans le dossier `C:\Users\<toi>\AppData\Roaming\Mnemo` (**Réglages → Dossier de données → Ouvrir**).
- Une **sauvegarde automatique** est faite chaque jour (30 gardées) : **Réglages → Sauvegardes → Restaurer**.
- Besoin de tout récupérer ailleurs ? **Réglages → Tout exporter (JSON)**, ou **Intégrations** pour CSV, Markdown, Anki.
- **Désinstaller** : Paramètres Windows → Applications → Mnémo. Tes données restent dans le dossier ci-dessus tant que tu ne le supprimes pas.

---

## Ça ne marche pas ?

| Problème | Solution |
| --- | --- |
| Windows bloque le fichier d'installation | *Informations complémentaires* → *Exécuter quand même*. Si ton antivirus insiste, ajoute une exception pour le fichier. |
| `INSTALLER-MNEMO.bat` se ferme tout de suite | Clic droit → *Exécuter en tant qu'administrateur*. Vérifie ta connexion internet. |
| « Node.js n'est pas reconnu » | Installe-le depuis [nodejs.org](https://nodejs.org) (version LTS), redémarre l'ordinateur, relance le `.bat`. |
| Mnémo ne s'ouvre pas | Double-clique sur `LANCER-MNEMO.bat`. Si le message dit « pas encore installé », relance `INSTALLER-MNEMO.bat`. |
| La synchro dit « phrase incorrecte » | Vérifie les majuscules et les espaces : la phrase doit être **identique** sur les deux PC. |
| L'IA répond « Ollama ne répond pas » | Ouvre l'application Ollama (icône dans la barre des tâches), puis réessaie. |
| Une carte importée d'Anki est bizarre | Garde le paquet `.apkg` et signale-le : on corrigera l'import. |

Pour demander de l'aide, joins une **capture d'écran** et décris ce que tu as cliqué juste avant.

---

## Pour les curieux : mettre à jour ou compiler soi-même

- **Mise à jour (méthode 1)** : télécharge le nouvel installateur et lance-le par-dessus l'ancien. Tes données sont conservées.
- **Mise à jour (méthode 2)** : retélécharge le ZIP, copie ton ancien dossier à côté, relance `INSTALLER-MNEMO.bat`. Tes données ne sont pas dans ce dossier, elles sont conservées.
- **Publier une version (mainteneur)** : `git tag v1.0.0 && git push --tags` ; l'installateur est construit automatiquement et apparaît dans *Releases*.
