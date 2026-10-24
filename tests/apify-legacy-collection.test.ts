import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

test("Une ancienne collecte déjà payée garde ses 37 fiches sans nouveau lancement", async () => {
  const dir = await mkdtemp(
    path.join(tmpdir(), "prospectai-legacy-collection-"),
  );
  process.env.DATA_DIR = dir;
  const { db, setSetting } = await import("../server/db");
  const { collectApify } = await import("../server/services/apify");
  const original = globalThis.fetch;
  const rows = Array.from({ length: 37 }, (_, i) => ({
    title: `Entreprise fictive ${i}`,
    placeId: "ChIJ" + String(i).padStart(23, "0"),
  }));
  globalThis.fetch = async (url, init) => {
    assert.equal(init?.method ?? "GET", "GET");
    return Response.json(
      String(url).includes("/datasets/")
        ? rows
        : {
            data: {
              id: "legacy-fixture-run",
              actId: "nwua9Gu5YrADL7ZDj",
              status: "SUCCEEDED",
              finishedAt: "2026-01-01T00:00:00Z",
              defaultDatasetId: "legacy-fixture-data",
              usageTotalUsd: 0.1,
            },
          },
    );
  };
  try {
    await setSetting("apifyPending", {
      runId: "legacy-fixture-run",
      city: "Ville fictive",
      engine: "website",
      max: 37,
    });
    const result = await collectApify("fixture-token");
    assert.equal(result.items?.length, 37);
  } finally {
    globalThis.fetch = original;
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
