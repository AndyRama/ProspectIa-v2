# Toolkit indépendant Prospecteur

Le skill contient un moteur **vendu comme copie source** (vendored), et non une connexion au serveur ProspectIa-v2. Les 14 fichiers TypeScript audités sont inchangés, épinglés au commit `16278988dca04c59f298ff9cbaea8a23f4b8edb7` ; `SOURCE-MANIFEST.json` contient leur SHA-256. Aucun module n’a été exécuté lors de la copie. L’adaptateur `engine/cli.ts` est nouveau ; il ne charge jamais `server/index.ts`.

## Installation explicite

Après installation du profil par l’installateur natif Hermes, exécuter avec `terminal` depuis le dossier de ce skill :

```text
python -B scripts/bootstrap.py
python -B scripts/prospecteur.py status
```

Prérequis : Python 3, Node >=24.10, npm, accès au registre npm pour le bootstrap. Pas de fichier `config.yaml` produit ici, pas d’installation automatique au chargement du skill. Le bootstrap vérifie les empreintes des sources, copie uniquement le moteur et le manifeste npm dans `$HERMES_HOME/workspace/prospecteur/runtime`, puis lance `npm ci --ignore-scripts --no-audit --no-fund`. `package.json` et `package-lock.json` verrouillent libsql, cheerio et tsx ; aucun `node_modules` n’est livré. Les modules natifs précompilés libsql et esbuild sont installés via leurs dépendances optionnelles, sans scripts d’installation. Sur une plateforme sans binaire compatible, rapporter l’échec : ne pas désactiver la protection.

Le wrapper utilise un environnement à liste blanche et force `DATA_DIR` dans le profil avant de charger le moteur. Il retire notamment TURSO/APIFY/VERCEL/APP/GMAIL, les proxys, variables npm et `NODE_OPTIONS`. Ne pas appeler directement les fichiers du moteur en usage normal. Aucun secret ni fichier `.env` n’est lu, copié ou demandé.

## Une entreprise par profil

Initialisation obligatoire, même si l’application native possède un profil métier par défaut :

```text
python -B scripts/prospecteur.py init-business '{"name":"Mon entreprise","services":"Mes prestations","zone":"Ma ville","tone":"Sobre","prices":"Sur devis","website":"","instagram":"","facebook":"","userName":"Mon prénom"}'
```

Remplacer ces valeurs par les réponses réelles de l’utilisateur. Neuf champs texte obligatoires ; nom/services/zone/ton/prénom non vides ; URLs publiques HTTP(S) sans identifiants si renseignées ; `hermesInstructions` facultatif. Les champs inconnus sont refusés. Aucun fichier JSON utilisateur n’est ouvert : l’argument est le JSON lui-même.

`init-business` est immuable : répétition identique sans effet, toute édition/remplacement refusée avec instruction d’installer un **nouveau profil vide**. Si l’identité manque mais que des fiches, historiques, brouillons, dossiers ou réglages existent, l’initialisation est refusée. Pas de `--force`, reset ni suppression. La clé métier `prospecteur:business` est séparée de la clé native `business`, pour éviter ses valeurs par défaut et sa migration lexicale historique. Une nouvelle copie source du profil commence sans entreprise et sans prospect.

## Commandes

Chaque commande renvoie du JSON sur stdout ; erreur = JSON `error` et code non nul. Un seul argument objet JSON est accepté. Voir `SKILL.md` pour le détail et la procédure.

| Commande | Argument | Effet |
|---|---|---|
| `status` | aucun | Initialisation et nombre de fiches locales |
| `list` | aucun | Fiches dédoublonnées |
| `show` | `{"id":"..."}` | Fiche, brouillons et dossiers ; ces deux derniers masqués si DNC/demo |
| `discover` | ville/métier/mot-clé/moteur/max/requestId | Collecte gratuite et lot inédit via `discoverNext` existant |
| `analyze` | `{"id":"..."}` | Lecture bornée du site public, audit et sources locales |
| `drafts` | `{"id":"..."}` | Trois variantes déterministes de texte, jamais envoyées |
| `handoff` | `{"id":"..."}` | Snapshot JSON + prompt, stocké localement |
| `block` | `{"id":"...","doNotContact":true}` | Blocage permanent via cette interface |

Exemple de recherche :

```text
python -B scripts/prospecteur.py discover '{"city":"Bordeaux","activity":"artisan","keyword":"","engine":"voice","max":10,"requestId":"lot-001"}'
```

`max` : entier 1–25 (booléens refusés). `requestId` : 1–100 caractères alphanumériques, tiret et underscore. Moteurs : `website`, `voice`, `menu`. `paid` n’est pas un argument autorisé ; le moteur reçoit toujours `paid:false`. Le moteur existant peut collecter jusqu’à 250 candidats gratuits dans une réserve pour produire plusieurs petits lots. Rejouer même requête/même `requestId` récupère le résultat persisté sans rappel fournisseur, y compris après redémarrage. La réserve vide ne lance aucune collecte payante.

Les fiches fictives et DNC sont refusées **avant** l’audit, la génération et le dossier. Aucun outil d’envoi, contact, publication, statut de contact, SQL libre ou système de fichiers arbitraire n’est exposé. Les anciens brouillons/dossiers bloqués restent dans la base pour l’historique mais ne sont plus fournis par `show`.

## Emplacements locaux

Tous sont calculés à chaque lancement depuis `HERMES_HOME` (défaut `~/.hermes`) :

- `workspace/prospecteur/runtime/` : copie exécutable et dépendances.
- `workspace/prospecteur/data/prospectai.sqlite` : base SQLite indépendante.
- `workspace/prospecteur/npm-cache/` : cache d’installation.

Aucun runtime ou jeu de données n’est créé dans ce skill. Le bootstrap ne crée pas de base ; `status` peut créer la base vide. Ne pas partager ces espaces ni les profils actifs contenant des sessions/secrets. Les chemins de données principaux symboliques sont refusés pour éviter une redirection accidentelle vers une autre installation. Ce n’est pas un sandbox face à un utilisateur local qui modifie volontairement le code/runtime.

## Tests locaux sans fournisseur réel

Depuis la racine du dépôt, avec `terminal` :

```text
python -B -m unittest discover -s hermes/prospecteur/skills/prospecteur-local/tests -v
```

Les tests utilisent des profils temporaires, de vraies bases SQLite et de nouveaux processus Node pour chaque commande. Seule la couche transport des fournisseurs/site est simulée ; une URL inattendue échoue sans appel réseau. Les tests n’ouvrent pas le serveur applicatif, ne contactent aucun fournisseur réel et ne disposent d’aucun secret. Le bootstrap de test contacte uniquement npm pour installer les dépendances. `tests/TDD.md` conserve les cycles RED/GREEN ; `tests/green.log` contient la dernière exécution. Les fixtures sont uniquement dans `tests/`, jamais copiées dans le runtime par le bootstrap.

## Export et limites

Exporter **uniquement** `SKILL.md`, `README.md`, `SOURCE-MANIFEST.json`, `scripts/*.py`, `engine/package*.json`, `engine/cli.ts` et les 14 fichiers du manifeste. L’empaqueteur du profil doit exclure `tests/`, `__pycache__/`, `*.pyc`, `node_modules/`, workspace, SQLite, caches, sessions, `.env` et secrets ; ne pas archiver un profil actif. Le manifest/SOUL/README du profil sont construits séparément, hors de ce skill.

Les fonctions distantes/default/demo du fichier `db.ts` restent présentes pour préserver la copie auditée, mais elles ne sont jamais exposées ni appelées ; le wrapper et l’adaptateur retirent les variables distantes avant import. Une commande directe du moteur hors wrapper n’est pas une interface prise en charge. Les recherches et audits gratuits exigent Internet en usage réel ; disponibilité, exhaustivité et droits de réutilisation restent à vérifier. Les protections HTTP/DNS sont celles du moteur audité, sans promesse de sandbox réseau. Aucun profil utilisateur/VPS n’est activé ou validé par les tests du dépôt.
