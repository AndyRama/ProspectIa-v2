import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Prospect } from "../server/types";

test("37 anciennes fiches exclues AVANT enrichissement ; trois lots inédits de 25, réserve persistante et aucun appel Apify", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "prospectai-discovery-"));
  process.env.DATA_DIR = dir; process.env.TURSO_DATABASE_URL = ""; process.env.VERCEL = "";
  const { db, saveProspect, list } = await import("../server/db");
  const { discoverNext } = await import("../server/services/discovery");
  const { planEnrichment } = await import("../server/services/apifyPlan");
  const original = globalThis.fetch, calls: string[] = [];
  const id = (i: number) => "ChIJ" + String(i).padStart(23, "0");
  const old: Prospect[] = Array.from({ length: 37 }, (_, i) => ({ id: "apify-" + id(i), name: `Atelier historique ${i}`, city: "Bordeaux", category: "Menuisier", address: `${i + 1} rue des Lilas 33000 Bordeaux France`, fields: { placeId: { value: id(i), source: "Apify · Google Maps", collectedAt: "2026-10-19" } }, lat: null, lng: null, website: "", email: "", phone: "", rating: null, reviews: null, selected: true, status: "Contacté", demo: false, webStatus: "Non vérifié", socials: {}, hours: "", photos: [], engine: "website" }));
  globalThis.fetch = async (input: any) => {
    const url = String(input); calls.push(url);
    assert.ok(!url.includes("apify"), "Aucun appel Apify autorisé pour découvrir un lot");
    const data = url.includes("nominatim") ? [{ lat: "44.84", lon: "-0.58", address: { country_code: "fr" } }]
      : url.includes("recherche-entreprises") ? { results: [] }
      : { elements: Array.from({ length: 112 }, (_, i) => ({ type: "node", id: i + 1, lat: 44.84, lon: -0.58, tags: { name: i < 37 ? `Atelier historique ${i}` : `Atelier inédit ${i}`, craft: "carpenter", "addr:housenumber": String(i + 1), "addr:street": "rue des Lilas", "addr:city": "Bordeaux" } })) };
    return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
  };
  try {
    for (const p of old) await saveProspect(p);
    const plan = await planEnrichment(old.map((p) => p.id));
    assert.equal(plan.candidates.length, 0); assert.equal(plan.excluded, 37); assert.equal(calls.length, 0);
    const args = { city: "Bordeaux", activity: "artisan", keyword: "menuisier", paid: false, engine: "website" as const, max: 25, requestId: "batch-1" };
    const seen = new Set<string>();
    for (let n = 1; n <= 3; n++) {
      const result = await discoverNext({ ...args, requestId: `batch-${n}` });
      assert.ok("search" in result); if (!("search" in result)) throw Error("Lot manquant");
      assert.equal(result.search!.count, 25); assert.equal(result.search!.newCount, 25); assert.equal(result.search!.cost, 0);
      for (const p of result.prospects) { assert.ok(!seen.has(p.id)); assert.ok(!p.name.startsWith("Atelier historique")); seen.add(p.id); }
      if (n === 1) { await db.close(); } // Reprise de la réserve sur disque.
    }
    assert.equal(seen.size, 75); assert.equal(calls.filter((url) => url.includes("overpass")).length, 1);
    const before = calls.length;
    const empty = await discoverNext({ ...args, requestId: "batch-4" });
    assert.equal(empty.exhausted, true); assert.equal(empty.prospects.length, 0); assert.equal(calls.length, before);
    const retry = await discoverNext(args); assert.ok("cached" in retry && retry.cached); assert.equal(calls.length, before);
    assert.equal((await list("prospects")).length, 112); assert.equal((await list("searches")).length, 3);
    const preserved = (await list<Prospect>("prospects")).filter((p) => p.id.startsWith("apify-"));
    assert.ok(preserved.every((p) => p.selected && p.status === "Contacté"));
  } finally { globalThis.fetch = original; await db.close(); await rm(dir, { recursive: true, force: true }); }
});
