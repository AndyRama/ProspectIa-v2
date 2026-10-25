import yauzl from "yauzl";
import { SaxesParser } from "saxes";

const MAX_EXPANDED = 20 * 1024 * 1024;
const MAX_ENTRIES = 1000;

// SAX, not a DOM: the ZIP byte budget bounds input, and depth is bounded before
// the Excel parser can build its own structures. Attribute values are decoded
// by the XML parser (including quoted '>' and numeric character references).
function validateXml(text: string): void {
  if (text.includes("\0") || /<!\s*(?:DOCTYPE|ENTITY)/i.test(text)) throw Error("XML dangereux : DTD et entités externes interdits.");
  if (/macroEnabled|vbaProject/i.test(text)) throw Error("Les macros ne sont pas acceptées.");
  let depth = 0, sheetData = false, maxRow = 0, maxColumn = 0, cells = 0, rows = 0;
  const dimensions = () => {
    if (maxRow > 10000 || maxColumn > 256 || maxRow * maxColumn > 100000) throw Error("Dimensions de feuille trop grandes (10000 lignes, 256 colonnes, 100000 cellules maximum).");
  };
  const parser = new SaxesParser({ xmlns: true });
  parser.on("error", () => { throw Error("XML invalide ou mal formé."); });
  parser.on("opentag", tag => {
    if (++depth > 128) throw Error("XML trop profondément imbriqué.");
    if (tag.local === "f") throw Error("Les formules Excel ne sont pas acceptées, même avec une valeur en cache. Remplacez-les par du texte.");
    // Apply to every XML part, not just xl/worksheets/*.xml. Once sheetData
    // occurs, keep guarding subsequent rows/cells just like read-excel-file.
    if (tag.local === "sheetData") sheetData = true;
    if (!sheetData || (tag.local !== "row" && tag.local !== "c")) return;
    if (tag.local === "row") {
      if (++rows > 10000) throw Error("Dimensions de feuille trop grandes (10000 lignes maximum).");
      // Missing row coordinates are implicit, never unlimited.
      maxRow++;
    } else if (++cells > 100000) throw Error("Feuille limitée à 100000 cellules.");
    const ref = tag.attributes.r?.value;
    if (ref === undefined && tag.local === "row") { dimensions(); return; }
    const coordinate = tag.local === "row" ? /^(\d+)$/.exec(ref ?? "") : /^([A-Z]+)(\d+)$/.exec(ref ?? "");
    if (!coordinate) throw Error("Dimensions de feuille invalides.");
    const row = Number(coordinate[tag.local === "row" ? 1 : 2]);
    const column = tag.local === "row" ? 0 : [...coordinate[1]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
    if (row < 1) throw Error("Dimensions de feuille invalides.");
    maxRow = Math.max(maxRow, row); maxColumn = Math.max(maxColumn, column);
    dimensions();
  });
  parser.on("closetag", () => { depth--; });
  for (let offset = 0; offset < text.length; offset += 65536) parser.write(text.slice(offset, offset + 65536));
  parser.close();
}

// Inspect every entry using a lazy, size-validating ZIP reader before the Excel
// parser gets the original buffer. Never write entries or follow relationships.
export function validateXlsxArchive(buffer: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => {
      if (error || !zip) return reject(Error("Archive XLSX invalide ou corrompue."));
      let settled = false, entries = 0, declared = 0, expanded = 0;
      const names = new Set<string>();
      const fail = (error: Error) => { if (!settled) { settled = true; zip.close(); reject(error); } };
      zip.on("error", () => fail(Error("Archive XLSX invalide ou corrompue.")));
      if (zip.entryCount > MAX_ENTRIES) return fail(Error("Archive limitée à 1000 entrées."));
      zip.on("entry", entry => {
        if (settled) return;
        if (++entries > MAX_ENTRIES) return fail(Error("Archive limitée à 1000 entrées."));
        declared += entry.uncompressedSize;
        if (declared > MAX_EXPANDED) return fail(Error("Archive décompressée limitée à 20 MiB."));
        const name = entry.fileName;
        if (names.has(name) || name.includes("\\") || name.startsWith("/") || name.split("/").includes("..")) return fail(Error("Entrée ZIP invalide ou dupliquée."));
        names.add(name);
        if (/vbaproject|macrosheets|activex/i.test(name)) return fail(Error("Les macros ne sont pas acceptées."));
        if (entry.generalPurposeBitFlag & 1) return fail(Error("Les archives chiffrées ne sont pas acceptées."));
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream) return fail(Error("Entrée ZIP illisible."));
          const chunks: Buffer[] = [];
          const xml = /\.(?:xml|rels)$/i.test(name);
          stream.on("error", () => fail(Error("Entrée ZIP invalide ou corrompue.")));
          stream.on("data", (chunk: Buffer) => {
            expanded += chunk.length;
            if (expanded > MAX_EXPANDED || settled) { stream.destroy(); return fail(Error("Archive décompressée limitée à 20 MiB.")); }
            chunks.push(chunk);
          });
          stream.on("end", () => {
            if (settled) return;
            const data = Buffer.concat(chunks);
            // Also inspect XML with nonstandard/extensionless names. Binary
            // assets remain opaque; all decoded XML is bounded by ZIP budgets.
            const text = data.toString("utf8");
            if (xml || text.trimStart().startsWith("<")) {
              try {
                validateXml(new TextDecoder("utf-8", { fatal: true }).decode(data));
              } catch (error) {
                return fail(error instanceof Error ? error : Error("XML invalide."));
              }
            }
            zip.readEntry();
          });
        });
      });
      zip.on("end", () => {
        if (settled) return;
        if (!names.has("[Content_Types].xml") || !names.has("xl/workbook.xml")) return fail(Error("Classeur XLSX invalide."));
        settled = true; zip.close(); resolve();
      });
      zip.readEntry();
    });
  });
}
