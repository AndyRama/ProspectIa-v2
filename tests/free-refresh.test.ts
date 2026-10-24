import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { makeQuery, queryKey } from "../server/searchQuery";
import type { Prospect, SearchQuery } from "../server/types";

test("réserve vide : avertissements, réessai explicite gratuit, UUID idempotent et trois lots locaux", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "prospectai-refresh-"));
  process.env.DATA_DIR = dir; process.env.TURSO_DATABASE_URL = ""; process.env.VERCEL = "";
  const { db, list, getSetting, setSetting } = await import("../server/db");
  const { discoverNext } = await import("../server/services/discovery");
  const original = globalThis.fetch;
  let phase = "empty"; const calls: string[] = [];
  globalThis.fetch = async (input: any) => {
    const url = String(input); calls.push(url); assert.ok(!url.includes("apify"));
    if (url.includes("nominatim")) {
      if (phase === "timeout") throw Error("timeout gratuit");
      return Response.json([{ lat: "44.84", lon: "-0.58", address: { country_code: "fr" } }]);
    }
    if (url.includes("recherche-entreprises")) return Response.json({ results: [] });
    if (phase === "empty") return new Response("indisponible", { status: 503 });
    return Response.json({ elements: Array.from({ length: phase === "more" ? 112 : 75 }, (_, i) => ({ type: "node", id: i + 1, tags: { name: `Atelier Delta ${i}`, craft: "carpenter", "addr:street": `${i + 1} rue Neuve`, "addr:city": "Bordeaux" } })) });
  };
  const args = { city: "Bordeaux", activity: "artisan", keyword: "menuisier", paid: false, engine: "website" as const, max: 25, requestId: "initial" };
  try {
    const initial = await discoverNext(args);
    assert.equal(initial.exhausted, true);
    assert.ok("warnings" in initial && initial.warnings.some((w: string) => /OpenStreetMap/.test(w)));
    assert.ok("provider" in initial && /Sirene/.test(initial.provider));
    const before = calls.length;
    await discoverNext({ ...args, requestId: "ordinary" });
    assert.equal(calls.length, before, "aucune recharge automatique");
    phase = "full";
    await db.close(); // Le reçu UUID vide survit au redémarrage.
    await discoverNext({ ...args, refreshPool: true });
    assert.equal(calls.length, before, "UUID vide déjà servi ne recharge pas");
    const ids = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const result = await discoverNext({ ...args, requestId: `fresh-${i}`, refreshPool: true });
      assert.ok("search" in result); if (!("search" in result)) throw Error("lot absent");
      assert.equal(result.search!.cost, 0); assert.equal(result.prospects.length, 25);
      result.prospects.forEach((p) => ids.add(p.id));
    }
    assert.equal(ids.size, 75);
    assert.equal(calls.filter((u) => u.includes("nominatim")).length, 2, "remaining inédit conservé");
    const previousCalls = calls.length;
    await discoverNext({ ...args, requestId: "fresh-0", refreshPool: true });
    assert.equal(calls.length, previousCalls);
    assert.equal((await list("searches")).length, 3);
    const history = await list("searches");
    phase = "timeout";
    const failure = await discoverNext({ ...args, requestId: "timeout", refreshPool: true });
    assert.equal(failure.exhausted, true);
    assert.ok("warnings" in failure && failure.warnings.some((w) => /timeout gratuit/.test(w)));
    assert.deepEqual(await list("searches"), history, "l’historique ne change pas pendant une panne");
    const failureCalls = calls.length;
    await discoverNext({ ...args, requestId: "timeout", refreshPool: true });
    assert.equal(calls.length, failureCalls);
    const key = "discoveryPool:" + createHash("sha256").update(queryKey(makeQuery(args))).digest("hex");
    type Pool = { remaining: Prospect[]; provider: string; warnings: string[]; createdAt: string; query: SearchQuery };
    const pool = await getSetting<Pool | null>(key, null); assert.ok(pool);
    await setSetting(key, { ...pool, remaining: await list<Prospect>("prospects") });
    const allKnownPool = await getSetting<Pool>(key, pool);
    phase = "timeout";
    await discoverNext({ ...args, requestId: "timeout-preserves-pool", refreshPool: true });
    assert.deepEqual(await getSetting(key, null), allKnownPool, "panne : réserve ancienne inchangée");
    phase = "full";
    const beforeKnownRefresh = calls.length;
    const knownOnly = await discoverNext({ ...args, requestId: "all-known", refreshPool: true });
    assert.equal(knownOnly.prospects.length, 0);
    assert.ok(calls.length > beforeKnownRefresh, "réserve non vide mais entièrement connue : recharge permise");
    assert.deepEqual(await list("searches"), history);
    phase = "more";
    const fresh = await discoverNext({ ...args, requestId: "refill-with-known", refreshPool: true });
    assert.equal(fresh.prospects.length, 25);
    assert.ok(fresh.prospects.every((p) => !ids.has(p.id)), "anciens exclus aussi pendant la recharge");
    assert.equal(fresh.remaining, 12);
    await setSetting(key + ":lock", { requestId: "other-instance", expiresAt: Date.now() + 60000 });
    const beforeLock = calls.length;
    await assert.rejects(discoverNext({ ...args, requestId: "locked", refreshPool: true }), /déjà en préparation/);
    assert.equal(calls.length, beforeLock);
    await setSetting(key + ":lock", { requestId: "stale-instance", expiresAt: Date.now() - 1 });
    await discoverNext({ ...args, requestId: "recovered", refreshPool: true });
    assert.equal(await getSetting(key + ":lock", "missing"), null);
    const execute = db.execute;
    db.execute = async (statement) => {
      if (String(typeof statement === "string" ? statement : statement.sql).includes("SELECT data FROM prospects")) throw Error("DB catalogue inaccessible");
      return execute(statement);
    };
    const beforeDbFailure = calls.length;
    try { await assert.rejects(discoverNext({ ...args, requestId: "db-error", refreshPool: true }), /DB catalogue inaccessible/); }
    finally { db.execute = execute; }
    assert.equal(calls.length, beforeDbFailure);
    assert.equal(await getSetting(key + ":lock", "missing"), null);
    db.execute = async (statement) => {
      if (typeof statement !== "string" && statement.sql === "INSERT OR REPLACE INTO settings VALUES(?,?)" && Array.isArray(statement.args) && statement.args[0] === key) throw Error("DB réserve non enregistrable");
      return execute(statement);
    };
    try { await assert.rejects(discoverNext({ ...args, requestId: "db-pool-error", refreshPool: true }), /DB réserve non enregistrable/); }
    finally { db.execute = execute; }
    assert.equal(await getSetting(key + ":lock", "missing"), null);
    const fixtureFetch = globalThis.fetch;
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    globalThis.fetch = async (input: any, init?: any) => {
      if (String(input).includes("nominatim")) { entered(); await gate; }
      return fixtureFetch(input, init);
    };
    const countBeforeConcurrent = calls.length;
    const one = discoverNext({ ...args, requestId: "concurrent-same", refreshPool: true });
    const two = discoverNext({ ...args, requestId: "concurrent-same", refreshPool: true });
    try {
      await started;
      await assert.rejects(discoverNext({ ...args, requestId: "concurrent-other", refreshPool: true }), /déjà en préparation/);
    } finally { release(); }
    assert.deepEqual(await one, await two);
    assert.equal(calls.length - countBeforeConcurrent, 3, "une seule collecte partagée pour le même UUID");
  } finally { globalThis.fetch = original; await db.close(); await rm(dir, { recursive: true, force: true }); }
});
