import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Server } from "node:http";
import writeXlsxFile, { type SheetData } from "write-excel-file/node";
import { zipSync, unzipSync, strToU8 } from "fflate";

let dir: string, base: string, server: Server, cookie = "";
let store: typeof import("../server/db");
const env = { ...process.env }, realFetch = globalThis.fetch;
let externalCalls = 0;
const headers = ["Nom", "Ville", "Site web", "Email", "Téléphone", "Adresse", "Catégorie", "Place ID"];
const example = ["Atelier Zéro", "Paris", "https://atelier.example/", "contact@atelier.example", "0012345678", "1 rue Test", "Artisan", "ChIJ" + "a".repeat(23)];
const table = (rows: unknown[][]): SheetData => rows.map(row => row.map(value => value == null ? null : ({ value, ...(value instanceof Date ? { format: "yyyy-mm-dd" } : {}), type: value instanceof Date ? Date : typeof value === "number" ? Number : String } as any)));
async function fixture(rows: unknown[][] = [headers, example], otherSheets: { sheet: string; data: SheetData }[] = []) {
  const buffer = await writeXlsxFile([{ sheet: "Vide", data: [] }, { sheet: "Prospects", data: table(rows) }, ...otherSheets]).toBuffer();
  await writeFile(path.join(dir, "fixture.xlsx"), buffer);
  return { fileName: "prospects.xlsx", data: buffer.toString("base64") };
}
const post = (route: string, body: unknown, extra: Record<string, string> = {}) => realFetch(base + "/api/import/xlsx" + route, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie, ...extra }, body: JSON.stringify(body) });
const request = (route: string, body?: unknown, method = body === undefined ? "GET" : "POST") => realFetch(base + "/api" + route, { method, headers: { "Content-Type": "application/json", Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
before(async () => {
  for (const key of Object.keys(process.env)) if (/TURSO|VERCEL|APIFY|SMTP|AI_API|APP_PASSWORD|PROSPECTIA_AGENT_TOKEN|DATA_ENCRYPTION|PROXY/i.test(key)) delete process.env[key];
  const scratch = process.env.TMPDIR || "/opt/data/cache/scratch"; await mkdir(scratch, { recursive: true });
  dir = await mkdtemp(path.join(scratch, "prospectia-xlsx-"));
  Object.assign(process.env, { DATA_DIR: dir, APP_PASSWORD: "xlsx-fixture-password-only", DOTENV_CONFIG_PATH: path.join(dir, "absent.env"), VERCEL: "1", DATA_ENCRYPTION_KEY: "a".repeat(64) });
  const app = (await import("../server/index")).default; delete process.env.VERCEL;
  store = await import("../server/db");
  server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  globalThis.fetch = async () => { externalCalls++; throw Error("External networking prohibited"); };
  const login = await request("/auth/login", { password: process.env.APP_PASSWORD }); assert.equal(login.status, 200);
  cookie = login.headers.get("set-cookie")!.split(";")[0];
});
after(async () => {
  globalThis.fetch = realFetch;
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  if (store) await store.db.close(); if (dir) await rm(dir, { recursive: true, force: true });
  for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]; Object.assign(process.env, env);
});

test("XLSX commit requires confirmation, reparses and preserves archive/opposition/history on duplicate reimport", async () => {
  const input = await fixture();
  for (const patch of [{}, { confirmed: false }, { confirmed: true, rows: [] }]) assert.equal((await post("", { ...input, ...patch })).status, 400);
  const response = await post("", { ...input, confirmed: true }); assert.equal(response.status, 200);
  const saved = await response.json(); assert.equal(saved.prospects.length, 1); assert.equal(saved.search.provider, "Import Excel"); assert.equal(saved.search.cost, 0);
  const p = saved.prospects[0]; assert.equal(p.name, example[0]); assert.equal(p.phone, "0012345678"); assert.equal(p.demo, false); assert.equal(p.webStatus, "Non vérifié");
  for (const field of ["name", "city", "website", "email", "phone", "address", "category", "placeId"]) {
    assert.equal(p.fields[field].source, "Import Excel"); assert.match(p.fields[field].qualification, /non vérifi/i); assert.ok(p.fields[field].value);
  }
  assert.equal((await request(`/prospects/${p.id}`, { archived: true, doNotContact: true, status: "Contacté" }, "PATCH")).status, 200);
  const again = await post("", { ...input, confirmed: true }).then(r => r.json());
  assert.equal(again.search.newCount, 0); assert.equal(again.search.knownCount, 1); assert.equal(again.prospects[0].id, p.id);
  await store.db.close(); // Reopen the real SQLite file, not an in-memory snapshot.
  const reopened = await request(`/searches/${saved.search.id}`).then(r => r.json());
  assert.equal(reopened.prospects[0].archived, true); assert.equal(reopened.prospects[0].doNotContact, true); assert.equal(reopened.prospects[0].status, "Contacté"); assert.equal(reopened.prospects[0].selected, false);
  const exported = await request("/export").then(r => r.json()); assert.ok(exported.suppressions.some((s: any) => s.email === example[3])); assert.equal(externalCalls, 0);
});

test("XLSX guards strict payloads, invalid data and workbook/row validation without writes", async () => {
  const input = await fixture(); const before = await request("/state").then(r => r.json());
  for (const route of ["", "/preview"]) {
    assert.equal((await post(route, { ...input, confirmed: true }, { Cookie: "" })).status, 401);
    assert.equal((await post(route, input, { Origin: "https://evil.example" })).status, 403);
  }
  for (const patch of [{ rows: [] }, { confirmed: true }, { data: "" }, { data: "abcd\n" }, { data: "!!!!" }, { data: "YQ===" }, { data: "YR==" }, { fileName: "bad.xls" }, { fileName: "bad.xlsm" }, { sheet: "Missing" }]) {
    const r = await post("/preview", { ...input, ...patch }); assert.ok(r.status >= 400, JSON.stringify(patch));
  }
  for (const rows of [ [["Ville"], ["Paris"]], [headers, ["", "Paris"]], [headers, ["Valid", "", "javascript:alert(1)"]], [headers, ["Valid", "", "https://"]], [headers, [...example.slice(0, 7), "not-a-place-id"]], [headers, ...Array.from({ length: 201 }, () => example)] ]) {
    const invalid = await fixture(rows);
    for (const route of ["/preview", ""]) assert.equal((await post(route, { ...invalid, ...(route ? {} : { confirmed: true }) })).status, 422);
  }
  assert.equal((await post("/preview", { fileName: "bad.xlsx", data: Buffer.from("not zip").toString("base64") })).status, 422);
  assert.deepEqual(await request("/state").then(r => r.json()), before);
});

test("XLSX lists validated workbook sheets independently of invalid first-sheet rows and imports only the selected valid sheet", async () => {
  for (const rows of [[["Instructions"], ["Lire avant import"]], [headers, ["Invalid first", "", "javascript:alert(1)"]]]) {
    const input = await fixture(rows, [{ sheet: "Valide", data: table([headers, ["Seconde valide", ...example.slice(1)]]) }]);
    const before = await request("/state").then(r => r.json());
    const listed = await post("/sheets", input); assert.equal(listed.status, 200);
    assert.deepEqual(await listed.json(), { sheets: ["Vide", "Prospects", "Valide"], sheet: "Prospects" });
    for (const route of ["/preview", ""]) assert.equal((await post(route, { ...input, ...(route ? {} : { confirmed: true }) })).status, 422);
    assert.deepEqual(await request("/state").then(r => r.json()), before);
    const preview = await post("/preview", { ...input, sheet: "Valide" }).then(r => r.json());
    assert.equal(preview.rows[0].name, "Seconde valide");
    assert.equal((await post("", { ...input, sheet: "Valide" })).status, 400);
    const saved = await post("", { ...input, sheet: "Valide", confirmed: true }); assert.equal(saved.status, 200);
    assert.equal((await saved.json()).prospects[0].name, "Seconde valide");
  }
  const input = await fixture();
  assert.equal((await post("/sheets", input, { Cookie: "" })).status, 401);
  assert.equal((await post("/sheets", input, { Origin: "https://evil.example" })).status, 403);
  for (const patch of [{ rows: [] }, { confirmed: true }, { data: "!!!!" }, { fileName: "bad.xls" }]) assert.ok((await post("/sheets", { ...input, ...patch })).status >= 400);
  assert.equal(externalCalls, 0);
});

test("XLSX handles multisheet choice, English aliases, blank and date cells, text identifiers, header-only template", async () => {
  const input = await fixture([headers], [{ sheet: "Other", data: table([["Raison sociale", "City", "Website", "Phone", "Google place id", "Code postal"], ["Other Co", "", "", "0123456789", "ChIJ" + "b".repeat(23), "00123"]]) }]);
  const empty = await post("/preview", input).then(r => r.json()); assert.equal(empty.sheet, "Prospects"); assert.equal(empty.count, 0);
  assert.equal((await post("", { ...input, confirmed: true })).status, 422);
  const other = await post("/preview", { ...input, sheet: "Other" }).then(r => r.json()); assert.equal(other.count, 1); assert.equal(other.rows[0].phone, "0123456789");
  const english = await fixture([["name", "city", "website", "email", "phone", "address", "category"], ["English", null, null, null, "000123", null, null], []]);
  const englishPreview = await post("/preview", english).then(r => r.json()); assert.equal(englishPreview.count, 1); assert.equal(englishPreview.rows[0].city, ""); assert.equal(englishPreview.rows[0].phone, "000123");
  const dates = await fixture([["Nom", "Téléphone"], ["Date", new Date("2026-01-01T00:00:00Z")]]);
  const dateResponse = await post("/preview", dates); assert.equal(dateResponse.status, 422); assert.match((await dateResponse.json()).error, /date|texte/i);
  const allowed = await fixture([headers, ...Array.from({ length: 200 }, () => example)]); assert.equal((await post("/preview", allowed)).status, 200);
});

test("XLSX rejects formulas including cached values, unsafe XML/macros and bounded ZIP bombs before parsing", async () => {
  const input = await fixture();
  const original = unzipSync(Buffer.from(input.data, "base64"));
  const make = (files: Record<string, Uint8Array>) => ({ fileName: "unsafe.xlsx", data: Buffer.from(zipSync(files)).toString("base64") });
  const xml = new TextDecoder().decode(original["xl/worksheets/sheet2.xml"]);
  const before = await request("/state").then(r => r.json());
  const cases = [
    { files: { ...original, "xl/worksheets/sheet2.xml": strToU8(xml.replace(/<c\b[^>]*r="A2"[^>]*>[\s\S]*?<\/c>/, '<c r="A2"><f>HYPERLINK("https://evil.example","Test")</f><v>42</v></c>')) }, error: /formule/i },
    { files: { ...original, "unsafe.xml": strToU8('<!DOCTYPE x [<!ENTITY ext SYSTEM "https://evil.example">]><x>&ext;</x>') }, error: /XML|DTD|entit/i },
    { files: { ...original, "xl/vbaProject.bin": strToU8("macro") }, error: /macro/i },
    { files: { ...original, "padding.bin": new Uint8Array(20 * 1024 * 1024) }, error: /20|décompress/i },
    { files: { ...original, ...Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [`extra/${i}`, new Uint8Array()])) }, error: /1000|entrées/i },
  ];
  for (const item of cases) {
    for (const route of ["/sheets", "/preview", ""]) {
      const response = await post(route, { ...make(item.files), ...(route ? {} : { confirmed: true }) });
      assert.equal(response.status, 422); assert.match((await response.json()).error, item.error);
    }
  }
  assert.deepEqual(await request("/state").then(r => r.json()), before); assert.equal(externalCalls, 0);
});

test("XLSX has a scoped 8 MiB JSON ceiling and a 5 MiB file ceiling with clear 413 and no writes", async () => {
  const before = await request("/state").then(r => r.json());
  const input = await fixture(); const files = unzipSync(Buffer.from(input.data, "base64"));
  // Incompressible, harmless unused ZIP entry makes a genuine >2 MiB workbook.
  const { randomBytes } = await import("node:crypto");
  files["padding.bin"] = randomBytes(2 * 1024 * 1024);
  const large = { ...input, data: Buffer.from(zipSync(files)).toString("base64") };
  assert.equal((await post("/preview", large)).status, 200);
  assert.equal((await post("/sheets", large)).status, 200);
  for (const size of [5 * 1024 * 1024 + 1, 7 * 1024 * 1024]) {
    for (const route of ["/sheets", ""]) {
      const response = await post(route, { ...input, data: Buffer.alloc(size).toString("base64"), ...(route ? {} : { confirmed: true }) });
      assert.equal(response.status, 413); assert.match((await response.json()).error, /volumineux|5 MiB|8 MiB/i);
    }
  }
  const legacy = await request("/import", { text: "x".repeat(3 * 1024 * 1024) }); assert.equal(legacy.status, 413);
  assert.deepEqual(await request("/state").then(r => r.json()), before);
});

test("XLSX refuses numeric phone/identifiers rather than silently dropping formatted leading zeroes", async () => {
  for (const header of ["Téléphone", "Place ID"]) {
    const buffer = await writeXlsxFile(table([["Nom", header], ["Numeric", 123456789]]), { sheet: "Prospects" }).toBuffer();
    const response = await post("/preview", { fileName: "numbers.xlsx", data: buffer.toString("base64") });
    assert.equal(response.status, 422); assert.match((await response.json()).error, /texte/i);
  }
});

test("XLSX bounds sparse worksheet coordinates before allocating parser matrices", async () => {
  const input = await fixture(); const original = unzipSync(Buffer.from(input.data, "base64"));
  const xml = new TextDecoder().decode(original["xl/worksheets/sheet2.xml"]);
  // Modest out-of-policy coordinate is safe even on RED; a hostile huge one
  // follows the same pre-parser path on GREEN.
  original["xl/worksheets/sheet2.xml"] = strToU8(xml.replace(/r="([A-Z]*)2"/g, (_match, column) => `r="${column}10001"`));
  const response = await post("/preview", { ...input, data: Buffer.from(zipSync(original)).toString("base64") });
  assert.equal(response.status, 422); assert.match((await response.json()).error, /dimensions|cellules|feuille/i);
});

for (const variant of ["quoted-gt", "relocated", "extensionless", "relocated-quoted-gt"]) {
  test(`XLSX rejects sparse coordinates with ${variant} on preview and commit without writes`, async () => {
    const input = await fixture(); const files = unzipSync(Buffer.from(input.data, "base64"));
    let xml = new TextDecoder().decode(files["xl/worksheets/sheet2.xml"])
      .replace(/r="([A-Z]*)2"/g, (_match, column) => `r="${column}10001"`);
    if (variant.includes("quoted-gt")) xml = xml.replace(/<(row|c) /g, '<$1 custom=">" ');
    const target = variant === "extensionless" ? "custom/sheet" : variant.includes("relocated") ? "custom/sheet.xml" : "worksheets/sheet2.xml";
    delete files["xl/worksheets/sheet2.xml"];
    files["xl/" + target] = strToU8(xml);
    for (const name of ["xl/_rels/workbook.xml.rels", "[Content_Types].xml"]) {
      files[name] = strToU8(new TextDecoder().decode(files[name]).replaceAll("worksheets/sheet2.xml", target));
    }
    const before = await request("/state").then(r => r.json());
    for (const route of ["/sheets", "/preview", ""]) {
      const response = await post(route, { ...input, data: Buffer.from(zipSync(files)).toString("base64"), ...(route ? {} : { confirmed: true }) });
      assert.equal(response.status, 422); assert.match((await response.json()).error, /dimensions|cellules|feuille/i);
    }
    assert.deepEqual(await request("/state").then(r => r.json()), before); assert.equal(externalCalls, 0);
  });
}

test("XLSX rejects malformed XML, namespace formulas and encoded coordinates before parsing without writes", async () => {
  const input = await fixture(); const original = unzipSync(Buffer.from(input.data, "base64"));
  const before = await request("/state").then(r => r.json());
  const cases = [
    { xml: '<root/><other/>', error: /XML/i },
    { xml: '<root>&missing;</root>', error: /XML/i },
    { xml: '<root a="x" a="y"/>', error: /XML/i },
    { xml: '<root><child></root>', error: /XML/i },
    { xml: '<root xmlns:é="urn:test"><é:f custom=">">1+1</é:f></root>', error: /formule/i },
    { xml: '<worksheet><sheetData><row custom=">" r="&#49;0001"><c custom=">" r="A&#49;0001"/></row></sheetData></worksheet>', error: /dimensions/i },
    { xml: '<worksheet><sheetData><row r="2"><c r="IW2"/></row></sheetData></worksheet>', error: /dimensions/i },
    { xml: '<worksheet><sheetData><row r="1000"><c r="DW1000"/></row></sheetData></worksheet>', error: /dimensions/i },
    { xml: '<worksheet><sheetData>' + '<row/>'.repeat(10001) + '</sheetData></worksheet>', error: /dimensions/i },
    { xml: '<root>' + '<n>'.repeat(129) + '</n>'.repeat(129) + '</root>', error: /XML/i },
  ];
  for (const item of cases) {
    const data = Buffer.from(zipSync({ ...original, "custom/unchecked.xml": strToU8(item.xml) })).toString("base64");
    for (const route of ["/sheets", "/preview", ""]) {
      const response = await post(route, { ...input, data, ...(route ? {} : { confirmed: true }) });
      assert.equal(response.status, 422, item.xml.slice(0, 100)); assert.match((await response.json()).error, item.error);
    }
  }
  assert.deepEqual(await request("/state").then(r => r.json()), before); assert.equal(externalCalls, 0);
});

test("XLSX accepts bounded relocated sheets and quoted attributes without treating theme rows as cells", async () => {
  const input = await fixture(); const files = unzipSync(Buffer.from(input.data, "base64"));
  files["xl/custom/sheet.xml"] = strToU8(new TextDecoder().decode(files["xl/worksheets/sheet2.xml"]).replace(/<(row|c) /g, '<$1 custom=">" '));
  delete files["xl/worksheets/sheet2.xml"];
  for (const name of ["xl/_rels/workbook.xml.rels", "[Content_Types].xml"]) {
    files[name] = strToU8(new TextDecoder().decode(files[name]).replaceAll("worksheets/sheet2.xml", "custom/sheet.xml"));
  }
  files["custom/theme.xml"] = strToU8('<theme><row r="unrelated"><c r="not-a-coordinate"/></row></theme>');
  const before = await request("/state").then(r => r.json());
  const response = await post("/preview", { ...input, data: Buffer.from(zipSync(files)).toString("base64") });
  assert.equal(response.status, 200); const preview = await response.json();
  assert.equal(preview.count, 1); assert.equal(preview.rows[0].name, example[0]);
  assert.deepEqual(await request("/state").then(r => r.json()), before); assert.equal(externalCalls, 0);
});

test("XLSX preview selects first nonempty sheet, normalizes French fields and never writes", async () => {
  const before = await request("/state").then(r => r.json());
  const response = await post("/preview", await fixture()); assert.equal(response.status, 200);
  const preview = await response.json();
  assert.deepEqual(Object.keys(preview).sort(), ["sheets", "sheet", "rows", "count", "warnings"].sort());
  assert.deepEqual(preview.sheets, ["Vide", "Prospects"]); assert.equal(preview.sheet, "Prospects"); assert.equal(preview.count, 1);
  assert.deepEqual(preview.rows, [{ name: example[0], city: example[1], website: example[2], email: example[3], phone: example[4], address: example[5], category: example[6] }]);
  assert.ok(preview.warnings.some((s: string) => /non vérifi/i.test(s)));
  assert.deepEqual(await request("/state").then(r => r.json()), before); assert.equal(externalCalls, 0);
});
