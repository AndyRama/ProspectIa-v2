import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import type { Server } from "node:http";
import type { Prospect } from "../server/types";

const env = { ...process.env }, originalFetch = globalThis.fetch;
let base: string, dir: string, cookie: string, server: Server, store: typeof import("../server/db");
const calls: string[] = [];
let transport: (url: string, init?: RequestInit) => Promise<Response>;
const html = '<html><head><title>Accueil réel fixture</title><meta name="viewport" content="width=device-width"></head><body><h1>Activité publiée</h1><a href="/contact">Contact</a><a href="mailto:new@fixture.fr">Email</a><a href="tel:999">Téléphone</a></body></html>';
const ok = async () => new Response(html, { headers: { "content-type": "text/html" } });
const p: Prospect = { id: "site-check-fixture", name: "Atelier", category: "Artisan", city: "Paris", address: "", lat: null, lng: null, website: "https://93.184.216.34", email: "manual@fixture.fr", phone: "123", rating: null, reviews: null, selected: true, status: "En discussion", demo: false, webStatus: "Non vérifié", fields: { email: { value: "manual@fixture.fr", source: "Saisie utilisateur", collectedAt: "2026-01-01T00:00:00Z" } }, socials: {}, hours: "", photos: [], engine: "website" };
const check = (body: unknown = {}, headers: Record<string, string> = { Cookie: cookie }, id = p.id) => originalFetch(base + `/api/prospects/${id}/site-check`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
before(async () => {
  for (const key of Object.keys(process.env)) if (/TURSO|VERCEL|APIFY|SMTP|AI_API|APP_PASSWORD|PROSPECTIA_AGENT_TOKEN|DATA_ENCRYPTION|PROXY/i.test(key)) delete process.env[key];
  const scratch = process.env.TMPDIR || "/opt/data/cache/scratch"; await mkdir(scratch, { recursive: true }); dir = await mkdtemp(path.join(scratch, "prospectai-site-check-"));
  process.env.DATA_DIR = dir; process.env.DOTENV_CONFIG_PATH = "/dev/null"; process.env.APP_PASSWORD = "fixture-only-password"; process.env.VERCEL = "1";
  const app = (await import("../server/index")).default; delete process.env.VERCEL; store = await import("../server/db");
  server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve)); base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  globalThis.fetch = async (url, init) => { calls.push(String(url)); return transport(String(url), init); };
  const login = await originalFetch(base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: process.env.APP_PASSWORD }) }); assert.equal(login.status, 200); cookie = login.headers.get("set-cookie")!.split(";")[0];
});
after(async () => { globalThis.fetch = originalFetch; if (server) await new Promise<void>(resolve => server.close(() => resolve())); if (store) await store.db.close(); if (dir) await rm(dir, { recursive: true, force: true }); for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]; Object.assign(process.env, env); });

test("homepage-only check persists real audit and provenance, preserving manual data and surviving database reopen", async () => {
  await store.saveProspect(p); calls.length = 0; transport = ok;
  const response = await check(); assert.equal(response.status, 200);
  const saved = await response.json();
  assert.equal(saved.webStatus, "Site analysé"); assert.equal(saved.audit.title, "Accueil réel fixture");
  assert.equal(saved.audit.sourceUrl, "https://93.184.216.34/");
  assert.equal(saved.audit.scope, "homepage"); assert.ok(Number.isFinite(Date.parse(saved.audit.checkedAt)));
  assert.deepEqual(calls, ["https://93.184.216.34/"]);
  assert.deepEqual({ ...saved, audit: undefined, siteCheck: undefined, webStatus: p.webStatus }, { ...p, audit: undefined, siteCheck: undefined });
  assert.equal(saved.siteCheck.status, "succeeded");
  await store.db.close(); assert.deepEqual(await store.prospect(p.id), saved);
});

test("scheme-less public domain is explicitly normalized to HTTPS without changing stored website", async () => {
  const bare = { ...p, website: "93.184.216.34" }; await store.saveProspect(bare); calls.length = 0; transport = ok;
  const response = await check(); assert.equal(response.status, 200);
  const saved = await response.json(); assert.equal(saved.website, bare.website); assert.equal(saved.audit.sourceUrl, "https://93.184.216.34/");
  assert.deepEqual(calls, ["https://93.184.216.34/"]);
});

test("missing site, archived, demo, auth, origin and strict body never request a site", async () => {
  calls.length = 0; transport = ok;
  for (const change of [{ website: "" }, { website: "   " }, { archived: true }, { demo: true }]) {
    const blocked = { ...p, ...change }; await store.saveProspect(blocked);
    assert.equal((await check()).status, "website" in change ? 422 : 403);
    assert.deepEqual(await store.prospect(p.id), blocked);
  }
  await store.saveProspect(p);
  assert.equal((await check({}, {})).status, 401);
  assert.equal((await check({}, { Cookie: cookie, Origin: "https://evil.invalid" })).status, 403);
  assert.equal((await check({}, { Cookie: cookie }, "missing")).status, 404);
  assert.equal((await check({}, { Cookie: cookie }, "bad.id")).status, 400);
  for (const body of [[], { force: true }, { website: "https://93.184.216.34" }, { archived: false }]) assert.equal((await check(body)).status, 400);
  assert.deepEqual(calls, []); assert.deepEqual(await store.prospect(p.id), p);
});

test("HTTP, DNS and timeout failures persist controlled failure, retaining previous dated audit", async () => {
  await store.saveProspect(p); transport = ok;
  const previous = await (await check()).json();
  for (const fail of [async () => new Response("unavailable", { status: 503 }), async () => { throw Error("ENOTFOUND secret-host token=secret"); }, async () => { throw new DOMException("sensitive timeout detail", "TimeoutError"); }]) {
    await store.saveProspect(previous); calls.length = 0; transport = fail;
    const response = await check(); assert.equal(response.status, 502);
    const body = await response.json(); assert.doesNotMatch(JSON.stringify(body), /secret|sensitive/);
    assert.equal(body.prospect.webStatus, "Vérification impossible"); assert.equal(body.prospect.siteCheck.status, "failed");
    assert.equal(body.error, body.prospect.siteCheck.error); assert.deepEqual(body.prospect.audit, previous.audit);
    assert.ok(Number.isFinite(Date.parse(body.prospect.siteCheck.checkedAt)));
    await store.db.close(); assert.deepEqual(await store.prospect(p.id), body.prospect); assert.equal(calls.length, 1);
  }
  await store.saveProspect(p); transport = async () => { throw Error("DNS failed"); };
  const failed = await (await check()).json(); assert.equal(failed.prospect.audit, undefined);
  transport = ok; const recovered = await (await check()).json(); assert.equal(recovered.siteCheck.status, "succeeded"); assert.equal(recovered.siteCheck.error, undefined);
});

test("SSRF restrictions cover original address and every redirect, including scheme-less private host", async () => {
  for (const website of ["http://127.0.0.1", "https://10.0.0.1", "192.168.1.1", "file:///etc/passwd", "https://user:pass@93.184.216.34", "https://93.184.216.34:8080", "//93.184.216.34", "javascript:alert(1)"]) {
    calls.length = 0; transport = ok; await store.saveProspect({ ...p, website });
    assert.equal((await check()).status, 502, website); assert.equal(calls.length, 0, website);
  }
  await store.saveProspect(p); calls.length = 0;
  transport = async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } });
  assert.equal((await check()).status, 502); assert.equal(calls.length, 1);
});

test("CAS refuses concurrent archive, site change, manual fields, audit and deletion without overwriting them", async () => {
  for (const change of [{ archived: true }, { website: "https://1.1.1.1" }, { email: "changed@fixture.fr", phone: "456", fields: {} }, { webStatus: "Autre analyse" }, null]) {
    await store.saveProspect(p); let concurrent: Prospect | null = change ? { ...p, ...change } : null;
    transport = async () => {
      if (concurrent) await store.db.execute({ sql: "UPDATE prospects SET data=? WHERE id=?", args: [JSON.stringify(concurrent), p.id] });
      else await store.db.execute({ sql: "DELETE FROM prospects WHERE id=?", args: [p.id] });
      return ok();
    };
    assert.equal((await check()).status, 409);
    assert.deepEqual((await store.prospect(p.id)) || null, concurrent);
  }
  await store.saveProspect(p); transport = ok;
  const execute = store.db.execute; let intercepted = false;
  store.db.execute = async statement => {
    if (!intercepted && typeof statement !== "string" && statement.sql.startsWith("UPDATE prospects SET data=")) {
      intercepted = true; await execute({ sql: "UPDATE prospects SET data=? WHERE id=?", args: [JSON.stringify({ ...p, archived: true }), p.id] });
    }
    return execute(statement);
  };
  try { assert.equal((await check()).status, 409); assert.equal((await store.prospect(p.id))?.archived, true); assert.equal(intercepted, true); }
  finally { store.db.execute = execute; }
});

test("route enforces the 15-second total budget and durably records aborted body failure", async () => {
  await store.saveProspect(p); calls.length = 0;
  let canceled = false; const budgets: number[] = []; const timeout = AbortSignal.timeout;
  const clock = mock.method(AbortSignal, "timeout", (ms: number) => { budgets.push(ms); return timeout(ms === 15000 ? 25 : ms); });
  transport = async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("<html>")); }, cancel() { canceled = true; } }), { headers: { "content-type": "text/html" } });
  try {
    const response = await check(); assert.equal(response.status, 502);
    const saved = (await response.json()).prospect; assert.equal(saved.siteCheck.status, "failed"); assert.equal(saved.audit, undefined);
    assert.equal(canceled, true); assert.deepEqual(budgets, [15000]); assert.equal(calls.length, 1);
    await store.db.close(); assert.deepEqual(await store.prospect(p.id), saved);
  } finally { clock.mock.restore(); }
});

test("homepage audit never substitutes for the full eight-page coder handoff collection", async () => {
  await store.saveProspect({ ...p, website: "93.184.216.34" }); transport = ok;
  const preliminary = await (await check()).json();
  // A later failed preliminary check must remain failed, not become a synthetic success.
  preliminary.siteCheck = { status: "failed", checkedAt: "2026-01-02T00:00:00Z", error: "Échec précédent" };
  await store.saveProspect(preliminary); calls.length = 0;
  transport = async (url) => new Response(`<html><title>Collecte complète</title><meta name="viewport" content="width=device-width"><body><p>Contenu réel ${url}</p>${Array.from({ length: 10 }, (_, i) => `<a href="/service-${i}">Service</a>`).join("")}</body></html>`, { headers: { "content-type": "text/html" } });
  const response = await originalFetch(base + `/api/prospects/${p.id}/handoffs`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ engine: "website" }) });
  assert.equal(response.status, 200);
  const handoff = await response.json(), saved = await store.prospect(p.id);
  assert.equal(calls.length, 8); assert.equal(saved?.audit?.pages?.length, 8);
  assert.equal(saved?.audit?.scope, undefined); assert.deepEqual(saved?.siteCheck, preliminary.siteCheck);
  const stored = (await store.list<any>("handoffs")).find(h => h.id === handoff.id);
  assert.ok(stored); assert.match(JSON.stringify(stored.dossier), /service-6/);
  await store.db.execute("DELETE FROM handoffs");
});

test("handoff rejects a concurrent homepage downgrade after full collection without degrading history", async () => {
  await store.saveProspect(p);
  transport = async () => new Response(`<html><title>Collecte complète</title><body><p>Contenu réel</p>${Array.from({ length: 10 }, (_, i) => `<a href="/service-${i}">Service</a>`).join("")}</body></html>`, { headers: { "content-type": "text/html" } });
  const handoffRequest = () => originalFetch(base + `/api/prospects/${p.id}/handoffs`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ engine: "website" }) });
  const previous = await handoffRequest(); assert.equal(previous.status, 200);
  const history = await store.list<any>("handoffs"); assert.equal(history.length, 1);
  assert.equal(history[0].dossier.prospect.audit.pages.length, 8);
  assert.equal((await check()).status, 200); calls.length = 0;
  const execute = store.db.execute; let intercepted = false, fullPages = 0;
  let concurrent: Prospect | undefined;
  // Execute the real competing HTTP route at the asynchronous business-context
  // read, after the full analysis CAS but before the final eligibility read.
  store.db.execute = async statement => {
    if (!intercepted && typeof statement !== "string" && statement.sql === "SELECT data FROM settings WHERE key=?" && Array.isArray(statement.args) && statement.args[0] === "business") {
      intercepted = true; fullPages = (await store.prospect(p.id))?.audit?.pages?.length || 0;
      assert.equal((await check()).status, 200); concurrent = await store.prospect(p.id);
    }
    return execute(statement);
  };
  try {
    const response = await handoffRequest();
    assert.equal(response.status, 409, "must not export a homepage audit in place of the verified full collection");
    assert.equal(intercepted, true); assert.equal(fullPages, 8); assert.equal(calls.length, 9);
    assert.equal(concurrent?.audit?.scope, "homepage"); assert.equal(concurrent?.audit?.pages, undefined);
    assert.deepEqual(await store.prospect(p.id), concurrent);
    assert.deepEqual(await store.list("handoffs"), history, "the conflict must not create or replace any historical handoff");
    const exported = await originalFetch(base + `/api/handoffs/${history[0].id}/export?format=dossier`, { headers: { Cookie: cookie } });
    assert.equal(exported.status, 200); assert.deepEqual(await exported.json(), history[0].dossier);
  } finally { store.db.execute = execute; await store.db.execute("DELETE FROM handoffs"); }
});

test("full analysis preserves existing contact values and their user provenance", async () => {
  const manual = { ...p, socials: { instagram: "https://instagram.com/user-choice" }, fields: { ...p.fields, phone: { value: p.phone, source: "Saisie utilisateur", collectedAt: "2026-01-01T00:00:00Z" } } };
  await store.saveProspect(manual); calls.length = 0;
  transport = async () => new Response('<html><title>Contacts publiés</title><body><a href="tel:999">Appeler</a><a href="https://instagram.com/published">Instagram</a></body></html>', { headers: { "content-type": "text/html" } });
  const response = await originalFetch(base + `/api/prospects/${p.id}/analyze`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: "{}" });
  assert.equal(response.status, 200);
  const saved = await response.json(); assert.equal(saved.phone, manual.phone); assert.equal(saved.email, manual.email);
  assert.deepEqual(saved.fields, manual.fields); assert.deepEqual(saved.socials, manual.socials); assert.equal(saved.status, manual.status); assert.equal(saved.selected, manual.selected);
  assert.equal(saved.audit.pages.length, 1); assert.equal(calls.length, 1);
});

test("full analysis and handoff reject concurrent contact/site changes instead of saving stale audit", async () => {
  for (const action of ["analyze", "handoffs"]) {
    for (const change of [{ website: "https://1.1.1.1" }, { phone: "concurrent" }, { archived: true }]) {
      await store.saveProspect(p); const concurrent = { ...p, ...change };
      transport = async () => {
        await store.db.execute({ sql: "UPDATE prospects SET data=? WHERE id=?", args: [JSON.stringify(concurrent), p.id] });
        return new Response("<html><title>Stale</title><body>Ancienne version</body></html>", { headers: { "content-type": "text/html" } });
      };
      const response = await originalFetch(base + `/api/prospects/${p.id}/${action}`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ engine: "website" }) });
      assert.equal(response.status, "archived" in change ? 403 : 409, `${action}: ${JSON.stringify(change)}`);
      assert.deepEqual(await store.prospect(p.id), concurrent);
      assert.deepEqual(await store.list("handoffs"), []);
    }
  }
});

test("handoff insert is atomic against an archive after the final eligibility read", async () => {
  await store.saveProspect({ ...p, website: "" });
  const execute = store.db.execute; let intercepted = false;
  store.db.execute = async statement => {
    if (!intercepted && typeof statement !== "string" && statement.sql.startsWith("INSERT INTO handoffs")) {
      intercepted = true;
      await execute({ sql: "UPDATE prospects SET data=? WHERE id=?", args: [JSON.stringify({ ...p, website: "", archived: true }), p.id] });
    }
    return execute(statement);
  };
  try {
    const response = await originalFetch(base + `/api/prospects/${p.id}/handoffs`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ engine: "website" }) });
    assert.equal(response.status, 409); assert.equal(intercepted, true);
    assert.deepEqual(await store.list("handoffs"), []); assert.equal((await store.prospect(p.id))?.archived, true);
  } finally { store.db.execute = execute; }
});

test("real homepage observations can yield À examiner, without creating handoffs or drafts", async () => {
  await store.saveProspect(p); transport = async () => new Response("<html><title>Sans viewport</title><body><p>Contenu</p></body></html>", { headers: { "content-type": "text/html" } });
  const response = await check(); assert.equal(response.status, 200); assert.equal((await response.json()).webStatus, "À examiner");
  assert.deepEqual(await store.list("handoffs"), []); assert.deepEqual(await store.list("drafts"), []);
});
