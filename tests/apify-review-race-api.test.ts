import { businessPricing, businessMetadataResponse } from './fixtures/apify-business';
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";

test("APIFY-001 HTTP contract: two concurrent POSTs, empty completed poll, late caller receives cached search", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "apify-review-http-"));
  Object.assign(process.env, {
    DATA_DIR: dir,
    DOTENV_CONFIG_PATH: "/dev/null",
    TURSO_DATABASE_URL: "",
    TURSO_AUTH_TOKEN: "",
    VERCEL: "",
    PORT: "0",
    APP_PASSWORD: "fixture-password-long-enough",
    APIFY_TOKEN: "",
    DATA_ENCRYPTION_KEY: "f".repeat(64),
  });
  let server!: Server;
  const listen = express.application.listen,
    realFetch = globalThis.fetch;
  (express.application as any).listen = function (...args: any[]) {
    server = (listen as any).apply(this, args);
    return server;
  };
  let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>((r) => (entered = r)),
    held = new Promise<void>((r) => (release = r));
  let posts = 0,
    actorReads = 0;
  const props = Object.fromEntries(
    Object.entries({
      scrapeContacts: "boolean", mode: "string",
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
    }).map(([key, type]) => [
      key,
      { type, ...(type === "array" ? { items: { type: "string" } } : {}) },
    ]),
  );
  // Only our local server uses real HTTP; every external URL is intercepted.
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.startsWith("http://127.0.0.1:")) return realFetch(url, init);
    assert.ok(u.startsWith("https://api.apify.com/v2/"));
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
      if (++actorReads === 2) {
        entered();
        await held;
      }
      return Response.json({
        data: {
          id: "uU8ybh0dgvI68Q3o2",
          currentPricingInfo: { ...businessPricing },
        },
      });
    }
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
    if (u.includes("/datasets/")) return Response.json([]);
    throw Error("Network blocked: " + u);
  };
  const { db, getSetting } = await import("../server/db");
  try {
    await import("../server/index");
    express.application.listen = listen;
    if (!server.listening)
      await new Promise<void>((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    let cookie = "";
    const post = (endpoint: string, body: any) =>
      fetch(base + endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify(body),
      });
    const login = await post("/api/auth/login", {
      password: process.env.APP_PASSWORD,
    });
    assert.equal(login.status, 200);
    cookie = login.headers.get("set-cookie")!.split(";")[0];
    const { saveSecret } = await import("../server/secrets");
    await saveSecret("apifyKey", "fixture-never-real");
    const args = {
      city: "Paris",
      activity: "restaurant",
      keyword: "",
      engine: "website",
      max: 25,
      budget: 1,
    };
    const plan = await (await post("/api/apify/discovery/plan", args)).json();
    const input = {
      ...args,
      planId: plan.planId,
      requestId: "40000000-0000-4000-8000-000000000088",
      confirmed: true,
    };
    const slow = post("/api/apify/discovery/start", input);
    await waiting;
    const fast = await post("/api/apify/discovery/start", input);
    assert.equal(fast.status, 200);
    assert.deepEqual(await fast.json(), {
      pending: true,
      runId: "fixtureRun1",
    });
    const poll = await post("/api/apify/poll", {});
    assert.equal(poll.status, 200);
    const saved = await poll.json();
    assert.equal(saved.search.count, 0);
    assert.equal(saved.search.requestId, input.requestId);
    release();
    const late = await slow;
    assert.equal(late.status, 200);
    assert.deepEqual(await late.json(), {
      search: saved.search,
      prospects: [],
      cached: true,
    });
    assert.equal(posts, 1);
    assert.equal(await getSetting("apifyPending", null), null);
  } finally {
    release();
    express.application.listen = listen;
    globalThis.fetch = realFetch;
    if (server)
      await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
