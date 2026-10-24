import { test } from "node:test";
import assert from "node:assert/strict";
import { searchFree } from "../server/services/freeSearch";

test("Recherche gratuite : repli Sirene si OSM est indisponible, identité sourcée et absence de coordonnées inventées", async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (raw: any) => {
    const url = String(raw); calls.push(url);
    const data = url.includes("nominatim") ? [{ lat: "48.8566", lon: "2.3522", address: { country_code: "fr" } }]
      : url.includes("recherche-entreprises") ? { results: [{ siren: "123456789", nom_complet: "Entreprise test", matching_etablissements: [
        { siret: "12345678900001", adresse: "Adresse de test", libelle_commune: "Paris", latitude: "48.85", longitude: "2.35", activite_principale: "56.10A", etat_administratif: "A" }
      ] }] } : null;
    return new Response(JSON.stringify(data), { status: data ? 200 : 503, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await searchFree("Paris", "all", "", 25, "menu");
    assert.equal(result.items.length, 1);
    assert.match(result.provider, /Sirene/);
    assert.equal(result.warnings.length, 1);
    const p = result.items[0];
    assert.equal(p.email, ""); assert.equal(p.website, ""); assert.equal(p.rating, null);
    assert.equal(p.fields.siret.value, "12345678900001");
    assert.match(p.fields.name.source, /Sirene/);
    const query = new URL(calls.find((url) => url.includes("recherche-entreprises"))!);
    assert.match(query.searchParams.get("activite_principale")!, /56\.10A/);
  } finally { globalThis.fetch = original; }
});
