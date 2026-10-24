import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { Server } from "node:http";
import type { Prospect, Draft } from "../server/types";

let dir: string, base: string, server: Server, cookie: string;
let store: typeof import("../server/db");
const env = { ...process.env }, originalFetch = globalThis.fetch;
const token = randomBytes(32).toString("base64url");
const calls: string[] = [];
const sample = (id: string, extra: Partial<Prospect> = {}): Prospect => ({ id, name: "Atelier " + id, category: "Artisan", city: "Bordeaux", address: "", lat: null, lng: null, website: "", email: "", phone: "", rating: null, reviews: null, selected: true, status: "Contacté", demo: false, webStatus: "Non vérifié", fields: {}, socials: {}, hours: "", photos: [], engine: "website", ...extra });
const request = (route: string, body?: unknown, method = body === undefined ? "GET" : "POST", agent = false) => originalFetch(base + "/api" + (agent ? "/agent" : "") + route, { method, headers: { "Content-Type": "application/json", ...(agent ? { Authorization: `Bearer ${token}`, "X-ProspectIA-Confirm": "write" } : { Cookie: cookie }) }, body: body === undefined ? undefined : JSON.stringify(body) });
const patch = (id: string, body: unknown) => request("/prospects/" + id, body, "PATCH");

before(async () => {
  for (const key of Object.keys(process.env)) if (/TURSO|VERCEL|APIFY|SMTP|AI_API|APP_PASSWORD|PROSPECTIA_AGENT_TOKEN|DATA_ENCRYPTION|PROXY/i.test(key)) delete process.env[key];
  const scratch = process.env.TMPDIR || "/opt/data/cache/scratch";
  await mkdir(scratch, { recursive: true }); dir = await mkdtemp(path.join(scratch, "prospectia-archive-"));
  process.env.DATA_DIR = dir; process.env.APP_PASSWORD = "archive-fixture-password-only"; process.env.PROSPECTIA_AGENT_TOKEN = token;
  process.env.DOTENV_CONFIG_PATH = path.join(dir, "absent.env");
  process.env.VERCEL = "1";
  const app = (await import("../server/index")).default;
  delete process.env.VERCEL;
  store = await import("../server/db");
  server = app.listen(0, "127.0.0.1"); await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  globalThis.fetch = async (input, init) => { calls.push(String(input)); throw Error("External networking prohibited in archive fixtures"); };
  const login = await request("/auth/login", { password: process.env.APP_PASSWORD }); assert.equal(login.status, 200);
  cookie = login.headers.get("set-cookie")!.split(";")[0];
});
after(async () => {
  globalThis.fetch = originalFetch;
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (store) await store.db.close(); if (dir) await rm(dir, { recursive: true, force: true });
  for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]; Object.assign(process.env, env);
});

test("legacy draft and handoff generation recheck archive immediately before persistence", async () => {
  const execute = store.db.execute;
  try {
    for (const action of ["drafts", "handoffs"]) {
      const p = sample("archive-final-" + action, { selected: false }); await store.saveProspect(p);
      const drafts = await store.list("drafts"), handoffs = await store.list("handoffs");
      let release!: () => void, entered!: () => void;
      const started = new Promise<void>((resolve) => { entered = resolve; });
      const gate = new Promise<void>((resolve) => { release = resolve; });
      store.db.execute = async (statement) => {
        if (typeof statement !== "string" && statement.sql === "SELECT data FROM settings WHERE key=?" && Array.isArray(statement.args) && statement.args[0] === "business") { entered(); await gate; }
        return execute(statement);
      };
      const pending = request(`/prospects/${p.id}/${action}`, { engine: "website" });
      await started;
      assert.equal((await patch(p.id, { archived: true })).status, 200); release();
      assert.equal((await pending).status, 403, action);
      assert.deepEqual(await store.list("drafts"), drafts); assert.deepEqual(await store.list("handoffs"), handoffs);
      store.db.execute = execute;
    }
  } finally { store.db.execute = execute; }
});

test("archiving while legacy site analysis is in flight prevents audit or handoff writes and cannot revive the lead", async () => {
  const fallback = globalThis.fetch;
  try {
    for (const action of ["analyze", "handoffs"]) {
      const p = sample("archive-inflight-" + action, { website: "https://93.184.216.34", selected: false }); await store.saveProspect(p);
      let release!: () => void, entered!: () => void;
      const started = new Promise<void>((resolve) => { entered = resolve; });
      const gate = new Promise<void>((resolve) => { release = resolve; });
      globalThis.fetch = async (input, init) => {
        if (String(input).startsWith(p.website)) { entered(); await gate; return new Response("<html><title>Fixture</title><body>Contenu fixture</body></html>", { headers: { "Content-Type": "text/html" } }); }
        return fallback(input, init);
      };
      const pending = request(`/prospects/${p.id}/${action}`, action === "analyze" ? {} : { engine: "website" });
      await started;
      assert.equal((await patch(p.id, { archived: true })).status, 200); release();
      assert.equal((await pending).status, 403, action);
      const saved = (await store.prospect(p.id))!; assert.equal(saved.archived, true); assert.equal(saved.audit, undefined);
      assert.ok(!(await store.list<{ prospectId: string }>("handoffs")).some((item) => item.prospectId === p.id));
    }
  } finally { globalThis.fetch = fallback; }
});

for (const action of ["analyze", "handoffs"]) {
  test(`legacy ${action} preserves current user state after an in-flight archive and restore`, async () => {
    const p = sample("archive-restored-inflight-" + action, { website: "https://93.184.216.34", selected: true, doNotContact: false });
    await store.saveProspect(p);
    const fallback = globalThis.fetch;
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    globalThis.fetch = async (input, init) => {
      if (String(input).startsWith(p.website)) { entered(); await gate; return new Response("<html><title>Restored fixture</title><body>Contenu synthétique</body></html>", { headers: { "Content-Type": "text/html" } }); }
      return fallback(input, init);
    };
    try {
      const pending = request(`/prospects/${p.id}/${action}`, action === "analyze" ? {} : { engine: "website" });
      await started;
      assert.equal((await patch(p.id, { archived: true })).status, 200);
      assert.equal((await patch(p.id, { archived: false, status: "Gagné", doNotContact: true })).status, 200);
      const current = (await store.prospect(p.id))!;
      assert.equal(current.selected, false);
      await store.saveProspect({ ...current, name: "Atelier restauré " + action, hours: "Horaires mis à jour" });
      const beforeAnalysis = (await store.prospect(p.id))!;
      release();
      const response = await pending; assert.equal(response.status, 200);
      const saved = (await store.prospect(p.id))!;
      // Only audit-produced fields may replace values from the canonical re-read.
      const { audit, email, phone, socials, fields, webStatus, ...userState } = saved;
      const { audit: oldAudit, email: oldEmail, phone: oldPhone, socials: oldSocials, fields: oldFields, webStatus: oldWebStatus, ...expectedState } = beforeAnalysis;
      assert.deepEqual(userState, expectedState);
      assert.equal(saved.selected, false); assert.equal(saved.archived, false);
      assert.equal(saved.status, "Gagné"); assert.equal(saved.doNotContact, true);
      assert.equal(audit?.title, "Restored fixture"); assert.notEqual(webStatus, p.webStatus);
      if (action === "analyze") assert.deepEqual(await response.json(), saved);
      else {
        const handoff = await response.json();
        const exported = await request(`/handoffs/${handoff.id}/export?format=dossier`);
        assert.equal(exported.status, 200);
        assert.deepEqual((await exported.json()).prospect, saved);
      }
    } finally { release(); globalThis.fetch = fallback; }
  });
}

for (const action of ["analyze", "handoffs"]) {
  test(`legacy ${action} refuses a prospect removed during the crawl`, async () => {
    const p = sample("archive-missing-inflight-" + action, { website: "https://93.184.216.34" });
    await store.saveProspect(p);
    const fallback = globalThis.fetch;
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    globalThis.fetch = async (input, init) => {
      if (String(input).startsWith(p.website)) { entered(); await gate; return new Response("<html><title>Missing fixture</title></html>", { headers: { "Content-Type": "text/html" } }); }
      return fallback(input, init);
    };
    try {
      const pending = request(`/prospects/${p.id}/${action}`, action === "analyze" ? {} : { engine: "website" });
      await started;
      await store.db.execute({ sql: "DELETE FROM prospects WHERE id=?", args: [p.id] });
      release();
      const response = await pending; assert.equal(response.status, 404);
      assert.match((await response.json()).error, /introuvable/i);
      assert.equal(await store.prospect(p.id), undefined);
      assert.ok(!(await store.list<{ prospectId: string }>("handoffs")).some((item) => item.prospectId === p.id));
    } finally { release(); globalThis.fetch = fallback; }
  });
}

test("legacy handoff crawl warnings retain current restored state", async () => {
  const p = sample("archive-restored-failed-crawl", { website: "https://93.184.216.34" });
  await store.saveProspect(p);
  const fallback = globalThis.fetch;
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith(p.website)) { entered(); await gate; throw Error("Synthetic crawl failure"); }
    return fallback(input, init);
  };
  try {
    const pending = request(`/prospects/${p.id}/handoffs`, { engine: "website" });
    await started;
    assert.equal((await patch(p.id, { archived: true })).status, 200);
    assert.equal((await patch(p.id, { archived: false, status: "Perdu", doNotContact: true })).status, 200);
    const current = (await store.prospect(p.id))!;
    release();
    const response = await pending; assert.equal(response.status, 200);
    const handoff = await response.json();
    assert.deepEqual(handoff.warnings, ["Le site n’a pas pu être analysé. Hermès devra consulter la source ou demander les contenus manquants."]);
    const dossier = await (await request(`/handoffs/${handoff.id}/export?format=dossier`)).json();
    assert.deepEqual(dossier.prospect, current);
    assert.deepEqual(await store.prospect(p.id), current);
  } finally { release(); globalThis.fetch = fallback; }
});

test("archived leads remain known to discoverNext and never reappear as new prospects", async () => {
  const { createHash } = await import("node:crypto");
  const { makeQuery, queryKey } = await import("../server/searchQuery");
  const { discoverNext } = await import("../server/services/discovery");
  const old = sample("archive-discovery", { archived: true, selected: false, address: "10 rue des Archives" });
  const fresh = sample("archive-discovery-fresh", { name: "Entreprise inédite", selected: false });
  await store.saveProspect(old);
  const args = { city: "Bordeaux", activity: "artisan", keyword: "archives fixture", paid: false, engine: "website" as const, max: 25, requestId: "archive-discovery-request" };
  const query = makeQuery(args);
  const key = "discoveryPool:" + createHash("sha256").update(queryKey(query)).digest("hex");
  await store.setSetting(key, { remaining: [{ ...old, id: "archive-discovery-recollected", archived: false }, fresh], provider: "Fixture offline", warnings: [], query, createdAt: "2026-10-24" });
  await store.db.close();
  const result = await discoverNext(args);
  assert.deepEqual(result.prospects.map((p) => p.id), [fresh.id]);
  assert.equal(result.exhausted, true); assert.equal(calls.length, 0);
  assert.deepEqual(await store.prospect(old.id), old);
  assert.equal(await store.prospect("archive-discovery-recollected"), undefined);
});

test("paid enrichment excludes archived leads before planning or spending and restore invalidates the old plan", async () => {
  const placeId = "ChIJ" + "7".repeat(23);
  const p = sample("archive-enrich", { archived: true, selected: false, fields: { placeId: { value: placeId, source: "Fixture import", collectedAt: "2026-10-24" } } });
  await store.saveProspect(p);
  const { planEnrichment } = await import("../server/services/apifyPlan");
  const archivedPlan = await planEnrichment([p.id]);
  assert.deepEqual(archivedPlan.candidates, []); assert.equal(archivedPlan.excluded, 1);
  const response = await request("/apify/enrich", { prospectIds: [p.id], planId: archivedPlan.planId, requestId: "7493ed97-7e48-480f-a56f-596f93d986db", budget: 0.05 });
  assert.equal(response.status, 422); assert.equal(calls.length, 0);
  assert.equal((await patch(p.id, { archived: false })).status, 200);
  const restoredPlan = await planEnrichment([p.id]); assert.equal(restoredPlan.candidates.length, 1);
  assert.notEqual(restoredPlan.planId, archivedPlan.planId);
  assert.equal((await patch(p.id, { archived: true })).status, 200);
  const stale = await request("/apify/enrich", { prospectIds: [p.id], planId: restoredPlan.planId, requestId: "7493ed97-7e48-480f-a56f-596f93d986dc", budget: 0.05 });
  assert.equal(stale.status, 422); assert.equal(calls.length, 0);
});

test("machine writable guard rejects archived canonical leads while retaining historical reads", async () => {
  const p = sample("archive-machine", { selected: false, archived: true }); await store.saveProspect(p);
  await store.saveProspect(sample("archive-machine-alias", { duplicateOf: p.id }));
  const draft: Draft = { id: "archive-machine-draft", prospectId: "archive-machine-alias", prospectName: p.name, subject: "Gardé", body: "Historique", variant: "A", createdAt: "2026-10-24" }; await store.saveDraft(draft);
  const beforeDrafts = await store.list("drafts"), beforeHandoffs = await store.list("handoffs");
  for (const action of ["drafts", "analyze", "handoffs"]) {
    const response = await request(`/prospects/archive-machine-alias/${action}`, action === "analyze" ? {} : { engine: "website" }, "POST", true);
    assert.equal(response.status, 403, action); assert.match((await response.json()).error, /archiv/i);
  }
  assert.equal((await request("/drafts/" + draft.id, { subject: "Interdit", body: "Interdit" }, "PATCH", true)).status, 403);
  assert.deepEqual(await store.list("drafts"), beforeDrafts); assert.deepEqual(await store.list("handoffs"), beforeHandoffs);
  assert.deepEqual(await store.prospect(p.id), p);
  assert.deepEqual(await (await request("/prospects/archive-machine-alias", undefined, "GET", true)).json(), p);
  const state = await (await request("/state", undefined, "GET", true)).json();
  assert.equal(state.prospects.find((item: Prospect) => item.id === p.id).archived, true);
  assert.equal(state.drafts.find((item: Draft) => item.id === draft.id).prospectId, p.id);
  assert.equal(calls.length, 0);
});

test("legacy archive guard blocks new work and draft edits but preserves historical reads and demo drafts", async () => {
  const p = sample("archive-legacy", { selected: false }); await store.saveProspect(p);
  await store.saveProspect(sample("archive-legacy-alias", { duplicateOf: p.id }));
  const draft: Draft = { id: "archive-legacy-draft", prospectId: "archive-legacy-alias", prospectName: p.name, subject: "Historique", body: "Copie gardée", variant: "A", createdAt: "2026-10-24" };
  await store.saveDraft(draft);
  const handoffResponse = await request(`/prospects/${p.id}/handoffs`, { engine: "website" }); assert.equal(handoffResponse.status, 200);
  const handoff = await handoffResponse.json();
  await store.saveSearch({ id: "archive-legacy-search", city: p.city, activity: "artisan", provider: "Fixture", count: 1, cost: 0, createdAt: "2026-10-24", ids: ["archive-legacy-alias"], engine: "website" });
  assert.equal((await patch(p.id, { archived: true })).status, 200);
  const beforeDrafts = await store.list("drafts"), beforeHandoffs = await store.list("handoffs");
  for (const action of ["drafts", "analyze", "handoffs"]) {
    const response = await request(`/prospects/archive-legacy-alias/${action}`, { engine: "website" });
    assert.equal(response.status, 403, action); assert.match((await response.json()).error, /archiv/i);
  }
  assert.equal((await request("/drafts/" + draft.id, { subject: "Interdit", body: "Interdit" }, "PATCH")).status, 403);
  assert.deepEqual(await store.list("drafts"), beforeDrafts); assert.deepEqual(await store.list("handoffs"), beforeHandoffs);
  await store.db.close();
  for (const route of ["/state", "/export"]) {
    const state = await (await request(route)).json();
    assert.equal(state.prospects.find((item: Prospect) => item.id === p.id).archived, true);
    assert.equal(state.drafts.find((item: Draft) => item.id === draft.id).body, draft.body);
    assert.ok(state.handoffs.some((item: { id: string }) => item.id === handoff.id));
  }
  const history = await (await request("/searches/archive-legacy-search")).json();
  assert.equal(history.prospects[0].archived, true); assert.deepEqual(history.search.ids, [p.id]);
  assert.equal((await request("/handoffs/" + handoff.id)).status, 200);
  assert.equal((await request("/handoffs/" + handoff.id + "/export")).status, 200);
  assert.equal((await request("/handoffs/" + handoff.id + "/export?format=dossier")).status, 200);
  assert.equal(calls.length, 0);
  const demo = sample("archive-demo", { demo: true, website: "https://93.184.216.34" }); await store.saveProspect(demo);
  assert.equal((await request(`/prospects/${demo.id}/drafts`, { engine: "website" })).status, 200);
  const demoAnalysis = await request(`/prospects/${demo.id}/analyze`, {});
  assert.equal(demoAnalysis.status, 422); assert.match((await demoAnalysis.json()).error, /fictives/);
  const demoHandoff = await request(`/prospects/${demo.id}/handoffs`, { engine: "website" });
  assert.equal(demoHandoff.status, 200);
  const demoDossier = await (await request(`/handoffs/${(await demoHandoff.json()).id}/export?format=dossier`)).json();
  assert.deepEqual(demoDossier.prospect, demo);
  assert.deepEqual(await store.prospect(demo.id), demo); assert.equal(calls.length, 0);
});

test("reimport and dedupe OR archive without reviving selection or losing references", async () => {
  const { mergeProspects } = await import("../server/services/identity");
  const { persistResults } = await import("../server/searches");
  const p = sample("archive-merge", { archived: true, selected: false, doNotContact: true, status: "En discussion", address: "10 rue archive" });
  const incoming = { ...p, id: "archive-incoming", archived: false, selected: true, doNotContact: false, status: "À contacter" as const };
  for (const [old, fresh] of [[p, incoming], [incoming, p]]) {
    const merged = mergeProspects(old, fresh);
    assert.equal(merged.archived, true); assert.equal(merged.selected, false);
    assert.equal(merged.doNotContact, true); assert.equal(merged.status, "En discussion");
  }
  await store.saveProspect(p);
  const result = await persistResults([incoming], { city: "Bordeaux", activity: "artisan", engine: "website" }, "Fixture", 0);
  assert.equal(result.prospects[0].archived, true); assert.equal(result.prospects[0].selected, false);
  await store.saveProspect({ ...incoming, id: "archive-startup-alias" });
  await store.db.close();
  assert.equal((await store.prospect("archive-startup-alias"))!.id, p.id);
  assert.equal((await store.prospect(p.id))!.archived, true);
  assert.equal((await store.prospect(p.id))!.selected, false);
});

test("archived prospects reject selection until explicitly restored", async () => {
  const p = sample("archive-selection", { archived: true, selected: false }); await store.saveProspect(p);
  for (const body of [{ selected: true }, { archived: true, selected: true }]) {
    const response = await patch(p.id, body); assert.equal(response.status, 422);
    assert.deepEqual(await store.prospect(p.id), p);
  }
  const response = await patch(p.id, { archived: false, selected: true }); assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ...p, archived: false, selected: true });
});

test("archive and restore persist independently of commercial status and contact opposition, including old JSON records", async () => {
  const p = sample("archive-persist", { doNotContact: true, email: "stop@example.test", status: "Gagné" });
  await store.saveProspect(p);
  await store.db.execute({ sql: "INSERT INTO suppressions VALUES(?,?)", args: [p.email, "2026-10-24"] });
  assert.equal((await store.prospect(p.id))!.archived, undefined);
  const archived = await patch(p.id, { archived: true }); assert.equal(archived.status, 200);
  assert.deepEqual(await archived.json(), { ...p, archived: true, selected: false });
  await store.db.close();
  assert.deepEqual(await store.prospect(p.id), { ...p, archived: true, selected: false });
  const restored = await patch(p.id, { archived: false }); assert.equal(restored.status, 200);
  assert.deepEqual(await restored.json(), { ...p, archived: false, selected: false });
  await store.db.close(); assert.equal((await store.prospect(p.id))!.archived, false);
  assert.equal((await store.db.execute("SELECT * FROM suppressions")).rows.length, 1);
});
