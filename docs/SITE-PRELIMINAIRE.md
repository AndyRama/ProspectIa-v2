# Vérification préliminaire des sites

## États et couleurs

- **Jaune / ambre** : une adresse de site est renseignée, mais aucun contrôle préliminaire réussi n’est enregistré. Le bouton permet de lancer le contrôle.
- **Rouge — Aucun site renseigné** : la fiche ne contient pas d’adresse de site ; le contrôle est indisponible. Ce libellé n’affirme pas que l’entreprise ne possède aucun site sur Internet.
- **Site analysé / À examiner** : un contrôle réel a réussi ; les observations et la date sont enregistrées.
- **Vérification impossible** : la requête n’a pas permis de contrôler la page. Cela ne prouve pas que le site est inexistant ou mauvais. Un nouvel essai reste possible.

## Fonctionnement

Le contrôle préliminaire lit uniquement la page d’accueil publique, avec les limites de taille, de délai, de redirections et la protection contre les adresses privées déjà appliquées à la lecture des sites. Il ne lance ni Apify, ni email, ni navigateur distant. Il ne remplace pas une revue visuelle du site.

Les observations portent sur les données réellement récupérées : HTTPS, titre, description, balise viewport, technologie identifiable et temps de récupération indicatif. La présence d’une balise viewport ne démontre pas que la mise en page est adaptée à tous les téléphones ; le score ne prouve ni la qualité graphique ni un gain commercial.

Le bouton de la ligne ou de la fiche déclenche une vérification explicite. **Vérifier les sites affichés** traite un lot borné, séquentiellement, avec un bilan des réussites/échecs. Aucun contrôle ne démarre automatiquement lors du chargement de la page ou de l’import de leads.

L’analyse complète reste distincte : elle peut consulter plusieurs pages pour constituer le dossier de refonte. Un contrôle préliminaire ne doit pas être présenté comme un inventaire complet des contenus.

## Conservation et erreurs

Les coordonnées saisies par l’utilisateur, oppositions, archives, sélections et statuts commerciaux ne sont pas remplacés par le contrôle préliminaire. Une fiche archivée pendant la requête ne reçoit pas de nouvelle analyse. Une modification concurrente ne doit pas être écrasée.

Une tentative échouée ne fabrique pas d’audit. Un audit antérieur, s’il existe, reste historique et conserve sa date ; il ne devient pas une preuve de réussite du dernier essai. Aucune réinitialisation de la base n’est requise.
