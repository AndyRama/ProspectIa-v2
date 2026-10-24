# Contrat Apify et protection avant facturation — version 1.3

Le schéma et les tarifs publics de `compass/crawler-google-places` ont été relus le 20 octobre 2026, sans token et sans collecte payante :

- Actor : https://api.apify.com/v2/acts/compass~crawler-google-places
- Build et schéma : https://api.apify.com/v2/acts/compass~crawler-google-places/builds/default
- Build observé : **0.14.773**, PAY_PER_EVENT, minimum de budget observé : **0,50 USD** (relu à chaque lancement).

**Constat :** ce schéma ne contient aucun champ d’exclusion de Place IDs déjà collectés et aucun curseur « résultats suivants ». `placeIds` désigne les établissements à scraper, pas ceux à exclure. Relancer la même chaîne de recherche peut facturer les mêmes fiches, même si elles sont dédupliquées ensuite dans SQLite.

**Décision dans ProspectAI :** aucun nouveau run payant par mots-clés. Le serveur rejette ces demandes, y compris `refresh=true`. Les anciennes recherches sont consultables sans frais. Les nouveaux lots sont préparés avec les sources gratuites et une réserve locale, en excluant le catalogue existant.

## Enrichissement ciblé facultatif

`POST /api/apify/plan` calcule localement un aperçu sur des candidats importés avec un vrai `placeId`. Il compare l’historique Apify, les données anciennes et les réservations persistantes. Il exclut les identifiants déjà collectés ou réservés, les doublons de la sélection, les démos et les identifiants invalides. Il retient au plus 25 identifiants et fournit l’empreinte du lot. Aucun accès externe à cette étape.

`POST /api/apify/enrich` revérifie cette empreinte, les plafonds et l’absence de paiement antérieur. `startApify` refuse lui-même les mots-clés et les identifiants déjà connus. Un verrou durable empêche deux lancements simultanés. `apify_place_claims` réserve chaque identifiant AVANT le POST de lancement et empêche sa répétition après redémarrage ou erreur incertaine.

Entrée envoyée : `placeIds` (1 à 25), `maxCrawledPlacesPerSearch` = taille du lot, `language=fr`, `scrapeContacts=true`. Aucun `searchStringsArray` ni `locationQuery`. Options désactivées lorsqu’elles existent : `scrapePlaceDetailPage`, `maxReviews`, `maxImages`, `maximumLeadsEnrichmentRecords`, les enrichissements des profils sociaux et l’analyse concurrentielle. Les Place IDs/URL directs peuvent néanmoins entraîner automatiquement le supplément de détails, selon la documentation de l’Actor.

L’API reçoit le build vérifié, `maxTotalChargeUsd`, `maxItems` = taille du lot, `restartOnError=false`. Le seuil financier reste soumis aux événements de facturation Apify ; l’application ne garantit pas un plafond absolu indépendant du fournisseur. `usageTotalUsd` du run est la seule source du coût affiché.

Récupération manuelle du même run, idempotente par Run ID, sans relance. Les identifiants restent réservés en cas d’échec ou de réponse incertaine ; aucun crédit supplémentaire n’est engagé automatiquement. Les anciens runs déjà lancés restent récupérables. Aucun remboursement des dépenses anciennes n’est effectué par ProspectAI.

Les tests simulent les fournisseurs et vérifient qu’un identifiant déjà collecté est refusé avant tout appel externe. La vérification sur l’export fourni (37 fiches, 4 recherches) a exclu les 37 identifiants sans appel Apify. Les lots de 25 sont vérifiés avec des candidats simulés ; l’existence de 75 nouveaux établissements réels à Bordeaux n’a pas été affirmée ni vérifiée.

**Non testé :** lancement et facturation réels du nouveau mode ciblé. Aucun crédit n’a été dépensé pour ces vérifications.
