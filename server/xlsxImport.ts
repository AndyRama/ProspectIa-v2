import { createHash } from "node:crypto";
import { validPlaceId } from "./services/apifyPlan";
import type { Prospect } from "./types";
import { validateXlsxArchive } from "./xlsxArchive";
import readXlsxFile from "read-excel-file/node";
import { z } from "zod";

export const xlsxSchema = z.object({ fileName: z.string().min(1).max(255), data: z.string().min(1), sheet: z.string().min(1).max(31).optional() }).strict();
type Row = { name: string; city: string; website: string; email: string; phone: string; address: string; category: string; placeId: string };
const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const aliases: Record<keyof Row, string[]> = {
  name: ["nom", "entreprise", "raisonsociale", "name", "company", "companyname"], city: ["ville", "city", "town"],
  website: ["siteweb", "site", "website", "url"], email: ["email", "courriel", "mail"],
  phone: ["telephone", "tel", "phone"], address: ["adresse", "address"], category: ["categorie", "category"], placeId: ["placeid", "googleplaceid"],
};
async function readValidatedWorkbook(input: z.infer<typeof xlsxSchema>) {
  if (!/\.xlsx$/i.test(input.fileName)) throw Error("Seuls les fichiers .xlsx sont acceptés.");
  const tooLarge = () => Object.assign(Error("Fichier trop volumineux : maximum 5 MiB (JSON maximum 8 MiB)."), { status: 413 });
  if (input.data.length > 4 * Math.ceil(5 * 1024 * 1024 / 3)) throw tooLarge();
  if (input.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.data)) throw Error("Encodage base64 invalide.");
  const buffer = Buffer.from(input.data, "base64");
  if (buffer.length > 5 * 1024 * 1024) throw tooLarge();
  if (buffer.toString("base64") !== input.data) throw Error("Encodage base64 invalide.");
  await validateXlsxArchive(buffer);
  // Preserve raw numeric lexemes without IEEE-754 coercion. Numeric phone / ID
  // cells are refused because number formats may hide already-lost zeroes.
  return readXlsxFile(buffer, { parseNumber: raw => ({ raw }) });
}
function chooseSheet(sheets: Awaited<ReturnType<typeof readValidatedWorkbook>>, selected?: string) {
  const chosen = selected ? sheets.find(s => s.sheet === selected) : sheets.find(s => s.data.length) || sheets[0];
  if (!chosen) throw Error("Feuille Excel introuvable.");
  return chosen;
}
export async function listXlsxSheets(input: z.infer<typeof xlsxSchema>) {
  const sheets = await readValidatedWorkbook(input);
  return { sheets: sheets.map(s => s.sheet), sheet: chooseSheet(sheets, input.sheet).sheet };
}
export async function parseXlsx(input: z.infer<typeof xlsxSchema>) {
  const sheets = await readValidatedWorkbook(input);
  const chosen = chooseSheet(sheets, input.sheet);
  const [header = [], ...data] = chosen.data;
  const columns = Object.fromEntries(Object.entries(aliases).map(([key, names]) => [key, header.findIndex(h => names.includes(normalize(String(h ?? ""))))])) as Record<keyof Row, number>;
  if (columns.name < 0) throw Error("Colonne Nom / Entreprise requise.");
  const rows: Row[] = data.filter(r => r.some(c => c !== null && c !== "")).map((r, i) => {
    const row = Object.fromEntries(Object.entries(columns).map(([key, index]) => {
      const value = index < 0 ? "" : r[index];
      if (value instanceof Date || typeof value === "boolean") throw Error(`Date ou booléen non accepté : utilisez du texte à la ligne ${i + 2}.`);
      if (value && typeof value === "object") {
        if (key === "phone" || key === "placeId") throw Error(`Téléphone et identifiant doivent être au format texte à la ligne ${i + 2} pour conserver leurs zéros initiaux.`);
        return [key, value.raw];
      }
      return [key, String(value ?? "").trim()];
    })) as Row;
    if (!row.name) throw Error(`Nom manquant à la ligne ${i + 2}.`);
    if (row.placeId && !validPlaceId(row.placeId)) throw Error(`Place ID Google Maps invalide à la ligne ${i + 2}.`);
    if (row.website) {
      try {
        const url = new URL(row.website);
        if (!/^https?:\/\//i.test(row.website) || !["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) throw Error();
      } catch { throw Error(`URL invalide à la ligne ${i + 2}.`); }
    }
    return row;
  });
  if (rows.length > 200) throw Error("Import limité à 200 entreprises.");
  return { sheets: sheets.map(s => s.sheet), sheet: chosen.sheet, rows, count: rows.length, warnings: ["Informations importées, non vérifiées. Aucun enrichissement ni contact automatique."] };
}
export function xlsxProspects(rows: Row[]): Prospect[] {
  const collectedAt = new Date().toISOString();
  return rows.map(row => {
    const { placeId, ...values } = row;
    const fields: Prospect["fields"] = {};
    for (const [key, value] of Object.entries(row)) if (value) fields[key] = { value, source: "Import Excel", collectedAt, qualification: "Information importée, non vérifiée" };
    return {
      ...values, category: row.category || "Commerce",
      id: "import-" + createHash("sha256").update(JSON.stringify([row.name, row.website, row.city, row.address, placeId])).digest("hex"),
      lat: null, lng: null, rating: null, reviews: null, selected: false, status: "À contacter", demo: false,
      webStatus: "Non vérifié", fields, socials: {}, hours: "", photos: [], engine: "website",
    };
  });
}
export function previewXlsx(parsed: Awaited<ReturnType<typeof parseXlsx>>) {
  return { ...parsed, rows: parsed.rows.map(({ placeId, ...row }) => row) };
}
