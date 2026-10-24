import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import type { Prospect, Search } from "../server/types";

const dir = await mkdtemp("/opt/data/cache/scratch/apify-identity-");
Object.assign(process.env, { DATA_DIR: dir, TURSO_DATABASE_URL: "", TURSO_AUTH_TOKEN: "", DOTENV_CONFIG_PATH: "/dev/null", VERCEL: "" });
const { db, setSetting, list } = await import("../server/db");
const { collectApify } = await import("../server/services/apify");
const { persistResults, resolveSearch } = await import("../server/searches");
const { sameEstablishment } = await import("../server/services/identity");
after(async () => { await db.close(); await rm(dir, { recursive: true, force: true }); });

async function collect(rows: Record<string, unknown>[]) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url: any, init?: RequestInit) => {
    assert.notEqual(init?.method, "POST", "No paid run may be started");
    if (String(url).includes("/datasets/")) return Response.json(rows.map(row => ({ name: "Same chain", city: "Paris", website: "https://fixture-chain.example/", ...row })));
    if (String(url).includes("/actor-runs/")) return Response.json({ data: { id: "fixture", actId: "uU8ybh0dgvI68Q3o2", status: "SUCCEEDED", finishedAt: "2026-01-01T00:00:00Z", defaultDatasetId: "fixture", usageTotalUsd: 0 } });
    throw Error("Network blocked: " + url);
  };
  try {
    await setSetting("apifyPending", { mode: "discovery", actorSlug: "benthepythondev~google-maps-business-scraper", actorId: "uU8ybh0dgvI68Q3o2", runId: "fixture", city: "Paris", activity: "restaurant", engine: "website", max: 25 });
    const result = await collectApify("fixture");
    assert.ok(result.items);
    return result.items;
  } finally { globalThis.fetch = original; }
}

async function persistAndReopen(rows: Record<string, unknown>[], expected: number) {
  await db.execute("DELETE FROM prospects");
  await db.execute("DELETE FROM searches");
  const items = await collect(rows);
  assert.equal(new Set(items.map(p => p.id)).size, items.length);
  const saved = await persistResults(items, { city: "Paris", activity: "restaurant", engine: "website", runId: "fixture" }, "Apify", 0);
  assert.equal(saved.search.count, expected, "persist must respect Google identities");
  await db.close();
  assert.equal((await list<Prospect>("prospects")).length, expected, "startup consolidation must respect identities");
  const searches = await list<Search>("searches");
  assert.equal((await resolveSearch(searches[0])).prospects.length, expected);
}

test("distinct validated Maps branch URLs survive persistence and reopen", async () => {
  await persistAndReopen([{ url: "https://www.google.com/maps/place/branch-1" }, { url: "https://www.google.com/maps/place/branch-2" }], 2);
});

test("decimal CID strings beyond Number precision remain distinct after reopen", async () => {
  await persistAndReopen([{ cid: "9007199254740992" }, { cid: "9007199254740993" }], 2);
});

test("Maps URL language, tracking, fragment and trailing slash variants merge after reopen", async () => {
  await persistAndReopen([
    { url: "https://www.google.com/maps/place/branch-1/?hl=fr&utm_source=fixture#reviews" },
    { url: "https://www.google.com/maps/place/branch-1?hl=en&utm_source=other" },
  ], 1);
});

test("known CID in Maps URLs takes priority over different display paths", async () => {
  await persistAndReopen([
    { url: "https://www.google.com/maps?cid=9007199254740993&hl=fr" },
    { url: "https://www.google.com/maps/place/Translated-name?cid=9007199254740993&hl=en" },
  ], 1);
});

test("known place ID reconciles explicit field with localized Maps data path", async () => {
  await persistAndReopen([
    { place_id: "ChIJ" + "a".repeat(23), url: "https://www.google.com/maps/place/Original?hl=fr" },
    { url: "https://www.google.com/maps/place/Translated/data=!4m2!3m1!1sChIJ" + "a".repeat(23) + "?hl=en" },
  ], 1);
});

test("feature ID in Maps data reconciles translated paths before URL fallback", async () => {
  await persistAndReopen([
    { feature_id: "0xabc:0x123", url: "https://www.google.com/maps/place/Original" },
    { url: "https://www.google.fr/maps/place/Traduit/data=!4m2!3m1!1s0xabc%3A0x123?hl=fr" },
  ], 1);
});

test("explicit place ID reconciles Maps query_place_id selector", async () => {
  await persistAndReopen([
    { place_id: "ChIJ" + "b".repeat(23) },
    { name: "Translated brand", url: "https://www.google.com/maps/search/?api=1&query=Translated&query_place_id=ChIJ" + "b".repeat(23) },
  ], 1);
});

const genericBusinesses = [
  { name: "Alpha fixture", city: "Paris", address: "1 rue Alpha", url: "https://www.google.com/maps" },
  { name: "Beta fixture", city: "Paris", address: "2 rue Beta", url: "https://www.google.com/maps" },
];

for (const separateRuns of [false, true]) {
  test(`generic Maps URLs preserve distinct businesses through ${separateRuns ? "successive runs" : "one dataset"}, persistence and reopen`, async () => {
    await db.execute("DELETE FROM prospects");
    await db.execute("DELETE FROM searches");
    const savedSearches: Search[] = [];
    const collectedIds: string[] = [];
    const batches = separateRuns ? genericBusinesses.map(row => [row]) : [genericBusinesses];
    for (const [index, batch] of batches.entries()) {
      const items = await collect(batch);
      assert.equal(items.length, batch.length, "collection must not drop businesses sharing a generic URL");
      collectedIds.push(...items.map(item => item.id));
      for (const item of items) assert.match(item.id, /^apify-[a-f0-9]{64}$/, "generic URL must use contextual SHA-256 fallback");
      const saved = await persistResults(items, { city: "Paris", activity: "restaurant", engine: "website", runId: `generic-${index}` }, "Apify", 0);
      savedSearches.push(saved.search);
      await db.close();
      assert.equal((await list<Prospect>("prospects")).length, collectedIds.length, "no business may disappear after reopen");
    }
    assert.equal(new Set(collectedIds).size, 2, "distinct contextual identities must survive successive runs");
    const visible = await list<Prospect>("prospects");
    assert.deepEqual(visible.map(p => [p.name, p.address]).sort(), genericBusinesses.map(p => [p.name, p.address]).sort());
    for (const [index, search] of savedSearches.entries()) {
      const resolved = await resolveSearch(search);
      assert.deepEqual(resolved.prospects.map(p => p.name).sort(), batches[index].map(p => p.name).sort(), "history must still resolve the original businesses");
    }
    for (const row of genericBusinesses) {
      const [recollected] = await collect([{ ...row, url: "https://www.google.com/maps/?hl=fr&utm_source=fixture#reviews" }]);
      assert.equal(recollected.id, visible.find(p => p.name === row.name)?.id, "generic presentation variants must reuse contextual fallback");
    }
    const [otherAddress] = await collect([{ ...genericBusinesses[0], address: "3 rue Alpha" }]);
    const [otherCity] = await collect([{ ...genericBusinesses[0], city: "Lyon" }]);
    assert.ok(!collectedIds.includes(otherAddress.id), "fallback must include address");
    assert.ok(!collectedIds.includes(otherCity.id), "fallback must include city");
  });
}

test("generic Maps landing page is not an establishment identity", async () => {
  const [base] = await collect([{ url: "https://www.google.com/maps" }]);
  assert.equal(sameEstablishment(base, { ...base, id: "other", name: "Other business", city: "Lyon" }), false);
});

test("existing SIRET and placeId precedence remains unchanged", async () => {
  const [base] = await collect([{ feature_id: "0xabc:0x1" }]);
  const withFields = (id: string, values: Record<string, string>): Prospect => ({
    ...base, id, fields: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value, source: "fixture", collectedAt: "2026-01-01" }])),
  });
  const first = withFields("a", { siret: "12345678900011", placeId: "same-place", featureId: "0xabc:0x1" });
  assert.equal(sameEstablishment(first, withFields("b", { siret: "12345678900022", placeId: "same-place", featureId: "0xabc:0x1" })), false);
  assert.equal(sameEstablishment(first, withFields("b", { siret: "12345678900011", placeId: "other-place" })), true);
  assert.equal(sameEstablishment(withFields("a", { placeId: "one", cid: "123" }), withFields("b", { placeId: "two", cid: "123" })), false);
  assert.equal(sameEstablishment(withFields("a", { placeId: "one" }), withFields("b", { placeId: "one", googleMaps: "https://www.google.com/maps/place/different" })), true);
  assert.equal(sameEstablishment(withFields("a", {}), withFields("b", {})), true, "legacy name/city/site fallback is preserved");
});

test("known explicit Google identities override URL variants but not their own conflicts", async () => {
  const [base] = await collect([{ feature_id: "0xabc:0x1", cid: "9007199254740993", url: "https://www.google.com/maps/place/Original?hl=fr" }]);
  const field = (value: string) => ({ value, source: "fixture", collectedAt: "2026-01-01" });
  const variant = { ...base, id: "variant", name: "Translated brand", fields: { ...base.fields, googleMaps: field("https://www.google.fr/maps/place/Translated?hl=en&utm_source=fixture") } };
  assert.equal(sameEstablishment(base, variant), true);
  assert.equal(sameEstablishment(base, { ...variant, fields: { ...variant.fields, cid: field("9007199254740992") } }), false);
  const featureOnly = { ...base, fields: { featureId: field("0xabc:0x1"), googleMaps: base.fields.googleMaps } };
  assert.equal(sameEstablishment(featureOnly, { ...variant, fields: { featureId: field("0xABC:0x1"), googleMaps: variant.fields.googleMaps } }), true);
  assert.equal(sameEstablishment(featureOnly, { ...variant, fields: { featureId: field("0xabc:0x2"), googleMaps: base.fields.googleMaps } }), false);
});

test("CID values are kept as exact strings and unsafe numeric provider values are rejected, never repaired", async () => {
  const [item] = await collect([{ cid: "9007199254740993" }]);
  assert.equal(item.fields.cid.value, "9007199254740993");
  assert.equal(item.id, "apify-9007199254740993");
  await assert.rejects(collect([{ cid: 9007199254740992 }]), /Identité Google Apify invalide/);
});

test("untrusted Maps-like URLs cannot create a strong identity", async () => {
  const [base] = await collect([{ feature_id: "0xabc:0x1" }]);
  for (const url of ["https://google.com.evil.example/maps/place/A", "http://www.google.com/maps/place/A", "https://user@www.google.com/maps/place/A", "https://www.google.com/maps-not-real/place/A", "not a URL"]) {
    const fields = { googleMaps: { value: url, source: "fixture", collectedAt: "2026-01-01" } };
    assert.equal(sameEstablishment({ ...base, fields }, { ...base, id: "other", name: "Other brand", fields }), false, url);
  }
});

test("unknown Maps query selectors are retained conservatively", async () => {
  await persistAndReopen([
    { url: "https://www.google.com/maps/place/branch?branch_selector=1" },
    { url: "https://www.google.com/maps/place/branch?branch_selector=2" },
  ], 2);
});

test("distinct feature IDs survive same name/city/site collection, persistence and reopen without addresses", async () => {
  await persistAndReopen([{ feature_id: "0xabc:0x1" }, { feature_id: "0xabc:0x2" }], 2);
});
