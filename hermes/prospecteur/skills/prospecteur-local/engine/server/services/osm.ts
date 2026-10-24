import type { Engine, Prospect, Source } from "../types";
import { jsonRequest } from "./http";
import { matchesKeyword, trade } from "./trades";
export const osmFilters: Record<string, string> = {
  all: '[~"^(shop|craft|amenity|tourism)$"~"."]',
  restaurant: '[amenity~"^(restaurant|cafe|bar|fast_food)$"]',
  artisan: "[craft]",
  beauty: '[shop~"^(hairdresser|beauty)$"]',
  hotel: '[tourism~"^(hotel|guest_house|hostel)$"]',
  retail: "[shop]",
};
export type GeoLocation = { lat: number; lng: number; countryCode: string };
export async function geocode(city: string): Promise<GeoLocation> {
  const locations = await jsonRequest(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&q=${encodeURIComponent(city)}`,
    { headers: { "User-Agent": "ProspectAI/1.0 local professional research", "Accept-Language": "fr" } },
  );
  if (!locations.length) throw Error("Ville introuvable. Précisez la ville et le pays.");
  return { lat: Number(locations[0].lat), lng: Number(locations[0].lon), countryCode: locations[0].address?.country_code || "" };
}
export async function searchOSM(
  city: string,
  activity: string,
  keyword: string,
  max: number,
  engine: Engine,
  location?: GeoLocation,
) {
  const { lat, lng } = location || await geocode(city);
  const targeted =
    activity === "all"
      ? engine === "voice"
        ? "artisan"
        : engine === "menu"
          ? "restaurant"
          : "all"
      : activity;
  const filter = ["artisan", "all"].includes(targeted) ? trade(keyword)?.osm : undefined;
  const query = `[out:json][timeout:25];nwr(around:6000,${lat},${lng})${filter || osmFilters[targeted] || osmFilters.all}[name];out center tags ${max};`;
  let data: any;
  let lastError: unknown;
  for (const endpoint of [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
  ]) {
    try {
      data = await jsonRequest(
        endpoint + "?" + new URLSearchParams({ data: query }),
        {
          headers: {
            "User-Agent": "ProspectAI/1.0 local professional research",
            Accept: "application/json",
          },
        },
      );
      break;
    } catch (e) {
      lastError = e;
    }
  }
  if (!data)
    throw Error(
      `Recherche OSM indisponible : ${(lastError as Error)?.message}. Réessayez plus tard ou importez un CSV.`,
    );
  return (data.elements as any[])
    .filter((x) => x.tags?.name)
    .filter(
      (x) =>
        matchesKeyword(keyword, x.tags.name, x.tags.craft || x.tags.cuisine || x.tags.shop || ""),
    )
    .slice(0, max)
    .map((x): Prospect => {
      const t = x.tags;
      const url = `https://www.openstreetmap.org/${x.type}/${x.id}`;
      const fields: Record<string, Source> = {};
      for (const [key, value] of Object.entries({
        name: t.name,
        website: t.website || t["contact:website"],
        email: t.email || t["contact:email"],
        phone: t.phone || t["contact:phone"],
        hours: t.opening_hours,
        category: t.cuisine || t.craft || t.shop || t.amenity || t.tourism,
        city: t["addr:city"] || city,
        latitude: x.lat ?? x.center?.lat,
        longitude: x.lon ?? x.center?.lon,
        address: [t["addr:housenumber"], t["addr:street"], t["addr:city"]]
          .filter(Boolean)
          .join(" "),
      })) {
        if (value)
          fields[key] = {
            value: String(value),
            source: "OpenStreetMap",
            url,
            collectedAt: new Date().toISOString(),
            qualification: "Information publique, à confirmer",
          };
      }
      const socials: Record<string, string> = {};
      for (const key of ["instagram", "facebook", "linkedin", "whatsapp"])
        if (t[`contact:${key}`]) {
          socials[key] = t[`contact:${key}`];
          fields[key] = {
            value: t[`contact:${key}`],
            source: "OpenStreetMap",
            url,
            collectedAt: new Date().toISOString(),
            qualification: "Lien public, à confirmer",
          };
        }
      return {
        id: `osm-${x.type}-${x.id}`,
        name: t.name,
        category:
          t.cuisine ||
          t.craft ||
          t.shop ||
          t.amenity ||
          t.tourism ||
          "Commerce",
        city: t["addr:city"] || city,
        address: fields.address?.value || city,
        lat: x.lat ?? x.center?.lat ?? null,
        lng: x.lon ?? x.center?.lon ?? null,
        website: fields.website?.value || "",
        email: fields.email?.value || "",
        phone: fields.phone?.value || "",
        rating: null,
        reviews: null,
        selected: false,
        status: "À contacter",
        demo: false,
        webStatus: fields.website ? "Non vérifié" : "Pas de site renseigné",
        fields,
        socials,
        hours: t.opening_hours || "",
        photos: [],
        engine,
      };
    });
}
