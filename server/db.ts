import { mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Client, InStatement } from "@libsql/client";
import type { Business, Prospect, Search, Draft } from "./types";
import { consolidateProspects } from "./services/identity";

const schema = [
  "CREATE TABLE IF NOT EXISTS prospects(id TEXT PRIMARY KEY, data TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS searches(id TEXT PRIMARY KEY, data TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS drafts(id TEXT PRIMARY KEY, prospect_id TEXT NOT NULL, data TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, data TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS deliverables(id TEXT PRIMARY KEY, prospect_id TEXT NOT NULL, data TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS handoffs(id TEXT PRIMARY KEY, prospect_id TEXT NOT NULL, data TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS mail_attempts(id TEXT PRIMARY KEY, draft_id TEXT UNIQUE NOT NULL, data TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS login_limits(key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS suppressions(email TEXT PRIMARY KEY, created_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS apify_place_claims(place_id TEXT PRIMARY KEY, run_id TEXT, created_at TEXT NOT NULL)",
];
let connection: Promise<Client> | undefined;
async function connect() {
  if (!connection) connection = (async () => {
    const remote = process.env.TURSO_DATABASE_URL;
    if (process.env.VERCEL && (!remote || !process.env.TURSO_AUTH_TOKEN))
      throw Error("Vercel : configurez TURSO_DATABASE_URL et TURSO_AUTH_TOKEN pour conserver vos données.");
    let client: Client;
    if (remote) {
      if (!/^(libsql|https):\/\//.test(remote)) throw Error("TURSO_DATABASE_URL doit être une URL libsql:// ou https://.");
      const { createClient } = await import("@libsql/client/web");
      client = createClient({ url: remote, authToken: process.env.TURSO_AUTH_TOKEN });
    } else {
      const dir = process.env.DATA_DIR || path.resolve(".data");
      mkdirSync(dir, { recursive: true });
      const { createClient } = await import("@libsql/client");
      client = createClient({ url: pathToFileURL(path.resolve(dir, "prospectai.sqlite")).href });
    }
    await client.batch(schema, "write");
    const existing = (await client.execute("SELECT data FROM prospects ORDER BY rowid ASC")).rows.map((r) => JSON.parse(String(r.data)) as Prospect);
    const changes = consolidateProspects(existing);
    if (changes.length) await client.batch(changes.map(prospectStatement), "write");
    const businessRow = (await client.execute("SELECT data FROM settings WHERE key='business'")).rows[0];
    if (businessRow) {
      const business: Business = JSON.parse(String(businessRow.data));
      const services = business.services.replace(/\bagent vocal\b/gi, "agent personnel").replace(/\bagents vocaux\b/gi, "agents personnels");
      if (services !== business.services) await client.execute({ sql: "UPDATE settings SET data=? WHERE key='business'", args: [JSON.stringify({ ...business, services })] });
    }
    return client;
  })().catch((e) => { connection = undefined; throw e; });
  return connection;
}
export const db = {
  execute: async (statement: InStatement) => (await connect()).execute(statement),
  batch: async (statements: InStatement[]) => (await connect()).batch(statements, "write"),
  close: async () => { if (connection) (await connection).close(); connection = undefined; },
};
export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = (await db.execute({ sql: "SELECT data FROM settings WHERE key=?", args: [key] })).rows[0];
  return row ? JSON.parse(String(row.data)) : fallback;
}
export async function setSetting(key: string, value: unknown) {
  await db.execute({ sql: "INSERT OR REPLACE INTO settings VALUES(?,?)", args: [key, JSON.stringify(value)] });
}
/** Durable compare-and-set; coordinates separate Vercel instances. */
export async function claimSetting(key: string, value: unknown) {
  const result = await db.execute({ sql: "INSERT INTO settings(key,data) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data WHERE settings.data='null'", args: [key, JSON.stringify(value)] });
  return result.rowsAffected === 1;
}
export const defaultBusiness: Business = { name: "Mon agence", services: "Création et refonte de sites web, agents personnels, menus et supports visuels", zone: "Papeete", tone: "Chaleureux et professionnel", prices: "Sur devis", website: "", instagram: "", facebook: "", userName: "Mon espace" };
type Table = "prospects" | "searches" | "drafts" | "deliverables" | "handoffs" | "mail_attempts";
export async function list<T>(table: Table): Promise<T[]> {
  const rows = (await db.execute(`SELECT data FROM ${table} ORDER BY rowid DESC`)).rows.map((r) => JSON.parse(String(r.data)));
  return table === "prospects" ? rows.filter((p) => !p.duplicateOf) : rows;
}
/** Un seul aller-retour pour afficher l’historique et résoudre ses anciennes références. */
export async function catalogSnapshot() {
  const rows = (await db.execute("SELECT data FROM prospects ORDER BY rowid DESC")).rows.map((r) => JSON.parse(String(r.data)) as Prospect);
  const byId = new Map(rows.map((p) => [p.id, p]));
  const resolve = (id: string): Prospect | undefined => {
    const seen = new Set<string>();
    while (!seen.has(id)) {
      seen.add(id);
      const p = byId.get(id);
      if (!p || !p.duplicateOf) return p;
      id = p.duplicateOf;
    }
    return undefined;
  };
  return { prospects: rows.filter((p) => !p.duplicateOf), resolve };
}
export async function prospect(id: string): Promise<Prospect | undefined> {
  const seen = new Set<string>();
  while (!seen.has(id)) {
    seen.add(id);
    const row = (await db.execute({ sql: "SELECT data FROM prospects WHERE id=?", args: [id] })).rows[0];
    if (!row) return undefined;
    const p: Prospect = JSON.parse(String(row.data));
    if (!p.duplicateOf) return p;
    id = p.duplicateOf;
  }
  return undefined;
}
export const prospectStatement = (p: Prospect): InStatement => ({ sql: "INSERT OR REPLACE INTO prospects VALUES(?,?)", args: [p.id, JSON.stringify(p)] });
export const saveProspect = async (p: Prospect) => { await db.execute(prospectStatement(p)); };
export const saveSearch = async (s: Search) => { await db.execute({ sql: "INSERT OR REPLACE INTO searches VALUES(?,?)", args: [s.id, JSON.stringify(s)] }); };
export const saveDraft = async (d: Draft) => { await db.execute({ sql: "INSERT OR REPLACE INTO drafts VALUES(?,?,?)", args: [d.id, d.prospectId, JSON.stringify(d)] }); };
export async function saveDrafts(drafts: Draft[]) { await db.batch(drafts.map((d) => ({ sql: "INSERT OR REPLACE INTO drafts VALUES(?,?,?)", args: [d.id, d.prospectId, JSON.stringify(d)] }))); }
export async function seedDemo() {
  const names = ["Le Jardin des Saveurs", "Atelier Manoa", "Café des Alizés", "La Table du Lagon", "Maison Nacre", "Salon Moana", "Les Petits Artisans", "Le Comptoir Fleuri", "Pension des Îles"];
  const items = names.map((name, i): Prospect => ({ id: `demo-${i}`, name, category: i === 1 || i === 6 ? "Artisan" : i === 5 ? "Coiffure & beauté" : i === 8 ? "Hôtel" : "Restaurant & café", city: "Papeete", address: "Adresse fictive · Papeete", lat: -17.535 + i * 0.0018, lng: -149.57 + Math.sin(i) * 0.008, website: "", email: "", phone: "", rating: null, reviews: null, selected: false, status: "À contacter", demo: true, webStatus: "Non vérifié", fields: {}, socials: {}, hours: "", photos: [], engine: "website" }));
  await db.batch(items.map((p) => ({ sql: "INSERT OR IGNORE INTO prospects VALUES(?,?)", args: [p.id, JSON.stringify(p)] })));
  return items;
}
