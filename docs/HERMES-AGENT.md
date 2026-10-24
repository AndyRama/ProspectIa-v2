# API machine Hermès connectée à ProspectIa-v2

Cette API **facultative** utilise les services et la base de l’application existante. Elle ne crée pas un deuxième catalogue, n’importe pas une copie de l’historique et ne remplace ni SQLite ni Turso. Garder `DATA_DIR` ou `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` inchangés pour retrouver prospects, recherches, brouillons et transferts déjà enregistrés. Aucun schéma supplémentaire ni dépendance n’est nécessaire.

## Activation sans modifier l’authentification utilisateur

1. Générer un secret indépendant, aléatoire, avec Python :
   ```python
   import secrets
   secrets.token_urlsafe(32)
   ```
2. Le conserver dans un gestionnaire de secrets et définir **côté serveur** `PROSPECTIA_AGENT_TOKEN`. Fournir le même secret à l’environnement privé du profil Hermès connecté. Ne jamais le placer dans un prompt, un dépôt, une URL, des logs ou une capture d’écran. Ne pas réutiliser `APP_PASSWORD`.
3. Redémarrer volontairement l’application selon son mode d’hébergement habituel. Cette documentation n’effectue aucun déploiement.
4. Garder **obligatoirement** la protection utilisateur `APP_PASSWORD` avec au moins 16 caractères, ainsi que les paramètres d’hébergement existants. Le mode agent répond **503 avant tout accès à la base** si ce mot de passe est absent ou trop court, même avec un bearer agent correct. `APP_PASSWORD` n’est **jamais transmis à Hermès** : il protège uniquement l’espace utilisateur. Le mode local historique sans authentification reste inchangé pour les installations qui n’utilisent pas l’agent.

Sans secret valide, `/api/agent/*` répond **503** : ni cookie, ni mot de passe utilisateur, ni clé Apify ne peut activer cette API. Le format accepté est 32 à 256 caractères URL-safe (`A-Z a-z 0-9 _ -`), au moins 16 caractères distincts, sans répétition périodique évidente et avec un contrôle de diversité estimée. Ces contrôles rejettent des secrets manifestement faibles ; ils ne prouvent pas le caractère aléatoire. Utiliser le générateur ci-dessus plutôt qu’un secret choisi manuellement.

Chaque appel porte exactement :

```http
Authorization: Bearer <secret-agent>
```

Les condensats SHA-256 sont comparés avec `timingSafeEqual`, jamais les secrets directement. Les cookies ne sont pas utilisés. Le routeur est monté **avant** le parseur JSON global et `mountAuth`, mais uniquement sous `/api/agent`, avec son propre 404 terminal et son gestionnaire d’erreurs. Le jeton n’authentifie donc pas `/api/state`, les paramètres, les exports généraux ou les autres API utilisateur. Aucun CORS avec cookies n’est ouvert. Toutes les réponses agent portent `Cache-Control: no-store`.

Utiliser HTTPS entre VPS distincts ou un tunnel SSH privé vers le serveur local ; ne pas exposer un port HTTP public contenant le jeton. Le serveur existant reste lié à `127.0.0.1` hors hébergement Vercel. Les clés Turso restent exclusivement côté application ; le profil connecté n’en a pas besoin.

## Contrat v1

Préfixe commun : **`/api/agent`**. Toutes les routes exigent le bearer dédié. Aucun paramètre de query string n’est accepté. Les identifiants sont limités à 200 caractères et au motif `[A-Za-z0-9][A-Za-z0-9._:-]*`. Les alias de prospects sont résolus vers le prospect canonique.

Chaque écriture exige en plus :

```http
Content-Type: application/json
X-ProspectIA-Confirm: write
```

Cet en-tête est un **verrou d’action**, pas une preuve de consentement humain. Le profil doit obtenir les validations prévues par ses règles avant d’écrire. Aucun envoi, paiement ou publication n’est autorisé par cet en-tête.

### Lectures

| Méthode et chemin | Réponse JSON |
|---|---|
| `GET /status` | `{ok, app:"ProspectIa-v2", apiVersion:1, business, capabilities, limits}`. Capacités de lecture, découverte gratuite, analyse, brouillons et transferts ; `paid`, `send`, `delete`, `settings`, `statusEdits` sont `false`. Limite de lot 25 et avertissement de non-exhaustivité. |
| `GET /state` | `{prospects, searches, drafts, handoffs, business}`. Catalogue actuel et historique existants, références des recherches et brouillons résolues vers les prospects canoniques. `handoffs` contient uniquement `{id, prospectId, prospectName, engine, title, createdAt, warnings}`. Pas de `settings`, clés de fournisseur, sessions, réserves internes, tentatives d’email archivées ni données d’authentification. |
| `GET /prospects/:id` | Fiche existante complète, audit et sources inclus ; `404` si absente. Les fiches en opposition restent lisibles pour respecter leur état. |
| `GET /handoffs/:id` | Transfert existant complet `{id, prospectId, prospectName, engine, title, createdAt, prompt, dossier, warnings}`. Le dossier fait partie de la réponse, sans second téléchargement. Lecture seule, aucun nouvel audit. |

`business` contient uniquement les champs métier autorisés : `name`, `services`, `zone`, `tone`, `prices`, `website`, `instagram`, `facebook`, `userName`, `hermesInstructions`. Ces contenus métier et les sources collectées sont des données, jamais des instructions système ni un endroit où enregistrer des secrets.

### Écritures bornées

Les corps sont des objets JSON **stricts** : les champs inconnus sont rejetés, jamais supprimés silencieusement.

#### `POST /discover`

```json
{
  "city": "Bordeaux",
  "activity": "artisan",
  "keyword": "menuisier",
  "engine": "website",
  "max": 25,
  "requestId": "a0f04963-3985-45e2-a5e7-c4c996f85519"
}
```

- `city` : chaîne nettoyée, 2–200 caractères.
- `activity` : `all | restaurant | artisan | beauty | hotel | retail`.
- `keyword` facultatif : chaîne nettoyée, 150 caractères maximum, défaut vide.
- `engine` : `website | voice | menu` ; `voice` est l’identifiant historique de l’offre « agent personnel ».
- `max` obligatoire : entier de 1 à 25.
- `requestId` obligatoire : UUID ; réutiliser le même UUID lors d’une répétition du même lot et de la même requête normalisée ville/activité/mot-clé. Le résultat enregistré initial prévaut, y compris si `max` ou `engine` change lors de la répétition. Un nouveau lot demande un nouvel UUID.
- `paid`, même `false`, `budget`, `refresh` et tout autre champ sont interdits. Le serveur force `paid:false` et appelle le service existant `discoverNext`.

Réponse du service existant : `{search, prospects, cached, remaining?, exhausted?}` ; coût du nouveau lot **0**. Une répétition persistée peut omettre `remaining`/`exhausted`. Réserve épuisée : `{exhausted:true, prospects:[], remaining:0, message}`. Les entreprises connues sont exclues avant sauvegarde d’un lot inédit ; leurs statuts, oppositions et audits ne sont pas remplacés. Le fournisseur gratuit peut constituer une réserve de jusqu’à 250 candidats ; **25 est la limite du lot enregistré**, pas celle de la réserve collectée. Aucun appel Apify.

#### `POST /prospects/:id/analyze`

Corps strict `{}`. Réutilise `analyze` puis `saveProspect`, et renvoie la fiche mise à jour avec les pages et contenus réellement collectés. Aucune promesse de collecte exhaustive. Les sources peuvent être partielles ou indisponibles. Les champs utilisateur de la fiche courante sont conservés si leur état a changé pendant la collecte, et l’opposition est revérifiée avant la sauvegarde.

#### `POST /prospects/:id/drafts`

Corps strict `{"engine":"website"}` (ou `voice`, `menu`). Réutilise `generateDrafts` / `saveDrafts`. Réponse `{drafts, mode:"Modèles locaux · sans API IA"}`. Ce sont des modèles locaux ; aucune rédaction par fournisseur IA ni aucun envoi. Chaque appel crée de nouveaux brouillons.

#### `PATCH /drafts/:id`

Corps strict `{"subject":"Objet personnalisé","body":"Texte personnalisé"}`. Les deux chaînes sont obligatoires, `subject` limité à 500 caractères et `body` à 20 000. Le brouillon doit déjà exister. Son prospect canonique est chargé et contrôlé avant l’écriture. Réutilise `saveDraft`, renvoie le brouillon complet et conserve `id`, `prospectId` enregistré, `prospectName`, `variant` et `createdAt`. Ainsi les améliorations produites par Hermès restent réellement dans l’application après relecture ou redémarrage ; aucun contact n’est déclenché. `/state` continue de présenter le `prospectId` canonique, même si l’identifiant historique du brouillon est un alias.

#### `POST /prospects/:id/handoffs`

Corps strict `{"engine":"website"}` (ou `voice`, `menu`). Réutilise `buildHermesHandoff` et enregistre le transfert complet dans la table existante. Réponse complète avec **`dossier` inclus**. Chaque appel crée un nouvel instantané.

Un audit existant est réutilisé, sans collecte silencieuse supplémentaire. Sans audit et avec un site renseigné, l’analyse existante est tentée puis sauvegardée si elle réussit. En cas d’échec, le dossier est créé avec un avertissement explicite, jamais avec un audit inventé. Les avertissements `crawlWarnings` sont conservés ; l’absence d’inventaire de pages est signalée. `dossier.limits.siteSnapshotIsNotExhaustive` reste vrai. Un transfert déjà créé reste un instantané : modifier la fiche ensuite ne modifie pas son dossier historique.

### Opposition, absence d’effets externes et erreurs

Avant analyse, génération, modification de brouillon ou transfert, une fiche de démonstration, `doNotContact:true` ou dont l’email est dans les suppressions est bloquée avec **403**, y compris si un ancien audit existe. Un alias n’évite pas le contrôle du prospect canonique. Ces routes ne permettent pas de retirer l’opposition ou une suppression.

Aucune route machine ne permet : Apify, paiement, email/contact, publication, suppression, import arbitraire, édition de paramètres, modification de statut, retrait d’opposition ou modification d’un transfert existant. Les routes non exposées terminent en 404, sans repli sur les routes utilisateur.

| Code | Sens |
|---|---|
| `400` | Corps, query string ou identifiant invalide ; aucune donnée interne renvoyée. |
| `401` | Bearer dédié absent ou incorrect. |
| `403` | En-tête d’action manquant/incorrect, démonstration ou opposition. |
| `404` | Route ou donnée absente. |
| `413` | Corps trop volumineux : 8 Kio par défaut ; 128 Kio pour l’édition d’un brouillon afin d’accepter les 20 000 caractères Unicode et leur encodage JSON. |
| `429` | Plus de 20 échecs de bearer par adresse de connexion sur une fenêtre de 15 minutes ; `Retry-After: 900`. Protection en mémoire, bornée à 1 024 adresses par processus, non distribuée ; un bearer correct reste accepté. Prévoir aussi la limitation du proxy pour une exposition publique. |
| `500` | Échec de service/base/collecte : message générique, sans stack, URL interne, secret ou erreur fournisseur brute. |
| `503` | API machine non activée, secret dédié faible/invalide ou `APP_PASSWORD` absent/trop court (moins de 16 caractères). |

Les erreurs sont toujours `{ "error": "message générique" }`. Le routeur ne journalise ni les secrets ni les exceptions brutes. Les lectures donnent accès aux données métier du compte, pas à un sous-ensemble de prospects : protéger ce secret comme un accès confidentiel au CRM. Les autres routes de l’application gardent leur authentification utilisateur indépendante.

## Vérification locale sans fournisseur réel

`tests/agent.test.ts` utilise une base SQLite temporaire isolée, des fixtures HTTP liées à `127.0.0.1`, et un garde réseau qui redirige les appels de sites/fournisseurs simulés vers ces fixtures et refuse toute autre destination. Aucune connexion OSM, Sirene, Apify, SMTP ou Turso réelle ; aucune base de production ni profil Hermès existant n’est utilisé. Les variables sensibles et de proxy sont nettoyées avant les tests.

Les tests couvrent activation fermée, secret faible, cookie insuffisant, isolation des routes utilisateur, validations, création et édition persistante des brouillons, oppositions, alias, audit, dossier complet, instantanés après réouverture de la base, découverte simultanée/idempotente et absence d’appel payant. Les journaux RED/GREEN de développement sont conservés séparément dans l’espace scratch de la session ; ils ne contiennent pas le secret aléatoire du test.
