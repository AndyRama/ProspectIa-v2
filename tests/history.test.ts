import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@libsql/client";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import path from "node:path";
import type { Prospect } from "../server/types";
import { sameEstablishment } from "../server/services/identity";

const fixture: Prospect = { id: "osm-node-10", name: "Menuisier Martin", category: "Artisan menuisier", city: "Bordeaux", address: "10 rue des Lilas Bordeaux", lat: 44.84, lng: -0.58, website: "", email: "", phone: "", rating: null, reviews: null, selected: false, status: "À contacter", demo: false, webStatus: "Non vérifié", fields: {}, socials: {}, hours: "", photos: [], engine: "voice" };

test("Rapprochement : protège les établissements distincts malgré un nom ou un site partagé", () => {
  const at = (id: string, address: string, siret?: string): Prospect => ({ ...fixture, id, address, website: "https://example.com", fields: siret ? { siret: { value: siret, source: "Sirene", collectedAt: "2026-10-20" } } : {} });
  assert.equal(sameEstablishment(at("a", "10 rue des Lilas Bordeaux"), at("b", "10, Rue des Lilas Bordeaux")), true);
  assert.equal(sameEstablishment(at("a", "10 rue des Lilas Bordeaux"), at("b", "10 rue des Lilas 33000 Bordeaux")), true);
  assert.equal(sameEstablishment(at("a", "10 rue des Lilas 33000 Bordeaux"), at("b", "10 rue des Lilas 33100 Bordeaux")), false);
  assert.equal(sameEstablishment(at("a", "10 rue des Lilas Bordeaux"), at("b", "20 rue des Lilas Bordeaux")), false);
  assert.equal(sameEstablishment(at("a", "10 rue des Lilas Bordeaux", "111"), at("b", "10 rue des Lilas Bordeaux", "222")), false);
  assert.equal(sameEstablishment({ ...fixture, id: "a", address: "Bordeaux" }, { ...fixture, id: "b", address: "Bordeaux" }), false);
  assert.equal(sameEstablishment(fixture, { ...fixture, id: "demo", demo: true }), false);
});

test("Bordeaux menuisiers : historique gratuit conservé, nouvelles collectes bloquées et reprise après redémarrage", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "prospectai-history-"));
  const base = "http://127.0.0.1:3197/api";
  let proc: ChildProcess | undefined;
  const request = async (route: string, body?: any, method = body ? "POST" : "GET") => {
    const response = await fetch(base + route, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  async function start() {
    proc = spawn(process.execPath, ["--import", "tsx", "tests/fixtures/search-provider.ts"], { env: { ...process.env, PORT: "3197", DATA_DIR: dir, APP_PASSWORD: "", DATA_ENCRYPTION_KEY: "", APIFY_TOKEN: "", TURSO_DATABASE_URL: "", TURSO_AUTH_TOKEN: "", VERCEL: "" }, stdio: "pipe" });
    let errors = ""; proc.stderr?.on("data", (d) => errors += String(d));
    for (let i = 0; i < 60; i++) {
      try { const res = await fetch(base + "/health"); if (res.ok) return; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw Error("API non démarrée : " + errors);
  }
  async function stop() {
    if (!proc || proc.exitCode !== null) return;
    const exit = new Promise((resolve) => proc!.once("exit", resolve)); proc.kill(); await exit;
  }
  try {
    const client = createClient({ url: pathToFileURL(path.join(dir, "prospectai.sqlite")).href });
    await client.batch(["CREATE TABLE prospects(id TEXT PRIMARY KEY, data TEXT NOT NULL)", "CREATE TABLE searches(id TEXT PRIMARY KEY, data TEXT NOT NULL)", "CREATE TABLE drafts(id TEXT PRIMARY KEY, prospect_id TEXT NOT NULL, data TEXT NOT NULL)"], "write");
    const duplicate = { ...fixture, id: "apify-old", address: "10 rue des Lilas, 33000 Bordeaux, France", selected: true, status: "En discussion", email: "public@example.com", fields: { email: { value: "public@example.com", source: "Apify", collectedAt: "2026-10-19" } } };
    const history = (id: string, provider: string, createdAt: string) => ({ id, city: "Bordeaux", activity: "artisan", keyword: "menuisier", engine: "voice", provider, cost: 0, count: 2, ids: [fixture.id, duplicate.id], createdAt });
    await client.batch([
      ...[fixture, duplicate].map((p) => ({ sql: "INSERT INTO prospects VALUES(?,?)", args: [p.id, JSON.stringify(p)] })),
      ...[history("old-free", "OpenStreetMap", "2026-10-19T10:00:00Z"), history("old-paid", "Apify", "2026-10-19T11:00:00Z")].map((s) => ({ sql: "INSERT INTO searches VALUES(?,?)", args: [s.id, JSON.stringify(s)] })),
      { sql: "INSERT INTO drafts VALUES(?,?,?)", args: ["old-draft", duplicate.id, JSON.stringify({ id: "old-draft", prospectId: duplicate.id, body: "Texte ancien à conserver" })] },
    ], "write"); client.close();
    await start();
    const state = await request("/state");
    assert.equal(state.searches.length, 2); assert.equal(state.prospects.length, 1);
    assert.equal(state.prospects[0].selected, true); assert.equal(state.prospects[0].status, "En discussion");
    assert.equal(state.drafts[0].prospectId, fixture.id); assert.equal(state.drafts[0].body, "Texte ancien à conserver");
    const q = { city: "Bordeaux", activity: "artisan", keyword: "menuisier", engine: "website", max: 25, budget: 1, paid: false };
    for (const paid of [false, true]) {
      const reused = await request("/search", { ...q, city: "  BORDEAUX  ", keyword: "MÉNUISIER", paid });
      assert.equal(reused.cached, true); assert.equal(reused.prospects.length, 1);
    }
    const blocked = await fetch(base + "/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...q, paid: true, refresh: true }) });
    assert.equal(blocked.status, 422); assert.match((await blocked.json()).error, /Apify.*plan.*confirmation/);
    await assert.rejects(readFile(path.join(dir, "provider-calls.json")), { code: "ENOENT" });
    await request("/prospects/apify-old", { selected: false, status: "Gagné", doNotContact: true }, "PATCH");
    const handoff = await request(`/prospects/${fixture.id}/handoffs`, { engine: "voice" });
    assert.match(handoff.title, /agent personnel/); assert.match(handoff.prompt, /organiser son activité/);
    assert.doesNotMatch(handoff.prompt, /agent vocal|accueil vocal/i);
    const before = await request("/state");
    const refreshRequest = { ...q, refresh: true, requestId: "e8ceac37-89d8-4fcb-95d9-0d97eb736604" };
    const attempts = [refreshRequest, refreshRequest, { ...q, intent: "discover", requestId: refreshRequest.requestId, refreshPool: true }];
    for (const body of attempts) {
      const response = await fetch(base + "/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      assert.equal(response.status, 422);
      assert.match((await response.json()).error, /Apify.*plan.*confirmation/);
    }
    assert.deepEqual(await request("/state"), before, "no new search and no overwritten user state");
    await assert.rejects(readFile(path.join(dir, "provider-calls.json")), { code: "ENOENT" });
    await stop(); await start();
    const resumed = await request("/state"); assert.equal(resumed.searches.length, 2); assert.equal(resumed.prospects.length, 1);
    const saved = await request("/searches/old-free"); assert.equal(saved.prospects.length, 1); assert.equal(saved.prospects[0].status, "Gagné"); assert.equal(saved.prospects[0].selected, false);
    assert.equal(saved.prospects[0].doNotContact, true); assert.equal(saved.prospects[0].email, "public@example.com");
    const reopened = await request("/search", q); assert.equal(reopened.cached, true);
    await assert.rejects(readFile(path.join(dir, "provider-calls.json")), { code: "ENOENT" });
    const exported = await request("/export"); assert.ok(exported.archivedDuplicateProspects.some((p: Prospect) => p.id === duplicate.id));
    assert.equal(exported.prospects.length, 1); assert.equal(exported.searches.length, 2);
  } finally { await stop(); await rm(dir, { recursive: true, force: true }); }
});
