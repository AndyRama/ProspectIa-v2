import type { Engine, Prospect, Source } from "../types";
import { jsonRequest } from "./http";
import type { GeoLocation } from "./osm";
import { matchesKeyword, trade } from "./trades";

// API publique de l'Annuaire des Entreprises (Sirene), France uniquement.
const codes: Record<string, string> = {
  restaurant: "56.10A,56.10B,56.10C,56.30Z",
  artisan: "43.21A,43.22A,43.22B,43.32A,43.34Z,43.91B,45.20A",
  beauty: "96.02A,96.02B", hotel: "55.10Z,55.20Z",
};
export async function searchRegistry(location: GeoLocation, activity: string, keyword: string, max: number, engine: Engine): Promise<Prospect[]> {
  const query = new URLSearchParams({ lat: String(location.lat), long: String(location.lng),
    radius: "6", per_page: String(Math.min(max, 25)), etat_administratif: "A" });
  const filter = ["all", "artisan"].includes(activity) ? trade(keyword)?.naf || codes[activity] : codes[activity];
  if (filter) query.set("activite_principale", filter);
  const companies: any[] = [], seen = new Set<string>(), started = Date.now();
  for (let page = 1; page <= Math.min(3, Math.ceil(max / 25)); page++) {
    query.set("page", String(page));
    const data = await jsonRequest(`https://recherche-entreprises.api.gouv.fr/near_point?${query}`, { headers: { Accept: "application/json" } });
    if (!Array.isArray(data.results)) throw Error("Réponse du registre public non reconnue.");
    const fresh = data.results.filter((company: any) => {
      const key = String(company.siren || JSON.stringify(company));
      if (seen.has(key)) return false; seen.add(key); return true;
    });
    companies.push(...fresh);
    if (!fresh.length || data.results.length < 25 || page >= data.total_pages || Date.now() - started > 20000) break;
  }
  const collectedAt = new Date().toISOString();
  return companies.flatMap((company: any) => {
    const establishments = company.matching_etablissements || [company.siege];
    return establishments.filter(Boolean).filter((e: any) => e.etat_administratif !== "F").map((e: any): Prospect => {
      const name = e.nom_commercial || e.liste_enseignes?.[0] || company.nom_complet || company.nom_raison_sociale;
      const category = e.activite_principale || company.activite_principale || "";
      const sourceUrl = `https://annuaire-entreprises.data.gouv.fr/etablissement/${encodeURIComponent(e.siret || company.siren)}`;
      const values = { name, address: e.adresse || "", city: e.libelle_commune || "", siret: e.siret || "", category,
        latitude: e.latitude, longitude: e.longitude };
      const fields = Object.fromEntries(Object.entries(values).filter(([, v]) => !!v).map(([key, value]) =>
        [key, { value: String(value), source: "Annuaire des Entreprises · Sirene", url: sourceUrl, collectedAt,
          qualification: "Information publique du registre, à confirmer" } satisfies Source]));
      return { id: `sirene-${e.siret || company.siren}`, name, category: `Activité NAF ${category}`,
        city: values.city, address: values.address, lat: e.latitude && Number.isFinite(Number(e.latitude)) ? Number(e.latitude) : null,
        lng: e.longitude && Number.isFinite(Number(e.longitude)) ? Number(e.longitude) : null,
        website: "", email: "", phone: "", rating: null, reviews: null, selected: false,
        status: "À contacter", demo: false, webStatus: "Non vérifié", fields, socials: {}, hours: "", photos: [], engine };
    });
  }).filter((p: Prospect) => p.name && matchesKeyword(keyword, p.name, p.category)).slice(0, max);
}
