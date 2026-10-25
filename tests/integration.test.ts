import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isPublicAddress, publicUrl } from "../server/services/http";
let proc: ChildProcess, dir: string;
const base = "http://127.0.0.1:3199/api";
async function request(route: string, method = "GET", body?: any) {
  const res = await fetch(base + route, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "prospectai-test-"));
  proc = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    env: {
      ...process.env,
      PORT: "3199",
      DATA_DIR: dir,
      APIFY_TOKEN: "",
      AI_API_KEY: "",
      APP_PASSWORD: "",
      DATA_ENCRYPTION_KEY: "",
      TURSO_DATABASE_URL: "",
      TURSO_AUTH_TOKEN: "",
      EMAIL_ENABLED: "false",
    },
    stdio: "pipe",
  });
  let logs = "";
  proc.stderr?.on("data", (d) => (logs += d));
  for (let i = 0; i < 60; i++) {
    try {
      await request("/state");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw Error("API non démarrée " + logs);
});
after(async () => {
  proc?.kill();
  await new Promise((r) => proc?.once("exit", r));
  await rm(dir, { recursive: true, force: true });
});
test("Parcours local complet : démo, sélection, statut, brouillons, dossier Hermès et cache", async () => {
  const demo = await request("/demo", "POST", {});
  assert.equal(demo.status, 200);
  assert.equal(demo.data.prospects.length, 9);
  const p = demo.data.prospects[0];
  assert.equal(p.demo, true);
  assert.equal(p.email, "");
  assert.equal(p.rating, null);
  assert.deepEqual(p.fields, {});
  assert.equal(
    (
      await request("/prospects/" + p.id, "PATCH", {
        selected: true,
        status: "En discussion",
      })
    ).data.status,
    "En discussion",
  );
  const drafts = await request("/prospects/" + p.id + "/drafts", "POST", {
    engine: "website",
  });
  assert.equal(drafts.data.drafts.length, 3);
  for (const d of drafts.data.drafts) {
    assert.match(d.body, /ne souhaitez plus être contacté/);
    assert.match(d.body, /ne dispose pas encore d’un audit/);
  }
  const d = drafts.data.drafts[0];
  assert.equal(
    (
      await request("/drafts/" + d.id, "PATCH", {
        subject: "Objet personnalisé",
        body: "Message relu",
      })
    ).data.subject,
    "Objet personnalisé",
  );
  const deliver = await request(
    "/prospects/" + p.id + "/handoffs",
    "POST",
    { engine: "website" },
  );
  assert.equal(deliver.status, 200);
  assert.match(deliver.data.prompt, /Commence maintenant UNIQUEMENT par l’étape 1/);
  const source = await fetch(base + "/handoffs/" + deliver.data.id + "/export?format=dossier");
  assert.match(source.headers.get("content-disposition") || "", /dossier-prospectai.json/);
  assert.equal((await source.json()).prospect.demo, true);
  const cache = await request("/searches/" + demo.data.search.id);
  assert.equal(cache.data.prospects[0].selected, true);
  assert.equal(cache.data.search.cost, 0);
  const exported = await request("/export");
  assert.equal(exported.data.drafts.length, 3);
  assert.equal(exported.data.settings, undefined);
});
test("Accès Gmail, publication et création de maquettes retirés", async () => {
  for (const route of ["/email/verify", "/drafts/demo/send", "/deliverables/demo/publish", "/prospects/demo-0/deliverables"]) {
    const result = await request(route, "POST", { confirm: true });
    assert.equal(result.status, 404);
  }
  const state = (await request("/state")).data;
  assert.equal(state.settings.email, undefined); assert.equal(state.settings.ai, undefined);
  assert.equal(state.settings.vercelConfigured, undefined);
  assert.equal(state.deliverables, undefined); assert.equal(state.handoffs.length, 1);
});
test("Refuse les paiements sans token et les dépassements des limites", async () => {
  const q = {
    city: "Papeete",
    activity: "restaurant",
    keyword: "",
    paid: true,
    max: 25,
    budget: 1,
    engine: "website",
  };
  const missing = await request("/search", "POST", q);
  assert.equal(missing.status, 422);
  assert.match(missing.data.error, /Apify.*plan.*confirmation/);
  const over = await request("/search", "POST", { ...q, budget: 2 });
  assert.match(over.data.error, /Apify.*plan.*confirmation/);
  const invalid = await request("/search", "POST", { ...q, max: -1 });
  assert.equal(invalid.status, 400);
});
test("Paramètres chiffrés et jamais retournés au frontend ni à l’export", async () => {
  const state = (await request("/state")).data;
  const input = {
    business: { ...state.settings.business, name: "Agence Test" },
    limits: { max: 25, budget: 1 },
    ai: { provider: "openai", model: "gpt-4o-mini" },
    apifyKey: "test-secret-not-real",
  };
  const s = await request("/settings", "PUT", input);
  assert.equal(s.data.apifyConfigured, true);
  assert.ok(!JSON.stringify(s.data).includes("test-secret"));
  const exportText = JSON.stringify((await request("/export")).data);
  assert.ok(!exportText.includes("test-secret"));
});
test("Import CSV cité, déduplication et protection des rendus HTML", async () => {
  const text =
    'name,website,email,city\n"<script>alert(1)</script>",http://127.0.0.1,public@example.com,Papeete';
  const imported = await request("/import", "POST", { text });
  assert.equal(imported.status, 200);
  assert.equal(
    imported.data.prospects[0].fields.email.source,
    "Import utilisateur",
  );
  await request("/import", "POST", { text });
  const all = (await request("/state")).data;
  assert.equal(
    all.prospects.filter((p: any) => p.id.startsWith("import-")).length,
    1,
  );
  const p = imported.data.prospects[0];
  const d = await request("/prospects/" + p.id + "/handoffs", "POST", {
    engine: "menu",
  });
  assert.equal(d.status, 200); // Transfert possible ; l’absence d’analyse doit être signalée à Hermès.
  assert.match(d.data.prompt, /Aucun audit réel disponible/);
  assert.ok(d.data.warnings.length > 0);
  const bad = await request("/import", "POST", {
    text: "name,website\nEntreprise,javascript:alert(1)",
  });
  assert.equal(bad.status, 422);
});
test("Analyse : bloque les URL internes et les démos", async () => {
  for (const raw of [
    "http://127.0.0.1",
    "http://169.254.169.254",
    "http://[::1]",
    "file:///etc/passwd",
  ])
    await assert.rejects(() => publicUrl(raw));
  assert.equal(isPublicAddress("10.0.0.1"), false);
  assert.equal(isPublicAddress("172.16.1.1"), false);
  assert.equal(isPublicAddress("8.8.8.8"), true);
  const r = await request("/prospects/demo-0/analyze", "POST", {});
  assert.equal(r.status, 422);
  assert.match(r.data.error, /fictives/);
});
test("Protection origine : refuse les requêtes d’un site tiers", async () => {
  const r = await fetch(base + "/demo", {
    method: "POST",
    headers: {
      Origin: "https://site-tiers.example",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(r.status, 403);
});

test("Enrichissement : aperçu local, Place ID validé, lot périmé ou déjà réservé interdit avant paiement", async () => {
  const placeId = "ChIJ" + "z".repeat(23);
  const imported = await request("/import", "POST", { text: `name,placeId,city\nCandidat enrichissement,${placeId},Bordeaux` });
  assert.equal(imported.status, 200);
  const id = imported.data.prospects[0].id;
  const preview = await request("/apify/plan", "POST", { prospectIds: [id, id] });
  assert.equal(preview.data.candidates.length, 1);
  assert.equal(preview.data.candidates[0].placeId, placeId);
  const stale = await request("/apify/enrich", "POST", { prospectIds: [id], planId: "0".repeat(64), requestId: "690e84b9-f61f-429c-a87e-2f8e4525d0d3", budget: 1 });
  assert.equal(stale.status, 422); assert.match(stale.data.error, /lot a changé/);
  const { createClient } = await import("@libsql/client");
  const { pathToFileURL } = await import("node:url");
  const client = createClient({ url: pathToFileURL(path.join(dir, "prospectai.sqlite")).href });
  await client.execute({ sql: "INSERT INTO apify_place_claims VALUES(?,NULL,?)", args: [placeId, new Date().toISOString()] }); client.close();
  const noCharge = await request("/apify/enrich", "POST", { prospectIds: [id], planId: preview.data.planId, requestId: "690e84b9-f61f-429c-a87e-2f8e4525d0d3", budget: 1 });
  assert.equal(noCharge.status, 422); assert.match(noCharge.data.error, /Aucun identifiant Google Maps inédit/);
  const invalid = await request("/import", "POST", { text: "name,placeId\nCandidat invalide,invented-place-id" });
  assert.equal(invalid.status, 422);
});
