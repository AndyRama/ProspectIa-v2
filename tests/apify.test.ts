import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
test("Contrat Apify : build vérifié, budget, lancement unique, normalisation et coût réel", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "prospectai-apify-"));
  process.env.DATA_DIR = dir;
  const { startApify, collectApify, acknowledgeApify, verifyApify } =
    await import("../server/services/apify");
  const { db, getSetting } = await import("../server/db");
  const original = globalThis.fetch;
  const calls: { url: string; body: any }[] = [];
  globalThis.fetch = async (url: any, init?: RequestInit) => {
    const u = String(url);
    calls.push({
      url: u,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    let data: any;
    if (u.endsWith("/builds/default"))
      data = {
        data: {
          buildNumber: "0.14.773",
          inputSchema: JSON.stringify({
            properties: {
              placeIds: {},
              searchStringsArray: {},
              locationQuery: {},
              maxCrawledPlacesPerSearch: {},
              maxReviews: {},
              maxImages: {},
              scrapeContacts: {},
              maximumLeadsEnrichmentRecords: {},
            },
          }),
        },
      };
    else if (u.includes("/runs?")) data = { data: { id: "runTest123456789" } };
    else if (u.includes("actor-runs/"))
      data = {
        data: {
          id: "runTest123456789",
          status: "SUCCEEDED",
          actId: "nwua9Gu5YrADL7ZDj",
          finishedAt: "2026-01-01T10:00:00Z",
          defaultDatasetId: "datasetTest",
          usageTotalUsd: 0.182,
        },
      };
    else if (u.includes("/datasets/"))
      data = [
        {
          title: "Entreprise de test",
          placeId: "ChIJ" + "a".repeat(23),
          website: "https://example.com",
          emails: ["contact@atelier.fr"],
          phone: "+33123456789",
          city: "Ville test",
          location: { lat: 48, lng: 2 },
          categoryName: "Restaurant",
          totalScore: 4.2,
          reviewsCount: 32,
          imageUrl: "https://example.com/photo.png",
          permanentlyClosed: true,
          url: "https://maps.google.com/?cid=test",
          instagrams: ["https://instagram.com/exemple"],
        },
      ];
    else data = { data: { pricingInfos: [{ pricingModel: "PAY_PER_EVENT", minimalMaxTotalChargeUsd: 0.5 }] } };
    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    await assert.rejects(() => verifyApify(""), /clé Apify/);
    const args = {
      city: "Ville test",
      activity: "restaurant",
      keyword: "",
      max: 25,
      budget: 1,
      engine: "website" as const,
      placeIds: ["ChIJ" + "a".repeat(23)],
    };
    await assert.rejects(() => startApify('token-test', { ...args, max:26 }), /Plafond/);
    await assert.rejects(() => startApify('token-test', { ...args, budget:11 }), /Plafond/);
    await assert.rejects(() => startApify("token-test", { ...args, budget: 0.1 }), /budget minimal/);
    assert.equal(calls.filter((c) => c.url.includes("/runs?")).length, 0);
    const first = startApify("token-test", args);
    await assert.rejects(() => startApify("token-test", { ...args, placeIds: ["ChIJ" + "c".repeat(23)] }), /déjà en cours/);
    assert.equal(await first, "runTest123456789");
    const launch = calls.find((c) => c.url.includes("/runs?"))!;
    const url = new URL(launch.url);
    assert.equal(url.searchParams.get("build"), "0.14.773");
    assert.equal(url.searchParams.get("maxTotalChargeUsd"), "1");
    assert.equal(url.searchParams.get("restartOnError"), "false");
    assert.equal(launch.body.maxCrawledPlacesPerSearch, 1);
    assert.deepEqual(launch.body.placeIds, args.placeIds);
    assert.equal(launch.body.searchStringsArray, undefined);
    assert.equal(launch.body.locationQuery, undefined);
    assert.equal(launch.body.maxReviews, 0);
    assert.equal(launch.body.maximumLeadsEnrichmentRecords, 0);
    assert.equal(launch.body.scrapeContacts, false);
    const results = await collectApify("token-test");
    assert.equal(results.pending, false);
    assert.equal(results.cost, 0.182);
    assert.equal(results.items?.[0].id, "apify-" + args.placeIds[0]);
    assert.equal(results.items?.[0].fields.email.source, "Apify · Google Maps");
    assert.ok(results.items?.[0].fields.email.collectedAt);
    assert.equal(
      results.items?.[0].fields.closure.value,
      "Fermé définitivement",
    );
    assert.equal(results.items?.[0].photos[0], "https://example.com/photo.png");
    const { persistResults } = await import("../server/searches");
    const firstSave = await persistResults(results.items!, results.args, "Apify", results.cost!);
    const secondSave = await persistResults(results.items!, results.args, "Apify", results.cost!);
    assert.equal(secondSave.search.id, firstSave.search.id);
    assert.equal(secondSave.cached, true);
    assert.equal((await db.execute("SELECT COUNT(*) AS n FROM searches")).rows[0].n, 1);
    await acknowledgeApify();
    assert.equal(await getSetting("apifyPending", null), null);
    const beforeRepeat = calls.length;
    await assert.rejects(() => startApify("token-test", args), /Paiement bloqué/);
    assert.equal(calls.length, beforeRepeat);
    await assert.rejects(() => startApify("token-test", { ...args, placeIds: undefined }), /par mot-clé sont désactivées/);
    assert.equal(calls.length, beforeRepeat);
    globalThis.fetch = async (url: any) => {
      if (String(url).includes("/runs?")) throw Error("Network timeout fixture-sensitive-token");
      if (String(url).endsWith("/builds/default"))
        return new Response(
          JSON.stringify({
            data: {
              buildNumber: "0.14.773",
              inputSchema: {
                properties: {
                  placeIds: {},
              searchStringsArray: {},
                  locationQuery: {},
                  maxCrawledPlacesPerSearch: {},
                },
              },
            },
          }),
        );
      return new Response(
        JSON.stringify({
          data: { pricingInfos: [{ pricingModel: "PAY_PER_EVENT" }] },
        }),
      );
    };
    await assert.rejects(
      () => startApify("token-test", { ...args, placeIds: ["ChIJ" + "b".repeat(23)] }),
      (e) => /verrou est conservé/.test(String(e)) && !String(e).includes('fixture-sensitive-token'),
    );
    assert.ok(await getSetting<any>("apifyPending", null));
    await assert.rejects(() => startApify("token-test", { ...args, placeIds: ["ChIJ" + "c".repeat(23)] }), /déjà en cours/);
  } finally {
    globalThis.fetch = original;
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
