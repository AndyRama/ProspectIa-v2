# Importer des prospects depuis Excel

## Utilisation

1. Ouvrir **Importer Excel** depuis le dashboard de prospection.
2. Télécharger le **modèle Excel** proposé ou choisir un fichier `.xlsx` existant.
3. Sélectionner la feuille contenant les entreprises. La première ligne doit contenir les en-têtes de colonnes.
4. Consulter l’aperçu et les avertissements. Cette étape n’enregistre aucun prospect.
5. Confirmer l’import. Les entreprises sont enregistrées dans le catalogue et disponibles dans **Tous les leads** ; l’opération figure dans l’historique.

Le modèle ne contient aucune entreprise fictive à importer. Remplir sa feuille **Prospects** ; la feuille **Aide** contient uniquement des instructions.

## Colonnes

**Nom** est obligatoire. Les autres colonnes du modèle sont facultatives :

- **Ville**
- **Site web** : URL complète `https://…` ou `http://…`
- **Email**
- **Téléphone**
- **Adresse**
- **Catégorie**
- **Place ID** : véritable identifiant Google Maps, uniquement s’il est disponible

Les équivalents français et anglais usuels sont reconnus. Utiliser des valeurs simples, pas de formules. Pour un téléphone ou un identifiant, choisir le format **Texte** dans Excel : une valeur numérique dont les zéros initiaux ont déjà été perdus ne peut pas être reconstituée avec certitude.

## Limites et confidentialité

- Fichiers `.xlsx` uniquement, au maximum **5 Mio**.
- Au maximum **200 entreprises par import**.
- Feuilles sélectionnées explicitement ; une feuille n’est pas importée simplement parce qu’elle existe dans le classeur.
- Aucune macro ou formule exécutée ; les classeurs invalides, dangereux ou hors limites sont refusés.
- Aucun appel Apify, aucune analyse de site, aucun email et aucun coût fournisseur déclenchés par l’import.
- Les informations sont marquées comme **importées, non vérifiées** ; aucun contact manquant n’est inventé.
- Le rapprochement des doublons réutilise le catalogue existant. Un import ne doit pas réactiver un lead archivé ou lever une opposition de contact.
- Conserver `.env` et `.data/` lors d’une mise à jour ; aucune réinitialisation n’est nécessaire.

Le format CSV et les recherches sauvegardées restent disponibles. L’import Excel n’ajoute pas de capacité de paiement à l’API agent.
