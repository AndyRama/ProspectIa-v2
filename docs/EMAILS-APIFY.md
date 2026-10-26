# Emails fournis par l’Actor Apify

## Choix validé

Les nouvelles recherches visent `benthepythondev/google-maps-email-scraper`, avec `requireEmail:true`. L’utilisateur a accepté le changement de fournisseur et l’affichage du tarif avant confirmation de chaque collecte, sans autoriser de run réel pendant le développement.

Le tarif publié lors de l’étude est de 0,003 USD par résultat sur le plan Free, avec un événement de démarrage supplémentaire. La confirmation doit reprendre les prix effectivement vérifiés, selon le plan et le contrat fournisseur. La présence d’un email ne garantit pas sa délivrabilité, ni le nombre demandé de prospects.

## Périmètre

Aucun secours ADEME RGE ou autre annuaire n’est ajouté. La récupération automatique locale sur les sites reste retirée. L’Actor email effectue lui-même l’extraction sur les sites des établissements : il ne constitue pas une base d’emails indépendante.

Les actions manuelles et contrôles préliminaires existants restent distincts ; ils ne doivent jamais se lancer implicitement après une collecte ou au chargement du dashboard.

## Historique et coût

Ne pas effacer l’historique pour changer de fournisseur. Les identifiants connus doivent rester exclus avant lancement. Le nouvel Actor ne publie pas de champ `excludePlaceUrls` : les anciennes identités connues seulement par URL et impossibles à réconcilier doivent bloquer le paiement plutôt qu’être ignorées.

La mémoire distante du nouvel Actor est différente de l’ancien : conserver le même `monitorId` seul ne prouve pas la reprise de l’historique. Les anciens runs restent récupérables avec leur Actor et leur INPUT d’origine, sans nouveau run automatique.

## Sources officielles

- Schéma et documentation : https://api.apify.com/v2/acts/benthepythondev~google-maps-email-scraper/builds/default
- Métadonnées et prix : https://api.apify.com/v2/acts/benthepythondev~google-maps-email-scraper

Contrat consulté en lecture seule ; aucune facturation ni délivrabilité réelle validée par un run payant.
