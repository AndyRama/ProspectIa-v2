import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { Prospect } from "../server/types";

const token = randomBytes(32).toString("base64url");
let base: string, server: Server, dir: string;
let store: typeof import("../server/db");
const originalFetch = globalThis.fetch;
const savedEnv = { ...process.env };
let fixtureMode = false;
let fixtureFails = false;
const calls: string[] = [];
const request = (route: string, options: RequestInit = {}) => originalFetch(base + route, options);
const headers = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-ProspectIA-Confirm": "write" });
const post = (route: string, body: unknown = {}, extra = {}) => request("/api/agent" + route, { method: "POST", headers: { ...headers(), ...extra }, body: JSON.stringify(body) });
const sample = (id: string, extra: Partial<Prospect> = {}): Prospect => ({ id, name: "Atelier " + id, category: "Artisan", city: "Bordeaux", address: "", lat: null, lng: null, website: "", email: "", phone: "", rating: null, reviews: null, selected: false, status: "À contacter", demo: false, webStatus: "Non vérifié", fields: {}, socials: {}, hours: "", photos: [], engine: "website", ...extra });

before(async () => {
  for (const key of Object.keys(process.env)) if (/TURSO|VERCEL|APIFY|SMTP|AI_API|APP_PASSWORD|PROSPECTIA_AGENT_TOKEN|DATA_ENCRYPTION|PROXY/i.test(key)) delete process.env[key];
  const scratch = process.env.TMPDIR || "/opt/data/cache/scratch";
  await mkdir(scratch, { recursive: true });
  dir = await mkdtemp(path.join(scratch, "prospectia-agent-"));
  process.env.DATA_DIR = dir; process.env.APP_PASSWORD = "fixture-user-password-not-agent";
  process.env.PROSPECTIA_AGENT_TOKEN = token;
  store = await import("../server/db");
  const { mountAgent } = await import("../server/agent");
  const { mountAuth } = await import("../server/auth");
  const app = express();
  app.get("/fixture/site", (req, res) => {
    if (fixtureFails) return res.status(503).send("fixture-secret-provider-error");
    res.type("html").send('<html><head><title>Atelier fixture</title><meta name="viewport" content="width=device-width"></head><body><h1>Contenu public complet</h1><p>Source locale seulement.</p><a href="/contact">Contact</a><a href="/menu.pdf">Menu PDF non lu</a><img src="/logo.png" alt="logo"></body></html>');
  });
  app.get("/fixture/provider/:provider", (req, res) => {
    if (req.params.provider === "geocode") return res.json([{ lat: "44.84", lon: "-0.58", address: { country_code: "fr" } }]);
    if (req.params.provider === "registry") return res.json({ results: [] });
    res.json({ elements: Array.from({ length: 3 }, (_, i) => ({ type: "node", id: 90000 + i, lat: 44.84, lon: -0.58, tags: { name: "Nouveau fixture " + i, craft: "carpenter", "addr:city": "Bordeaux", "addr:street": "rue fixture", "addr:housenumber": String(i + 1) } })) });
  });
  mountAgent(app); app.use(express.json()); mountAuth(app);
  app.get("/api/state", (_req, res) => res.json({ privateUserState: true }));
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  globalThis.fetch = async (input, init) => {
    const url = String(input); calls.push(url);
    if (fixtureMode && url.startsWith("https://93.184.216.34")) return originalFetch(base + "/fixture/site");
    const provider = url.includes("nominatim.openstreetmap.org") ? "geocode" : url.includes("overpass") ? "osm" : url.includes("recherche-entreprises.api.gouv.fr") ? "registry" : "";
    if (fixtureMode && provider) return originalFetch(base + "/fixture/provider/" + provider);
    if (!url.startsWith(base + "/")) throw Error("External networking prohibited: fixture-secret-not-for-response");
    return originalFetch(input, init);
  };
});
after(async () => {
  globalThis.fetch = originalFetch;
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (store) await store.db.close();
  if (dir) await rm(dir, { recursive: true, force: true });
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
});

test("agent auth fails closed without a dedicated strong bearer; cookies never suffice and scope never escapes", async () => {
  assert.equal((await request("/api/agent/status")).status, 401);
  assert.equal((await request("/api/agent/status", { headers: { Authorization: "Bearer wrong" } })).status, 401);
  const login = await request("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: process.env.APP_PASSWORD }) });
  assert.equal(login.status, 200);
  assert.equal((await request("/api/agent/status", { headers: { Cookie: login.headers.get("set-cookie")!.split(";")[0] } })).status, 401);
  for (const weak of [undefined, "", "short", "a".repeat(64), "0123456789abcdef".repeat(4), "abcd efghijklmnopqrstuvwxyz0123456789"]) {
    if (weak === undefined) delete process.env.PROSPECTIA_AGENT_TOKEN; else process.env.PROSPECTIA_AGENT_TOKEN = weak;
    assert.equal((await request("/api/agent/status", { headers: { Authorization: `Bearer ${weak || token}` } })).status, 503);
  }
  process.env.PROSPECTIA_AGENT_TOKEN = token;
  assert.equal((await request("/api/agent/status", { headers: headers() })).status, 200);
  assert.equal((await request("/api/state", { headers: headers() })).status, 401);
  for (const route of ["/settings", "/send", "/apify/enrich", "/../state"]) {
    assert.ok([401, 404].includes((await post(route)).status));
  }
});


test("read API reuses empty and existing SQLite history, resolves aliases and returns full immutable dossiers without settings or mail secrets", async () => {
  const empty = await request("/api/agent/state", { headers: headers() });
  assert.equal(empty.status, 200);
  assert.deepEqual((await empty.json()).prospects, []);
  const status = await (await request("/api/agent/status", { headers: headers() })).json();
  assert.equal(status.app, "ProspectIa-v2");
  assert.equal(status.capabilities.paid, false);
  assert.equal(status.capabilities.send, false);
  assert.equal(status.business.name, store.defaultBusiness.name);
  const p = sample("history-real", { status: "Contacté" });
  await store.saveProspect(p);
  await store.saveProspect(sample("old-alias", { duplicateOf: p.id }));
  await store.setSetting("business", { ...store.defaultBusiness, name: "Agence historique", apiKey: "business-secret-hidden" });
  await store.setSetting("apifyKey", "apify-secret-hidden");
  await store.setSetting("smtp", { password: "smtp-secret-hidden" });
  await store.db.execute({ sql: "INSERT INTO mail_attempts VALUES(?,?,?)", args: ["archived", "old-draft", JSON.stringify({ password: "mail-secret-hidden" })] });
  await store.saveSearch({ id: "history-search", city: "Bordeaux", activity: "artisan", provider: "Historique", count: 2, cost: 2, createdAt: "2026-10-01", ids: ["old-alias", p.id], engine: "website" });
  await store.saveDraft({ id: "history-draft", prospectId: "old-alias", prospectName: p.name, subject: "Conservé", body: "Texte existant", variant: "A", createdAt: "2026-10-01" });
  const { buildHermesHandoff } = await import("../server/services/handoffs/hermes");
  const h = buildHermesHandoff(p, store.defaultBusiness, "voice", ["Historique partiel"]);
  await store.db.execute({ sql: "INSERT INTO handoffs VALUES(?,?,?)", args: [h.id, p.id, JSON.stringify(h)] });
  const state = await (await request("/api/agent/state", { headers: headers() })).json();
  assert.equal(state.prospects.length, 1);
  assert.equal(state.prospects[0].status, "Contacté");
  assert.deepEqual(state.searches[0].ids, [p.id]);
  assert.equal(state.searches[0].cost, 2);
  assert.equal(state.drafts[0].prospectId, p.id);
  assert.equal(state.business.name, "Agence historique");
  assert.equal(state.handoffs[0].id, h.id);
  assert.ok(!("prompt" in state.handoffs[0])); assert.ok(!("dossier" in state.handoffs[0]));
  for (const secret of ["business-secret-hidden", "apify-secret-hidden", "smtp-secret-hidden", "mail-secret-hidden", token, "settings", "mail_attempts"]) assert.ok(!JSON.stringify(state).includes(secret));
  assert.deepEqual(await (await request("/api/agent/prospects/old-alias", { headers: headers() })).json(), p);
  assert.deepEqual(await (await request("/api/agent/handoffs/" + h.id, { headers: headers() })).json(), h);
  await store.saveProspect({ ...p, name: "Modifié depuis" });
  assert.equal((await (await request("/api/agent/handoffs/" + h.id, { headers: headers() })).json()).dossier.prospect.name, p.name);
  assert.equal((await request("/api/agent/prospects/missing", { headers: headers() })).status, 404);
  assert.equal((await request("/api/agent/handoffs/missing", { headers: headers() })).status, 404);
  assert.equal((await request("/api/agent/state?secret=1", { headers: headers() })).status, 400);
});

test("draft creation requires explicit action gate, strict body and a real prospect without opposition or email suppression", async () => {
  const p = sample("draftable"); await store.saveProspect(p);
  const route = "/prospects/" + p.id + "/drafts";
  const before = (await store.list("drafts")).length;
  for (const gate of ["", "read", "WRITE"]) assert.equal((await post(route, { engine: "website" }, { "X-ProspectIA-Confirm": gate })).status, 403);
  for (const body of [{}, { engine: "other" }, { engine: "website", paid: false }, { engine: "website", status: "Gagné" }, [], null]) assert.equal((await post(route, body)).status, 400);
  assert.equal((await store.list("drafts")).length, before);
  for (const protectedProspect of [sample("demo-block", { demo: true }), sample("dnc-block", { doNotContact: true, audit: { checkedAt: "2026-10-01", https: true, responsive: true, copyright: null, technology: "Non identifiée", elapsedMs: 0, score: 0, observations: [], title: "Ancien audit", description: "", texts: [], images: [], logo: "", colors: [], links: [] } }), sample("suppressed-block", { email: "STOP@example.test" })]) {
    await store.saveProspect(protectedProspect);
    if (protectedProspect.email) await store.db.execute({ sql: "INSERT INTO suppressions VALUES(?,?)", args: ["stop@example.test", "2026-10-01"] });
    for (const action of ["drafts", "analyze", "handoffs"]) {
      const response = await post(`/prospects/${protectedProspect.id}/${action}`, action === "analyze" ? {} : { engine: "website" });
      assert.equal(response.status, 403);
    }
    assert.deepEqual(await store.prospect(protectedProspect.id), protectedProspect);
  }
  assert.equal((await store.list("drafts")).length, before);
  const response = await post(route, { engine: "website" });
  assert.equal(response.status, 200);
  const data = await response.json(); assert.equal(data.drafts.length, 3);
  assert.equal((await store.list("drafts")).length, before + 3);
  assert.equal((await post("/prospects/absent/drafts", { engine: "website" })).status, 404);
  assert.equal((await post("/prospects/bad%20id/drafts", { engine: "website" })).status, 400);
  assert.equal((await post("/prospects/" + "x".repeat(201) + "/drafts", { engine: "website" })).status, 400);
});

test("analyze uses the existing crawler and persists a real snapshot; invalid requests and provider failures never leak internals", async () => {
  const p = sample("analyzable", { website: "https://93.184.216.34" }); await store.saveProspect(p);
  fixtureMode = true;
  try {
    assert.equal((await post("/prospects/analyzable/analyze", { extra: true })).status, 400);
    const response = await post("/prospects/analyzable/analyze");
    assert.equal(response.status, 200);
    const updated = await response.json();
    assert.equal(updated.audit.title, "Atelier fixture");
    assert.ok(updated.audit.pages.length >= 1);
    assert.deepEqual(await store.prospect(p.id), updated);
    fixtureFails = true;
    const failed = await post("/prospects/analyzable/analyze");
    assert.equal(failed.status, 500);
    assert.deepEqual(await failed.json(), { error: "Opération agent impossible." });
    assert.deepEqual(await store.prospect(p.id), updated);
    const malformed = await request("/api/agent/prospects/analyzable/analyze", { method: "POST", headers: headers(), body: '{"secret":"fixture-hidden"' });
    assert.equal(malformed.status, 400); assert.ok(!(await malformed.text()).includes("fixture-hidden"));
    const huge = await post("/prospects/analyzable/analyze", { text: "x".repeat(9000) }); assert.equal(huge.status, 413);
  } finally { fixtureMode = false; fixtureFails = false; }
});

test("handoffs persist the complete dossier and reuse old audits with explicit incomplete-crawl warnings; failed analysis is never claimed complete", async () => {
  const analyzed = (await store.prospect("analyzable"))!;
  const text = "Texte intégral conservé ".repeat(500);
  const p = { ...analyzed, id: "handoff-audited", audit: { ...analyzed.audit!, texts: [text], crawlWarnings: ["Une page inaccessible"], pages: undefined } };
  await store.saveProspect(p);
  const count = calls.length;
  for (const body of [{ engine: "website", extra: true }, { engine: "bad" }, {}]) assert.equal((await post("/prospects/handoff-audited/handoffs", body)).status, 400);
  const response = await post("/prospects/handoff-audited/handoffs", { engine: "website" });
  assert.equal(response.status, 200);
  const h = await response.json();
  assert.equal(calls.length, count, "Existing snapshot must not trigger a recrawl");
  assert.equal(h.dossier.prospect.audit.texts[0], text);
  assert.equal(h.dossier.limits.siteSnapshotIsNotExhaustive, true);
  assert.ok(h.warnings.includes("Une page inaccessible"));
  assert.ok(h.warnings.some((w: string) => /incompl|exhaustiv|inventaire/i.test(w)));
  assert.ok(!JSON.stringify(h).includes("business-secret-hidden"));
  assert.deepEqual(await (await request("/api/agent/handoffs/" + h.id, { headers: headers() })).json(), h);
  await store.saveProspect({ ...p, name: "Nouveau nom" });
  await store.db.close();
  assert.deepEqual(await (await request("/api/agent/handoffs/" + h.id, { headers: headers() })).json(), h);
  const unaudited = sample("handoff-failed", { website: "https://93.184.216.34" }); await store.saveProspect(unaudited);
  fixtureMode = true; fixtureFails = true;
  try {
    const failed = await post("/prospects/handoff-failed/handoffs", { engine: "menu" });
    assert.equal(failed.status, 200);
    const partial = await failed.json();
    assert.ok(partial.warnings.some((w: string) => /pas pu être analysé/.test(w)));
    assert.ok(!partial.dossier.prospect.audit);
    assert.ok(!JSON.stringify(partial).includes("fixture-secret"));
  } finally { fixtureMode = false; fixtureFails = false; }
});

test("discover strictly bounds free batches, rejects paid/unknown fields and reuses durable request IDs without paid network calls", async () => {
  const args = { city: "Bordeaux", activity: "artisan", keyword: "menuisier", engine: "website", max: 2, requestId: randomUUID() };
  const count = calls.length;
  for (const body of [{ ...args, paid: true }, { ...args, paid: false }, { ...args, max: 26 }, { ...args, max: 0 }, { ...args, max: 1.5 }, { ...args, budget: 1 }, { ...args, refresh: true }, { ...args, activity: "invalid" }, { ...args, engine: "bad" }, { ...args, requestId: "bad" }, { ...args, requestId: undefined }, { ...args, city: "x" }, { ...args, city: "x".repeat(201) }, { ...args, keyword: "x".repeat(151) }]) assert.equal((await post("/discover", body)).status, 400);
  assert.equal((await post("/discover", args, { "X-ProspectIA-Confirm": "" })).status, 403);
  assert.equal(calls.length, count);
  const oldProspects = await store.list("prospects");
  fixtureMode = true;
  try {
    const responses = await Promise.all([post("/discover", args), post("/discover", args)]);
    assert.equal(responses[0].status, 200); assert.equal(responses[1].status, 200);
    const first = await responses[0].json(), second = await responses[1].json();
    assert.equal(first.search.id, second.search.id);
    assert.equal(first.prospects.length, 2); assert.equal(first.search.cost, 0); assert.equal(first.search.query.paid, false);
    assert.equal((await store.list("prospects")).length, oldProspects.length + 2);
    const after = calls.length;
    await store.db.close();
    const retry = await (await post("/discover", args)).json();
    assert.equal(retry.cached, true); assert.equal(retry.search.id, first.search.id); assert.equal(calls.length, after);
    const next = await (await post("/discover", { ...args, requestId: randomUUID() })).json();
    assert.equal(next.prospects.length, 1); assert.equal(calls.length, after);
    const empty = await (await post("/discover", { ...args, requestId: randomUUID() })).json();
    assert.equal(empty.exhausted, true); assert.equal(empty.prospects.length, 0);
    assert.ok(!calls.some((url) => /apify|turso|smtp/i.test(url)));
    for (const old of oldProspects) assert.deepEqual(await store.prospect((old as Prospect).id), old);
  } finally { fixtureMode = false; }
});

test("draft edits persist personalized copy, preserve immutable metadata and enforce canonical-prospect opposition with strict bounds", async () => {
  const draft = { id: "editable-draft", prospectId: "old-alias", prospectName: "Historique", subject: "Avant", body: "Avant", variant: "Variante conservée", createdAt: "2026-10-01" };
  await store.saveDraft(draft);
  const patch = (body: unknown, extra = {}) => request("/api/agent/drafts/" + draft.id, { method: "PATCH", headers: { ...headers(), ...extra }, body: JSON.stringify(body) });
  assert.equal((await patch({ subject: "Après", body: "Personnalisé" }, { "X-ProspectIA-Confirm": "" })).status, 403);
  for (const body of [{ subject: "x", body: "y", id: "override" }, { subject: "x", body: "y", prospectId: "other" }, { subject: "x" }, { body: "x" }, { subject: 1, body: "x" }, { subject: "x".repeat(501), body: "x" }, { subject: "x", body: "x".repeat(20001) }]) assert.equal((await patch(body)).status, 400);
  assert.deepEqual((await store.list("drafts")).find((d) => (d as { id: string }).id === draft.id), draft);
  const body = "Personnalisation gardée ".repeat(800);
  const response = await patch({ subject: "Après", body }); assert.equal(response.status, 200);
  const expected = { ...draft, subject: "Après", body };
  assert.deepEqual(await response.json(), expected);
  await store.db.close();
  const state = await (await request("/api/agent/state", { headers: headers() })).json();
  const read = state.drafts.find((d: { id: string }) => d.id === draft.id);
  assert.equal(read.body, body); assert.equal(read.prospectId, "history-real");
  assert.deepEqual((await store.list("drafts")).find((d) => (d as { id: string }).id === draft.id), expected);
  const canonical = (await store.prospect("history-real"))!;
  await store.saveProspect({ ...canonical, doNotContact: true });
  assert.equal((await patch({ subject: "Interdit", body: "Interdit" })).status, 403);
  await store.saveProspect({ ...canonical, demo: true });
  assert.equal((await patch({ subject: "Interdit", body: "Interdit" })).status, 403);
  await store.saveProspect(canonical);
  assert.deepEqual((await store.list("drafts")).find((d) => (d as { id: string }).id === draft.id), expected);
  assert.equal((await request("/api/agent/drafts/absent", { method: "PATCH", headers: headers(), body: JSON.stringify({ subject: "x", body: "y" }) })).status, 404);
});

test("production app mounts the isolated agent router before user auth and global body parsing", async () => {
  process.env.VERCEL = "1";
  process.env.DOTENV_CONFIG_PATH = path.join(dir, "absent.env");
  let app;
  try { app = (await import("../server/index")).default; }
  finally { delete process.env.VERCEL; }
  const production = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => production.once("listening", resolve));
  const url = `http://127.0.0.1:${(production.address() as { port: number }).port}`;
  try {
    assert.equal((await originalFetch(url + "/api/agent/status", { headers: headers() })).status, 200);
    assert.equal((await originalFetch(url + "/api/state", { headers: headers() })).status, 401);
    const bad = await originalFetch(url + "/api/agent/prospects/analyzable/analyze", { method: "POST", headers: headers(), body: '{"private":"not-for-errors"' });
    assert.equal(bad.status, 400); assert.deepEqual(await bad.json(), { error: "Requête JSON invalide." });
    assert.equal((await originalFetch(url + "/api/agent/prospects/analyzable/analyze", { method: "POST", headers: headers(), body: JSON.stringify({ data: "x".repeat(9000) }) })).status, 413);
  } finally { await new Promise<void>((resolve) => production.close(() => resolve())); }
});

test("bounded per-process token failure protection returns generic JSON and never blocks the correct token", async () => {
  let limited = false;
  for (let i = 0; i < 25; i++) {
    const response = await request("/api/agent/status", { headers: { Authorization: "Bearer invalid-fixture-secret" } });
    assert.ok([401, 429].includes(response.status));
    const text = await response.text(); assert.ok(!text.includes("fixture-secret"));
    if (response.status === 429) { limited = true; assert.equal(response.headers.get("retry-after"), "900"); break; }
  }
  assert.equal(limited, true);
  assert.equal((await request("/api/agent/status", { headers: headers() })).status, 200);
});

test("machine mode refuses an open or weakly protected legacy API without opening the database", async () => {
  const password = process.env.APP_PASSWORD;
  const originalExecute = store.db.execute;
  let databaseCalls = 0;
  store.db.execute = async (...args) => { databaseCalls++; return originalExecute(...args); };
  try {
    for (const weak of [undefined, "", "short-password"]) {
      if (weak === undefined) delete process.env.APP_PASSWORD; else process.env.APP_PASSWORD = weak;
      assert.equal((await request("/api/agent/status", { headers: headers() })).status, 503);
      assert.equal((await request("/api/agent/state", { headers: headers() })).status, 503);
      assert.equal((await post("/prospects/history-real/analyze")).status, 503);
    }
    assert.equal(databaseCalls, 0);
  } finally { store.db.execute = originalExecute; process.env.APP_PASSWORD = password; }
});

test("malformed identifiers fail safely as client errors", async () => {
  const response = await request("/api/agent/prospects/%E0%A4%A", { headers: headers() });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Requête JSON invalide." });
});
