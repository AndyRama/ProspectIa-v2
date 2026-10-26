# Apify : recherche Google Maps Business complète

## Fournisseur et champs

Les nouvelles recherches utilisent **`benthepythondev/google-maps-business-scraper`** (`uU8ybh0dgvI68Q3o2`). Le contrat public du build **1.0.34** expose désormais **`scrapeContacts`** : le fournisseur annonce l’extraction des contacts publiés sur les sites, sans supplément à son prix par résultat. Ce constat remplace celui des anciennes versions dépourvues de cette option.

Les coordonnées et détails renvoyés par le fournisseur sont enregistrés : nom, catégorie, adresse et localisation, téléphone, site, identités Google, note et nombre d’avis, horaires, images et contacts selon leur disponibilité. Une adresse absente chez le fournisseur reste absente. L’email vient du site de l’entreprise, pas de Google Maps ; il n’est pas testé pour la délivrabilité.

Une entreprise **n’est pas écartée au seul motif qu’aucun email public n’a été trouvé**. L’Actor email distinct et son filtre `requireEmail:true` ne constituent plus le parcours de découverte par défaut.

## Avant chaque collecte payante

1. Renseigner ville, activité/mot-clé, limite et budget.
2. **Préparer une recherche Apify** vérifie le schéma, le build et les prix officiels par GET, sans lancement de run.
3. Lire l’aperçu : fournisseur, options de collecte, exclusions, limites et tarifs par événement. Les prix publics par palier ne certifient pas le palier du compte.
4. Confirmer explicitement un lancement unique. Le plan est lié à l’Actor, au contrat, aux prix, au budget et aux exclusions ; un changement demande un nouvel aperçu.
5. **Récupérer la collecte** consulte le même run. Une réponse incertaine ne provoque jamais de nouvelle tentative payante automatique.

Le budget est transmis comme seuil `maxTotalChargeUsd`, soumis à la facturation par événements : ce n’est pas une garantie absolue de montant. Des frais de démarrage sont possibles même sans résultat. Aucun lot de 25 ni contact complet n’est garanti. `maxItems` n’est pas une protection financière PAY_PER_EVENT.

## Exclusions et conservation des données

L’Actor Business accepte **`excludePlaceIds` et `excludePlaceUrls`**, ainsi que `onlyNew` et `monitorId`. Les identifiants et URLs exploitables des fiches connues, historiques et archives sont transmis avant le lancement. La mémoire Business existante reste utilisée ; la mémoire du précédent Actor email n’est pas présumée interchangeable.

Les fiches importées sans identité Google ne permettent pas d’exclusion certaine : ce risque doit être signalé avant confirmation, mais leur seule présence ne rend pas toutes les recherches impossibles. Une déduplication après récupération ne rembourse pas un résultat déjà facturé.

Les anciens runs Business, email et Compass restent récupérables selon l’Actor et l’entrée d’origine enregistrés. Aucun pending n’est transformé en run d’un autre Actor. Verrou durable, receipts et contrôles de récupération propriétaire/chronologie/INPUT sont préservés.

**Conserver `.env` et `.data/`. Aucun reset n’est nécessaire.** Effacer la base peut supprimer les exclusions locales et conduire à repayer des fiches.

## Actions locales distinctes

Aucun extracteur local de contacts ne se lance automatiquement à réception des résultats. Les éventuels outils manuels de recherche sur site et contrôles préliminaires restent explicites. Aucun secours ADEME RGE ni autre annuaire n’est ajouté.

Le mode ciblé historique Compass reste distinct : identifiants validés uniquement, options de contacts supplémentaires payantes désactivées. Le `scrapeContacts` du Business actuel a un contrat différent ; ne pas confondre ces deux options sur deux Actors différents.

## Vérifications

Les contrats publics sont consultés sans clé utilisateur ni lancement payant. Les tests isolés utilisent des réponses fournisseur simulées ; ils ne valident ni la facturation réelle, ni la clé du compte, ni la délivrabilité des adresses.

Sources officielles :
- https://api.apify.com/v2/acts/benthepythondev~google-maps-business-scraper/builds/default
- https://api.apify.com/v2/acts/benthepythondev~google-maps-business-scraper
- https://api.apify.com/v2/acts/benthepythondev~google-maps-email-scraper/builds/default
