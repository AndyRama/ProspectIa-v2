import "dotenv/config";
import express from "express";
import { createHash } from "node:crypto";
import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { z } from "zod";
import { parse } from "csv-parse/sync";
import { db, defaultBusiness, getSetting, setSetting, list, prospect, saveProspect, saveDraft, saveDrafts, seedDemo, catalogSnapshot } from "./db";
import { secret, saveSecret } from "./secrets";
import type { Business, Draft, Engine, Prospect, Search, HermesHandoff } from "./types";
import { searchFree } from "./services/freeSearch";
import { analyze, inspectSite } from "./services/siteAnalyzer";
import { generateDrafts } from "./services/generators";
import { startApify, collectApify, acknowledgeApify, verifyApify, recoverApify, } from "./services/apify";
import { mountAuth, validateHosting } from "./auth";
import { buildHermesHandoff } from "./services/handoffs/hermes";
import { persistResults, resolveSearch, presentSearch, findSavedSearch, shareSearch } from "./searches";
import { makeQuery, queryForSearch, queryKey } from "./searchQuery";
import { discoverNext } from "./services/discovery";
import { planEnrichment, validPlaceId } from "./services/apifyPlan";
import { planApifyDiscovery, startApifyDiscovery, verifyApifyDiscovery } from "./services/apifyDiscovery";
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));
app.use("/api", (req, res, next) => {
    const origin = req.get("origin");
    if (origin) {
        try {
            const u = new URL(origin);
            const localDev = !process.env.VERCEL && ["localhost", "127.0.0.1"].includes(u.hostname) &&
                u.protocol === "http:" &&
                u.port === (process.env.VITE_PORT || "5173");
            if (u.host !== req.get("host") && !localDev)
                return res.status(403).json({ error: "Origine non autorisée." });
        }
        catch {
            return res.status(403).json({ error: "Origine non autorisée." });
        }
    }
    res.set("Cache-Control", "no-store");
    next();
});
mountAuth(app);
const engineSchema = z.enum(["website", "voice", "menu"]);
const businessSchema = z.object({
    name: z.string().min(1).max(120),
    services: z.string().max(3000),
    zone: z.string().max(150),
    tone: z.string().max(200),
    prices: z.string().max(500),
    website: z.string().max(2000),
    instagram: z.string().max(2000),
    facebook: z.string().max(2000),
    userName: z.string().max(120),
    hermesInstructions: z.string().max(6000).optional(),
});
const searchSchema = z.object({
    city: z.string().trim().min(2).max(200),
    activity: z.enum([
        "all",
        "restaurant",
        "artisan",
        "beauty",
        "hotel",
        "retail",
    ]),
    keyword: z.string().trim().max(150).default(""),
    paid: z.boolean(),
    max: z.number().int().min(1).max(100),
    budget: z.number().min(0.05).max(10),
    engine: engineSchema,
    refresh: z.boolean().default(false),
    refreshPool: z.boolean().optional(),
    requestId: z.uuid().optional(),
    intent: z.enum(["browse", "discover"]).default("browse"),
});
const settings = async () => {
  const [business, limits, apifyKey, pending, onboarded] = await Promise.all([
    getSetting("business", defaultBusiness), getSetting("limits", { max: 25, budget: 1 }),
    secret("apifyKey"), getSetting("apifyPending", null), getSetting("onboarded", false),
  ]);
  return { business, limits: { ...limits, max: Math.min(25, limits.max) }, apifyConfigured: !!apifyKey, pending, onboarded,
    storage: process.env.TURSO_DATABASE_URL ? "Turso · SQLite distant" : "SQLite local" };
};
app.get("/api/tiles/:z/:x/:tile", async (req, res) => {
    const z = Number(req.params.z), x = Number(req.params.x), y = Number(req.params.tile.replace(/\.png$/, ""));
    if (!Number.isInteger(z) ||
        !Number.isInteger(x) ||
        !Number.isInteger(y) ||
        z < 0 ||
        z > 19 ||
        x < 0 ||
        y < 0 ||
        x >= 2 ** z ||
        y >= 2 ** z)
        return res.sendStatus(400);
    const root = path.join(process.env.VERCEL ? "/tmp/prospectai" : process.env.DATA_DIR || path.resolve(".data"), "tiles");
    const file = path.join(root, `${z}-${x}-${y}.png`);
    res.set("Cache-Control", "public, max-age=604800");
    try {
        if (Date.now() - (await stat(file)).mtimeMs < 7 * 86400000)
            return res.type("png").send(await readFile(file));
    }
    catch { }
    const response = await fetch(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`, {
        headers: {
            "User-Agent": "ProspectAI/1.0 local business research",
            Accept: "image/png",
        },
        signal: AbortSignal.timeout(12000),
    });
    if (!response.ok)
        return res.status(response.status).end();
    const data = Buffer.from(await response.arrayBuffer());
    await mkdir(root, { recursive: true });
    await writeFile(file, data);
    res.type("png").send(data);
});
app.get("/api/state", async (_req, res) => {
  const [catalog, searches, drafts, handoffs, config] = await Promise.all([
    catalogSnapshot(), list<Search>("searches"), list<Draft>("drafts"), list<HermesHandoff>("handoffs"), settings(),
  ]);
  const history = searches.map((s) => presentSearch(s, s.ids.map(catalog.resolve).filter((p): p is Prospect => !!p)).search);
  const canonicalDrafts = drafts.map((d) => ({ ...d, prospectId: catalog.resolve(d.prospectId)?.id || d.prospectId }));
  res.json({ prospects: catalog.prospects, searches: history, drafts: canonicalDrafts, handoffs: handoffs.map(({ prompt, dossier, ...summary }) => summary), settings: config });
});
app.post("/api/demo", async (_req, res) => {
    const items = (await seedDemo());
    res.json((await persistResults(items, { city: "Papeete", activity: "restaurant", engine: "website" }, "Démonstration fictive", 0)));
});
app.post("/api/search", async (req, res) => {
    const args = searchSchema.parse(req.body);
    const query = makeQuery(args);
    if (args.paid) {
        if (args.refresh) throw Error("Relance payante bloquée : la même recherche referait facturer des entreprises connues. Utilisez les nouveaux lots gratuits ou un enrichissement ciblé après vérification des identifiants.");
        const history = (await list<Search>("searches")).filter((s) => { const q = queryForSearch(s); return q && queryKey(q) === queryKey(query); });
        if (history.length) {
            const all = await resolveSearch({ ...history[0], ids: [...new Set(history.flatMap((s) => s.ids))] });
            return res.json({ ...all, cached: true, message: "Toutes les fiches déjà payées ont été réunies, sans nouvelle collecte." });
        }
        throw Error("Recherche payante par mot-clé bloquée : aucune exclusion avant facturation n’est disponible chez cet Actor. Recherchez gratuitement, puis préparez un lot d’identifiants inédits.");
    }
    if (args.intent === "discover") {
        if (!args.requestId) throw Error("Identifiant de lot requis pour empêcher les doubles demandes.");
        if (args.max > 25) throw Error("Les nouveaux lots sont limités à 25 entreprises.");
        return res.json(await discoverNext({ ...args, requestId: args.requestId }));
    }
    const result = await shareSearch(queryKey(query) + (args.refresh ? `:refresh:${args.requestId || "legacy"}` : ":saved"), async () => {
        if (!args.refresh || args.requestId) {
            const saved = await findSavedSearch(query, args.refresh ? args.requestId : undefined);
            if (saved) return { ...await resolveSearch(saved), cached: true };
        }
        const limit = await getSetting("limits", { max: 25, budget: 1 });
        if (args.max > limit.max || args.budget > limit.budget)
            throw Error("Les limites demandées dépassent vos plafonds. Modifiez-les dans les paramètres.");
        const found = await searchFree(args.city, args.activity, args.keyword, args.max, args.engine);
        return persistResults(found.items, args, found.provider, 0, found.warnings, { query, refreshed: args.refresh });
    });
    res.json(result);
});
const apifyDiscoverySchema = z.object({
    city: searchSchema.shape.city,
    activity: searchSchema.shape.activity,
    keyword: z.string().trim().max(150),
    engine: engineSchema,
    max: z.number().int().min(1).max(25),
    budget: z.number().min(0.05).max(10),
}).strict();
app.post("/api/apify/discovery/plan", async (req, res) => {
    res.json(await planApifyDiscovery(apifyDiscoverySchema.parse(req.body)));
});
app.post("/api/apify/discovery/start", async (req, res) => {
    const input = apifyDiscoverySchema.extend({ planId: z.string().regex(/^[a-f0-9]{64}$/), requestId: z.uuid(), confirmed: z.literal(true) }).strict().parse(req.body);
    const old = (await list<Search>("searches")).find((s) => s.kind === "discovery" && s.provider === "Apify" && s.requestId === input.requestId);
    if (old) return res.json({ ...await resolveSearch(old), cached: true });
    const pending = await getSetting<any>("apifyPending", null);
    if (pending?.mode === "discovery" && pending.requestId === input.requestId) return res.json({ pending: true, runId: pending.runId });
    const limits = await getSetting("limits", { max: 25, budget: 1 });
    if (input.max > limits.max || input.budget > limits.budget) throw Error("Les limites demandées dépassent vos plafonds enregistrés.");
    const plan = await planApifyDiscovery(input);
    if (plan.planId !== input.planId) throw Error("Le plan a changé : recalculez son aperçu avant paiement.");
    const result = await startApifyDiscovery(await secret("apifyKey"), input);
    res.json(typeof result === "string" ? { pending: true, runId: result } : result);
});
const enrichmentSchema = z.object({ prospectIds: z.array(z.string().min(1).max(500)).min(1).max(200) });
app.post("/api/apify/plan", async (req, res) => {
    res.json(await planEnrichment(enrichmentSchema.parse(req.body).prospectIds));
});
app.post("/api/apify/enrich", async (req, res) => {
    const input = enrichmentSchema.extend({ planId: z.string().regex(/^[a-f0-9]{64}$/), requestId: z.uuid(), budget: z.number().min(0.05).max(10) }).parse(req.body);
    const old = (await list<Search>("searches")).find((s) => s.kind === "enrichment" && s.requestId === input.requestId);
    if (old) return res.json({ ...await resolveSearch(old), cached: true });
    const pending = await getSetting<any>("apifyPending", null);
    if (pending?.requestId === input.requestId) return res.json({ pending: true, runId: pending.runId });
    const plan = await planEnrichment(input.prospectIds);
    if (!plan.candidates.length) throw Error(plan.message);
    if (plan.planId !== input.planId) throw Error("Le lot a changé : recalculez son aperçu avant paiement.");
    const limits = await getSetting("limits", { max: 25, budget: 1 });
    if (plan.candidates.length > limits.max) throw Error("Le lot dépasse votre plafond d’entreprises enregistré. Réduisez la sélection.");
    if (input.budget > limits.budget) throw Error("Le budget dépasse votre plafond enregistré.");
    const runId = await startApify(await secret("apifyKey"), { city: "Identifiants validés", activity: "all", keyword: "", engine: "website", max: plan.candidates.length, budget: input.budget, requestId: input.requestId, placeIds: plan.candidates.map((p) => p.placeId), refresh: true });
    res.json({ pending: true, runId });
});
app.post("/api/apify/poll", async (_req, res) => {
    const result = await collectApify((await secret("apifyKey")));
    if (result.pending) {
        res.json(result);
        return;
    }
    const saved = await persistResults(result.items!, result.args, "Apify", result.cost!, [], { kind: result.args.mode === "discovery" ? "discovery" : result.args.placeIds ? "enrichment" : undefined, query: result.args.query || makeQuery({ ...result.args, paid: true }), refreshed: result.args.refresh });
    (await acknowledgeApify());
    res.json({ ...saved, enriched: !!result.args.placeIds, runStatus: result.status });
});
app.post("/api/apify/recover", async (req, res) => {
    const { runId } = z
        .object({ runId: z.string().regex(/^[a-zA-Z0-9]{10,30}$/) })
        .parse(req.body);
    await recoverApify((await secret("apifyKey")), runId);
    res.json({ ok: true });
});
app.post("/api/apify/verify", async (_req, res) => {
    await verifyApifyDiscovery((await secret("apifyKey")));
    res.json({ ok: true });
});
app.get("/api/searches/:id", async (req, res) => {
    const s = (await list<Search>("searches")).find((x) => x.id === req.params.id);
    if (!s)
        return res.status(404).json({ error: "Recherche introuvable." });
    res.json({ ...await resolveSearch(s), cached: true });
});
app.patch("/api/prospects/:id", async (req, res) => {
    const p = (await prospect(req.params.id));
    if (!p)
        return res.status(404).json({ error: "Prospect introuvable." });
    const patch = z
        .object({
        selected: z.boolean().optional(),
        doNotContact: z.boolean().optional(),
        status: z
            .enum(["À contacter", "Contacté", "En discussion", "Gagné", "Perdu"])
            .optional(),
    })
        .parse(req.body);
    const updated = { ...p, ...patch };
    if (patch.doNotContact === true && p.email) await db.execute({ sql: "INSERT OR IGNORE INTO suppressions VALUES(?,?)", args: [p.email.trim().toLowerCase(), new Date().toISOString()] });
    if (patch.doNotContact === false && p.email) await db.execute({ sql: "DELETE FROM suppressions WHERE email=?", args: [p.email.trim().toLowerCase()] });
    (await saveProspect(updated));
    res.json(updated);
});
app.post("/api/prospects/:id/analyze", async (req, res) => {
    const p = (await prospect(req.params.id));
    if (!p)
        return res.status(404).json({ error: "Prospect introuvable." });
    const updated = await analyze(p);
    (await saveProspect(updated));
    res.json(updated);
});
app.post("/api/prospects/:id/drafts", async (req, res) => {
    const p = (await prospect(req.params.id));
    if (!p)
        return res.status(404).json({ error: "Prospect introuvable." });
    const engine = engineSchema.parse(req.body.engine);
    const drafts = await generateDrafts(p, (await getSetting<Business>("business", defaultBusiness)), engine);
    await saveDrafts(drafts);
    res.json({ drafts, mode: "Modèles locaux · sans API IA" });
});
app.patch("/api/drafts/:id", async (req, res) => {
    const d = (await list<Draft>("drafts")).find((x) => x.id === req.params.id);
    if (!d)
        return res.status(404).json({ error: "Brouillon introuvable." });
    const patch = z
        .object({ subject: z.string().max(500), body: z.string().max(20000) })
        .parse(req.body);
    const updated = { ...d, ...patch };
    (await saveDraft(updated));
    res.json(updated);
});
app.delete("/api/drafts/:id", async (req, res) => {
    await db.execute({ sql: "DELETE FROM drafts WHERE id=?", args: [req.params.id] });
    res.json({ ok: true });
});
app.post("/api/prospects/:id/handoffs", async (req, res) => {
  let p = await prospect(req.params.id);
  if (!p) return res.status(404).json({ error: "Prospect introuvable." });
  const engine = engineSchema.parse(req.body.engine);
  const warnings: string[] = [];
  if (p.website && !p.demo && !p.audit) {
    try { p = await analyze(p); await saveProspect(p); }
    catch { warnings.push("Le site n’a pas pu être analysé. Hermès devra consulter la source ou demander les contenus manquants."); }
  }
  const handoff = buildHermesHandoff(p, await getSetting<Business>("business", defaultBusiness), engine, warnings);
  await db.execute({ sql: "INSERT INTO handoffs VALUES(?,?,?)", args: [handoff.id, p.id, JSON.stringify(handoff)] });
  const { dossier, ...result } = handoff;
  res.json(result);
});
app.get("/api/handoffs/:id", async (req, res) => {
  const item = (await list<HermesHandoff>("handoffs")).find((h) => h.id === req.params.id);
  if (!item) return res.status(404).json({ error: "Prompt Hermès introuvable." });
  const { dossier, ...result } = item;
  res.json(result);
});
app.get("/api/handoffs/:id/export", async (req, res) => {
  const item = (await list<HermesHandoff>("handoffs")).find((h) => h.id === req.params.id);
  if (!item) return res.status(404).json({ error: "Prompt Hermès introuvable." });
  if (req.query.format === "dossier") return res.attachment("dossier-prospectai.json").json(item.dossier);
  res.attachment("prompt-hermes.md").type("text/markdown; charset=utf-8").send(item.prompt);
});
app.put("/api/settings", async (req, res) => {
    const input = z
        .object({
        business: businessSchema,
        limits: z.object({
            max: z.number().int().min(1).max(25),
            budget: z.number().min(0.05).max(10),
        }),
        apifyKey: z.string().max(500).optional(),
    })
        .parse(req.body);
    await setSetting("business", input.business);
    await setSetting("limits", input.limits);
    await setSetting("onboarded", true);
    if (input.apifyKey !== undefined)
        (await saveSecret("apifyKey", input.apifyKey));
    res.json((await settings()));
});
app.post("/api/business/read-site", async (req, res) => {
    const { url } = z.object({ url: z.url().max(2000) }).parse(req.body);
    const info = await inspectSite(url);
    res.json({
        name: info.audit.title,
        services: info.audit.description || info.audit.texts.slice(0, 5).join("\n"),
        website: info.url,
        instagram: info.socials.instagram || "",
        facebook: info.socials.facebook || "",
        source: info.url,
    });
});
app.post("/api/import", async (req, res) => {
    const { text } = z
        .object({ text: z.string().min(1).max(500000) })
        .parse(req.body);
    let rows: any[];
    if (text.trim().split("\n")[0].includes(",") ||
        text.trim().split("\n")[0].includes(";")) {
        const first = text.trim().split("\n")[0];
        rows = parse(text, {
            columns: true,
            skip_empty_lines: true,
            bom: true,
            delimiter: first.includes(";") ? ";" : ",",
            trim: true,
        });
    }
    else
        rows = text
            .split("\n")
            .filter((x) => x.trim())
            .map((website) => ({
            website: website.trim(),
            name: new URL(website.trim()).hostname,
        }));
    if (rows.length > 200)
        throw Error("Import limité à 200 entreprises.");
    const items: Prospect[] = rows.map((r, i) => {
        const website = String(r.website || r.site || "");
        if (website && !/^https?:\/\//i.test(website))
            throw Error(`URL invalide à la ligne ${i + 2}.`);
        const name = String(r.name || r.nom || "").trim();
        const placeId = String(r.placeId || r.place_id || "").trim();
        if (placeId && !validPlaceId(placeId)) throw Error(`Place ID Google Maps invalide à la ligne ${i + 2}.`);
        if (!name)
            throw Error(`Nom manquant à la ligne ${i + 2}.`);
        const fields: Prospect["fields"] = {};
        for (const [key, value] of Object.entries({
            name,
            placeId,
            website,
            email: r.email,
            phone: r.phone || r.telephone,
            address: r.address || r.adresse,
        })) {
            if (value)
                fields[key] = {
                    value: String(value),
                    source: "Import utilisateur",
                    collectedAt: new Date().toISOString(),
                    qualification: "Information importée, non vérifiée",
                };
        }
        return {
            id: "import-" +
                createHash("sha256").update(JSON.stringify([name, website, String(r.city || r.ville || ""), String(r.address || r.adresse || ""), placeId])).digest("hex"),
            name,
            website,
            city: String(r.city || r.ville || ""),
            category: String(r.category || r.categorie || "Commerce"),
            address: String(r.address || r.adresse || ""),
            email: String(r.email || ""),
            phone: String(r.phone || r.telephone || ""),
            lat: Number.isFinite(Number(r.lat)) && r.lat !== undefined
                ? Number(r.lat)
                : null,
            lng: Number.isFinite(Number(r.lng)) && r.lng !== undefined
                ? Number(r.lng)
                : null,
            rating: null,
            reviews: null,
            selected: false,
            status: "À contacter",
            demo: false,
            webStatus: "Non vérifié",
            fields,
            socials: {},
            hours: "",
            photos: [],
            engine: "website",
        };
    });
    res.json((await persistResults(items, { city: "Import local", activity: "all", engine: "website" }, "Import utilisateur", 0)));
});
app.get("/api/export", async (_req, res) => res.attachment("prospectai-export.json").json({
    exportedAt: new Date().toISOString(),
    business: (await getSetting("business", defaultBusiness)),
    prospects: await list("prospects"),
    archivedDuplicateProspects: (await db.execute("SELECT data FROM prospects")).rows.map((r) => JSON.parse(String(r.data))).filter((p) => p.duplicateOf),
    searches: (await list("searches")),
    drafts: (await list("drafts")),
    deliverables: (await list("deliverables")),
    archivedMailAttempts: await list("mail_attempts"),
    handoffs: await list("handoffs"),
    apifyPaidClaims: (await db.execute("SELECT place_id,run_id,created_at FROM apify_place_claims")).rows,
    discoveryPools: (await db.execute("SELECT key,data FROM settings WHERE key LIKE 'discoveryPool:%'")).rows.filter((r) => !String(r.key).endsWith(":lock")).map((r) => JSON.parse(String(r.data))),
    suppressions: (await db.execute("SELECT email,created_at FROM suppressions")).rows,
}));
app.delete("/api/data", async (req, res) => {
    if (req.body.confirm !== "SUPPRIMER")
        throw Error("Confirmation requise : SUPPRIMER.");
    if ((await getSetting("apifyPending", null)))
        throw Error("Une collecte Apify est en cours. Récupérez son résultat avant de supprimer.");
    await db.batch(["prospects", "searches", "drafts", "deliverables", "settings", "mail_attempts", "suppressions", "handoffs", "apify_place_claims"].map((table) => ({ sql: "DELETE FROM " + table, args: [] })));
    res.json({ ok: true });
});
app.use("/api", (_req, res) => res.status(404).json({ error: "Fonction introuvable. ProspectAI ne publie plus de maquettes et n’envoie aucun email." }));
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err instanceof z.ZodError ? 400 : 422).json({
        error: err instanceof z.ZodError
            ? "Champs invalides : " +
                err.issues.map((x) => x.path.join(".") + " " + x.message).join(", ")
            : /fetch failed|ECONN|ENOTFOUND|ETIMEDOUT/i.test(err.message || "")
                ? "Connexion au service impossible. Vérifiez votre réseau et les domaines autorisés, puis réessayez."
                : /abort|timeout/i.test(err.message || "") ? "Le service n’a pas répondu à temps. Réessayez plus tard."
                    : err.message || "Une erreur est survenue.",
    });
});
const dist = path.resolve("dist");
if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get("/{*path}", async (_req, res) => res.sendFile(path.join(dist, "index.html")));
}
const port = Number(process.env.PORT || 3001);
if (!process.env.VERCEL) {
    app.listen(port, "127.0.0.1", () => {
        console.log(`ProspectAI API prête sur le port ${port} · stockage SQLite`);
        try { validateHosting(); }
        catch (error) {
            console.error(`Configuration à corriger : ${(error as Error).message}`);
            console.error("L’accès reste bloqué. Corrigez .env puis redémarrez npm run dev.");
        }
    });
}
export default app;
