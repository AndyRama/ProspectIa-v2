# Apify : recherche d’entreprises avec email publié

## Fournisseur et sortie attendue

Les nouvelles recherches utilisent **`benthepythondev/google-maps-email-scraper`** (`4MTxdHfGoKTLDoTrD`), avec `requireEmail:true`. Le fournisseur annonce l’exclusion des établissements dont le site ne publie pas d’email : ils ne sont pas sauvegardés ni facturés comme résultats selon son contrat. Cela ne garantit ni 25 résultats ni la délivrabilité des boîtes.

Les sorties documentées incluent `primary_email`, `emails[]` (objets contenant email, source, confiance et état éventuel), les coordonnées et les identités Google selon disponibilité. Les métadonnées sont conservées avec provenance, sans présenter une boîte comme vérifiée/délivrable en l’absence de preuve.

L’ancien `google-maps-business-scraper` ne publie pas d’emails. Ses collectes déjà payées restent lisibles/récupérables avec leur Actor et entrée enregistrés. Changer uniquement le nom d’Actor dans un ancien pending est interdit.

## Avant de payer

1. Renseigner ville, activité, limite et budget.
2. **Préparer une recherche Apify** calcule les exclusions et vérifie publiquement le build, le schéma et les tarifs. Ces GET de métadonnées ne lancent aucun run.
3. L’aperçu nomme l’Actor, montre ses tarifs par événement, le budget et les avertissements. Le palier de prix effectif du compte n’est pas certifié par un GET public.
4. La confirmation explicite autorise un seul lancement. Le serveur revalide Actor/build/schéma/input/prix/exclusions sous verrou ; tout changement demande un nouvel aperçu.
5. Récupérer le même run, sans relancer après une réponse incertaine.

Au contrôle public, le prix Free annoncé est de 0,003 USD par résultat et 0,00005 USD par Go pour l’événement de démarrage. L’interface reprend les métadonnées actuelles plutôt qu’une estimation présentée comme facture. Un frais de démarrage peut subsister avec zéro résultat. `maxTotalChargeUsd` transmet un seuil d’arrêt soumis au fonctionnement des événements, pas une garantie absolue de facture ; `maxItems` n’est pas une protection financière pour PAY_PER_EVENT.

## Exclusions et migration sûres

- Le nouvel Actor accepte `excludePlaceIds`, `onlyNew` et `monitorId`, mais **pas `excludePlaceUrls`** dans le schéma publié.
- Les URLs encodant des identifiants Google exacts peuvent être réconciliées ; une URL seule non convertible ou une identité historique insuffisante **bloque le lancement**. Ne pas supprimer les fiches pour contourner cette garde.
- La mémoire distante `google-maps-email-monitor` est distincte de celle de l’ancien Actor business. Garder uniquement le même nom de monitor ne prouve pas la reprise de l’historique ; les exclusions explicites restent indispensables.
- Les identités sont conservées comme chaînes, notamment les CID ; aucune réparation d’un nombre arrondi.
- Les receipts UUID, verrou durable, absence de retry automatique, preuve de récupération Actor/propriétaire/chronologie/INPUT et finalisation du coût sont conservés.

**Conserver `.env` et `.data/` pendant la mise à jour.** Le reset efface les exclusions locales et peut conduire à repayer les mêmes entreprises. Aucun reset n’est nécessaire pour installer ce correctif.

## Hors périmètre automatique

La récupération automatique locale des emails sur les sites est retirée, y compris après un nouveau run. Les actions manuelles éventuelles restent dans les fiches/outils explicites, pas répétées sur chaque ligne. Aucun fallback ADEME RGE ni autre annuaire n’est ajouté.

L’enrichissement ciblé Compass historique reste distinct : Place IDs validés uniquement, blocage des recherches libres susceptibles de refacturer les mêmes résultats, contacts payants supplémentaires désactivés. Les données et anciens historiques ne sont pas effacés.

## Vérification et limites

Contrats et tarifs vérifiés par GET anonymes officiels, sans lancement payant. Les tests utilisent des providers simulés et des bases temporaires ; ils ne valident ni une clé utilisateur, ni le débit réel, ni la délivrabilité. Les anciens runs business et Compass restent soumis à leur contrat et prix d’origine.

Sources officielles :
- https://api.apify.com/v2/acts/benthepythondev~google-maps-email-scraper/builds/default
- https://api.apify.com/v2/acts/benthepythondev~google-maps-email-scraper
- https://api.apify.com/v2/acts/benthepythondev~google-maps-business-scraper/builds/default
- https://api.apify.com/v2/acts/compass~crawler-google-places/builds/default
