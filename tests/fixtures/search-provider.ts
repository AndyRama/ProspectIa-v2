// Fournisseurs simulés uniquement pour le test de non-régression de l’historique.
import { writeFileSync } from "node:fs";
import path from "node:path";
const counters: Record<string, number> = {};
globalThis.fetch = async (input: any) => {
  const url = String(input);
  const provider = url.includes("nominatim") ? "geocode" : url.includes("overpass") ? "osm" : url.includes("recherche-entreprises") ? "registry" : "unexpected";
  counters[provider] = (counters[provider] || 0) + 1;
  writeFileSync(path.join(process.env.DATA_DIR!, "provider-calls.json"), JSON.stringify(counters));
  if (provider === "unexpected") throw Error("Appel externe inattendu pendant le test");
  const data = provider === "geocode" ? [{ lat: "44.84", lon: "-0.58", address: { country_code: "fr" } }]
    : provider === "registry" ? { results: [] }
    : { elements: [
      { type: "way", id: 99, lat: 44.84, lon: -0.58, tags: { name: "Menuisier Martin", craft: "carpenter", "addr:housenumber": "10", "addr:street": "rue des Lilas", "addr:city": "Bordeaux" } },
      { type: "node", id: 100, lat: 44.85, lon: -0.59, tags: { name: "Menuisier Nouveau", craft: "carpenter", "addr:housenumber": "20", "addr:street": "rue des Lilas", "addr:city": "Bordeaux" } },
    ] };
  return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
};
await import("../../server/index");
