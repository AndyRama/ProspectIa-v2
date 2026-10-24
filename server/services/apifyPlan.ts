import { createHash } from "node:crypto";
import { db, list, prospect } from "../db";
import type { Prospect, Search } from "../types";

export const validPlaceId = (id: string) => /^(ChIJ|GhIJ)[A-Za-z0-9_-]{23}$/.test(id);
export async function billedPlaceIds(): Promise<Set<string>> {
  const raw = (await db.execute("SELECT data FROM prospects")).rows.map((r) => JSON.parse(String(r.data)) as Prospect);
  const paidRefs = new Set((await list<Search>("searches")).filter((s) => s.provider === "Apify").flatMap((s) => s.ids));
  const ids = new Set((await db.execute("SELECT place_id FROM apify_place_claims")).rows.map((r) => String(r.place_id)));
  for (const p of raw) {
    const paid = p.id.startsWith("apify-") || paidRefs.has(p.id) || Object.values(p.fields).some((f) => /Apify/.test(f.source));
    if (!paid) continue;
    if (p.id.startsWith("apify-")) ids.add(p.id.slice(6));
    for (const [key, f] of Object.entries(p.fields)) if (key === "placeId" || key.startsWith("archive_placeId_")) ids.add(f.value);
  }
  return ids;
}
export async function planEnrichment(prospectIds: string[]) {
  const billed = await billedPlaceIds();
  const candidates: { prospectId: string; name: string; placeId: string }[] = [];
  let excluded = 0, missing = 0;
  const seen = new Set<string>();
  for (const id of new Set(prospectIds)) {
    const p = await prospect(id), placeId = p?.fields.placeId?.value || "";
    if (p?.archived) { excluded++; continue; }
    if (!p || p.demo || !validPlaceId(placeId)) { missing++; continue; }
    if (billed.has(placeId) || p.id.startsWith("apify-") || seen.has(placeId)) { excluded++; continue; }
    seen.add(placeId); candidates.push({ prospectId: p.id, name: p.name, placeId });
  }
  const batch = candidates.slice(0, 25);
  const planId = createHash("sha256").update(JSON.stringify(batch.map((p) => [p.prospectId, p.placeId]))).digest("hex");
  return { planId, candidates: batch, excluded, missing, remaining: Math.max(0, candidates.length - 25),
    message: batch.length ? `${batch.length} identifiant(s) inédit(s) vérifiés avant paiement.` : "Aucun identifiant Google Maps inédit : aucun paiement ne peut être lancé. Les fiches déjà collectées sont exclues ; importez des candidats avec une colonne placeId pour un enrichissement ciblé." };
}
