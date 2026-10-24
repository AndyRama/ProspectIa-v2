import { createHash } from "node:crypto";
import { db, claimSetting, getSetting, list, setSetting } from "../db";
import type { Engine, Prospect, SearchQuery } from "../types";
import { makeQuery, queryKey } from "../searchQuery";
import { findSavedSearch, persistResults, resolveSearch, shareSearch } from "../searches";
import { searchFree } from "./freeSearch";
import { sameEstablishment } from "./identity";

interface Pool { remaining: Prospect[]; provider: string; warnings: string[]; createdAt: string; query: SearchQuery }
export async function discoverNext(args: SearchQuery & { engine: Engine; max: number; requestId: string }) {
  const query = makeQuery({ ...args, paid: false });
  const key = "discoveryPool:" + createHash("sha256").update(queryKey(query)).digest("hex");
  return shareSearch(key + ":" + args.requestId, async () => {
    const previous = await findSavedSearch(query, args.requestId);
    if (previous) return { ...await resolveSearch(previous), cached: true };
    const lockKey = key + ":lock";
    const lease = { requestId: args.requestId, expiresAt: Date.now() + 120000 };
    const oldLease = await getSetting<typeof lease | null>(lockKey, null);
    if (oldLease && oldLease.expiresAt <= Date.now()) await db.execute({ sql: "UPDATE settings SET data='null' WHERE key=? AND data=?", args: [lockKey, JSON.stringify(oldLease)] });
    if (!await claimSetting(lockKey, lease)) throw Error("Un lot est déjà en préparation pour cette requête. Attendez son résultat avant de continuer ; aucun paiement n’a été lancé.");
    try {
    const completed = await findSavedSearch(query, args.requestId);
    if (completed) return { ...await resolveSearch(completed), cached: true };
    let pool = await getSetting<Pool | null>(key, null);
    if (!pool) {
      // Une collecte gratuite bornée alimente plusieurs lots locaux, sans appel Apify.
      const result = await searchFree(query.city, query.activity, query.keyword, 250, args.engine);
      pool = { remaining: result.items, provider: result.provider, warnings: result.warnings, query, createdAt: new Date().toISOString() };
      await setSetting(key, pool);
    }
    const known = await list<Prospect>("prospects");
    const unseen = pool.remaining.filter((p) => !known.some((old) => sameEstablishment(old, p)));
    const batch = unseen.slice(0, Math.min(25, args.max));
    const rest = unseen.slice(batch.length);
    const updated = { ...pool, remaining: rest };
    if (!batch.length) {
      await setSetting(key, updated);
      return { exhausted: true, prospects: [], remaining: 0, message: "Aucun candidat inédit dans cette réserve gratuite. Aucune collecte payante lancée. Modifiez la zone ou importez de nouveaux candidats ; l’historique reste accessible." };
    }
    const saved = await persistResults(batch, { ...args, ...query }, pool.provider, 0, pool.warnings, {
      query, refreshed: true, newOnly: true, kind: "discovery",
      afterSave: [{ sql: "INSERT OR REPLACE INTO settings VALUES(?,?)", args: [key, JSON.stringify(updated)] }],
    });
    return { ...saved, remaining: rest.length, exhausted: rest.length === 0 };
    } finally {
      await db.execute({ sql: "UPDATE settings SET data='null' WHERE key=? AND data=?", args: [lockKey, JSON.stringify(lease)] });
    }
  });
}
