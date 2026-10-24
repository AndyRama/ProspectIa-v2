import type { Engine, Prospect } from "../types";
import { geocode, searchOSM } from "./osm";
import { searchRegistry } from "./registry";
import { mergeProspects, sameEstablishment } from "./identity";

export async function searchFree(city: string, activity: string, keyword: string, max: number, engine: Engine) {
  const location = await geocode(city);
  const targeted = activity === "all" ? engine === "voice" ? "artisan" : engine === "menu" ? "restaurant" : "all" : activity;
  const sources = [{ name: "OpenStreetMap", run: () => searchOSM(city, targeted, keyword, max, engine, location) }];
  // Nominatim may label French Pacific territories as country_code=fr.
  const pacificTerritory = location.lat < -5 && (location.lng < -120 || location.lng > 150);
  if (location.countryCode === "fr" && !pacificTerritory) sources.push({ name: "Annuaire des Entreprises · Sirene",
    run: () => searchRegistry(location, targeted, keyword, max, engine) });
  const results = await Promise.allSettled(sources.map((s) => s.run()));
  const warnings: string[] = [], providers: string[] = [];
  const items: Prospect[] = [];
  for (const [i, result] of results.entries()) {
    if (result.status === "fulfilled") { providers.push(sources[i].name); items.push(...result.value); }
    else warnings.push(`${sources[i].name} : ${result.reason.message || "source indisponible"}`);
  }
  if (!providers.length) throw Error(warnings.join(" · ") + ". Réessayez plus tard ou importez un CSV.");
  const unique: Prospect[] = [];
  for (const p of items) {
    const index = unique.findIndex((old) => sameEstablishment(old, p));
    if (index < 0) unique.push(p);
    else unique[index] = mergeProspects(unique[index], p);
  }
  return { items: unique.slice(0, max), warnings, provider: providers.join(" + ") };
}
