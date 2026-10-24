import { createHash, randomUUID } from "node:crypto";
import { db, getSetting, setSetting, claimSetting, list } from "../db";
import type { Engine, Search } from "../types";
import { resolveSearch } from "../searches";
import { makeQuery } from "../searchQuery";
import { billedPlaceIds, validPlaceId } from "./apifyPlan";
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
export async function discoverySnapshot() {
  const ids = new Set<string>(),
    urls = new Set<string>();
  let unidentifiedCount = 0;
  const add = (v: unknown) => {
    if (safeGoogleId(v)) {
      ids.add(v);
      return true;
    }
    if (safeMapsUrl(v)) {
      urls.add(v);
      return true;
    }
    return false;
  };
  for (const id of await billedPlaceIds()) add(id);
  for (const row of (await db.execute("SELECT data FROM searches")).rows) {
    const search = JSON.parse(String(row.data));
    if (search.provider === "Apify")
      for (const id of search.ids || [])
        if (typeof id === "string" && id.startsWith("apify-")) add(id.slice(6));
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
    if (!identified) unidentifiedCount++;
  }
  return { ids: [...ids].sort(), urls: [...urls].sort(), unidentifiedCount };
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
  const planId = createHash("sha256")
    .update(
      JSON.stringify({
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
  return { planId, query, city, monitorId, snapshot };
}
export async function planApifyDiscovery(args: ApifyDiscoveryCriteria) {
  const c = await context(args);
  return {
    planId: c.planId,
    actor: discoveryActor.replace("~", "/"),
    query: c.query,
    city: c.city,
    max: args.max,
    budget: args.budget,
    excludedCount: c.snapshot.ids.length + c.snapshot.urls.length,
    unidentifiedCount: c.snapshot.unidentifiedCount,
    warnings: [
      "Des frais de lancement Apify restent possibles même sans nouvelle entreprise.",
      "25 résultats ne sont pas garantis ; une identité Google manquante ne peut pas être exclue avec certitude.",
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
        Authorization: `Bearer ${token}`,
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
export async function verifyApifyDiscovery(token: string) {
  if (!token) throw Error("Clé Apify requise.");
  const a = (await discoveryApi(`acts/${discoveryActor}`, token)).data;
  const b = (await discoveryApi(`acts/${discoveryActor}/builds/default`, token))
    .data;
  let schema = b?.actorDefinition?.input;
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
    excludePlaceUrls: "array",
    maxResults: "integer",
    language: "string",
    includeReviews: "boolean",
    includePhotos: "boolean",
    includeLeadScore: "boolean",
    debugMode: "boolean",
  };
  if (
    a?.id !== discoveryActorId ||
    !p ||
    Object.entries(required).some(([key, type]) => p[key]?.type !== type) ||
    p.excludePlaceIds.items?.type !== "string" ||
    p.excludePlaceUrls.items?.type !== "string"
  )
    throw Error("Schéma officiel Apify modifié : lancement verrouillé.");
  const price = a.currentPricingInfo || a.pricingInfos?.at(-1);
  if (price?.pricingModel !== "PAY_PER_EVENT")
    throw Error(
      "Tarification PAY_PER_EVENT non confirmée : lancement verrouillé.",
    );
  if (
    typeof b.buildNumber !== "string" ||
    !/^\d+\.\d+\.\d+$/.test(b.buildNumber)
  )
    throw Error("Build Apify non identifié.");
  return {
    build: b.buildNumber,
    minimumBudget: Number(price.minimalMaxTotalChargeUsd || 0),
  };
}
export async function startApifyDiscovery(
  token: string,
  args: ApifyDiscoveryCriteria & { planId: string; requestId: string },
) {
  await validate(args);
  if (!args.requestId?.trim()) throw Error("requestId requis.");
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
  const verified = await verifyApifyDiscovery(token);
  if (args.budget < verified.minimumBudget)
    throw Error("Budget minimal Apify non atteint.");
  const input = {
    mode: "search",
    query: c.query,
    location: c.city,
    maxResults: args.max,
    language: "fr",
    onlyNew: true,
    monitorId: c.monitorId,
    excludePlaceIds: c.snapshot.ids,
    excludePlaceUrls: c.snapshot.urls,
    includeReviews: false,
    includePhotos: false,
    includeLeadScore: false,
    debugMode: false,
  };
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
