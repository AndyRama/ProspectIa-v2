// Isolation boundary: no engine import until environment and local paths are fixed.
import path from 'node:path';
import os from 'node:os';
import { mkdirSync, lstatSync, existsSync } from 'node:fs';

const home = path.resolve(process.env.HERMES_HOME || path.join(os.homedir(), '.hermes'));
const root = path.join(home, 'workspace', 'prospecteur');
const allowed = new Set(['PATH', 'HOME', 'USERPROFILE', 'SYSTEMROOT', 'WINDIR', 'PATHEXT', 'LANG', 'LC_ALL', 'TMPDIR', 'TEMP', 'TMP']);
for (const key of Object.keys(process.env)) if (!allowed.has(key)) delete process.env[key];
process.env.HERMES_HOME = home;
process.env.DATA_DIR = path.join(root, 'data');
let storage: typeof import('./server/db.ts') | undefined;

function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Objet JSON requis.');
  return value;
}
function keys(value: Record<string, any>, names: string[]) {
  if (Object.keys(value).some(k => !names.includes(k))) throw Error('Champ non autorisé.');
}
function text(value: unknown, name: string, required = true, max = 5000): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()) || /[\x00-\x08\x0b-\x1f]/.test(value)) throw Error('Champ invalide : ' + name);
  return value.trim();
}
function business(value: unknown) {
  const b = object(value);
  const required = ['name', 'services', 'zone', 'tone', 'prices', 'website', 'instagram', 'facebook', 'userName'];
  keys(b, [...required, 'hermesInstructions']);
  const result: any = {};
  for (const k of required) result[k] = text(b[k], k, ['name', 'services', 'zone', 'tone', 'userName'].includes(k));
  for (const k of ['website', 'instagram', 'facebook']) if (result[k]) {
    const u = new URL(result[k]);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw Error('URL publique requise : ' + k);
  }
  if (b.hermesInstructions !== undefined) result.hermesInstructions = text(b.hermesInstructions, 'hermesInstructions', false);
  return result;
}
function literalIdentifier(value: unknown, name: string, max: number) {
  const result = text(value, name, true, max);
  if (result !== value) throw Error('Identifiant invalide, aucune correction automatique : ' + name);
  return result;
}
async function run() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 24 || (major === 24 && minor < 10)) throw Error('Node >=24.10 requis.');
  for (const p of [home, path.join(home, 'workspace'), root, process.env.DATA_DIR!, path.join(process.env.DATA_DIR!, 'prospectai.sqlite')]) {
    if (existsSync(p) && lstatSync(p).isSymbolicLink()) throw Error('Liens symboliques interdits dans les données du profil.');
  }
  mkdirSync(process.env.DATA_DIR!, { recursive: true, mode: 0o700 });
  const [command, raw, ...extra] = process.argv.slice(2);
  if (extra.length) throw Error('Un seul objet JSON autorisé.');
  const a = object(raw === undefined ? {} : JSON.parse(raw));
  const d = storage = await import('./server/db.ts');
  if (command === 'init-business') {
    const b = business(a);
    // Durable claim avoids two concurrent initializations silently replacing identity.
    const existing = await d.getSetting('prospecteur:business', null);
    const same = existing && JSON.stringify(business(existing)) === JSON.stringify(b);
    if (same) return { businessInitialized: true, business: b, unchanged: true };
    if (existing) throw Error('Une seule entreprise par profil : installez un nouveau profil pour une autre entreprise. Modification non exposée.');
    if ((await d.db.execute('SELECT key FROM settings LIMIT 1')).rows.length) throw Error('Réglages déjà présents : installez un nouveau profil vide.');
    for (const table of ['prospects', 'searches', 'drafts', 'deliverables', 'handoffs', 'mail_attempts'] as const) {
      if ((await d.db.execute(`SELECT id FROM ${table} LIMIT 1`)).rows.length) throw Error('Données déjà présentes : installez un nouveau profil vide.');
    }
    if (!await d.claimSetting('prospecteur:business', b)) throw Error('Entreprise déjà initialisée : utilisez un nouveau profil.');
    return { businessInitialized: true, business: b };
  }
  if (command === 'status') {
    keys(a, []);
    return { businessInitialized: !!await d.getSetting('prospecteur:business', null), prospects: (await d.list('prospects')).length, localOnly: true, paid: false };
  }
  if (command === 'list') {
    keys(a, []);
    return { prospects: await d.list('prospects') };
  }
  if (command === 'show') {
    keys(a, ['id']);
    const p = await d.prospect(literalIdentifier(a.id, 'id', 200));
    if (!p) throw Error('Prospect introuvable.');
    const eligible = !p.demo && !p.doNotContact;
    return { prospect: p, drafts: eligible ? (await d.list<any>('drafts')).filter(x => x.prospectId === p.id) : [], handoffs: eligible ? (await d.list<any>('handoffs')).filter(x => x.prospectId === p.id) : [] };
  }
  if (command === 'discover') {
    keys(a, ['city', 'activity', 'keyword', 'engine', 'max', 'requestId']);
    const b = await d.getSetting('prospecteur:business', null);
    if (!b) throw Error('Exécutez init-business explicitement avant toute recherche.');
    const city = text(a.city, 'city', true, 200);
    const activity = text(a.activity, 'activity', true, 100);
    const keyword = text(a.keyword ?? '', 'keyword', false, 200);
    if (!['website', 'voice', 'menu'].includes(a.engine)) throw Error('Moteur invalide.');
    if (!Number.isInteger(a.max) || a.max < 1 || a.max > 25) throw Error('max doit être un entier de 1 à 25.');
    const requestId = literalIdentifier(a.requestId, 'requestId', 100);
    if (!/^[a-zA-Z0-9_-]+$/.test(requestId)) throw Error('requestId invalide.');
    const { discoverNext } = await import('./server/services/discovery.ts');
    return await discoverNext({ city, activity, keyword, engine: a.engine, max: a.max, requestId, paid: false });
  }
  if (['block', 'analyze', 'drafts', 'handoff'].includes(command)) {
    keys(a, command === 'block' ? ['id', 'doNotContact'] : ['id']);
    const p = await d.prospect(literalIdentifier(a.id, 'id', 200));
    if (!p) throw Error('Prospect introuvable.');
    if (command === 'block') {
      if (a.doNotContact !== true) throw Error('block accepte uniquement doNotContact=true. Aucun déblocage exposé.');
      const blocked = { ...p, doNotContact: true };
      await d.saveProspect(blocked);
      return { prospect: blocked };
    }
    const check = (item: import('./server/types.ts').Prospect | undefined) => {
      if (!item || item.doNotContact) throw Error('Ne plus contacter : analyse, brouillons et dossier interdits.');
      if (item.demo) throw Error('Fiche de démonstration : analyse, brouillons et dossier interdits.');
    };
    check(p);
    const b = await d.getSetting<import('./server/types.ts').Business | null>('prospecteur:business', null);
    if (!b) throw Error('Exécutez init-business explicitement avant cette opération.');
    if (command === 'analyze') {
      const { analyze } = await import('./server/services/siteAnalyzer.ts');
      const result = await analyze(p);
      check(await d.prospect(p.id));
      await d.saveProspect(result);
      return { prospect: result };
    }
    if (command === 'drafts') {
      const { generateDrafts } = await import('./server/services/generators/index.ts');
      const drafts = await generateDrafts(p, b, p.engine);
      check(await d.prospect(p.id));
      await d.saveDrafts(drafts);
      return { drafts, sent: false };
    }
    const { buildHermesHandoff } = await import('./server/services/handoffs/hermes.ts');
    const handoff = buildHermesHandoff(p, b, p.engine);
    check(await d.prospect(p.id));
    await d.db.execute({ sql: 'INSERT INTO handoffs VALUES(?,?,?)', args: [handoff.id, p.id, JSON.stringify(handoff)] });
    return handoff;
  }
  throw Error('Commande non autorisée.');
}
try { console.log(JSON.stringify(await run())); }
catch (error) { console.log(JSON.stringify({ error: (error as Error).message })); process.exitCode = 1; }
finally { if (storage) await storage.db.close(); }
