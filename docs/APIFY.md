# Apify : recherche avec exclusions avant facturation

## Diagnostic

L'ancienne route payante par mots-clés utilisait `compass/crawler-google-places`, dont le schéma ne propose pas d'exclusion des entreprises déjà collectées avant facturation. Filtrer ensuite dans SQLite n'empêche pas de payer ces mêmes résultats. Cette route reste bloquée, même avec `refresh` ; les anciennes recherches restent consultables.[3]

Les endpoints et le schéma publics de Compass étaient accessibles lors de l'audit : aucune URL cassée n'a été constatée. Deux défauts distincts ont été identifiés : la récupération manuelle vérifiait seulement l'Actor d'un run, et le coût pouvait être enregistré avant sa stabilisation.

## Recherche par ville et activité

Le nouveau parcours utilise **`benthepythondev/google-maps-business-scraper`**. Son schéma expose `excludePlaceIds`, `excludePlaceUrls`, `onlyNew` et `monitorId`. Selon la documentation du fournisseur, les établissements exclus ou déjà livrés dans ce mode ne sont pas sauvegardés ni facturés comme résultats.[1]

1. Renseigner ville, activité/mot-clé et budget.
2. **Préparer une recherche Apify** calcule un plan local : critères, limite du lot, nombre d'identifiants à exclure et avertissements. Aucun run à cette étape.
3. Relire le fournisseur nommé dans l'aperçu, le budget et les limites. Les fiches sans identifiant Google exploitable ne peuvent pas être exclues avec certitude par identifiant.
4. **Confirmer et lancer la collecte Apify** est l'action payante explicite. Le serveur revérifie le plan, les limites enregistrées et le verrou avant le POST fournisseur.
5. **Récupérer la collecte** consulte ce run existant. En cas de lancement incertain, retrouver son Run ID : ne pas relancer une nouvelle collecte pour contourner un délai réseau.

La clé reste dans `.env` ou les paramètres chiffrés. Ne jamais la transmettre dans le chat, un export ou Git. `npm run check:connections` effectue des contrôles sans collecte payante.

## Anti-doublons et conservation

- Exclusions sur l'ensemble des fiches réelles connues, l'historique et les réservations exploitables, pas uniquement les lignes visibles ou sélectionnées.
- Identifiants conservés comme chaînes : ne pas convertir un CID Google en nombre JavaScript, au risque de perdre sa précision.
- Empreinte liée aux critères, budget, exclusions et mémoire de suivi ; un plan périmé demande un nouvel aperçu.
- `onlyNew=true` avec un `monitorId` stable ajoute une mémoire fournisseur entre les runs de l'installation ; ne pas remplacer cette protection par un nom différent à chaque clic.[1]
- Un seul run à la fois. Répéter la même requête déjà en cours ou enregistrée ne doit pas créer un second paiement.
- Un filtre local supplémentaire ne réintroduit pas une identité connue si le prestataire la renvoie. Ce filtrage après réponse n'est pas une preuve de non-facturation.

Les identifiants absents, les changements d'identité Google et la qualité des données du prestataire empêchent de promettre zéro doublon physique dans toutes les situations. Un lot peut contenir moins de 25 nouveaux établissements ; aucun faux résultat n'est ajouté pour compléter.

**Conserver `.env` et `.data/` lors d'une mise à jour.** L'historique et la mémoire locale fournissent une partie des exclusions. Le changement de fournisseur ne supprime ni anciennes recherches, ni fiches, sélections ou dossiers Hermès.

## Coût

La tarification publique du nouvel Actor est `PAY_PER_EVENT`, avec un événement de démarrage et des événements de résultats. Un frais de lancement peut donc subsister même sans nouvelle ligne exportée.[1][2]

Le contrat et le build sont vérifiés avant lancement. Le lot est limité à 25 au plus et `maxTotalChargeUsd` transmet le seuil financier à Apify. Ce seuil reste soumis au fonctionnement des événements du prestataire : il ne constitue pas une garantie absolue de facture. Ne pas utiliser `maxItems` comme protection financière pour un Actor `PAY_PER_EVENT`.

Seul le coût rapporté par Apify est affiché, jamais une estimation présentée comme débitée. Une collecte récemment terminée reste en finalisation avant que son coût soit enregistré. Des informations de fin manquantes ne deviennent pas un coût définitif.

## Enrichissement Compass historique

`POST /api/apify/plan` prépare toujours localement un lot de 1 à 25 Place IDs importés. `POST /api/apify/enrich` revérifie l'empreinte, les plafonds et les identifiants déjà collectés ou réservés avant l'appel. Les anciens `apify_place_claims` sont conservés.

Compass reçoit des `placeIds`, jamais une nouvelle recherche par mots-clés. Les options d'avis, images et enrichissements supplémentaires restent désactivées lorsqu'elles existent. Selon la documentation de cet Actor, les Place IDs directs peuvent néanmoins entraîner un supplément de détails. Les paramètres de ce parcours ne doivent pas être confondus avec ceux du nouvel Actor de recherche.[3]

## Récupération sûre

Un Run ID ne suffit pas : avant rattachement, contrôler l'Actor, le propriétaire, la chronologie et l'entrée du run par rapport à la collecte en attente. Un run historique, d'un autre compte ou d'un autre lot doit être refusé sans lever le verrou. Une ancienne collecte incertaine sans éléments de correspondance suffisants demande une vérification manuelle, pas un rattachement approximatif.

## Collecte gratuite retirée

La recherche d’entreprises OpenStreetMap/Nominatim/Sirene est désactivée côté interface et route `/api/search`. Les nouvelles recherches passent exclusivement par l’aperçu et la confirmation Apify ; aucun paiement n’est déclenché implicitement par un appel ancien à `/api/search`. Les anciens leads, recherches et réserves sont conservés, sans réinitialiser la base. La carte peut toujours afficher des tuiles OpenStreetMap : cet affichage ne collecte aucune nouvelle entreprise.

## Vérifications et limites

Les schémas et tarifs publics ont été consultés le **24 octobre 2026**, par GET sans token ni lancement payant.[1][2][3] Les tests utilisent des fournisseurs simulés et des bases temporaires. Le comportement effectif des exclusions et la facturation du nouvel Actor ne sont pas validés par un run payant dans cette intervention : les garanties annoncées restent celles du prestataire, pas une preuve tirée des tests locaux.

## Sources

[1] https://api.apify.com/v2/acts/benthepythondev~google-maps-business-scraper/builds/default — Actor de recherche avec exclusions : schéma et documentation officiels
[2] https://api.apify.com/v2/acts/benthepythondev~google-maps-business-scraper — Tarification officielle du nouvel Actor de recherche
[3] https://api.apify.com/v2/acts/compass~crawler-google-places/builds/default — Schéma officiel Compass conservé pour enrichissement ciblé
