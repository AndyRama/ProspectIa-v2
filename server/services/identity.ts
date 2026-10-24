import { createHash } from "node:crypto";
import type { Prospect } from "../types";
import { normalizedText } from "../searchQuery";

const compact = (s: string) => normalizedText(s).replace(/ /g, "");
const sourceId = (p: Prospect, key: string) => p.fields[key]?.value?.trim();
function addressParts(p: Prospect) {
  let value = normalizedText(p.address).replace(/\s+(france|polynesie francaise)$/, "");
  const city = normalizedText(p.city);
  if (city && (value === city || value.endsWith(" " + city))) value = value.slice(0, -city.length).trim();
  const postalCode = value.match(/\b\d{5}\b/)?.[0];
  return { street: value.replace(/\b\d{5}\b/g, "").replace(/ /g, ""), postalCode };
}
const site = (url: string) => {
  try { const u = new URL(url); return u.hostname.toLowerCase().replace(/^www\./, "") + u.pathname.replace(/\/+$/, ""); }
  catch { return ""; }
};

// Kept pure: importing the Apify lifecycle here would create a DB/search cycle.
export function canonicalMapsUrl(value: string | undefined): string | undefined {
  try {
    const u = new URL(value || "");
    if (u.protocol !== "https:" || u.username || u.password || u.port ||
        !/^(?:(?:www|maps)\.)?google\.(?:com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/.test(u.hostname) ||
        !/^\/maps(?:\/|$)/.test(u.pathname)) return;
    u.hash = "";
    u.pathname = u.pathname.replace(/\/+$/, "");
    // Drop only known presentation/tracking options; retain unknown selectors.
    for (const key of [...u.searchParams.keys()])
      if (/^(?:hl|gl|authuser|entry|g_ep|utm_.+)$/i.test(key)) u.searchParams.delete(key);
    u.searchParams.sort();
    if (u.pathname === "/maps" && !u.search) return;
    return u.href;
  } catch { return; }
}

function mapsId(url: string | undefined, pattern: RegExp, queryKey?: string): string | undefined {
  if (!url) return;
  const u = new URL(url);
  const queryId = queryKey ? u.searchParams.get(queryKey) : null;
  if (queryId && pattern.test(queryId)) return queryId;
  let path = u.pathname;
  try { path = decodeURIComponent(path); } catch { return; }
  const value = path.match(/!1s([^!/?]+)/)?.[1];
  return value && pattern.test(value) ? value : undefined;
}

export function sameEstablishment(a: Prospect, b: Prospect): boolean {
  if (a.demo !== b.demo) return false;
  if (a.id === b.id) return true;
  const siretA = sourceId(a, "siret"), siretB = sourceId(b, "siret");
  if (siretA && siretB) return siretA === siretB;
  const urlA = canonicalMapsUrl(sourceId(a, "googleMaps")), urlB = canonicalMapsUrl(sourceId(b, "googleMaps"));
  const placePattern = /^(ChIJ|GhIJ)[A-Za-z0-9_-]{23}$/;
  const placeA = sourceId(a, "placeId") || mapsId(urlA, placePattern, "query_place_id");
  const placeB = sourceId(b, "placeId") || mapsId(urlB, placePattern, "query_place_id");
  if (placeA && placeB) return placeA === placeB;
  const cidA = sourceId(a, "cid") || (urlA ? new URL(urlA).searchParams.get("cid") : undefined);
  const cidB = sourceId(b, "cid") || (urlB ? new URL(urlB).searchParams.get("cid") : undefined);
  // Never coerce a CID through Number: precision already lost cannot be repaired.
  if (cidA && cidB && /^\d+$/.test(cidA) && /^\d+$/.test(cidB)) return cidA === cidB;
  const featurePattern = /^0x[0-9a-f]+:0x[0-9a-f]+$/i;
  const featureA = sourceId(a, "featureId") || mapsId(urlA, featurePattern);
  const featureB = sourceId(b, "featureId") || mapsId(urlB, featurePattern);
  if (featureA && featureB && featurePattern.test(featureA) && featurePattern.test(featureB))
    return featureA.toLowerCase() === featureB.toLowerCase();
  // Unequal URL representations are not proof of physical difference, but must
  // not be overridden by the weaker shared-chain name/city/site fallback.
  if (urlA && urlB) return urlA === urlB;
  if (!compact(a.name) || compact(a.name) !== compact(b.name)) return false;
  if (a.city && b.city && compact(a.city) !== compact(b.city)) return false;
  const x = addressParts(a), y = addressParts(b);
  if (x.postalCode && y.postalCode && x.postalCode !== y.postalCode) return false;
  if (x.street && y.street) return x.street === y.street;
  // Un nom, un téléphone ou un domaine partagé ne suffisent jamais seuls.
  return !!a.city && !!b.city && !!site(a.website) && site(a.website) === site(b.website);
}

/** Conserve le suivi utilisateur et les valeurs sourcées, y compris les anciennes variantes. */
export function mergeProspects(old: Prospect, incoming: Prospect): Prospect {
  const fields = { ...old.fields };
  for (const [key, value] of Object.entries(incoming.fields)) {
    const previous = fields[key];
    if (previous && JSON.stringify(previous) !== JSON.stringify(value)) {
      const suffix = createHash("sha256").update(JSON.stringify(previous)).digest("hex").slice(0, 16);
      fields[`archive_${key}_${suffix}`] = previous;
    }
    fields[key] = value;
  }
  const website = incoming.website || old.website;
  const keepAudit = old.audit && site(old.website) === site(website);
  const result: Prospect = { ...old, ...incoming, id: old.id, fields,
    archived: !!old.archived || !!incoming.archived,
    selected: (old.archived || incoming.archived) ? false : old.selected || incoming.selected,
    status: old.status !== "À contacter" ? old.status : incoming.status,
    doNotContact: !!old.doNotContact || !!incoming.doNotContact,
    website, email: keepAudit ? old.email || incoming.email : incoming.email || old.email,
    phone: keepAudit ? old.phone || incoming.phone : incoming.phone || old.phone,
    name: incoming.name || old.name, address: incoming.address || old.address, city: incoming.city || old.city,
    hours: incoming.hours || old.hours, lat: incoming.lat ?? old.lat, lng: incoming.lng ?? old.lng,
    rating: incoming.rating ?? old.rating, reviews: incoming.reviews ?? old.reviews,
    photos: [...new Set([...old.photos, ...incoming.photos])], socials: { ...old.socials, ...incoming.socials },
    audit: keepAudit ? old.audit : incoming.audit,
    webStatus: keepAudit ? old.webStatus : website ? "Non vérifié" : incoming.webStatus,
  };
  if (keepAudit) for (const key of ["email", "phone"]) {
    if (old.fields[key]) result.fields[key] = old.fields[key];
  }
  delete result.duplicateOf;
  return result;
}

/** Aucun effacement : chaque doublon reste en base avec sa redirection et ses données. */
export function consolidateProspects(rows: Prospect[]): Prospect[] {
  const canonical: Prospect[] = [], changes = new Map<string, Prospect>();
  for (const row of rows) {
    if (row.duplicateOf) continue;
    const index = canonical.findIndex((p) => sameEstablishment(p, row));
    if (index < 0) canonical.push(row);
    else {
      const merged = mergeProspects(canonical[index], row);
      canonical[index] = merged; changes.set(merged.id, merged);
      changes.set(row.id, { ...row, duplicateOf: merged.id });
    }
  }
  return [...changes.values()];
}
