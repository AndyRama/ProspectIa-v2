# Récupération des emails publics des sites

## Pourquoi les emails Google Maps étaient vides

Les anciennes versions de l’Actor Business ne proposaient pas d’extraction de contacts. Le contrat actuel du build 1.0.34 documente désormais `scrapeContacts` : les nouvelles collectes Business demandent cette option pour les contacts publiés sur les sites, sans supplément annoncé. Google Maps lui-même ne publie pas l’email. Une adresse absente du site reste introuvable ; aucune adresse n’est inventée. Voir [le contrat actuel](EMAILS-APIFY.md). Les actions décrites ci-dessous restent des outils locaux manuels distincts.

Source officielle consultée : https://api.apify.com/v2/acts/benthepythondev~google-maps-business-scraper/builds/default (`actorDefinition.readme`). Ne pas ajouter un paramètre `scrapeEmails` non documenté ni relancer les anciens lots payants pour compenser cette absence.

## Nouveau parcours

La récupération automatique des emails est désactivée, y compris après sauvegarde d’un **nouveau lot Apify**. La recherche locale complémentaire d’un email public ne démarre que par une action explicite dans la fiche. Google Maps ne fournit pas l’email et la présence d’une adresse publique sur le site n’est pas garantie ; cette limite reste affichée avant paiement.

Le panneau de récupération des emails en lot a été retiré pour alléger le tableau. La recherche individuelle dans la fiche reste disponible ; ses résultats confirmés dans la base restent acquis. Aucun traitement local ne démarre à l’import, à la réouverture d’une ancienne recherche ou au simple chargement du dashboard.

Pour **les prospects déjà payés et enregistrés**, ne pas réinitialiser la base ni relancer Apify :

- **Rechercher l’email sur le site** consulte explicitement la page publique du lead puis les pages de contact pertinentes du même site.
- Un nouveau lot Apify conserve les contacts éventuellement fournis par l’Actor et reste enregistré sans lancer de recherche locale complémentaire d’emails. La recherche individuelle dans la fiche n’engage aucun nouveau run Apify.
- L’adresse trouvée conserve sa page source, sa date et la qualification **publique, non vérifiée**. Aucune adresse n’est construite à partir du nom d’un dirigeant, d’un modèle supposé ou du domaine.
- Le résultat distingue **trouvé**, **aucun email public trouvé dans les pages consultées**, et **vérification impossible**. Un échec ou une absence ne prouve pas que l’entreprise n’a pas d’email.
- Une adresse utilisateur valide n’est jamais remplacée. Sans site, conserver la saisie manuelle d’une adresse réellement connue.

L’extraction est limitée à quatre pages et quinze secondes par lead, avec les contrôles de lecture publique, de taille et de redirections du projet. Les protections archives, démonstration, opposition et suppression restent applicables. Une modification concurrente ne doit pas être écrasée.

## Coûts et confidentialité

Il ne s’agit pas d’un nouveau run Apify : aucun crédit Apify n’est utilisé par cette lecture publique. Les exclusions et la mémoire des anciennes collectes sont conservées. La disponibilité et le contenu des sites restent des limites : anti-bot, pages inaccessibles et contenus uniquement exécutés en JavaScript peuvent empêcher la collecte.

Aucun email n’est envoyé, aucune campagne n’est activée et aucun test de délivrabilité de boîte n’est effectué. Une adresse publiquement visible n’est pas une autorisation générale de prospection ; conserver la pertinence professionnelle et respecter les oppositions.
