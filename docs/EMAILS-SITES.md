# Récupération des emails publics des sites

## Pourquoi les emails Google Maps étaient vides

L’ancien Actor de découverte `benthepythondev/google-maps-business-scraper` annonce explicitement **« No email addresses »** : Google Maps ne les publie pas. Il renvoie notamment le téléphone et l’URL du site. Lire `emails[0]` dans ces résultats ne déclenche aucune extraction d’email et ne garantit pas que ce champ existe. Les nouvelles recherches utilisent désormais l’Actor dédié aux emails ; voir [le contrat actuel](EMAILS-APIFY.md). Les actions décrites ci-dessous restent uniquement des outils manuels distincts.

Source officielle consultée : https://api.apify.com/v2/acts/benthepythondev~google-maps-business-scraper/builds/default (`actorDefinition.readme`). Ne pas ajouter un paramètre `scrapeEmails` non documenté ni relancer les anciens lots payants pour compenser cette absence.

## Nouveau parcours

La récupération automatique des emails est désactivée, y compris après sauvegarde d’un **nouveau lot Apify**. Une recherche publique ne démarre que par une action explicite dans la fiche ou un lot confirmé. Google Maps ne fournit pas l’email et la présence d’une adresse publique sur le site n’est pas garantie ; cette limite reste affichée avant paiement.

La file est séquentielle dans le navigateur, avec progression et arrêt. Un checkpoint local conserve les sites non encore tentés après rechargement ; ce n’est pas un service serveur autonome. Fermer l’application interrompt le traitement. Une requête interrompue n’est pas doublée automatiquement et reste retentable via le traitement de la base.

Pour **les prospects déjà payés et enregistrés**, ne pas réinitialiser la base ni relancer Apify :

- **Rechercher l’email sur le site** consulte explicitement la page publique du lead puis les pages de contact pertinentes du même site.
- **Récupérer les emails des sites affichés** traite un lot manuel borné de fiches éligibles sans adresse exploitable, un lead à la fois.
- Un nouveau lot Apify reste enregistré sans lancer d’extraction d’emails. Les contacts ne sont recherchés que sur demande explicite ; cette étape n’engage aucun nouveau run Apify.
- **Récupérer les emails de toute la base** permet aussi de rattraper les prospects déjà collectés, indépendamment des filtres d’affichage, après confirmation. La progression distingue trouvés, introuvables, échecs et fiches non éligibles ; l’arrêt prend effet après la requête en cours. Les résultats déjà enregistrés restent acquis et les adresses valides sont exclues d’une nouvelle passe. Aucun traitement ne démarre à l’import, à la réouverture d’une ancienne recherche ou au simple chargement du dashboard.
- L’adresse trouvée conserve sa page source, sa date et la qualification **publique, non vérifiée**. Aucune adresse n’est construite à partir du nom d’un dirigeant, d’un modèle supposé ou du domaine.
- Le résultat distingue **trouvé**, **aucun email public trouvé dans les pages consultées**, et **vérification impossible**. Un échec ou une absence ne prouve pas que l’entreprise n’a pas d’email.
- Une adresse utilisateur valide n’est jamais remplacée. Sans site, conserver la saisie manuelle d’une adresse réellement connue.

L’extraction est limitée à quatre pages et quinze secondes par lead, avec les contrôles de lecture publique, de taille et de redirections du projet. Les protections archives, démonstration, opposition et suppression restent applicables. Une modification concurrente ne doit pas être écrasée.

## Coûts et confidentialité

Il ne s’agit pas d’un nouveau run Apify : aucun crédit Apify n’est utilisé par cette lecture publique. Les exclusions et la mémoire des anciennes collectes sont conservées. La disponibilité et le contenu des sites restent des limites : anti-bot, pages inaccessibles et contenus uniquement exécutés en JavaScript peuvent empêcher la collecte.

Aucun email n’est envoyé, aucune campagne n’est activée et aucun test de délivrabilité de boîte n’est effectué. Une adresse publiquement visible n’est pas une autorisation générale de prospection ; conserver la pertinence professionnelle et respecter les oppositions.
