import type { Engine, Prospect, Source, SearchQuery } from "../types";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { db, getSetting, setSetting, claimSetting } from "../db";
import { billedPlaceIds, validPlaceId } from "./apifyPlan";
import { discoveryActor, discoveryActorId, discoveryApi } from './apifyDiscovery';
import { canonicalMapsUrl } from './identity';
function expectedActor(pending: any) {
  if (pending.mode === 'discovery') {
    if (pending.actorSlug !== discoveryActor || pending.actorId !== discoveryActorId) throw Error('Actor Apify non autorisé.');
    return discoveryActorId;
  }
  return 'nwua9Gu5YrADL7ZDj';
}
const actor = "compass~crawler-google-places";
async function api(path: string, token: string, init?: RequestInit) {
  return discoveryApi(path, token, init);
}
export async function verifyApify(token: string) {
  if (!token)
    throw Error(
      "Ajoutez votre clé Apify dans les paramètres avant toute collecte payante.",
    );
  const a = (await api(`acts/${actor}`, token)).data;
  const build = (await api(`acts/${actor}/builds/default`, token)).data;
  let schema = build.inputSchema;
  if (typeof schema === "string") {
    try {
      schema = JSON.parse(schema);
    } catch {
      schema = null;
    }
  }
  const props = schema?.properties;
  if (
    !props?.placeIds ||
    !props?.maxCrawledPlacesPerSearch
  )
    throw Error(
      "Schéma officiel Apify indisponible ou modifié : collecte verrouillée pour éviter un appel non vérifié.",
    );
  const price = a.currentPricingInfo || a.pricingInfos?.at(-1);
  if (price?.pricingModel !== "PAY_PER_EVENT")
    throw Error(
      "Tarification Apify non confirmée comme PAY_PER_EVENT : impossible de garantir le contrôle de coût, collecte verrouillée.",
    );
  if (typeof build.buildNumber !== "string" || !build.buildNumber)
    throw Error("Build Apify non identifié : collecte verrouillée.");
  return { props, build: build.buildNumber, minimumBudget: Number(price.minimalMaxTotalChargeUsd || 0) };
}
let starting = false;
export async function startApify(
  token: string,
  args: {
    city: string;
    activity: string;
    keyword: string;
    max: number;
    budget: number;
    engine: Engine;
    query?: SearchQuery;
    refresh?: boolean;
    requestId?: string;
    placeIds?: string[];
  },
) {
  const ids = [...new Set(args.placeIds || [])];
  const enforceLimits = async () => {
    const limits = await getSetting('limits', {max:25,budget:1});
    if (!Number.isInteger(args.max) || args.max < 1 || args.max > 25 || !Number.isFinite(args.budget) || args.budget < .05 || args.budget > 10 || ids.length > limits.max || args.budget > limits.budget) throw Error('Plafonds Apify invalides ou dépassés.');
  };
  await enforceLimits();
  if (!ids.length) throw Error("Les recherches Google Maps payantes par mot-clé sont désactivées : cet Actor ne permet pas d’exclure les entreprises déjà facturées. Préparez un lot d’identifiants inédits avant paiement.");
  if (ids.length > 25 || ids.some((id) => !validPlaceId(id))) throw Error("Lot Apify refusé : 1 à 25 identifiants Google Maps valides sont requis.");
  const billed = await billedPlaceIds();
  if (ids.some((id) => billed.has(id))) throw Error("Paiement bloqué : ce lot contient un identifiant déjà collecté ou réservé. Recalculez le lot inédit.");
  if (starting || await getSetting<any>("apifyPending", null))
    throw Error(
      "Une collecte Apify est déjà en cours. Récupérez son résultat avant de relancer.",
    );
  starting = true;
  try {
    const { props, build, minimumBudget } = await verifyApify(token);
    if (args.budget < minimumBudget)
      throw Error(`Apify exige un budget minimal de ${minimumBudget.toFixed(2)} USD pour cet Actor. Aucun appel payant lancé.`);
    const input: Record<string, unknown> = {
      placeIds: ids,
      maxCrawledPlacesPerSearch: ids.length,
      language: "fr",
    };
    if (props.scrapePlaceDetailPage) input.scrapePlaceDetailPage = false;
    if (props.maxReviews) input.maxReviews = 0;
    if (props.maxImages) input.maxImages = 0;
    if (props.maximumLeadsEnrichmentRecords)
      input.maximumLeadsEnrichmentRecords = 0;
    if (props.scrapeContacts) input.scrapeContacts = true;
    if (props.scrapeSocialMediaProfiles) input.scrapeSocialMediaProfiles = { instagrams: false, facebooks: false, youtubes: false, tiktoks: false, twitters: false };
    if (props.enableCompetitorAnalysis) input.enableCompetitorAnalysis = false;
    const pending = {
      runId: null,
      ...args,
      placeIds: ids,
      max: ids.length,
      startedAt: new Date().toISOString(),
    };
    if (!await claimSetting("apifyPending", pending)) throw Error("Une collecte Apify est déjà en cours. Récupérez-la avant de relancer.");
    let submitted = false;
    try {
      const latestBilled = await billedPlaceIds();
      if (ids.some((id) => latestBilled.has(id))) {
        await setSetting("apifyPending", null);
        throw Error("Paiement bloqué : un identifiant du lot vient d’être réservé ou collecté.");
      }
      await db.batch(ids.map((id) => ({ sql: "INSERT INTO apify_place_claims VALUES(?,NULL,?)", args: [id, pending.startedAt] })));
      await enforceLimits();
      submitted = true;
      const result = (
        await api(
          `acts/${actor}/runs?maxTotalChargeUsd=${args.budget}&maxItems=${ids.length}&build=${encodeURIComponent(build)}&restartOnError=false`,
          token,
          { method: "POST", body: JSON.stringify(input) },
        )
      ).data;
      await db.batch(ids.map((id) => ({ sql: "UPDATE apify_place_claims SET run_id=? WHERE place_id=?", args: [result.id, id] })));
      await setSetting("apifyPending", { ...pending, runId: result.id });
      return result.id as string;
    } catch (e) {
      if (!submitted) {
        await db.batch(ids.map((id) => ({ sql: "DELETE FROM apify_place_claims WHERE place_id=? AND created_at=? AND run_id IS NULL", args: [id, pending.startedAt] })));
        await setSetting("apifyPending", null);
        throw e;
      }
      if (
        /clé invalide|accès refusé|crédit insuffisant|HTTP (400|401|402|403|404)\b/.test(
          (e as Error).message,
        )
      ) {
        await db.batch(ids.map((id) => ({ sql: "DELETE FROM apify_place_claims WHERE place_id=? AND created_at=? AND run_id IS NULL", args: [id, pending.startedAt] })));
        await setSetting("apifyPending", null);
      }
      throw Error(
        (e as Error).message +
          " Si la réponse de lancement est incertaine, le verrou est conservé : retrouvez le Run ID dans la console Apify, sans relancer.",
      );
    }
  } finally {
    starting = false;
  }
}
export async function recoverApify(token: string, runId: string) {
  const pending = await getSetting<any>("apifyPending", null);
  if (!pending || pending.runId)
    throw Error("Aucune collecte incertaine à récupérer.");
  const run = (await api("actor-runs/" + encodeURIComponent(runId), token))
    .data;
  if (run?.actId !== expectedActor(pending) || run.id !== runId)
    throw Error('Ce run ne correspond pas à l’Actor attendu.');
  const owner = (await discoveryApi('users/me', token)).data;
  const started = Date.parse(run.startedAt), claimed = Date.parse(pending.startedAt);
  if (!owner?.id || run.userId !== owner.id || !Number.isFinite(started) || !Number.isFinite(claimed) || started < claimed || started - claimed > 300000)
    throw Error('Run Apify d’un autre propriétaire ou historique : récupération refusée.');
  if (!run.defaultKeyValueStoreId) throw Error('Preuve INPUT du lot indisponible : verrou conservé.');
  const input = await discoveryApi(`key-value-stores/${encodeURIComponent(run.defaultKeyValueStoreId)}/records/INPUT`, token);
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  if (pending.mode === 'discovery') {
    const expected = pending.input;
    // Only the exclusion lists are unordered. All explicitly recorded fields
    // (including false flags) must be present with their original values.
    const normalizeInputValue = (key: string, value: unknown) =>
      ['excludePlaceIds','excludePlaceUrls'].includes(key) && Array.isArray(value) ? [...value].sort() : value;
    const extraSelector = ['queries','locations','startUrls','searchStringsArray','placeIds'].some(key =>
      !Object.hasOwn(expected || {}, key) && input?.[key] != null && input[key] !== '' &&
      !(Array.isArray(input[key]) && input[key].length === 0));
    if (!expected || typeof expected !== 'object' || Array.isArray(expected) || !input ||
        Object.keys(expected).some(key => !Object.hasOwn(input, key) ||
          !isDeepStrictEqual(normalizeInputValue(key, input[key]), normalizeInputValue(key, expected[key]))) || extraSelector)
      throw Error('INPUT ne correspond pas au lot de recherche attendu.');
  } else if (!Array.isArray(pending.placeIds) || !Array.isArray(input?.placeIds) || !same([...input.placeIds].sort(), [...pending.placeIds].sort()) || input.maxCrawledPlacesPerSearch !== pending.placeIds.length) {
    throw Error('Preuve INPUT du lot ciblé absente ou différente : verrou conservé.');
  }
  const latest = await getSetting<any>('apifyPending', null);
  if (!latest || latest.runId || JSON.stringify(latest) !== JSON.stringify(pending)) throw Error('Le lot a changé pendant la récupération.');
  await setSetting("apifyPending", { ...pending, runId });
}
export async function collectApify(token: string) {
  const pending = await getSetting<any>("apifyPending", null);
  if (!pending) throw Error("Aucune collecte Apify en cours.");
  if (!pending.runId)
    throw Error(
      "Lancement incertain : renseignez le Run ID depuis la console Apify dans les paramètres, sans relancer la collecte.",
    );
  const run = (
    await api(`actor-runs/${encodeURIComponent(pending.runId)}`, token)
  ).data;
  if (!run || run.id !== pending.runId || run.actId !== expectedActor(pending)) throw Error('Run Apify invalide ou Actor différent.');
  if (["READY", "RUNNING", "TIMING-OUT", "ABORTING"].includes(run.status))
    return { pending: true, runId: run.id, status: run.status };
  if (!["SUCCEEDED", "TIMED-OUT", "ABORTED", "FAILED"].includes(run.status)) {
    throw Error(
      `Collecte Apify terminée : ${run.status}. Consultez la console Apify ; des frais peuvent avoir été engagés.`,
    );
  }
  const finishedAt = Date.parse(run.finishedAt);
  if (!Number.isFinite(finishedAt) || Date.now() - finishedAt < 10000) return { pending: true, status: 'FINALIZING', runId: run.id };
  const rows = run.defaultDatasetId ? await api(
    `datasets/${encodeURIComponent(run.defaultDatasetId)}/items?clean=true&limit=20001`,
    token,
  ) : [];
  if (!Array.isArray(rows) || rows.some((r: any) => !r || typeof r !== 'object' || r.error || r.errorMessage || typeof (pending.mode === 'discovery' ? r.name : r.title) !== 'string' || !(pending.mode === 'discovery' ? r.name : r.title).trim())) throw Error('Dataset Apify invalide ou erreur fournisseur ; verrou conservé.');
  if (pending.mode === 'discovery' && rows.some((r: any) =>
    (r.place_id != null && r.place_id !== '' && (typeof r.place_id !== 'string' || !validPlaceId(r.place_id))) ||
    (r.cid != null && r.cid !== '' && (typeof r.cid !== 'string' || !/^\d+$/.test(r.cid))) ||
    (r.feature_id != null && r.feature_id !== '' && (typeof r.feature_id !== 'string' || !/^0x[0-9a-f]+:0x[0-9a-f]+$/i.test(r.feature_id)))
  )) throw Error('Identité Google Apify invalide ; verrou conservé.');
  const excludedIds = new Set(pending.exclusionSnapshot?.ids || []), excludedUrls = new Set(pending.exclusionSnapshot?.urls || []);
  const seen = new Set<string>();
  const normalized = rows.map((r: any) => pending.mode === 'discovery' ? {
    ...r, title:r.name, placeId:r.place_id, categoryName:r.category, totalScore:r.rating, reviewsCount:r.review_count,
    location:{lat:r.latitude,lng:r.longitude},openingHours:r.opening_hours,imageUrl:r.image_url,imageUrls:r.photos,
  } : r).filter((r: any) => {
    if (pending.mode !== 'discovery') return true;
    if ([r.placeId,r.cid,r.feature_id].some(id => excludedIds.has(id)) || excludedUrls.has(r.url)) return false;
    const identity = r.placeId || r.cid || r.feature_id || canonicalMapsUrl(r.url);
    if (identity && seen.has(identity)) return false;
    if (identity) seen.add(identity);
    return true;
  }).slice(0, pending.mode === 'discovery' ? Math.min(25, pending.max) : pending.max);
  const items: Prospect[] = normalized
    .filter((r: any) => r.title && (!pending.placeIds || pending.placeIds.includes(r.placeId)))
    .map((r: any): Prospect => {
      const fields: Record<string, Source> = {};
      for (const [key, value] of Object.entries({
        name: r.title,
        address: r.address,
        phone: r.phone,
        website: r.website,
        email: r.emails?.[0],
        rating: r.totalScore,
        reviews: r.reviewsCount,
        instagram: r.instagrams?.[0],
        facebook: r.facebooks?.[0],
        linkedin: r.linkedIns?.[0],
        whatsapp: r.whatsapps?.[0] || r.whatsapp,
        category: r.categoryName,
        latitude: r.location?.lat,
        longitude: r.location?.lng,
        hours: r.openingHours ? JSON.stringify(r.openingHours) : undefined,
        photo: r.imageUrl,
        closure: r.permanentlyClosed
          ? "Fermé définitivement"
          : r.temporarilyClosed
            ? "Fermé temporairement"
            : undefined,
        googleMaps: r.url,
        placeId: r.placeId,
        cid: r.cid,
        featureId: r.feature_id,
      })) {
        if (value !== undefined && value !== null && value !== "")
          fields[key] = {
            value: String(value),
            source: "Apify · Google Maps",
            url: r.url,
            collectedAt: new Date().toISOString(),
            qualification: "Rapporté par Apify · à confirmer",
          };
      }
      for (const [index, email] of (Array.isArray(r.emails) ? r.emails : []).entries()) {
        if (index && typeof email === "string") fields[`email_${index + 1}`] = {
          value: email, source: "Apify · Google Maps", url: r.url,
          collectedAt: new Date().toISOString(), qualification: "Rapporté par Apify · à confirmer",
        };
      }
      const mapsUrl = canonicalMapsUrl(r.url);
      const featureId = typeof r.feature_id === 'string' && /^0x[0-9a-f]+:0x[0-9a-f]+$/i.test(r.feature_id) ? r.feature_id : null;
      const identity = r.placeId || r.cid || featureId || mapsUrl || createHash('sha256')
        .update(JSON.stringify([r.title, r.address || '', r.city || pending.city || '']))
        .digest('hex');
      return {
        id: `apify-${identity}`,
        name: r.title,
        category: r.categoryName || r.categories?.[0] || "Commerce",
        city: r.city || pending.city,
        address: r.address || "",
        lat: r.location?.lat ?? null,
        lng: r.location?.lng ?? null,
        website: r.website || "",
        email: r.emails?.[0] || "",
        phone: r.phone || "",
        rating: r.totalScore ?? null,
        reviews: r.reviewsCount ?? null,
        selected: false,
        status: "À contacter",
        demo: false,
        webStatus: r.website ? "Non vérifié" : "Pas de site renseigné",
        fields,
        socials: Object.fromEntries(
          ["instagram", "facebook", "linkedin", "whatsapp"]
            .filter((k) => fields[k])
            .map((k) => [k, fields[k].value]),
        ),
        hours: JSON.stringify(r.openingHours || []),
        photos: [r.imageUrl, ...(r.imageUrls || [])]
          .filter(Boolean)
          .slice(0, 10),
        engine: pending.engine,
      };
    });
  return {
    pending: false,
    items,
    cost: typeof run.usageTotalUsd === "number" ? run.usageTotalUsd : null,
    args: pending,
    status: run.status,
  };
}
export const acknowledgeApify = () => setSetting("apifyPending", null);
