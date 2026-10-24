import type { Engine, Search, SearchQuery } from "./types";

export const normalizedText = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");

export function makeQuery(args: SearchQuery & { engine?: Engine }): SearchQuery {
  const activity = args.activity === "all" ? args.engine === "voice" ? "artisan" : args.engine === "menu" ? "restaurant" : "all" : args.activity;
  return { city: args.city.trim(), activity, keyword: args.keyword.trim(), paid: args.paid };
}
export const queryKey = (q: SearchQuery) => JSON.stringify([normalizedText(q.city), q.activity, normalizedText(q.keyword), q.paid]);

/** Les recherches antérieures restent lisibles ; une précision manquante n’est jamais devinée. */
export function queryForSearch(s: Search): SearchQuery | undefined {
  if (s.query) return s.query;
  if (typeof s.keyword !== "string" || !/Apify|OpenStreetMap|Sirene/i.test(s.provider)) return undefined;
  const activity = ({ "commerce": "all", "salon de beauté": "beauty", "hôtel": "hotel", "commerce de détail": "retail" } as Record<string, string>)[s.activity] || s.activity;
  return makeQuery({ city: s.city, activity, keyword: s.keyword, paid: s.provider === "Apify", engine: s.engine });
}
