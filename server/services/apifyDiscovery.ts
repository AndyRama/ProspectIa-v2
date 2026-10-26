import { createHash, randomUUID } from "node:crypto";
import { db, getSetting, setSetting, claimSetting, list } from "../db";
import type { Engine, Search } from "../types";
import { resolveSearch } from "../searches";
import { makeQuery } from "../searchQuery";
import { billedPlaceIds, validPlaceId } from "./apifyPlan";
// Keep both paid contracts explicit: pending runs belong to their recorded Actor.
export const emailDiscoveryActor = "benthepythondev~google-maps-email-scraper";
export const emailDiscoveryActorId = "4MTxdHfGoKTLDoTrD";
export const discoveryActor = "benthepythondev~google-maps-business-scraper";
export const discoveryActorId = "uU8ybh0dgvI68Q3o2";
export type ApifyDiscoveryCriteria = {
  city: string;
  activity: string;
  keyword: string;
  engine: Engine;
  max: number;
  budget: number;
};
const normalize = (s: string) =>
  s.normalize("NFKC").trim().replace(/\s+/g, " ");
export const safeGoogleId = (s: unknown): s is string =>
  typeof s === "string" &&
  (validPlaceId(s) || /^\d+$/.test(s) || /^0x[0-9a-f]+:0x[0-9a-f]+$/i.test(s));
export function safeMapsUrl(s: unknown): s is string {
  if (typeof s !== "string") return false;
  try {
    const u = new URL(s);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      /^(?:(?:www|maps)\.)?google\.(?:com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/.test(
        u.hostname,
      ) &&
      (u.pathname.startsWith("/maps") || u.hostname.startsWith("maps."))
    );
  } catch {
    return false;
  }
}
// Decode only validated Google URL identity slots, never display names or
// coordinates. Decimal CIDs stay strings (including values above 2^53).
export function mapsUrlIds(value: string): string[] {
  if (!safeMapsUrl(value)) return [];
  try {
    const u = new URL(value), found = new Set<string>();
    for (const key of ['cid', 'ludocid', 'ftid', 'query_place_id', 'place_id']) {
      const id = u.searchParams.get(key); if (safeGoogleId(id)) found.add(id);
    }
    const query = u.searchParams.get('q') || u.searchParams.get('query') || '';
    if (query.startsWith('place_id:') && safeGoogleId(query.slice(9))) found.add(query.slice(9));
    const decoded = decodeURIComponent(u.pathname + u.search);
    for (const m of decoded.matchAll(/!(?:1s|19s)([^!&#?]+)/g)) if (safeGoogleId(m[1])) found.add(m[1]);
    return [...found].sort();
  } catch { return []; }
}
export async function discoverySnapshot() {
  const ids = new Set<string>(), urls = new Set<string>(), coveredUrls = new Set<string>();
  let unidentifiedCount = 0;
  const unresolvedHistory = new Set<string>();
  const add = (v: unknown) => {
    if (safeGoogleId(v)) {
      ids.add(v);
      return true;
    }
    if (safeMapsUrl(v)) {
      urls.add(v);
      const converted = mapsUrlIds(v);
      for (const id of converted) ids.add(id);
      if (converted.length) coveredUrls.add(v);
      return converted.length > 0;
    }
    return false;
  };
  for (const id of await billedPlaceIds()) add(id);
  for (const row of (await db.execute("SELECT data FROM searches")).rows) {
    const search = JSON.parse(String(row.data));
    if (search.provider === "Apify")
      for (const id of search.ids || [])
        if (typeof id === "string" && id.startsWith("apify-") && !add(id.slice(6))) unresolvedHistory.add(id);
  }
  const rows = (await db.execute("SELECT data FROM prospects")).rows;
  for (const row of rows) {
    const p = JSON.parse(String(row.data));
    if (p.demo) continue;
    let identified = false;
    if (p.id?.startsWith("apify-"))
      identified = add(p.id.slice(6)) || identified;
    for (const [key, f] of Object.entries(p.fields || {}) as [string, any][]) {
      if (
        /place.?id|^cid$|feature.?id|google.?maps|archive_.*(cid|placeId|featureId)/i.test(
          key,
        )
      )
        identified = add(f?.value) || identified;
      if (safeMapsUrl(f?.url)) identified = add(f.url) || identified;
    }
    const rowUrls: string[] = [];
    for (const f of Object.values(p.fields || {}) as any[]) {
      for (const value of [f?.value, f?.url]) if (safeMapsUrl(value)) rowUrls.push(value);
    }
    if (identified) {
      for (const url of rowUrls) coveredUrls.add(url);
      unresolvedHistory.delete(p.id);
    } else {
      unidentifiedCount++;
      unresolvedHistory.delete(p.id); // already counted as an unidentified row
    }
  }
  unidentifiedCount += unresolvedHistory.size;
  const unresolvedUrls = [...urls].filter(url => !coveredUrls.has(url)).sort();
  return { ids: [...ids].sort(), urls: [...urls].sort(), unidentifiedCount, unresolvedUrls };
}
async function validate(args: ApifyDiscoveryCriteria) {
  if (
    !Number.isInteger(args.max) ||
    args.max < 1 ||
    args.max > 25 ||
    !Number.isFinite(args.budget) ||
    args.budget < 0.05 ||
    args.budget > 10
  )
    throw Error(
      "Plafonds Apify invalides : 1 à 25 entreprises et budget 0.05 à 10 USD.",
    );
  const limits = await getSetting("limits", { max: 25, budget: 1 });
  if (args.max > limits.max || args.budget > limits.budget)
    throw Error("Les plafonds enregistrés Apify sont dépassés.");
  if (
    !args.city?.trim() ||
    !(args.keyword?.trim() || args.activity?.trim()) ||
    !["website", "voice", "menu"].includes(args.engine)
  )
    throw Error("Critères de recherche Apify invalides.");
}
async function context(args: ApifyDiscoveryCriteria) {
  await validate(args);
  await claimSetting("apifyDiscoveryMonitorId", randomUUID());
  const monitorId = await getSetting<string>("apifyDiscoveryMonitorId", "");
  if (!monitorId) throw Error("Mémoire Apify indisponible.");
  const snapshot = await discoverySnapshot();
  const effective = makeQuery({ ...args, paid: true });
  const terms: Record<string, string> = {
    all: "entreprises",
    artisan: "artisans",
    restaurant: "restaurants",
    beauty: "salons de beauté",
    hotel: "hôtels",
    retail: "commerces",
  };
  const query = normalize(
      effective.keyword || terms[effective.activity] || effective.activity,
    ),
    city = normalize(effective.city);
  const verified = await verifyApifyDiscovery();
  const input = {
    mode: 'search', query, location: city, maxResults: args.max,
    language: 'fr', scrapeContacts: true, includeReviews: true, includePhotos: true, includeLeadScore: true,
    onlyNew: true, monitorId, excludePlaceIds: snapshot.ids, excludePlaceUrls: snapshot.urls, debugMode: false,
  };
  const planId = createHash("sha256")
    .update(
      JSON.stringify({
        actor: discoveryActor, actorId: discoveryActorId, input,
        build: verified.build, schemaFingerprint: verified.schemaFingerprint, pricing: verified.pricing,
        query,
        city,
        activity: effective.activity,
        engine: args.engine,
        max: args.max,
        budget: args.budget,
        monitorId,
        ...snapshot,
      }),
    )
    .digest("hex");
  return { planId, query, city, monitorId, snapshot, input, verified };
}
export async function planApifyDiscovery(args: ApifyDiscoveryCriteria) {
  const c = await context(args);
  return {
    planId: c.planId,
    actor: discoveryActor.replace("~", "/"),
    actorId: discoveryActorId,
    build: c.verified.build,
    schemaFingerprint: c.verified.schemaFingerprint,
    pricing: c.verified.pricing,
    coverage: { requireEmail: false, scrapeContacts: true, email: 'Email publié sur le site selon disponibilité, non testé pour la délivrabilité', business: 'Coordonnées, détails, avis, photos et contacts publiés selon disponibilité ; aucune valeur garantie', monitorStore: 'google-maps-monitor' },
    blocked: false,
    blockedReason: null,
    unresolvedUrlCount: c.snapshot.unresolvedUrls.length,
    protection: { onlyNew: true, durableLock: true, confirmationRequired: true, maxResults: 25, singleSearch: true, maxTotalChargeUsd: args.budget },
    query: c.query,
    city: c.city,
    max: args.max,
    budget: args.budget,
    excludedCount: c.snapshot.ids.length,
    unidentifiedCount: c.snapshot.unidentifiedCount,
    warnings: [
      "Des frais de lancement Apify restent possibles même sans nouvelle entreprise.",
      "25 résultats ne sont pas garantis ; les entreprises sans email restent incluses. Aucun champ ni délivrabilité garanti.",
      `${c.snapshot.unidentifiedCount} fiches ou références sans identité Google exploitable ne peuvent pas être exclues avec certitude ; risque de repayer ces entreprises. Les identifiants et URL connus sont transmis avant lancement.`,
    ],
  };
}
export class ApifyHttpError extends Error {
  constructor(public readonly status: number) {
    const reasons: Record<number, string> = {
      400: "Input Apify invalide : vérifiez les paramètres d’entrée.",
      401: "Clé Apify invalide ou expirée.",
      402: "Crédit Apify insuffisant ou limite de paiement atteinte.",
      403: "Permission Apify refusée pour cette ressource.",
      404: "Actor ou ressource Apify introuvable.",
      429: "Limite de requêtes Apify atteinte.",
    };
    super(`Apify HTTP ${status}. ${reasons[status] || "Erreur du service Apify."}`);
    this.name = "ApifyHttpError";
  }
}
export async function discoveryApi(
  path: string,
  token: string,
  init?: RequestInit,
) {
  try {
    const response = await fetch("https://api.apify.com/v2/" + path, {
      ...init,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      // Provider bodies are untrusted and may contain credentials; expose only
      // the controlled HTTP explanation, without parsing any provider detail.
      throw new ApifyHttpError(response.status);
    }
    return await response.json();
  } catch (e) {
    if (e instanceof ApifyHttpError) throw e;
    throw Error(
      "Réponse Apify incertaine ou invalide ; aucun nouvel essai automatique.",
    );
  }
}
export async function verifyApifyDiscovery(token = "") {
  const a = (await discoveryApi(`acts/${discoveryActor}`, token)).data;
  const b = (await discoveryApi(`acts/${discoveryActor}/builds/default`, token))
    .data;
  let schema = b?.actorDefinition?.input || b?.inputSchema;
  if (typeof schema === "string") {
    try {
      schema = JSON.parse(schema);
    } catch {
      schema = null;
    }
  }
  const p = schema?.properties;
  const required: Record<string, string> = {
    mode: "string",
    query: "string",
    location: "string",
    onlyNew: "boolean",
    monitorId: "string",
    excludePlaceIds: "array",
    maxResults: "integer",
    language: "string",
    scrapeContacts: "boolean",
    includeReviews: "boolean",
    includePhotos: "boolean",
    includeLeadScore: "boolean",
    excludePlaceUrls: "array",
    debugMode: "boolean",
  };
  if (
    a?.id !== discoveryActorId ||
    !p ||
    Object.entries(required).some(([key, type]) => p[key]?.type !== type) ||
    p.excludePlaceIds.items?.type !== "string" || p.excludePlaceUrls.items?.type !== "string"
  )
    throw Error("Schéma officiel Apify modifié : lancement verrouillé.");
  const price = a.currentPricingInfo || a.pricingInfos?.filter((p: any) => !p.startedAt || Date.parse(p.startedAt) <= Date.now()).sort((a: any,b: any) => Date.parse(a.startedAt) - Date.parse(b.startedAt)).at(-1);
  if (price?.pricingModel !== "PAY_PER_EVENT" ||
      (price.startedAt != null && (!Number.isFinite(Date.parse(price.startedAt)) || Date.parse(price.startedAt) > Date.now())) ||
      (price.minimalMaxTotalChargeUsd != null && (typeof price.minimalMaxTotalChargeUsd !== 'number' || !Number.isFinite(price.minimalMaxTotalChargeUsd) || price.minimalMaxTotalChargeUsd < 0)))
    throw Error(
      "Tarification PAY_PER_EVENT non confirmée : lancement verrouillé.",
    );
  if (
    typeof b.buildNumber !== "string" ||
    !/^\d+\.\d+\.\d+$/.test(b.buildNumber)
  )
    throw Error("Build Apify non identifié.");
  const events = price.pricingPerEvent?.actorChargeEvents;
  if (!events || !events['apify-actor-start'] || !events['apify-default-dataset-item'] ||
      Object.values(events).some((e: any) => {
        const rates = e.eventPriceUsd != null ? [e.eventPriceUsd] : Object.values(e.eventTieredPricingUsd || {}).map((v: any) => v.tieredEventPriceUsd);
        return !rates.length || rates.some((r: any) => typeof r !== 'number' || !Number.isFinite(r) || r < 0);
      })) throw Error('Tarification détaillée Apify indisponible : lancement verrouillé.');
  return {
    build: b.buildNumber,
    schemaFingerprint: createHash('sha256').update(JSON.stringify({ input: schema, output: b?.actorDefinition?.storages?.dataset || null })).digest('hex'),
    minimumBudget: Number(price.minimalMaxTotalChargeUsd || 0),
    pricing: { model: price.pricingModel, currency: 'USD', events, effectiveAt: price.startedAt || null, minimumBudget: Number(price.minimalMaxTotalChargeUsd || 0), source: `https://api.apify.com/v2/acts/${discoveryActor}`, accountTierVerified: false },
  };
}
export async function startApifyDiscovery(
  token: string,
  args: ApifyDiscoveryCriteria & { planId: string; requestId: string },
) {
  await validate(args);
  if (!args.requestId?.trim()) throw Error("requestId requis.");
  if (!token) throw Error('Clé Apify requise.');
  const existing = await getSetting<any>("apifyPending", null);
  if (existing) {
    if (
      existing.mode === "discovery" &&
      existing.requestId === args.requestId &&
      existing.planId === args.planId &&
      existing.runId
    )
      return existing.runId;
    throw Error(
      "Une collecte Apify est déjà en cours ou incertaine ; récupérez-la sans relancer.",
    );
  }
  const c = await context(args);
  if (c.planId !== args.planId)
    throw Error("Plan Apify périmé : recalculez les exclusions.");

  const verified = c.verified;
  if (args.budget < verified.minimumBudget)
    throw Error("Budget minimal Apify non atteint.");
  const input = c.input;
  const pending = {
    ...args,
    query: makeQuery({ ...args, city: c.city, paid: true }),
    criteria: args,
    actorSlug: discoveryActor,
    actorId: discoveryActorId,
    mode: "discovery",
    monitorId: c.monitorId,
    exclusionSnapshot: c.snapshot,
    input,
    pricing: verified.pricing,
    build: verified.build,
    schemaFingerprint: verified.schemaFingerprint,
    startedAt: new Date().toISOString(),
    runId: null,
  };
  if (!(await claimSetting("apifyPending", pending))) {
    const winner = await getSetting<any>("apifyPending", null);
    if (
      winner?.requestId === args.requestId &&
      winner?.planId === args.planId &&
      winner?.runId
    )
      return winner.runId;
    throw Error("Une collecte Apify est déjà en cours.");
  }
  let submitted = false;
  const releaseOwnLock = () =>
    db.execute({
      sql: "UPDATE settings SET data='null' WHERE key='apifyPending' AND data=?",
      args: [JSON.stringify(pending)],
    });
  try {
    const latest = await context(args);
    if (latest.planId !== args.planId)
      throw Error("Plan Apify périmé : recalculez les exclusions.");
    // The preflight GET can outlive another request's entire run, even an
    // empty dataset (which leaves the exclusion snapshot unchanged).
    const completed = (await list<Search>("searches")).find(
      (s) =>
        s.kind === "discovery" &&
        s.provider === "Apify" &&
        s.requestId === args.requestId,
    );
    if (completed) {
      const response = {
        ...(await resolveSearch(completed)),
        cached: true as const,
      };
      await releaseOwnLock();
      return response;
    }
    submitted = true;
    const result = (
      await discoveryApi(
        `acts/${discoveryActor}/runs?build=${encodeURIComponent(verified.build)}&maxTotalChargeUsd=${args.budget}&restartOnError=false`,
        token,
        { method: "POST", body: JSON.stringify(input) },
      )
    ).data;
    if (typeof result?.id !== "string" || !result.id)
      throw Error("Accusé de lancement Apify invalide.");
    await setSetting("apifyPending", { ...pending, runId: result.id });
    return result.id;
  } catch (e) {
    // Use the typed status, not a full-message regex: provider details must
    // never turn a definite rejection into an uncertain, permanently held lock.
    const release = !submitted || (e instanceof ApifyHttpError && [400, 401, 402, 403, 404].includes(e.status));
    if (release) await releaseOwnLock();
    const suffix = submitted && !release
      ? " Si le lancement est incertain, le verrou est conservé ; récupérez le Run ID sans relancer."
      : "";
    if (e instanceof ApifyHttpError) { e.message += suffix; throw e; }
    throw Error((e as Error).message + suffix);
  }
}
