import { createHash, randomUUID } from "node:crypto";
import { db, list, prospect, prospectStatement } from "./db";
import type { Engine, Prospect, Search, SearchQuery } from "./types";
import { queryForSearch, queryKey } from "./searchQuery";
import { mergeProspects, sameEstablishment } from "./services/identity";
import type { InStatement } from "@libsql/client";

let writing: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const result = writing.then(fn);
  writing = result.catch(() => {});
  return result;
}
const inFlight = new Map<string, Promise<unknown>>();
export async function shareSearch<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;
  const result = fn(); inFlight.set(key, result);
  try { return await result; } finally { inFlight.delete(key); }
}

export function presentSearch(s: Search, items: Prospect[]) {
  const prospects = [...new Map(items.map((p) => [p.id, p])).values()];
  const query = queryForSearch(s);
  return { search: { ...s, ...(query ? { query, keyword: query.keyword } : {}), ids: prospects.map((p) => p.id), count: prospects.length }, prospects };
}
export async function resolveSearch(s: Search) {
  return presentSearch(s, (await Promise.all([...new Set(s.ids)].map(prospect))).filter((p): p is Prospect => !!p));
}
export async function findSavedSearch(query: SearchQuery, requestId?: string) {
  const matches = (await list<Search>("searches")).filter((s) => {
    const q = queryForSearch(s); return q && queryKey(q) === queryKey(query) && (!requestId || s.requestId === requestId);
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return matches[0];
}

export function persistResults(items: Prospect[], args: { city: string; activity: string; engine: Engine; keyword?: string; runId?: string; requestId?: string }, provider: string, cost: number | null, warnings: string[] = [], options: { query?: SearchQuery; refreshed?: boolean; newOnly?: boolean; kind?: Search["kind"]; afterSave?: InStatement[] } = {}) {
  return serialize(async () => {
    // Le Run ID rend la récupération Apify idempotente, même après un redémarrage.
    const identity = args.runId ? `apify:${args.runId}` : options.query ? options.refreshed ? args.requestId ? `refresh:${queryKey(options.query)}:${args.requestId}` : undefined : `query:${queryKey(options.query)}` : undefined;
    const id = identity ? "search-" + createHash("sha256").update(identity).digest("hex") : randomUUID();
    const saved = (await list<Search>("searches")).find((s) => s.id === id);
    if (saved) return { ...await resolveSearch(saved), cached: true };
    const catalog = await list<Prospect>("prospects");
    const results = new Map<string, Prospect>(), writes = new Map<string, Prospect>();
    const fresh = new Set<string>(), known = new Set<string>();
    for (const p of items) {
      const stored = await prospect(p.id);
      const old = catalog.find((x) => x.id === (stored?.id || p.id)) || stored || catalog.find((x) => sameEstablishment(x, p));
      if (old && options.newOnly) { known.add(old.id); continue; }
      const merged = old ? mergeProspects(old, p) : p;
      const index = catalog.findIndex((x) => x.id === merged.id);
      if (index < 0) catalog.push(merged); else catalog[index] = merged;
      results.set(merged.id, merged); writes.set(merged.id, merged);
      if (old && !fresh.has(merged.id)) known.add(merged.id); else if (!old) fresh.add(merged.id);
      if (merged.id !== p.id) writes.set(p.id, { ...p, duplicateOf: merged.id });
    }
    const s: Search = { id, city: args.city, activity: args.activity, engine: args.engine,
      ...(args.keyword !== undefined ? { keyword: args.keyword } : {}),
      ...(options.query ? { query: options.query } : {}),
      ...(args.requestId ? { requestId: args.requestId } : {}),
      ...(options.kind ? { kind: options.kind } : {}),
      provider, cost, createdAt: new Date().toISOString(), count: results.size, ids: [...results.keys()], warnings,
      newCount: fresh.size, knownCount: known.size };
    try {
      await db.batch([...writes.values()].map(prospectStatement).concat([{ sql: "INSERT INTO searches VALUES(?,?)", args: [s.id, JSON.stringify(s)] }], options.afterSave || []));
    } catch (error) {
      // Une autre instance peut avoir enregistré le même run ou la même requête.
      if (identity) {
        const concurrent = (await list<Search>("searches")).find((item) => item.id === id);
        if (concurrent) return { ...await resolveSearch(concurrent), cached: true };
      }
      throw error;
    }
    return { search: s, prospects: [...results.values()], cached: false };
  });
}
