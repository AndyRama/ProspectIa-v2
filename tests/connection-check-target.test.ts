import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Le diagnostic sans collecte cible le fournisseur de recherche avec exclusions", async () => {
  const source = await readFile(new URL("../scripts/check-connections.ts", import.meta.url), "utf8");
  assert.match(source, /import \{ verifyApifyDiscovery \} from "\.\.\/server\/services\/apifyDiscovery"/);
  assert.match(source, /verifyApifyDiscovery\(await secret\("apifyKey"\)\)/);
  assert.doesNotMatch(source, /startApify|startApifyDiscovery/);
});
