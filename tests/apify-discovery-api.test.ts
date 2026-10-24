import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";

test("API découverte Apify : gardes, aperçu local et contrat strict", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "prospectai-discovery-api-"));
  Object.assign(process.env, { DATA_DIR: dir, PORT: "0", VERCEL: "", APP_PASSWORD: "fixture-password-long-enough", TURSO_DATABASE_URL: "", TURSO_AUTH_TOKEN: "", APIFY_TOKEN: "", DATA_ENCRYPTION_KEY: "f".repeat(64) });
  let server!: Server;
  const listen = express.application.listen;
  (express.application as any).listen = function (...args: any[]) { server = (listen as any).apply(this, args); return server; };
  const realFetch = globalThis.fetch;
  let externalCalls = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("http://127.0.0.1:")) return realFetch(url, init);
    externalCalls++; throw Error("External provider forbidden in local-plan tests");
  };
  const { default: app } = await import("../server/index");
  void app;
  express.application.listen = listen;
  if (!server.listening) await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  let cookie = "";
  const post = (endpoint: string, body: any, extra = {}) => fetch(base + endpoint, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie, ...extra }, body: JSON.stringify(body) });
  const args = { city: "Bordeaux", activity: "artisan", keyword: "menuisier", engine: "voice", max: 25, budget: 1 };
  const { db, setSetting } = await import("../server/db");
  try {
    await t.test("authentication and origin protections apply to both new routes", async () => {
      for (const route of ["plan", "start"]) assert.equal((await post(`/api/apify/discovery/${route}`, args)).status, 401);
      const login = await post("/api/auth/login", { password: process.env.APP_PASSWORD });
      cookie = login.headers.get("set-cookie")!.split(";")[0];
      for (const route of ["plan", "start"]) assert.equal((await post(`/api/apify/discovery/${route}`, args, { Origin: "https://evil.example" })).status, 403);
    });
    await t.test("plan is local and rejects untrusted fields or invalid bounds", async () => {
      const response = await post("/api/apify/discovery/plan", args);
      assert.equal(response.status, 200);
      const plan = await response.json();
      assert.match(plan.planId, /^[a-f0-9]{64}$/);
      assert.equal(plan.actor, "benthepythondev/google-maps-business-scraper");
      assert.equal(plan.max, 25); assert.equal(plan.budget, 1);
      assert.equal(externalCalls, 0);
      for (const patch of [{ max: 26 }, { max: 1.5 }, { budget: 0.04 }, { budget: 11 }, { actor: "arbitrary/actor" }, { token: "client-secret" }, { url: "https://evil.example" }, { city: "" }, { engine: "other" }]) {
        assert.equal((await post("/api/apify/discovery/plan", { ...args, ...patch })).status, 400, JSON.stringify(patch));
      }
    });
    await t.test("start requires confirmation and strict identifiers; rejects stale plans and stored limits", async () => {
      const plan = await (await post("/api/apify/discovery/plan", args)).json();
      const input = { ...args, planId: plan.planId, requestId: "40000000-0000-4000-8000-000000000001", confirmed: true };
      for (const patch of [{ confirmed: false }, { confirmed: undefined }, { requestId: "bad" }, { planId: "bad" }, { actor: "x/y" }, { max: 26 }, { budget: 11 }]) assert.equal((await post("/api/apify/discovery/start", { ...input, ...patch })).status, 400);
      const stale = await post("/api/apify/discovery/start", { ...input, planId: "0".repeat(64) });
      assert.equal(stale.status, 422); assert.match((await stale.json()).error, /plan|aperçu|lot/i);
      await setSetting("limits", { max: 10, budget: 0.5 });
      assert.equal((await post("/api/apify/discovery/start", input)).status, 422);
      await setSetting("limits", { max: 25, budget: 1 });
      assert.equal(externalCalls, 0);
    });
    await t.test("same request reopens saved discovery or pending without any provider request", async () => {
      const input = { ...args, planId: "a".repeat(64), requestId: "40000000-0000-4000-8000-000000000002", confirmed: true };
      await setSetting("apifyPending", { mode: "discovery", requestId: input.requestId, runId: null, planId: input.planId });
      const pending = await (await post("/api/apify/discovery/start", input)).json();
      assert.equal(pending.pending, true); assert.equal(pending.runId, null);
      await setSetting("apifyPending", null);
      const saved = { id: "discovery-saved", ...args, query: { ...args, paid: true }, kind: "discovery", provider: "Apify", count: 0, ids: [], cost: 0.00001, requestId: input.requestId, createdAt: new Date().toISOString() };
      await db.execute({ sql: "INSERT INTO searches VALUES(?,?)", args: [saved.id, JSON.stringify(saved)] });
      const reopened = await (await post("/api/apify/discovery/start", input)).json();
      assert.equal(reopened.cached, true); assert.equal(reopened.search.id, saved.id);
      assert.equal(externalCalls, 0);
    });
    await t.test("settings verification checks the new provider without launching a run", async () => {
      const { saveSecret } = await import("../server/secrets");
      await saveSecret("apifyKey", "fixture-never-real-token");
      const urls: string[] = [];
      const properties = Object.fromEntries(Object.entries({ mode: "string", query: "string", location: "string", onlyNew: "boolean", monitorId: "string", excludePlaceIds: "array", excludePlaceUrls: "array", maxResults: "integer", language: "string", includeReviews: "boolean", includePhotos: "boolean", includeLeadScore: "boolean", debugMode: "boolean" }).map(([key, type]) => [key, { type, ...(type === "array" ? { items: { type: "string" } } : {}) }]));
      globalThis.fetch = async (url, init) => {
        if (String(url).startsWith(base)) return realFetch(url, init);
        urls.push(String(url));
        assert.ok(String(url).includes("benthepythondev~google-maps-business-scraper"));
        assert.notEqual(init?.method, "POST");
        return Response.json({ data: String(url).endsWith("/builds/default") ? { buildNumber: "1.0.32", actorDefinition: { input: { properties } } } : { id: "uU8ybh0dgvI68Q3o2", currentPricingInfo: { pricingModel: "PAY_PER_EVENT" } } });
      };
      assert.equal((await post("/api/apify/verify", {})).status, 200);
      assert.equal(urls.length, 2);
    });
    await t.test("mocked discovery start is idempotent and collection persists discovery with actual cost", async () => {
      const properties = Object.fromEntries(Object.entries({ mode: "string", query: "string", location: "string", onlyNew: "boolean", monitorId: "string", excludePlaceIds: "array", excludePlaceUrls: "array", maxResults: "integer", language: "string", includeReviews: "boolean", includePhotos: "boolean", includeLeadScore: "boolean", debugMode: "boolean" }).map(([key, type]) => [key, { type, ...(type === "array" ? { items: { type: "string" } } : {}) }]));
      let posts = 0, finalizing = true;
      globalThis.fetch = async (url, init) => {
        const u = String(url);
        if (u.startsWith(base)) return realFetch(url, init);
        assert.ok(u.startsWith("https://api.apify.com/v2/"));
        if (u.includes("/runs?")) { posts++; assert.equal(init?.method, "POST"); const body = JSON.parse(String(init?.body)); assert.equal(body.onlyNew, true); assert.ok(Array.isArray(body.excludePlaceIds)); return Response.json({ data: { id: "fixtureRun12345" } }); }
        if (u.includes("actor-runs/")) return Response.json({ data: { id: "fixtureRun12345", actId: "uU8ybh0dgvI68Q3o2", status: "SUCCEEDED", finishedAt: new Date(Date.now() - (finalizing ? 0 : 60000)).toISOString(), usageTotalUsd: 0.00001, defaultDatasetId: "fixtureDataset" } });
        if (u.includes("/datasets/")) return Response.json([{ name: "Fixture atelier", place_id: "ChIJ" + "x".repeat(23), address: "10 rue fixture", category: "Artisan", city: "Bordeaux" }]);
        return Response.json({ data: u.endsWith("/builds/default") ? { buildNumber: "1.0.32", actorDefinition: { input: { properties } } } : { id: "uU8ybh0dgvI68Q3o2", currentPricingInfo: { pricingModel: "PAY_PER_EVENT" } } });
      };
      const plan = await (await post("/api/apify/discovery/plan", args)).json();
      const input = { ...args, planId: plan.planId, requestId: "40000000-0000-4000-8000-000000000003", confirmed: true };
      const launched = await post("/api/apify/discovery/start", input);
      assert.equal(launched.status, 200, JSON.stringify(await launched.clone().json()));
      assert.equal((await launched.json()).pending, true);
      assert.equal((await (await post("/api/apify/discovery/start", input)).json()).runId, "fixtureRun12345");
      assert.equal(posts, 1);
      const firstPoll = await (await post("/api/apify/poll", {})).json();
      assert.equal(firstPoll.status, "FINALIZING"); assert.equal(firstPoll.pending, true);
      finalizing = false;
      const collected = await (await post("/api/apify/poll", {})).json();
      assert.equal(collected.search.kind, "discovery"); assert.equal(collected.enriched, false);
      assert.equal(collected.search.cost, 0.00001); assert.equal(collected.prospects[0].fields.name.source, "Apify · Google Maps");
      const { getSetting } = await import("../server/db"); assert.equal(await getSetting("apifyPending", null), null);
      const reopened = await (await post("/api/apify/discovery/start", input)).json();
      assert.equal(reopened.cached, true); assert.equal(reopened.search.id, collected.search.id); assert.equal(posts, 1);
    });
    await t.test("free refreshPool is boolean and explicit refill reaches public providers", async () => {
      const input = { ...args, paid: false, intent: "discover", requestId: "40000000-0000-4000-8000-000000000004" };
      assert.equal((await post("/api/search", { ...input, refreshPool: "true" })).status, 400);
      const { createHash } = await import("node:crypto");
      const { queryKey } = await import("../server/searchQuery");
      const query = { city: args.city, activity: args.activity, keyword: args.keyword, paid: false };
      await setSetting("discoveryPool:" + createHash("sha256").update(queryKey(query)).digest("hex"), { query, provider: "OpenStreetMap", remaining: [], warnings: ["Réserve témoin épuisée"], createdAt: new Date().toISOString() });
      let reads = 0;
      globalThis.fetch = async (url, init) => {
        const u = String(url); if (u.startsWith(base)) return realFetch(url, init);
        assert.ok(!u.includes("apify")); reads++;
        return Response.json(u.includes("nominatim") ? [{ lat: "44.84", lon: "-0.58", address: { country_code: "fr" } }] : u.includes("recherche-entreprises") ? { results: [] } : { elements: [{ type: "node", id: 555, lat: 44.84, lon: -0.58, tags: { name: "Menuisier rafraîchi", craft: "carpenter", "addr:street": "rue nouvelle", "addr:city": "Bordeaux" } }] });
      };
      const exhausted = await (await post("/api/search", { ...input, refreshPool: false })).json();
      assert.equal(exhausted.exhausted, true); assert.equal(reads, 0); assert.ok(exhausted.warnings.length);
      const refilled = await (await post("/api/search", { ...input, requestId: "40000000-0000-4000-8000-000000000005", refreshPool: true })).json();
      assert.ok(reads > 0); assert.equal(refilled.search.count, 1);
    });
  } finally {
    express.application.listen = listen; globalThis.fetch = realFetch;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.close(); await rm(dir, { recursive: true, force: true });
  }
});
