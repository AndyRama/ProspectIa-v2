# ProspectAI — Prospection et dossiers pour Hermès IA

ProspectAI aide à trouver des entreprises locales, consulter leur présence web et préparer un **prompt accompagné d’un dossier complet pour Hermès IA**. Hermès réalise ensuite le projet dans son propre environnement, selon vos validations.

La version 1.3 empêche les relances payantes par mot-clé qui facturaient de nouveau des entreprises déjà connues. Le bouton **Trouver 25 nouveaux prospects** utilise les sources gratuites, exclut les entreprises enregistrées et consomme une réserve locale sans recommencer la première liste. Apify est réservé à un enrichissement ciblé de Place IDs vérifiés comme inédits avant l’appel.

Les recherches anciennes, les prospects, les sélections et les statuts restent conservés. Les prompts Hermès et l’offre d’agent personnel sont maintenus. Aucune connexion Gmail, publication de maquette ni API de rédaction n’est utilisée.

## Deux profils Hermes optionnels

- **Prospecteur indépendant** : profil portable dans `hermes/prospecteur`, moteur de recherche et base locale isolés de cette application. Chaque copie démarre sans prospects, business ni secrets.
- **Prospecteur connecté** : profil dans `hermes/prospectia`, utilisant l’API dédiée `/api/agent` et la **base existante** de ProspectIa-v2. Les fiches, recherches, audits, brouillons personnalisés et dossiers restent dans l’application.

Voir [le contrat et les tests de l’API agent](docs/HERMES-AGENT.md) et les README de chaque profil pour installer les distributions. Cette API est facultative et fermée sans clé technique dédiée ; `APP_PASSWORD` doit rester conforme côté application et n’est jamais donné à l’agent. Aucun envoi, paiement, suppression, changement des paramètres ou publication n’est exposé. L’installation d’un profil ne vaut ni déploiement de l’API, ni connexion réelle, ni routage automatique du coordinateur WhatsApp.


## Installation locale

Node.js **24.10 ou supérieur**, de préférence Node 24 LTS, et npm.

```bash
npm ci
npm run setup
npm run dev
```

Ouvrir http://localhost:5173. La commande démarre Vite et Express sur 127.0.0.1. `npm run setup` crée ou complète `.env` sans remplacer les valeurs existantes et génère deux secrets sans les afficher :

- `APP_PASSWORD` : votre mot de passe de connexion à ProspectAI, au moins 16 caractères. Ouvrir `.env` pour le consulter.
- `DATA_ENCRYPTION_KEY` : clé de chiffrement des paramètres sensibles, à conserver avec les sauvegardes. Une ancienne clé locale est réutilisée si elle existe.

```bash
npm run build                 # TypeScript et frontend Vite
npm start                     # API et frontend compilé sur le port 3001
npm test                      # Tests métier/API avec bases temporaires
npm run test:e2e              # Parcours Chromium bureau/mobile
npm run check:connections     # Base et vérification Apify, sans collecte payante
```

Les scripts refusent une version de Node trop ancienne avant de lancer les services. Pour les tests navigateur, Chromium système est détecté sur `/usr/bin/chromium`, ou fournir CHROMIUM_PATH ; sinon installer Chromium pour Playwright avec `npx playwright install chromium`.

Pour mettre à jour une installation existante, arrêter l’application, sauvegarder `.env` et `.data/`, puis remplacer les fichiers du projet par ceux du nouveau ZIP en conservant ces deux éléments. Relancer `npm ci`, `npm run setup` et `npm run dev`. Ne jamais pousser les sauvegardes sur GitHub.

Vérifié en version 1.3 : compilation TypeScript/Vite, 19 tests métier/API et 4 parcours Chromium. Les vérifications incluent trois lots simulés distincts de 25 et le blocage des identifiants déjà collectés avant tout appel Apify. Ils couvrent l’historique, les doublons, le téléchargement du dossier et l’affichage du prompt sur ordinateur et téléphone. L’exécution du projet par votre agent Hermès reste à vérifier avec lui ; ProspectAI ne pilote pas cet agent.

## Le nouveau parcours avec Hermès

1. Dans **Paramètres**, renseigner votre business, vos services, votre zone, vos tarifs indicatifs et votre ton. Le site de votre entreprise peut préremplir ses textes publics. Le champ **Vos consignes complémentaires pour Hermès** permet d’ajouter votre style, vos exemples et vos préférences de livraison.
2. Choisir un moteur avant la recherche : création/refonte de site, menus et supports, ou projet d’agent personnel.
3. Cliquer **Trouver 25 nouveaux prospects**, importer un CSV ou ouvrir la démo. La recherche est gratuite. L’historique permet de revoir les résultats anciens sans les facturer à nouveau.
4. Sélectionner une entreprise et consulter sa fiche : coordonnées, sources et dates. Une absence dans les sources ne prouve pas une absence réelle.
5. Cliquer **Préparer le prompt Hermès**. Si un site est renseigné et n’a pas encore été analysé, ProspectAI tente d’en collecter les contenus publics. Si la lecture échoue, le dossier et le prompt indiquent explicitement cette limite.
6. Dans la fenêtre qui s’ouvre, télécharger **Dossier complet · JSON**, puis copier le prompt ou télécharger sa version Markdown.
7. Dans votre échange habituel avec Hermès, **joindre le JSON et coller le prompt**. Le résumé du prompt ne remplace pas le dossier complet : les textes, images référencées, coordonnées, sources et dates se trouvent dans le JSON.
8. Hermès commence par reformuler le besoin et attend votre « OK ». La création du site, ses vérifications et une éventuelle publication sont ensuite pilotées dans cet échange, avec vos autorisations.

Les projets préparés restent accessibles dans **Prompts pour Hermès**. Chaque dossier est un instantané de la fiche et de votre business à la date de préparation. Modifier le business ou analyser à nouveau une fiche ne modifie pas les dossiers déjà créés ; préparer un nouveau prompt pour refléter ces changements.

### Les consignes incluses

Le prompt reprend votre fonctionnement : langage simple, trois questions utiles maximum dans un seul message, compte rendu à chaque étape et attente de votre « OK ». Il demande à Hermès de ne pas engager de frais, créer de compte, supprimer de données importantes, modifier un site en ligne, contacter un tiers ou publier sans votre accord. Il exige des accès limités, la protection des secrets, des tests réels et un compte rendu honnête des limites. Après deux essais sérieux infructueux, Hermès doit expliquer le blocage.

Pour un site, le prompt demande un inventaire des contenus et une comparaison avec le résultat livré, avec contrôle mobile et ordinateur. Pour un menu, il interdit d’inventer plats et prix. Pour un agent personnel, il prévoit l’organisation des tâches, des documents et du suivi client, en distinguant un prototype des connexions réellement disponibles.

Ces consignes constituent un **document de travail**, pas un contrôle technique sur un service tiers. Le parcours manuel n’établit aucune connexion à Hermès et ne peut pas vérifier ses actions. L’API agent optionnelle décrite plus haut autorise un client Hermes authentifié à travailler sur les données de l’application ; elle ne pilote pas elle-même cet agent. La capacité à lire les pièces jointes, naviguer, coder, mémoriser ou publier dépend de votre environnement Hermès.

## Tous les leads et archivage

Le bouton **Tous les leads** ouvre la liste complète des entreprises enregistrées, indépendamment de la recherche ou du moteur affiché auparavant. Les vues Tous, Actifs et Archivés permettent de retrouver les fiches conservées.

**Archiver** signifie ne plus travailler ce lead en prospection : la fiche est désélectionnée et les nouvelles actions de prospection sont bloquées. Les coordonnées, sources, statuts commerciaux, brouillons, dossiers et références d’historique ne sont pas supprimés. **Désarchiver** remet la fiche parmi les actives sans la sélectionner automatiquement ni lever une opposition de contact.

L’archivage est distinct de **Ne plus contacter**, qui reste conservé. Un lead archivé reste connu du moteur : une nouvelle recherche ou un import ne doit pas le recréer comme nouveau lead ni le réactiver. Aucun envoi ou paiement n’est déclenché par l’archivage/restauration.

## Lots de 25 sans recommencer les mêmes entreprises

Le bouton principal prépare jusqu’à **25 entreprises inédites dans la base**. Il consulte OpenStreetMap et, en France, Sirene ; aucune recherche Apify payante n’est déclenchée. Une collecte gratuite bornée (jusqu’à 250 résultats OSM et trois pages Sirene) alimente une réserve persistante. Chaque clic suivant prélève le lot suivant et exclut les fiches entrées entre-temps, même dans une autre recherche. Un verrou persistant et un identifiant de demande empêchent la consommation concurrente et la répétition accidentelle du même lot.

Les 25 résultats ne sont pas garantis : si la réserve ne contient plus d’entreprise inédite, l’application le dit et s’arrête. Elle ne reprend pas les premières fiches et ne lance pas de collecte payante pour compléter. Modifier la zone ou importer des candidats permet de poursuivre. Un épuisement de cette réserve bornée ne prouve pas l’exhaustivité du marché. Une collecte en erreur n’entraîne aucun repli payant.

Le mot-clé **menuisier** cible aussi le métier `carpenter`/`joiner` dans OSM et le code NAF `43.32A` dans Sirene, sans exiger le mot « menuisier » dans le nom commercial. Les données conservent leurs sources, sans inventer de coordonnées.

Chaque lot et chaque ancienne recherche sont enregistrés avec critères, sources et date. L’historique regroupe les versions et permet de les ouvrir après un redémarrage. **Revoir les fiches enregistrées** affiche les fiches déjà obtenues pour ces critères sans les qualifier de nouveaux prospects. La réouverture des anciennes recherches Google Maps réunit leurs résultats déjà payés ; toute relance payante par mot-clé, y compris avec `refresh`, est refusée côté serveur.

Le rapprochement utilise le SIRET/Place ID ou un nom et une adresse compatibles. Un nom, un domaine ou un téléphone seuls ne suffisent pas. Les doublons anciens reconnus sont regroupés sans effacer leurs lignes d’origine ; leurs anciennes références restent résolues vers la fiche unique. Sélection, suivi, opposition de contact et documents sont conservés. `archivedDuplicateProspects` à l’export conserve les fiches redirigées.

Pour garder votre historique lors d’une mise à jour, **conserver le dossier `.data` et le même `.env`** (ou la même base Turso). Le ZIP ne contient pas votre base personnelle.

## ChatGPT Plus et API de rédaction

Aucune clé API de rédaction n’est nécessaire. Vous pouvez donner le prompt à Hermès ou le copier manuellement dans votre interface ChatGPT habituelle si elle correspond à votre workflow. L’abonnement ChatGPT Plus ne fournit pas d’accès programmatique à l’API et n’est pas connecté à ProspectAI. Les limites de votre abonnement continuent de s’appliquer dans l’interface utilisée.

Les trois brouillons de prospection encore proposés dans l’application sont des **modèles locaux**, personnalisés avec votre business et les observations réellement disponibles. Ils ne sont pas rédigés par ChatGPT. Vous pouvez les relire, les modifier, les copier ou les confier à Hermès. Aucun message n’est envoyé depuis ProspectAI.

## Apify : vérifier les identifiants avant de payer

L’Actor officiel `compass/crawler-google-places` ne propose ni exclusion de Place IDs déjà collectés ni curseur permettant de demander « les 25 suivants ». Un simple filtrage de sa réponse supprime les doublons après leur facturation. La version 1.3 **désactive donc les recherches payantes par mot-clé**, même si l’ancienne interface ou un appel direct à l’API demande une actualisation. Voir [docs/APIFY.md](docs/APIFY.md).

L’enrichissement ciblé reste facultatif :

1. Importer des candidats avec une colonne `placeId` contenant leur véritable identifiant Google Maps (format de 27 caractères commençant par `ChIJ` ou `GhIJ`). Les identifiants manquants ou invalides ne permettent pas de paiement.
2. Sélectionner ces candidats puis **Vérifier un lot Apify avant paiement**. Aucun appel Apify n’est effectué à cette étape.
3. L’aperçu exclut les identifiants déjà présents dans une collecte Apify, y compris dans les anciennes versions, ou réservés par une tentative précédente. Il limite le lot à 25 identifiants distincts et affiche la liste retenue. Un lot entièrement connu n’a aucun bouton de paiement.
4. Si nécessaire, configurer `APIFY_TOKEN` dans `.env` ou les paramètres. Cliquer sur **Enrichir … identifiants inédits** lance un seul run avec `placeIds`, sans `searchStringsArray` ni `locationQuery`. Les identifiants sont réservés durablement avant l’appel ; l’empreinte du lot et les plafonds sont revérifiés.
5. **Récupérer la collecte** récupère ce run existant, sans le relancer. Un lancement incertain conserve son verrou ; retrouver le Run ID dans la console et le récupérer plutôt que recommencer. Les identifiants réservés restent exclus, même après échec partiel : aucune relance payante automatique.

Les URL/Place IDs directs déclenchent une tarification de base et de détails supplémentaires selon Apify ; les contacts sont demandés, les avis individuels, images supplémentaires, personnes et profils sociaux détaillés sont désactivés. Le schéma, le build, PAY_PER_EVENT et le minimum de budget sont vérifiés avant lancement. Le coût affiché est `usageTotalUsd`, jamais une estimation présentée comme débitée. `maxTotalChargeUsd` transmet un seuil d’arrêt ; un événement peut le dépasser selon le fonctionnement Apify.

Ce contrôle empêche la réutilisation des identifiants déjà connus ou réservés, sans prétendre qu’un fournisseur ne peut jamais renvoyer un établissement erroné ou un second identifiant pour une même entreprise. L’historique réel est conservé pour détecter ces cas. L’exécution payante et la facturation de ce nouveau mode n’ont pas été testées en production ; les contrôles sont testés avec fournisseurs simulés, sans crédit dépensé.

ChatGPT Plus ne finance ni Apify ni l’hébergement. La recherche gratuite et les prompts Hermès restent utilisables sans Apify.

## Analyse des sites et fidélité du dossier

L’analyse est manuelle, ou déclenchée par la préparation explicite du dossier. Elle lit jusqu’à **huit pages HTML du même site**, contact, services et menus en priorité, dans une fenêtre de 35 secondes (la dernière requête peut durer 15 secondes de plus). Les pages avec paramètres, connexions et fichiers binaires sont exclues. Les pages redirigées hors du site ne sont pas conservées.

Les textes, références d’images, logo trouvé, couleurs présentes dans le HTML, liens, coordonnées, sources et dates sont conservés dans le dossier. Les PDF restent des liens ; leurs contenus ne sont pas retranscrits. Les images ne sont pas téléchargées et leurs droits ne sont pas présumés acquis. Hermès doit vérifier ces points avant réutilisation.

Le score technique examine HTTPS, balise viewport, copyright et temps indicatif de récupération de l’accueil. Il ne juge pas l’esthétique ni le rendu mobile réel. La vérification MX d’un domaine ne valide jamais une boîte email. Les erreurs et les limites de collecte sont transmises à Hermès. Les entreprises démo et leurs positions fictives sont explicitement signalées.

## Données, accès et anciennes versions

En local, les données persistent dans `.data/prospectai.sqlite` via libSQL, au format SQLite. Avec TURSO_DATABASE_URL, elles résident dans votre base Turso distante. Les tables principales sont prospects, searches, drafts, handoffs et settings. La réserve gratuite reste dans les paramètres de base ; `apify_place_claims` conserve les identifiants réservés avant paiement. Les deux sont inclus dans l’export. Sessions, limites de connexion et oppositions de contact sont conservées séparément. Les clés API sont exclues de l’export.

L’espace personnel utilise APP_PASSWORD, un cookie de session HttpOnly valable 12 heures et une limite persistante de tentatives de connexion. La déconnexion révoque la session ; changer APP_PASSWORD invalide les sessions existantes. Ce n’est pas une application multiutilisateur.

Les anciennes maquettes et historiques d’envoi ne sont pas supprimés lors de la mise à jour : ils restent dans l’export des données, sans bouton de création, publication ou envoi. Les anciennes valeurs SMTP_*, MAIL_*, EMAIL_ENABLED, AI_* et VERCEL_TOKEN éventuellement présentes dans votre ancien `.env` sont **ignorées**. Vous pouvez les retirer du fichier. Retirer l’intégration n’invalide pas un mot de passe ou jeton chez Google/Vercel : leur révocation se gère directement dans ces services si vous la souhaitez.

Le dossier transmis à Hermès ne contient que le profil métier et les données de la fiche ; aucun secret du `.env`, cookie, jeton Apify, mot de passe Gmail ou clé de compte ne doit être joint. Les `.env*`, bases, caches et exports de travail sont exclus de Git et du ZIP livré.

## Héberger ProspectAI sur Vercel (facultatif)

Cette possibilité concerne **l’hébergement de ProspectAI lui-même**, pas une connexion à votre compte pour publier les sites de prospects. L’application ne demande et n’utilise aucun jeton Vercel.

1. Créer une base Turso et renseigner TURSO_DATABASE_URL et TURSO_AUTH_TOKEN. Les tables se créent automatiquement au premier accès. Une base locale ne sera pas automatiquement copiée vers Turso.
2. Pousser le code sur GitHub sans `.env`, `.data/` ou `node_modules/`.
3. Importer le dépôt dans Vercel avec le dossier contenant package.json et server.ts comme racine. Conserver le framework Express, Node 24.x et vercel.json. `npm run build:vercel` prépare les ressources du frontend.
4. Dans les variables d’environnement du projet, ajouter APP_PASSWORD, DATA_ENCRYPTION_KEY, TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, APP_URL et, uniquement si souhaité, APIFY_TOKEN. Copier les secrets générés dans votre propre `.env`, jamais dans le chat ou Git. Définir APP_URL avec votre URL HTTPS.
5. Redéployer et vérifier la connexion et la persistance. Utiliser une base distincte pour les previews et ne pas fournir les variables de production aux contributions non fiables.

Le mode Vercel refuse l’accès applicatif sans mot de passe et clé de chiffrement conformes, et refuse le stockage sans paramètres Turso. Seules les tuiles cartographiques utilisent un cache temporaire dans `/tmp`. Un déploiement Vercel/Turso réel nécessite votre compte et reste à valider dans votre environnement.

## Réseau et limites

Domaines nécessaires : registry.npmjs.org pour l’installation ; api.apify.com pour la collecte payante ; nominatim.openstreetmap.org, overpass-api.de, overpass.kumi.systems et tile.openstreetmap.org pour OSM ; recherche-entreprises.api.gouv.fr pour Sirene ; les sites des entreprises pour l’analyse ; fonts.googleapis.com/fonts.gstatic.com pour les polices optionnelles ; le domaine de votre base Turso si vous l’utilisez.

Les URL internes, credentials dans les URL, ports non standards et redirections vers IP privées sont refusés. Chaque page HTML est limitée à 2 Mo. Les tuiles OSM sont consultées à la demande, mises en cache sept jours et attribuées à OpenStreetMap. Une défaillance des services publics ou une restriction réseau est affichée ; la démo et l’import restent utilisables.

Les essais de recherche réelle ont rencontré des erreurs réseau dans l’environnement de création ; la disponibilité complète OSM/Sirene n’y est pas validée. Aucune collecte facturée n’a été déclenchée. Les parcours démo/import, l’analyse sur sources simulées et les contrôles du contrat Apify sont testés.

## Dépanner le démarrage

`ECONNREFUSED 127.0.0.1:3001` signifie que l’API n’écoute pas sur le port attendu : lire les lignes `[api]` précédentes. Vérifier Node 24.10+, exécuter `npm ci`, conserver PORT=3001 en local, et utiliser un APP_PASSWORD d’au moins 16 caractères. Une valeur trop courte doit désormais produire une erreur explicite, sans ouvrir l’accès aux données.

Après toute modification de `.env`, arrêter avec Ctrl+C puis relancer `npm run dev`. `http://127.0.0.1:3001/api/health` confirme uniquement que l’API répond ; `/api/auth/status` vérifie l’état de connexion. Ne transmettre aucun contenu de `.env` pour demander de l’aide.

## Architecture

```text
client/src/              interface React, carte et affichage du prompt Hermès
server.ts                point d’entrée Express pour l’hébergement
server/
  index.ts               API locale et accès aux dossiers
  auth.ts                espace personnel et sessions
  db.ts                  SQLite local / Turso distant
  secrets.ts             chiffrement de la clé Apify
  services/
    apify.ts             enrichissement par identifiants et coûts
    apifyPlan.ts         exclusion avant paiement
    discovery.ts         réserve gratuite et lots de 25
    osm.ts, registry.ts  recherche gratuite
    siteAnalyzer.ts      collecte multi-page et provenance
    generators/          trois modèles de brouillons locaux
    handoffs/hermes.ts   prompt et dossier de transfert pour Hermès
scripts/                 préparation .env, contrôles et build
 tests/                  parcours métier/API et navigateur
```
