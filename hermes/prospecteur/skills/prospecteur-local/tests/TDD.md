# Journal TDD local

Commande depuis la racine du dépôt :

```text
python -B -m unittest discover -s hermes/prospecteur/skills/prospecteur-local/tests -v
```

Les résultats ci-dessous sont les observations réelles des exécutions, résumées sans chemins propres à la machine. Chaque tranche fonctionnelle a été ajoutée après son échec observé ; les sources auditées vendues sont préexistantes, non réimplémentées.

| Cycle | RED observé avant implémentation | GREEN observé après |
|---|---|---|
| 01 Bootstrap | `test_01`: code 2, script bootstrap absent ; `Ran 1 test`, `FAILED (failures=1)` | `Ran 1 test in 8.647s`, `OK` ; runtime npm dans profil temporaire, pas de SQLite |
| 02 Business et isolation | `test_02`: CLI absente, commande status retourne code 1 ; `Ran 2 tests`, `FAILED (failures=1)` | `Ran 2 tests in 6.813s`, `OK` ; validation, reprise autre processus, deux homes |
| 03 Découverte | `test_03`: commande non autorisée ; `Ran 3 tests`, `FAILED (failures=1)` | `Ran 3 tests in 10.008s`, `OK` ; 25 puis 5 inédits, aucun rappel lors de reprise |
| 04 Une entreprise | `test_04`: remplacement accepté, `AssertionError: 0 == 0` | `Ran 4 tests in 10.711s`, `OK` ; claim durable, remplacement/records refusés |
| 05 Audit/brouillons/dossier/DNC | `test_05`: analyse non autorisée ; `Ran 5 tests`, `FAILED (failures=1)` | `Ran 5 tests in 14.065s`, `OK` ; vrai stockage audit/3 brouillons/dossier, DNC et demo refusés sans fetch |
| 06 Wrapper | `test_06`: script prospecteur absent, code 2 | `Ran 6 tests in 16.212s`, `OK` ; NODE_OPTIONS malveillant retiré, pas d’auto-install |
| 07 Fidélité métier | `test_07`: la migration native « agent vocal » changeait les services et cassait la reprise identique | `Ran 7 tests in 15.466s`, `OK` ; clé métier indépendante `prospecteur:business`, sources inchangées |
| 08 Réglages orphelins | `test_08`: initialisation acceptée malgré réserve existante, `AssertionError: 0 == 0` | `Ran 8 tests in 21.516s`, `OK` ; nouveau profil vide exigé |
| 09 Contrat du kit | D’abord erreur fichier SKILL manquant ; assertion explicite ajoutée puis `Documentation du skill absente`, `FAILED (failures=1)` | Inclusion dans la suite finale verte ; 14 SHA-256, frontmatter, lock et absence de chemins locaux vérifiés |
| 10 Cache Python | Première tentative déjà verte car cache redirigé par environnement ; correction du test pour retirer `PYTHONPYCACHEPREFIX`, puis `AssertionError: True is not false` | `Ran 10 tests in 20.582s`, `OK` ; interdiction d’écriture bytecode avant import commun |

Ajustement du test statique : autoriser le chemin dynamique `$HERMES_HOME/workspace/...` sans le confondre avec un chemin machine `/workspace/...` ; aucune protection métier n’a été relâchée.

## Frontières vérifiées

- SQLite réelle, profils temporaires, nouveau processus Node par commande.
- Fournisseurs gratuits et lecture HTML interceptés par `tests/provider.mjs`, aucune requête réelle vers OSM/Sirene/sites.
- Les variables de production factices présentes dans le processus test sont absentes au moment du fetch simulé.
- Le bootstrap installe réellement avec `npm ci --ignore-scripts`, uniquement dans les espaces temporaires, jamais dans le skill.
- Aucune activation de profil, service applicatif, base de production, secret réel, contact ou paiement.

`green.log` est capturé depuis une nouvelle exécution réelle complète, pas reconstruit à partir de cette table. Ce dossier de tests doit être exclu de toute archive de partage.
