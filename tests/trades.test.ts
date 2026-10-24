import { test } from "node:test";
import assert from "node:assert/strict";
import { trade, matchesKeyword } from "../server/services/trades";
import { searchFree } from "../server/services/freeSearch";

const jobs = [
  { variants: ["plombier", "plombiers", "plomberie", "plomberies"], craft: "plumber", naf: "43.22A" },
  { variants: ["électricien", "électriciens", "electricien", "électricité"], craft: "electrician", naf: "43.21A" },
  { variants: ["peintre", "peintres"], craft: "painter", naf: "43.34Z" },
  { variants: ["couvreur", "couvreurs"], craft: "roofer", naf: "43.91B" },
  { variants: ["menuisier", "menuisiers", "menuiserie", "menuiseries"], craft: "carpenter", naf: "43.32A" },
];

test("métiers français : variantes, filtres OSM et NAF, noms commerciaux neutres", () => {
  for (const job of jobs) for (const keyword of job.variants) {
    assert.equal(trade(keyword)?.naf, job.naf, keyword);
    assert.ok(trade(keyword)?.osm.includes(job.craft), keyword);
    assert.equal(matchesKeyword(keyword, "Établissements Delta", job.craft), true, keyword);
    assert.equal(matchesKeyword(keyword, "Établissements Delta", job.naf), true, keyword);
  }
});

test("métier attesté par catégorie, pas par simple nom ou sous-chaîne ; inconnu littéral", () => {
  assert.equal(matchesKeyword("menuisier", "Jean Menuisier", "bakery"), false);
  assert.equal(matchesKeyword("plombier", "Plombier & Fils", "restaurant"), false);
  assert.equal(matchesKeyword("plombier", "Delta", "plumbersnot"), false);
  assert.equal(matchesKeyword("menuisier", "Delta", "Menuiseries"), true);
  assert.equal(matchesKeyword("électricien", "Delta", "Électricité"), true);
  assert.equal(matchesKeyword("inconnu", "Les inconnus", "shop"), true);
  assert.equal(matchesKeyword("inconnu", "Delta", "plumber"), false);
  assert.equal(matchesKeyword("", "Delta", ""), true);
});

test("collecte gratuite des cinq métiers : craft et NAF acceptés sans mot métier dans le nom", async () => {
  const original = globalThis.fetch;
  try {
    for (const [index, job] of jobs.entries()) {
      const calls: string[] = [];
      globalThis.fetch = async (input: any) => {
        const url = String(input); calls.push(url); assert.ok(!url.includes("apify"));
        if (url.includes("nominatim")) return Response.json([{ lat: "48.85", lon: "2.35", address: { country_code: "fr" } }]);
        if (url.includes("recherche-entreprises")) return Response.json({ results: [{ siren: "123456789", nom_complet: "Entreprise Alpha", matching_etablissements: [{ siret: `1234567890000${index}`, adresse: "1 rue Alpha", libelle_commune: "Paris", activite_principale: job.naf, etat_administratif: "A" }] }] });
        return Response.json({ elements: [{ type: "node", id: index + 1, tags: { name: "Entreprise Beta", craft: job.craft, "addr:street": "2 rue Beta" } }] });
      };
      const result = await searchFree("Paris", "artisan", job.variants[0], 25, "website");
      assert.equal(result.items.length, 2, job.variants[0]);
      assert.deepEqual(result.warnings, []);
      assert.ok(result.items.some((p) => p.fields.category.source === "OpenStreetMap"));
      assert.ok(result.items.some((p) => /Sirene/.test(p.fields.category.source)));
      const registry = new URL(calls.find((u) => u.includes("recherche-entreprises"))!);
      assert.equal(registry.searchParams.get("activite_principale"), job.naf);
      const overpass = new URL(calls.find((u) => u.includes("overpass"))!);
      assert.ok(overpass.searchParams.get("data")!.includes(trade(job.variants[0])!.osm));
    }
  } finally { globalThis.fetch = original; }
});
