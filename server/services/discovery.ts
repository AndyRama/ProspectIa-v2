import { createHash } from "node:crypto";
import { db, claimSetting, getSetting, list, setSetting } from "../db";
import type { Engine, Prospect, SearchQuery } from "../types";
import { makeQuery, queryKey } from "../searchQuery";
import { findSavedSearch, persistResults, resolveSearch, shareSearch } from "../searches";
import { searchFree } from "./freeSearch";
import { sameEstablishment } from "./identity";

interface Pool { remaining: Prospect[]; provider: string; warnings: string[]; createdAt: string; query: SearchQuery }
interface EmptyResult { exhausted: boolean; prospects: Prospect[]; remaining: number; provider: string; warnings: string[]; message: string }
export async function discoverNext(args: SearchQuery & { engine: Engine; max: number; requestId: string; refreshPool?: boolean }) {
  const query = makeQuery({ ...args, paid: false });
  const key = "discoveryPool:" + createHash("sha256").update(queryKey(query)).digest("hex");
  const receiptKey = key + ":request:" + createHash("sha256").update(args.requestId).digest("hex");
  return shareSearch(key + ":" + args.requestId, async () => {
    const previous = await findSavedSearch(query, args.requestId);
    if (previous) return { ...await resolveSearch(previous), cached: true, exhausted: undefined, remaining: undefined };
    const receipt = await getSetting<EmptyResult | null>(receiptKey, null);
    if (receipt) return { ...receipt, cached: true };
    const lockKey = key + ":lock";
    const lease = { requestId: args.requestId, expiresAt: Date.now() + 120000 };
    const oldLease = await getSetting<typeof lease | null>(lockKey, null);
    if (oldLease && oldLease.expiresAt <= Date.now()) await db.execute({ sql: "UPDATE settings SET data='null' WHERE key=? AND data=?", args: [lockKey, JSON.stringify(oldLease)] });
    if (!await claimSetting(lockKey, lease)) throw Error("Un lot est déjà en préparation pour cette requête. Attendez son résultat avant de continuer ; aucun paiement n’a été lancé.");
    try {
    const completed = await findSavedSearch(query, args.requestId);
    if (completed) return { ...await resolveSearch(completed), cached: true, exhausted: undefined, remaining: undefined };
    const completedReceipt = await getSetting<EmptyResult | null>(receiptKey, null);
    if (completedReceipt) return { ...completedReceipt, cached: true };
    let pool = await getSetting<Pool | null>(key, null);
    const known = await list<Prospect>("prospects");
    const excludeKnown = (items: Prospect[]) => items.filter((p) => !known.some((old) => sameEstablishment(old, p)));
    let unseen = excludeKnown(pool?.remaining || []);
    let refreshWarning: string | undefined;
    if (!pool || (args.refreshPool && !unseen.length)) {
      // Seule la collecte réseau est récupérable : les erreurs DB doivent remonter.
      let result: Awaited<ReturnType<typeof searchFree>> | undefined;
      try {
        result = await searchFree(query.city, query.activity, query.keyword, 250, args.engine);
      } catch (error) {
        if (!pool) throw error;
        refreshWarning = `Réessai gratuit indisponible : ${error instanceof Error ? error.message : String(error)}. Réserve et historique conservés ; aucun paiement lancé.`;
      }
      if (result) {
        pool = { remaining: result.items, provider: result.provider, warnings: result.warnings, query, createdAt: new Date().toISOString() };
        await setSetting(key, pool);
        unseen = excludeKnown(pool.remaining);
      }
    }
    if (!pool) throw Error("Réserve gratuite absente");
    const batch = unseen.slice(0, Math.min(25, args.max));
    const rest = unseen.slice(batch.length);
    const updated = { ...pool, remaining: rest };
    if (!batch.length) {
      const result: EmptyResult = { exhausted: true, prospects: [], remaining: 0, provider: pool.provider, warnings: [...pool.warnings, ...(refreshWarning ? [refreshWarning] : [])], message: "Aucun candidat inédit dans cette réserve gratuite. Aucune collecte payante lancée. Réessayez explicitement la collecte gratuite ou modifiez la zone ; l’historique reste accessible." };
      await db.batch([
        ...(!refreshWarning ? [{ sql: "INSERT OR REPLACE INTO settings VALUES(?,?)", args: [key, JSON.stringify(updated)] }] : []),
        { sql: "INSERT OR REPLACE INTO settings VALUES(?,?)", args: [receiptKey, JSON.stringify(result)] },
      ]);
      return result;
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
