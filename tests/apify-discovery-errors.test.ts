import { emailPricing, emailMetadataResponse } from './fixtures/apify-email';
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("Apify HTTP errors expose only controlled French reasons and preserve exact lock policy", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "apify-errors-"));
  Object.assign(process.env, { DATA_DIR: dir, TURSO_DATABASE_URL: "", TURSO_AUTH_TOKEN: "", VERCEL: "" });
  const { db, getSetting, setSetting } = await import("../server/db");
  const { discoveryApi, planApifyDiscovery, startApifyDiscovery } = await import("../server/services/apifyDiscovery");
  const original = globalThis.fetch;
  const token = "fixture-private-token+unsafe";
  const properties = Object.fromEntries(Object.entries({ requireEmail: "boolean", skipClosed: "boolean", countryCode: "string", mode: "string", query: "string", location: "string", onlyNew: "boolean", monitorId: "string", excludePlaceIds: "array", excludePlaceUrls: "array", maxResults: "integer", language: "string", includeReviews: "boolean", includePhotos: "boolean", includeLeadScore: "boolean", debugMode: "boolean" }).map(([key, type]) => [key, { type, ...(type === "array" ? { items: { type: "string" } } : {}) }]));
  const args = { city: "Bordeaux", activity: "artisan", keyword: "menuisier", engine: "voice" as const, max: 25, budget: 1 };
  try {
    await t.test("quoted JSON credentials and HTML-split tokens never expose provider details", async (t) => {
      for (const message of [
        'Invalid input {"apiKey":"fixture-secondary-secret"}',
        'Invalid input {"password":"fixture-secondary-password"}',
        'Rejected credential fixture-private-<b></b>token+unsafe',
      ]) await t.test(message, async () => {
        globalThis.fetch = async () => Response.json({ error: { message } }, { status: 400 });
        await assert.rejects(discoveryApi("acts/fixture", token), (error: any) => {
          assert.equal(error.name, "ApifyHttpError");
          assert.equal(error.status, 400);
          assert.equal(error.message, "Apify HTTP 400. Input Apify invalide : vérifiez les paramètres d’entrée.");
          for (const detail of [message, token, "fixture-secondary-secret", "fixture-secondary-password", "Rejected credential", "Invalid input", "Détail fournisseur"])
            assert.ok(!error.message.includes(detail), detail);
          return true;
        });
      });
    });
    await t.test("HTTP status explains key, credit, permission, input and actor failures without secrets", async () => {
      for (const [status, reason] of [[401, /clé/i], [402, /crédit/i], [403, /permission/i], [400, /input|entrée/i], [404, /actor/i]] as const) {
        globalThis.fetch = async () => Response.json({ error: { message: `Provider fixture reason: daily limit. ${token} ${encodeURIComponent(token)} https://api.apify.com/private?token=hidden-url-secret Bearer hidden-bearer-secret apiKey=hidden-key-secret apify_api_hidden-secret <script>bad</script>\u0000\n${"x".repeat(900)}` } }, { status });
        await assert.rejects(discoveryApi("acts/fixture", token), (error: any) => {
          assert.match(error.message, new RegExp(`^Apify HTTP ${status}\\.`));
          assert.match(error.message, reason);
          assert.equal(error.status, status);
          assert.ok(!error.message.includes("Provider fixture reason"));
          assert.ok(!error.message.includes("Détail fournisseur"));
          for (const secret of [token, encodeURIComponent(token), "hidden-url-secret", "hidden-bearer-secret", "hidden-key-secret", "apify_api_hidden-secret", "https://", "<script>", "\u0000", "\n"]) assert.ok(!error.message.includes(secret), secret);
          assert.ok(error.message.length < 500);
          return true;
        });
      }
    });
    await t.test("non-JSON HTTP rejection still explains status", async () => {
      globalThis.fetch = async () => new Response("<html>private response</html>", { status: 402 });
      await assert.rejects(discoveryApi("acts/fixture", token), /HTTP 402\..*crédit/i);
    });
    await t.test("definite HTTP rejection releases own lock; 429, 500 and uncertain transport retain it", async () => {
      globalThis.fetch = async (url) => emailMetadataResponse(url);
      const plan = await planApifyDiscovery(args);
      for (const status of [400, 401, 402, 403, 404, 429, 500, 0]) {
        await setSetting("apifyPending", null);
        let posts = 0;
        globalThis.fetch = async (url, init) => {
          if (init?.method === "POST") {
            posts++;
            if (!status) throw Error(`transport failed ${token}`);
            return Response.json({ error: { message: "Provider fixture reason" } }, { status });
          }
          return emailMetadataResponse(url);
        };
        const definite = [400, 401, 402, 403, 404].includes(status);
        await assert.rejects(startApifyDiscovery(token, { ...args, planId: plan.planId, requestId: `reject-${status}` }), (error: any) => {
          assert.ok(!error.message.includes(token));
          assert.ok(!error.message.includes("Provider fixture reason"));
          assert.ok(!error.message.includes("Détail fournisseur"));
          if (status) {
            assert.equal(error.name, "ApifyHttpError");
            assert.equal(error.status, status);
            assert.match(error.message, new RegExp(`^Apify HTTP ${status}\\.`));
          }
          assert.equal(/verrou est conservé/.test(error.message), !definite);
          return true;
        });
        assert.equal(posts, 1);
        assert.equal((await getSetting("apifyPending", null)) === null, definite, String(status));
      }
    });
  } finally { globalThis.fetch = original; await db.close(); await rm(dir, { recursive: true, force: true }); }
});
