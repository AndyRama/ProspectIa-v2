import { parseArgs } from 'node:util';
import { db } from '../server/db';
import { Followups, validateMessageId } from '../server/services/followups/runner';

const help = `Relances email ProspectAI — aucun envoi du premier email.
Usage: node --import tsx scripts/email-followups.ts <commande> [options]

prepare --prospect-id ID --handoff-id ID
  Enregistre une campagne inactive liée au handoff EXISTANT email / default du prospect.
  Legacy: --draft-id ID à la place de --handoff-id exige un brouillon app EXISTANT.
  Un brouillon Gmail ne crée pas de brouillon app. Les deux options sont exclusives.
  Ne crée ni n'envoie le premier email. Retourne id = id du prospect canonique.
approve --campaign ID --message-id '<identifiant@domaine>' [--execute]
  Sans --execute: aperçu hors ligne, aucune approbation.
  Avec --execute: approbation explicite après preuve Gmail Sent (compte Andy,
  destinataire unique, Message-ID exact, INTERNALDATE). Aucun SMTP.
tick --campaign ID [--dry-run | --execute]
  Défaut: dry-run HORS LIGNE, sans vérification des réponses.
  --execute: max 1 relance approuvée J+3/7/15/31 depuis l'envoi réel initial.
  Retard: saute les étapes anciennes; intervalle minimum 3 jours après relance.
status --campaign ID
  État persistant et étapes (JSON).

Credentials: FOLLOWUPS_GMAIL_USER=andyramaroson@gmail.com et
FOLLOWUPS_GMAIL_APP_PASSWORD via environnement externe uniquement.
Un fichier hors dépôt peut être chargé par node --env-file=/chemin/externe.
Aucun dotenv implicite. DATA_DIR choisit la DB app locale; TURSO_* sont ceux de l'app.
Aucun cron installé. L'automatisation nécessite un ordonnanceur externe explicite.
Réponse/refus, archive ou opposition => arrêt. Échec IMAP => aucun envoi.
SMTP incertain => aucun retry automatique, seulement rapprochement positif Sent.
Un verrou après crash n'expire jamais: investigation opérateur indispensable.
`;

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, strict: true, options: {
    help: { type: 'boolean', short: 'h' }, execute: { type: 'boolean' }, 'dry-run': { type: 'boolean' },
    campaign: { type: 'string' }, 'prospect-id': { type: 'string' }, 'draft-id': { type: 'string' }, 'handoff-id': { type: 'string' }, 'message-id': { type: 'string' },
  } });
  if (values.help) { console.log(help); return; }
  const command = positionals[0];
  if (positionals.length !== 1 || !['prepare', 'approve', 'tick', 'status'].includes(command)) throw Error('usage');
  if (values.execute && values['dry-run']) throw Error('usage');
  const allowed: Record<string, string[]> = { prepare: ['prospect-id', 'draft-id', 'handoff-id'], approve: ['campaign', 'message-id', 'execute', 'dry-run'], tick: ['campaign', 'execute', 'dry-run'], status: ['campaign'] };
  if (Object.keys(values).some(v => !allowed[command].includes(v))) throw Error('usage');
  const required = (name: 'campaign' | 'prospect-id' | 'draft-id' | 'handoff-id' | 'message-id'): string => {
    const value = values[name]; if (typeof value !== 'string' || !value || value.length > 300 || /[\r\n\0]/.test(value)) throw Error('usage'); return value;
  };
  let runner = new Followups();
  if (values.execute) {
    // Constructor does not connect; only explicit approve/tick can touch Gmail.
    const { GmailTransport } = await import('../server/services/followups/gmail');
    runner = new Followups(new GmailTransport({ user: process.env.FOLLOWUPS_GMAIL_USER || '', password: process.env.FOLLOWUPS_GMAIL_APP_PASSWORD || '' }));
  }
  let result: unknown;
  if (command === 'prepare') {
    if (!!values['handoff-id'] === !!values['draft-id']) throw Error('usage');
    result = await runner.prepare(required('prospect-id'), values['handoff-id'] ? { handoffId: required('handoff-id') } : required('draft-id'));
  }
  else if (command === 'status') result = await runner.status(required('campaign'));
  else if (command === 'tick') result = await runner.tick(required('campaign'), !!values.execute);
  else {
    const id = required('campaign'); const messageId = required('message-id'); validateMessageId(messageId);
    result = values.execute ? await runner.approve(id, messageId) : { action: 'dry-run', campaign: (await runner.status(id)).id, messageId, reason: 'No approval or Gmail verification without --execute' };
  }
  console.log(JSON.stringify(result, null, 2));
}
try { await main(); }
catch {
  // Intentionally omit raw library exceptions: URLs/auth/server diagnostics can leak secrets.
  console.error('Relances: opération refusée ou vérification échouée. Aucun envoi supplémentaire. Consultez --help et status; les détails réseau ne sont pas journalisés.');
  process.exitCode = 1;
} finally { await db.close(); }
