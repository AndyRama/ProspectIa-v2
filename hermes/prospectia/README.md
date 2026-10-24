# Profil connecté à ProspectIa-v2

Ce profil travaille sur l’instance existante, à travers l’API agent dédiée. Il ne copie pas sa base : les fiches, recherches, audits, brouillons et dossiers restent dans le stockage SQLite/Turso de l’application.

## Installation

Depuis le dépôt ou le répertoire extrait :

```sh
hermes profile install ./hermes/prospectia --name prospectia -y
hermes -p prospectia model
hermes -p prospectia chat
```

Ou, avec l’archive native fournie :

```sh
hermes profile import ./prospectia.tar.gz --name prospectia
```

La clé et les données ne sont jamais incluses dans ce paquet. L’installation n’active aucun nouveau canal WhatsApp, aucune collecte ni tâche planifiée. Elle ne configure pas automatiquement la délégation du coordinateur.

## Connexion réelle : prérequis séparés

1. Relire puis intégrer/déployer le changement d’API agent dans ProspectIa-v2 en préservant le même stockage et les variables déjà utilisées. Garder `APP_PASSWORD` valide côté application : l’API agent refuse de fonctionner si cet espace n’est pas protégé. Ce mot de passe n’est jamais transmis à Hermes. Faire une sauvegarde normale avant déploiement ; ne pas substituer une base vide à la base existante.
2. Générer localement une clé aléatoire dédiée (au moins 32 octets aléatoires, encodés URL-safe). Ne pas réutiliser APP_PASSWORD, un cookie, une clé Turso ou le jeton Apify.
3. Définir la même `PROSPECTIA_AGENT_TOKEN` dans les variables privées de l’application et dans le `.env` privé de ce profil. Ouvrir les fichiers/paramètres uniquement dans votre environnement ; ne pas coller la valeur dans le chat ni la passer en argument CLI.
4. Définir `PROSPECTIA_URL` dans ce profil : racine HTTPS de l’instance, sans identifiants, chemin, paramètres ni fragment. Le client ne suit pas les redirections. Pour une installation locale, HTTP loopback nécessite `--allow-local` explicite.
5. Dans Hermes, charger `prospectia-connected`, lancer `status`, vérifier le business, puis lire un historique connu. Cela seul permet de déclarer la connexion réelle validée.

Le client attend ces variables dans son environnement. Hermes charge le `.env` de son profil au démarrage ; après modification, démarrer une nouvelle session de ce profil. Une invocation Python directe hors Hermes doit recevoir ces variables localement sans les exposer dans le chat.

## Droits exposés

Lecture du business, fiches, recherches, brouillons et dossiers ; collecte gratuite bornée ; audit ; création de brouillons/dossiers ; modification bornée d’un brouillon. Chaque écriture exige une commande explicitement autorisée et `--confirm`. Aucune interface d’envoi, paiement/Apify, suppression, réglage du business, modification de statut commercial ou levée d’opposition.

Les refus sur les démos et fiches `doNotContact` ne doivent pas être contournés par un autre endpoint ou SQL direct. Une base représente le business de cette instance : ne pas la réutiliser pour mélanger les données d’autres clients.

Les tests fournis utilisent une base temporaire et des fournisseurs simulés. Ils ne prouvent ni le déploiement ni l’accessibilité de votre instance réelle. Une clé partagée par deux copies du profil accède à la même instance ; tourner la clé côté application pour révoquer cet accès.
