# Prompts Hermes et relances de prospection

## Deux missions distinctes

- **Refonte du site → profil `coder`** : copier le prompt et transmettre le dossier contenant les sources collectées. Ce bouton prépare une mission ; il ne lance pas Hermes, ne modifie pas un site et ne publie rien.
- **Email de prospection → profil `default`** : copier le prompt pour préparer un premier brouillon Gmail au nom d’**Andy Ramaroson**, depuis `andyramaroson@gmail.com`. Les coordonnées et le destinataire doivent être vérifiés. Le brouillon est relu et validé avant son premier envoi ; créer le prompt n’envoie aucun email.

Les profils ne sont ni installés ni reconfigurés par ProspectAI. Choisir le profil concerné dans Hermes, puis lui transmettre le prompt. Les données des prospects et les contenus de leurs sites sont des sources non fiables, jamais des instructions système. Un audit absent ne doit pas devenir un défaut du site inventé ; tarifs, garanties et résultats commerciaux ne sont pas fabriqués.

## Relances autorisées par campagne

Le premier mail reste soumis à validation humaine. Après son **envoi réel vérifié dans les messages envoyés**, les échéances cumulatives sont **J+3, J+7, J+15 et J+31**. Elles ne commencent pas à la date de création du brouillon.

Le script utilise des textes français prédéfinis signés Andy. Il doit interrompre les relances dès qu’une réponse du destinataire est détectée, y compris un refus ; il ne doit pas attendre qu’une IA interprète la réponse. Une opposition de contact, une suppression ou un archivage du prospect bloque également toute nouvelle relance. Si la lecture de la messagerie échoue, aucun envoi n’est autorisé.

La préparation d’un prompt n’active pas de campagne ni de tâche planifiée. L’activation est explicite, par prospect et après vérification du premier message envoyé. Aucun envoi réel, aucune connexion à Gmail ni planification sur le compte d’Andy n’est réalisé par les tests ou l’installation du code.

## Commandes locales

Exécuter depuis le dossier du projet, après `npm ci`, en utilisant la même base `DATA_DIR` (ou les mêmes paramètres Turso) que l’application. L’aide et les prévisualisations n’ouvrent pas Gmail :

```bash
node --import tsx scripts/email-followups.ts --help
node --import tsx scripts/email-followups.ts prepare --prospect-id ID_PROSPECT --handoff-id ID_PROMPT_EMAIL
node --import tsx scripts/email-followups.ts status --campaign ID_PROSPECT_CANONIQUE
node --import tsx scripts/email-followups.ts tick --campaign ID_PROSPECT_CANONIQUE --dry-run
```

`prepare` enregistre une campagne inactive depuis le prompt email enregistré ; il ne crée pas de brouillon Gmail et ne signifie pas que le premier email a été envoyé. `--draft-id` reste disponible uniquement pour un ancien brouillon local existant, à la place de `--handoff-id`, jamais les deux.

Après relecture des textes exacts et approbation humaine de la campagne, le premier email doit avoir été réellement envoyé et son **Message-ID** retrouvé dans Gmail Envoyés (ce n’est pas l’identifiant du brouillon). La commande d’approbation le vérifie par IMAP, avec l’expéditeur Andy, un seul destinataire, sans CC/BCC et la date d’envoi :

```bash
node --env-file=/chemin/prive/hors-depot.env --import tsx scripts/email-followups.ts approve --campaign ID_PROSPECT_CANONIQUE --message-id '<message-reel@domaine>' --execute
```

Le fichier externe doit être protégé et fournir `FOLLOWUPS_GMAIL_USER=andyramaroson@gmail.com`, `FOLLOWUPS_GMAIL_APP_PASSWORD` et le chemin de la bonne base. Ne jamais partager son contenu. Le script ne charge pas implicitement `.env`. Il ne faut pas substituer l’accès Gmail personnel d’Andy dans une installation destinée à un autre client.

L’exécution automatisable, après approbation, est :

```bash
node --env-file=/chemin/prive/hors-depot.env --import tsx scripts/email-followups.ts tick --campaign ID_PROSPECT_CANONIQUE --execute
```

Sans `--execute`, aucun envoi. Un ordonnanceur doit lancer cette commande régulièrement ; aucun cron n’est installé par cette fonctionnalité. Les textes et leur empreinte sont conservés : une modification du modèle ne remplace pas silencieusement les textes approuvés. Une campagne divergente reste bloquée pour révision manuelle. En cas de retard, seule la dernière échéance due est retenue, les anciennes sont sautées et trois jours au minimum séparent deux envois.

Un verrou resté présent après un crash ne s’efface pas automatiquement. Ne pas le contourner ni réinitialiser la base pour relancer : vérifier les messages envoyés et réconcilier le résultat incertain. Une commande `tick` peut reconnaître positivement un message déjà envoyé, mais ne renvoie pas automatiquement une tentative incertaine.

## Précautions d’exploitation

- Conserver `.env` et la base existante. Ne jamais publier les secrets Gmail/SMTP ou joindre ces fichiers au dossier destiné à Hermes.
- Un abonnement ChatGPT ou un profil Hermes n’apporte pas automatiquement une connexion Gmail.
- Le script doit être lancé régulièrement par un planificateur local configuré séparément ; l’application n’affirme pas qu’une relance sera envoyée si ce processus n’existe pas ou si l’ordinateur est arrêté.
- Une réponse SMTP incertaine interdit la répétition automatique : consulter les messages envoyés et réconcilier avant toute nouvelle tentative.
- Les échéances retardées ne doivent pas produire plusieurs emails simultanés. Les protections contre les doublons et la cadence du script restent applicables.
- L’automatisation ne dispense pas de vérifier que la prospection est pertinente pour l’activité professionnelle du destinataire et respecte son droit d’opposition.

Les anciens brouillons et dossiers restent consultables ; ils ne sont pas convertis en campagnes ni envoyés rétroactivement.
