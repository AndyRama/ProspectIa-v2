# Profil Prospecteur indépendant

Un profil de prospection autonome vis-à-vis de ProspectIa-v2 : sa propre base locale, aucune connexion à l’application, aucun accès Turso/Apify et aucun envoi. Le moteur de recherche/dédoublonnage est dérivé du code audité, sans embarquer les données personnelles de l’application.

## Installer et copier

Avec Hermes >=0.22.0, depuis le dépôt ou le répertoire extrait contenant ce dossier :

```sh
hermes profile install ./hermes/prospecteur --name prospecteur -y
hermes -p prospecteur model
hermes -p prospecteur chat
```

Si vous disposez de l’archive native fournie :

```sh
hermes profile import ./prospecteur.tar.gz --name prospecteur
```

Pour une seconde copie vierge, réimporter la même archive avec `--name autreprospecteur`. Ne pas utiliser `--force` sur un profil existant. Ce paquet ne copie ni modèle authentifié, clés, WhatsApp, mémoire métier, historique ni prospects ; configurer le modèle du destinataire. Les éventuels OAuth partagés par Hermes appartiennent à l’installation destinataire, pas à l’archive.

Demander ensuite au profil de charger `prospecteur-local`. Cette skill contient les commandes exactes de bootstrap et d’initialisation. Le bootstrap Node/npm est une étape explicite : aucune installation ni collecte à la simple lecture du profil. Node >=24.10 et accès au registre npm sont nécessaires pour installer le runtime reproductible ; les modules restent dans le workspace local et ne sont pas distribués.

## Initialisation métier

Donner le business, ses services réellement proposés, sa zone, sa cible et son ton ; ne pas inventer les prix. Une entreprise par profil/base. Pour un autre client, importer une copie vierge. La base locale du workspace conserve le travail après redémarrage sur un volume persistant ; ce volume n’est pas une sauvegarde hors machine.

## Limites

La recherche gratuite n’est ni exhaustive ni garantie à 25 résultats. Les données sont sourcées mais à confirmer. L’audit HTML n’est pas un audit visuel/SEO complet. Les liens vers PDF/images ne valent ni lecture ni droits d’utilisation. Pas d’envoi, Apify, paiement, publication ou levée d’opposition.

Un profil n’est pas un sandbox de l’OS. La distribution fournit un rôle et des outils à périmètre borné ; une isolation technique plus forte nécessite des comptes/conteneurs et une configuration d’outils distincts. L’installation ne configure pas le routage automatique depuis le coordinateur WhatsApp.
