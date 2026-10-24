import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("Le plan payant respecte le moteur, les critères effectifs et le mot-clé vide", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "prospectai-query-scope-"));
  process.env.DATA_DIR = dir;
  const service = await import("../server/services/apifyDiscovery");
  const { db } = await import("../server/db");
  try {
    const args = {
      city: "Paris",
      activity: "all",
      keyword: "",
      max: 25,
      budget: 1,
      engine: "menu" as const,
    };
    const menu = await service.planApifyDiscovery(args);
    assert.equal(menu.query, "restaurants");
    assert.equal(
      (await service.planApifyDiscovery({ ...args, engine: "voice" })).query,
      "artisans",
    );
    assert.equal(
      (await service.planApifyDiscovery({ ...args, engine: "website" })).query,
      "entreprises",
    );
    assert.equal(
      (
        await service.planApifyDiscovery({
          ...args,
          activity: "artisan",
          keyword: "  ",
        })
      ).query,
      "artisans",
    );
    const keyword = await service.planApifyDiscovery({
      ...args,
      keyword: "plombier",
      engine: "website",
    });
    assert.equal(keyword.query, "plombier");
    assert.notEqual(
      keyword.planId,
      (
        await service.planApifyDiscovery({
          ...args,
          keyword: "plombier",
          engine: "voice",
        })
      ).planId,
    );
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
