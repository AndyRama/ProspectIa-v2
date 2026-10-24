import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// No provider request can escape this fixture; DB environment precedes every import.
const dir = await mkdtemp(path.join(tmpdir(), "apify-review-regressions-"));
process.env.DATA_DIR = dir;
process.env.TURSO_DATABASE_URL = "";
process.env.TURSO_AUTH_TOKEN = "";
process.env.DOTENV_CONFIG_PATH = "/dev/null";
process.env.VERCEL = "";
const { db, getSetting, setSetting } = await import("../server/db");
const { planApifyDiscovery, startApifyDiscovery } = await import(
  "../server/services/apifyDiscovery"
);
const { collectApify, acknowledgeApify, recoverApify } = await import(
  "../server/services/apify"
);
const { persistResults } = await import("../server/searches");
const props = Object.fromEntries(
  Object.entries({
    mode: "string",
    query: "string",
    location: "string",
    onlyNew: "boolean",
    monitorId: "string",
    excludePlaceIds: "array",
    excludePlaceUrls: "array",
    maxResults: "integer",
    language: "string",
    includeReviews: "boolean",
    includePhotos: "boolean",
    includeLeadScore: "boolean",
    debugMode: "boolean",
  }).map(([k, type]) => [
    k,
    { type, ...(type === "array" ? { items: { type: "string" } } : {}) },
  ]),
);
const args = {
  city: "Paris",
  activity: "restaurant",
  keyword: "",
  max: 25,
  budget: 1,
  engine: "website" as const,
};
after(async () => {
  await db.close();
  await rm(dir, { recursive: true, force: true });
});

test("APIFY-001: delayed duplicate after empty completion returns durable saved response, never POSTs twice", async () => {
  const original = globalThis.fetch;
  let posts = 0,
    actorReads = 0;
  let entered!: () => void, release!: () => void;
  const waiting = new Promise<void>((r) => (entered = r)),
    held = new Promise<void>((r) => (release = r));
  globalThis.fetch = async (url: any, init?: RequestInit) => {
    const u = String(url);
    if (init?.method === "POST") {
      posts++;
      return Response.json({ data: { id: "fixtureRun" + posts } });
    }
    if (u.includes("/builds/default"))
      return Response.json({
        data: {
          buildNumber: "1.0.32",
          actorDefinition: { input: { properties: props } },
        },
      });
    if (u.includes("/acts/")) {
      if (++actorReads === 1) {
        entered();
        await held;
      }
      return Response.json({
        data: {
          id: "uU8ybh0dgvI68Q3o2",
          currentPricingInfo: { pricingModel: "PAY_PER_EVENT" },
        },
      });
    }
    if (u.includes("/datasets/")) return Response.json([]);
    if (u.includes("actor-runs/"))
      return Response.json({
        data: {
          id: "fixtureRun1",
          actId: "uU8ybh0dgvI68Q3o2",
          status: "SUCCEEDED",
          finishedAt: new Date(Date.now() - 20000).toISOString(),
          defaultDatasetId: "dataset",
          usageTotalUsd: 0.001,
        },
      });
    throw Error("Network blocked: " + u);
  };
  try {
    const plan = await planApifyDiscovery(args),
      request = {
        ...args,
        planId: plan.planId,
        requestId: "40000000-0000-4000-8000-000000000099",
      };
    const slow = startApifyDiscovery("fixture", request);
    await waiting;
    assert.equal(await startApifyDiscovery("fixture", request), "fixtureRun1");
    const result = await collectApify("fixture");
    assert.equal(result.pending, false);
    const saved = await persistResults(
      result.items!,
      result.args,
      "Apify",
      result.cost!,
      [],
      { kind: "discovery", query: result.args.query },
    );
    await acknowledgeApify();
    await db.close();
    release();
    const duplicate = await slow;
    assert.equal(
      posts,
      1,
      "completion while GET validation was held must prevent a second paid POST",
    );
    assert.deepEqual(duplicate, {
      search: saved.search,
      prospects: [],
      cached: true,
    });
    assert.equal(
      await getSetting("apifyPending", null),
      null,
      "only the acquired duplicate lock is released",
    );
  } finally {
    release();
    globalThis.fetch = original;
  }
});

test("APIFY-002: distinct Google feature IDs and validated URLs survive collect then persistence; fallback is contextual", async () => {
  const original = globalThis.fetch;
  let rows: any[] = [];
  globalThis.fetch = async (url: any, init?: RequestInit) => {
    assert.notEqual(init?.method, "POST");
    const u = String(url);
    if (u.includes("/datasets/")) return Response.json(rows);
    if (u.includes("actor-runs/"))
      return Response.json({
        data: {
          id: "identityRun",
          actId: "uU8ybh0dgvI68Q3o2",
          status: "SUCCEEDED",
          finishedAt: new Date(Date.now() - 20000).toISOString(),
          defaultDatasetId: "dataset",
          usageTotalUsd: 0,
        },
      });
    throw Error("Network blocked: " + u);
  };
  try {
    for (const [kind, batch] of Object.entries({
      feature: [
        {
          name: "Same feature chain",
          city: "Paris",
          feature_id: "0xabc:0x111",
        },
        { name: "Same feature chain", city: "Lyon", feature_id: "0xabc:0x222" },
      ],
      url: [
        {
          name: "Same URL chain",
          city: "Paris",
          url: "https://www.google.com/maps/place/one",
        },
        {
          name: "Same URL chain",
          city: "Lyon",
          url: "https://www.google.com/maps/place/two",
        },
      ],
      fallback: [
        { name: "Same fallback chain", city: "Paris" },
        { name: "Same fallback chain", city: "Lyon" },
      ],
      ambiguous: [
        { name: "ab", address: "c", city: "Paris" },
        { name: "a", address: "bc", city: "Paris" },
      ],
    })) {
      rows = batch;
      await setSetting("apifyPending", {
        ...args,
        runId: "identityRun",
        mode: "discovery",
        actorSlug: "benthepythondev~google-maps-business-scraper",
        actorId: "uU8ybh0dgvI68Q3o2",
      });
      const result = await collectApify("fixture");
      assert.equal(result.items!.length, 2);
      assert.equal(
        new Set(result.items!.map((p) => p.id)).size,
        2,
        kind + " identity collision",
      );
      if (kind === "fallback" || kind === "ambiguous")
        for (const p of result.items!)
          assert.match(p.id, /^apify-[a-f0-9]{64}$/);
      const saved = await persistResults(
        result.items!,
        { ...result.args, runId: kind + "Run" },
        "Apify",
        0,
      );
      assert.equal(saved.search.count, 2, kind + " lost in persistence");
    }
    const placeId = "ChIJ" + "z".repeat(23);
    rows = [
      {
        name: "Place compatibility",
        place_id: placeId,
        cid: "123",
        feature_id: "0xabc:0x333",
      },
      { name: "CID compatibility", cid: "456", feature_id: "0xabc:0x444" },
    ];
    const compatible = await collectApify("fixture");
    assert.deepEqual(
      compatible.items!.map((p) => p.id),
      ["apify-" + placeId, "apify-456"],
    );
    rows = [
      {
        name: "Invalid URL",
        city: "Paris",
        url: "https://evil.example/maps/place/foo",
      },
    ];
    const invalid = await collectApify("fixture");
    assert.match(
      invalid.items![0].id,
      /^apify-[a-f0-9]{64}$/,
      "untrusted URL is never a persistent Google identity",
    );
  } finally {
    globalThis.fetch = original;
    await setSetting("apifyPending", null);
  }
});

test("APIFY-003: recovery proves every recorded INPUT field and refuses additional batch selectors without releasing lock", async (t) => {
  const original = globalThis.fetch;
  const input = {
    mode: "search",
    query: "restaurants",
    location: "Paris",
    onlyNew: true,
    monitorId: "fixture-monitor",
    maxResults: 25,
    language: "fr",
    includeReviews: false,
    includePhotos: false,
    includeLeadScore: false,
    debugMode: false,
    excludePlaceIds: ["123", "456"],
    excludePlaceUrls: [
      "https://www.google.com/maps/place/a",
      "https://www.google.com/maps/place/b",
    ],
  };
  const pending = {
    ...args,
    mode: "discovery",
    actorSlug: "benthepythondev~google-maps-business-scraper",
    actorId: "uU8ybh0dgvI68Q3o2",
    runId: null,
    startedAt: new Date().toISOString(),
    input,
  };
  let actual: any;
  globalThis.fetch = async (url: any, init?: RequestInit) => {
    assert.notEqual(init?.method, "POST");
    const u = String(url);
    if (u.includes("/records/INPUT")) return Response.json(actual);
    if (u.includes("users/me"))
      return Response.json({ data: { id: "fixture-owner" } });
    if (u.includes("actor-runs/"))
      return Response.json({
        data: {
          id: "differentRun",
          actId: pending.actorId,
          userId: "fixture-owner",
          startedAt: new Date(
            Date.parse(pending.startedAt) + 1000,
          ).toISOString(),
          defaultKeyValueStoreId: "store",
        },
      });
    throw Error("Network blocked: " + u);
  };
  try {
    const mutations: Record<string, any> = {
      includeReviews: true,
      includePhotos: true,
      includeLeadScore: true,
      debugMode: true,
      language: "en",
      query: "hotels",
      location: "Lyon",
      mode: "detail",
      onlyNew: false,
      monitorId: "other",
      maxResults: 24,
      excludePlaceIds: ["789"],
      excludePlaceUrls: [],
      queries: ["hotels"],
      locations: ["Lyon"],
      startUrls: [{ url: "https://www.google.com/maps/place/other" }],
      searchStringsArray: ["hotels Lyon"],
      placeIds: ["ChIJ" + "a".repeat(23)],
    };
    for (const [key, value] of Object.entries(mutations))
      await t.test("rejects " + key, async () => {
        await setSetting("apifyPending", pending);
        actual = { ...input, [key]: value };
        await assert.rejects(
          () => recoverApify("fixture", "differentRun"),
          /INPUT/,
        );
        assert.deepEqual(
          await getSetting("apifyPending", null),
          pending,
          "mismatch keeps original uncertain lock",
        );
      });
    await t.test("rejects missing explicitly recorded false", async () => {
      await setSetting("apifyPending", pending);
      actual = { ...input };
      delete actual.debugMode;
      await assert.rejects(
        () => recoverApify("fixture", "differentRun"),
        /INPUT/,
      );
      assert.deepEqual(await getSetting("apifyPending", null), pending);
    });
    await t.test(
      "compares future explicitly recorded object and ordered array fields",
      async () => {
        const extended = {
          ...pending,
          input: {
            ...input,
            recordedOptions: { allowed: false },
            orderedSteps: ["first", "second"],
          },
        };
        for (const change of [
          { recordedOptions: { allowed: true } },
          { orderedSteps: ["second", "first"] },
        ]) {
          await setSetting("apifyPending", extended);
          actual = { ...extended.input, ...change };
          await assert.rejects(
            () => recoverApify("fixture", "differentRun"),
            /INPUT/,
          );
          assert.deepEqual(await getSetting("apifyPending", null), extended);
        }
      },
    );
    await t.test(
      "accepts reordered exclusion sets and empty unused selectors",
      async () => {
        await setSetting("apifyPending", pending);
        actual = {
          ...input,
          excludePlaceIds: [...input.excludePlaceIds].reverse(),
          excludePlaceUrls: [...input.excludePlaceUrls].reverse(),
          queries: [],
          locations: [],
          startUrls: [],
          searchStringsArray: [],
          placeIds: [],
        };
        await recoverApify("fixture", "differentRun");
        assert.deepEqual(await getSetting("apifyPending", null), {
          ...pending,
          runId: "differentRun",
        });
      },
    );
  } finally {
    globalThis.fetch = original;
    await setSetting("apifyPending", null);
  }
});
