# Seconde qualification Gemma — ProspectIa-v2

Cette fonction appartient à **AndyRama/ProspectIa-v2**, pas à l’application distincte `prospect-ia`. Elle ajoute une seconde évaluation commerciale aux fiches existantes de **Tous les leads**. Elle ne collecte pas de nouveaux prospects.

## Utilisation

1. Dans **Mon business & paramètres**, enregistrer votre offre et votre zone. La qualification se fonde sur ce profil, les critères affichés et le moteur propre à chaque fiche.
2. Renseigner la **clé OpenRouter** dans le champ protégé des paramètres, ou configurer `OPENROUTER_API_KEY` côté serveur. La valeur enregistrée dans les paramètres est chiffrée avec le mécanisme existant et n’est pas renvoyée au navigateur. Ne pas communiquer cette clé dans WhatsApp. Un indicateur « configurée » signifie seulement présence de la clé.
3. Ouvrir **Tous les leads**, puis **Requalifier avec Gemma**. Vérifier le périmètre : sélection courante éligible ou premiers leads affichés. Un lot est limité à **10 fiches** ; une sélection supérieure doit être réduite ou remplacée par un périmètre explicitement limité, pas tronquée en silence.
4. Examiner les critères et le profil, puis préparer l’aperçu. Cette étape est locale : aucun appel OpenRouter n’est lancé.
5. Confirmer le lot. L’application vérifie le modèle gratuit puis soumet une seule requête de qualification pour ce lot. L’ouverture, la saisie et l’annulation ne consomment pas de requête IA.
6. Consulter le score, la justification, les données manquantes et la date ; utiliser le filtre de qualification si souhaité. Par défaut les leads restent tous visibles.

## Signification des résultats

- **Qualifié** : score de 60 à 100.
- **À revoir** : score de 40 à 59.
- **Non retenu** : score de 0 à 39.
- **Non qualifié** : aucune seconde qualification IA enregistrée (ce n’est pas un résultat négatif).

Ces seuils sont appliqués par le serveur, pas confiés à un libellé libre du modèle. Une évaluation IA n’est pas une preuve de budget, de besoin urgent, de consentement commercial ou de délivrabilité d’un contact. Une absence d’information n’est pas une preuve d’absence réelle de site ou d’activité.

La seconde qualification ne remplace pas le score technique du site, les notes Google, les données collectées ou le statut **À contacter / Contacté / En discussion / Gagné / Perdu**. Elle ne sélectionne, archive, supprime ou contacte aucun lead. Les anciennes évaluations restent conservées lors d’une nouvelle analyse ; une erreur ne les efface pas.

Les fiches de démonstration, archivées, redirigées vers un doublon, opposées au contact ou supprimées ne sont pas envoyées au modèle. L’éligibilité et l’état courant sont vérifiés côté serveur, pas seulement par le bouton. Les modifications commerciales intervenues pendant la requête sont préservées ; une fiche dont les données d’évaluation ont changé peut être ignorée plutôt que recevoir un résultat périmé.

## Modèle et frais

Identifiant exact : `google/gemma-4-26b-a4b-it:free`.

Le catalogue public OpenRouter a été contrôlé pour cet identifiant et indiquait des tarifs d’entrée/sortie à zéro. Le serveur revérifie les prix avant une requête confirmée, impose un plafond fournisseur nul et désactive les replis. Aucun modèle alternatif payant n’est sélectionné si Gemma est indisponible. Cette fonction ne lance aucun run Apify.

Gratuit ne signifie pas quota illimité, disponibilité garantie ou latence constante. Si le modèle disparaît, devient incompatible, atteint sa limite ou renvoie une erreur, la qualification échoue explicitement sans réutiliser un modèle payant. Un coût fournisseur absent n’est pas présenté comme un coût réel vérifié.

Références officielles :
- Catalogue : `https://openrouter.ai/api/v1/models`
- Routage et plafonds : `https://openrouter.ai/docs/features/provider-routing`
- Contrat Chat Completions : `https://openrouter.ai/docs/api_reference/overview`

## Données transmises et confidentialité

Le modèle reçoit un extrait borné des **informations publiques utiles à l’évaluation**, le moteur concerné, le nom de votre business, vos services, votre zone et les critères examinés. Les emails et téléphones ne sont pas envoyés comme coordonnées ; leur présence peut être représentée par un booléen. Les URL sont réduites à des informations sans identifiants, paramètres ou fragments sensibles.

Ne sont pas envoyés : clés, notes de suivi, brouillons, dossiers Hermès, consignes privées Hermès ou accès de publication. La fonction ne visite pas les sites des prospects et ne lance pas de recherche d’emails. Les textes des fiches et la réponse du modèle sont traités comme des données, jamais comme des commandes à exécuter.

L’envoi d’un extrait à OpenRouter reste un partage avec un fournisseur externe : vérifier les critères et le périmètre avant confirmation. Cette intégration ne garantit pas une absence de conservation ou d’entraînement par le fournisseur ; ne pas y placer de données confidentielles.

## Reprise et conservation

Un aperçu serveur possède un identifiant et une durée limitée. La confirmation réserve durablement cet identifiant avant toute requête IA. Confirmer plusieurs fois le même lot ou le consulter après rechargement ne doit pas soumettre une seconde inférence automatiquement.

Si une réponse est perdue, la reprise consulte l’état du même identifiant. Un résultat déjà enregistré est relu ; une opération en cours ou incertaine ne déclenche pas une nouvelle requête. Après succès suivi d’un échec d’actualisation de la liste, le bouton de reprise recharge seulement les données.

Une réponse incomplète, un score invalide, un identifiant inattendu ou du JSON incorrect ne remplace pas les évaluations antérieures. Les nouveaux résultats et leur reçu sont enregistrés de façon cohérente ; les écritures ne recréent pas une fiche supprimée et ne rétablissent pas une sélection ou une opposition anciennes.

## Vérification

Les tests utilisent des fiches synthétiques, des bases temporaires et un transport OpenRouter simulé. Ils doivent établir le comportement des vrais handlers, la persistance, les reprises et les limites, pas seulement la forme d’un bouton. Un test simulé ne prouve ni validité d’une clé réelle, ni disponibilité d’un fournisseur, ni qualité commerciale réelle du classement.

Aucune inférence réelle ni collecte payante n’est autorisée ou nécessaire pour exécuter cette suite. Le contrôle public du catalogue est distinct d’un appel de qualification. La publication d’une PR ne signifie pas fusion ou déploiement.
