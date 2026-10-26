# Emails fournis par Apify Business

Le parcours courant est **`benthepythondev/google-maps-business-scraper` avec `scrapeContacts:true`**, documenté dans [APIFY.md](APIFY.md).

Le build public 1.0.34 expose cette option : l’Actor lit les sites des établissements et fournit les contacts qui y sont publiés, sans supplément annoncé au prix du résultat. Les anciennes observations « No email addresses » concernaient un contrat antérieur ; elles ne décrivent plus ce build.

Le fournisseur peut renvoyer `primary_email`, `emails`, des réseaux sociaux et la présence d’un formulaire de contact. Ces données restent publiques et non vérifiées pour la délivrabilité. Ni l’email, ni tous les champs, ni le nombre demandé de résultats ne sont garantis. Une entreprise sans email est conservée, pas écartée par un filtre `requireEmail`.

Les tarifs officiels, le budget, les exclusions par identifiant et URL et les limites sont affichés avant confirmation explicite de chaque collecte payante. Aucun crédit n’est dépensé pour simplement préparer l’aperçu.

La récupération automatique **locale** sur les sites reste retirée. Les outils locaux manuels restent distincts ; aucun secours ADEME ou autre annuaire n’est ajouté. Les anciens runs email restent récupérables avec leur contrat enregistré, sans être relancés.

## Sources

- Schéma et documentation : https://api.apify.com/v2/acts/benthepythondev~google-maps-business-scraper/builds/default
- Métadonnées/prix : https://api.apify.com/v2/acts/benthepythondev~google-maps-business-scraper

Contrat vérifié en lecture seule ; aucun run payant de validation ni test de délivrabilité effectué.
