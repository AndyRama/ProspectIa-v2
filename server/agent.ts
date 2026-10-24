import express, { type Express, type ErrorRequestHandler } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { catalogSnapshot, db, defaultBusiness, getSetting, list, prospect, saveDraft, saveDrafts, saveProspect } from "./db";
import { analyze } from "./services/siteAnalyzer";
import { buildHermesHandoff } from "./services/handoffs/hermes";
import { generateDrafts } from "./services/generators";
import type { Business, Draft, HermesHandoff, Prospect, Search } from "./types";
import { presentSearch } from "./searches";
import { discoverNext } from "./services/discovery";

const discoveryBody = z.object({
  city: z.string().trim().min(2).max(200),
  activity: z.enum(["all", "restaurant", "artisan", "beauty", "hotel", "retail"]),
  keyword: z.string().trim().max(150).default(""),
  engine: z.enum(["website", "voice", "menu"]),
  max: z.number().int().min(1).max(25),
  requestId: z.uuid(),
}).strict();

const engineBody = z.object({ engine: z.enum(["website", "voice", "menu"]) }).strict();
class AgentError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
async function writable(id: string) {
  const p = await prospect(id);
  if (!p) throw new AgentError(404, "Prospect introuvable.");
  if (p.archived) throw new AgentError(403, "Écriture interdite : prospect archivé.");
  const suppressed = p.email && (await db.execute({ sql: "SELECT 1 FROM suppressions WHERE email=?", args: [p.email.trim().toLowerCase()] })).rows.length;
  if (p.demo || p.doNotContact || suppressed) throw new AgentError(403, "Écriture interdite : démonstration ou opposition au contact.");
  return p;
}

async function business(): Promise<Business> {
  const saved = await getSetting<Business>("business", defaultBusiness);
  const { name, services, zone, tone, prices, website, instagram, facebook, userName, hermesInstructions } = saved;
  return { name, services, zone, tone, prices, website, instagram, facebook, userName, hermesInstructions };
}
const idSchema = z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);


const hash = (value: string) => createHash("sha256").update(value).digest();
// A format/diversity check catches obvious weak secrets, not proof of randomness.
function strongToken(value: string) {
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(value) || new Set(value).size < 16) return false;
  for (let width = 1; width <= value.length / 2; width++) {
    if (value === value.slice(0, width).repeat(Math.ceil(value.length / width)).slice(0, value.length)) return false;
  }
  const counts = new Map<string, number>();
  for (const c of value) counts.set(c, (counts.get(c) || 0) + 1);
  const bits = [...counts.values()].reduce((sum, n) => sum - n * Math.log2(n / value.length), 0);
  return bits >= 128;
}

export function mountAgent(app: Express) {
  const router = express.Router();
  // Bounded, per-process/IP backoff. Never trust caller-supplied forwarded IPs.
  const failures = new Map<string, { count: number; until: number }>();
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    const configured = process.env.PROSPECTIA_AGENT_TOKEN || "";
    if (!strongToken(configured) || (process.env.APP_PASSWORD || "").length < 16) return res.status(503).json({ error: "API agent désactivée ou non configurée." });
    const authorization = req.get("Authorization") || "";
    const provided = /^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(authorization)?.[1] || "";
    if (!timingSafeEqual(hash(provided), hash(configured))) {
      const now = Date.now(), key = req.socket.remoteAddress || "local";
      for (const [ip, record] of failures) if (record.until <= now) failures.delete(ip);
      if (!failures.has(key) && failures.size >= 1024) failures.delete(failures.keys().next().value!);
      const record = failures.get(key) || { count: 0, until: now + 900000 };
      record.count++; failures.set(key, record);
      if (record.count > 20) return res.set("Retry-After", "900").status(429).json({ error: "Trop de tentatives agent." });
      return res.status(401).json({ error: "Authentification agent requise." });
    }
    next();
  });
  router.use((req, res, next) => {
    if (!["GET", "HEAD"].includes(req.method) && req.get("X-ProspectIA-Confirm") !== "write") return res.status(403).json({ error: "Confirmation d’écriture requise." });
    next();
  });
  const smallJson = express.json({ limit: "8kb" });
  const draftJson = express.json({ limit: "128kb" });
  router.use((req, res, next) => (req.method === "PATCH" && /^\/drafts\/[^/]+\/?$/.test(req.path) ? draftJson : smallJson)(req, res, next));
  router.use((req, res, next) => {
    if (Object.keys(req.query).length) return res.status(400).json({ error: "Paramètres invalides." });
    next();
  });
  router.param("id", (_req, res, next, id) => {
    if (!idSchema.safeParse(id).success) return res.status(400).json({ error: "Identifiant invalide." });
    next();
  });
  router.get("/status", async (_req, res) => res.json({
    ok: true, app: "ProspectIa-v2", apiVersion: 1, business: await business(),
    capabilities: { read: true, discover: true, analyze: true, drafts: true, handoffs: true, paid: false, send: false, delete: false, settings: false, statusEdits: false },
    limits: { maxDiscovery: 25, confirmationHeader: "X-ProspectIA-Confirm: write", siteSnapshotIsNotExhaustive: true },
  }));
  router.get("/state", async (_req, res) => {
    const [catalog, searches, drafts, handoffs, context] = await Promise.all([
      catalogSnapshot(), list<Search>("searches"), list<Draft>("drafts"), list<HermesHandoff>("handoffs"), business(),
    ]);
    res.json({ prospects: catalog.prospects,
      searches: searches.map((s) => presentSearch(s, s.ids.map(catalog.resolve).filter((p): p is Prospect => !!p)).search),
      drafts: drafts.map((d) => ({ ...d, prospectId: catalog.resolve(d.prospectId)?.id || d.prospectId })),
      handoffs: handoffs.map(({ id, prospectId, prospectName, engine, title, createdAt, warnings }) => ({ id, prospectId, prospectName, engine, title, createdAt, warnings })),
      business: context,
    });
  });
  router.get("/prospects/:id", async (req, res) => {
    const p = await prospect(req.params.id);
    if (!p) return res.status(404).json({ error: "Prospect introuvable." });
    res.json(p);
  });
  router.get("/handoffs/:id", async (req, res) => {
    const h = (await list<HermesHandoff>("handoffs")).find((item) => item.id === req.params.id);
    if (!h) return res.status(404).json({ error: "Dossier introuvable." });
    res.json(h);
  });
  router.patch("/drafts/:id", async (req, res) => {
    const input = z.object({ subject: z.string().max(500), body: z.string().max(20000) }).strict().parse(req.body);
    const d = (await list<Draft>("drafts")).find((item) => item.id === req.params.id);
    if (!d) throw new AgentError(404, "Brouillon introuvable.");
    await writable(d.prospectId);
    const updated = { ...d, subject: input.subject, body: input.body };
    await saveDraft(updated);
    res.json(updated);
  });
  router.post("/discover", async (req, res) => {
    const args = discoveryBody.parse(req.body);
    res.json(await discoverNext({ ...args, paid: false }));
  });
  router.post(["/prospects/:id/analyze", "/prospects/:id/drafts", "/prospects/:id/handoffs"], async (req, _res, next) => {
    await writable(idSchema.parse(req.params.id)); next();
  });
  router.post("/prospects/:id/analyze", async (req, res) => {
    z.object({}).strict().parse(req.body);
    const p = await writable(req.params.id);
    const updated = await analyze(p);
    const current = await writable(p.id);
    // Preserve user-owned state if it changed while the crawl was in flight.
    const result = { ...current, audit: updated.audit, email: updated.email, phone: updated.phone, socials: updated.socials, fields: updated.fields, webStatus: updated.webStatus };
    await saveProspect(result);
    res.json(result);
  });
  router.post("/prospects/:id/drafts", async (req, res) => {
    const { engine } = engineBody.parse(req.body);
    const p = await writable(req.params.id);
    const drafts = await generateDrafts(p, await business(), engine);
    await writable(p.id);
    await saveDrafts(drafts);
    res.json({ drafts, mode: "Modèles locaux · sans API IA" });
  });
  router.post("/prospects/:id/handoffs", async (req, res) => {
    const { engine } = engineBody.parse(req.body);
    let p = await writable(req.params.id);
    const warnings: string[] = [];
    if (p.website && !p.audit) {
      let updated: Prospect | undefined;
      try { updated = await analyze(p); }
      catch { warnings.push("Le site n’a pas pu être analysé. Hermès devra consulter la source ou demander les contenus manquants."); }
      if (updated) {
        const current = await writable(p.id);
        p = { ...current, audit: updated.audit, email: updated.email, phone: updated.phone, socials: updated.socials, fields: updated.fields, webStatus: updated.webStatus };
        await saveProspect(p);
      }
    }
    if (!p.audit?.pages?.length) warnings.push("Analyse absente ou inventaire de pages incomplet : aucune exhaustivité de collecte n’est établie.");
    const h = buildHermesHandoff(p, await business(), engine, warnings);
    await writable(p.id);
    await db.execute({ sql: "INSERT INTO handoffs VALUES(?,?,?)", args: [h.id, p.id, JSON.stringify(h)] });
    res.json(h);
  });
  router.use((_req, res) => res.status(404).json({ error: "Route agent introuvable." }));
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    const malformed = error instanceof z.ZodError || error instanceof URIError || error?.type === "entity.parse.failed";
    const status = error instanceof AgentError ? error.status : malformed ? 400 : error?.type === "entity.too.large" ? 413 : 500;
    res.status(status).json({ error: error instanceof AgentError ? error.message : status === 400 ? "Requête JSON invalide." : status === 413 ? "Requête trop volumineuse." : "Opération agent impossible." });
  };
  app.use("/api/agent", router, errors);
}
