import { test, expect, type Page } from "@playwright/test";
import type { QualificationPreview, QualificationRun, AIQualification } from "../server/qualificationTypes";

const model = "google/gemma-4-26b-a4b-it:free" as const;
const id = "f68f1725-2e49-4468-8a22-6a32c0713317";
const lead = (id: string, extra = {}) => ({ id, name: `Entreprise ${id}`, category: "Artisan", city: "Bordeaux", address: "1 rue Fictive", website: "", email: "", phone: "", lat: null, lng: null, rating: null, reviews: null, selected: false, status: "Contacté", demo: false, fields: {}, socials: {}, hours: "", photos: [], engine: "website", webStatus: "Non vérifié", ...extra });
async function fixture(page: Page, prospects = [lead("old"), lead("selected", { selected: true }), lead("demo", { demo: true }), lead("archive", { archived: true }), lead("dnc", { doNotContact: true }), lead("alias", { duplicateOf: "old" })]) {
  const state = { prospects, searches: [{ id: "latest", ids: ["old"], city: "Paris", activity: "artisan", provider: "free", engine: "website", count: 1, cost: 0, createdAt: "2026-11-01T10:00:00Z" }], drafts: [], handoffs: [], settings: { business: { name: "Atelier", services: "Création de sites web pour artisans", zone: "Bordeaux", userName: "Test", website: "", tone: "", prices: "", instagram: "", facebook: "" }, limits: { max: 25, budget: 1 }, pending: null, apifyConfigured: false, openrouterConfigured: true, onboarded: true, storage: "Fixture" } };
  const writes: { path: string; body: any }[] = [];
  page.on("request", request => { if (request.url().includes("/api/") && request.method() !== "GET") writes.push({ path: new URL(request.url()).pathname, body: request.postDataJSON() }); });
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/status") return route.fulfill({ json: { required: false, authenticated: true } });
    if (path === "/api/state") return route.fulfill({ json: state });
    return route.fulfill({ status: 400, json: { error: `Unexpected request ${path}` } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /^Tous les leads/ }).click();
  return { state, writes };
}
const criteria = "Privilégier les artisans locaux pour une refonte de site.";
function preview(ids = ["selected"]): QualificationPreview {
  return { id, model, status: "prepared", expiresAt: new Date(Date.now() + 600000).toISOString(), criteria, business: { name: "Atelier", services: "Création de sites web pour artisans", zone: "Bordeaux" }, leads: ids.map(id => ({ id, name: `Entreprise ${id}`, city: "Bordeaux", engine: "website" })), excluded: [], max: 10, thresholds: { qualified: 60, review: 40 } };
}
async function prepare(page: Page, ids = ["selected"]) {
  await page.route("**/api/qualification/preview", route => route.fulfill({ json: preview(ids) }));
  await page.getByRole("button", { name: "Requalifier avec Gemma", exact: true }).click();
  await page.getByLabel("Critères de qualification").fill(criteria);
  await page.getByRole("button", { name: "Préparer l’aperçu", exact: true }).click();
  await expect(page.getByRole("button", { name: /Confirmer la qualification/ })).toBeVisible();
}

test("opening, typing and cancelling are inert; selected scope excludes old search and blocked records", async ({ page }) => {
  const { writes } = await fixture(page);
  await expect(page.locator("tbody tr")).toHaveCount(4);
  await page.getByRole("button", { name: "Requalifier avec Gemma", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Requalifier avec Gemma" });
  await expect(dialog).toContainText(model);
  await expect(dialog).toContainText("Sélection éligible affichée : 1 lead");
  await expect(dialog).toContainText("Exclus");
  await page.getByLabel("Critères de qualification").fill(criteria);
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  expect(writes).toEqual([]);
  await prepare(page);
  expect(writes).toEqual([{ path: "/api/qualification/preview", body: { ids: ["selected"], criteria } }]);
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  expect(writes).toHaveLength(1);
});

const qualification: AIQualification = { runId: id, model, score: 78, decision: "qualified", reason: "Activité artisanale locale cohérente avec les services proposés.", missingData: ["Budget inconnu"], criteria, evaluatedAt: "2026-11-12T10:00:00Z", profileFingerprint: "fixture" };
const completed = (): QualificationRun => ({ id, model, status: "completed", total: 1, updated: 1, skipped: 0, results: [{ id: "selected", name: "Entreprise selected", status: "updated", qualification }], createdAt: "2026-11-12T09:59:00Z", finishedAt: qualification.evaluatedAt });

test("confirmation persists UUID before POST, acknowledges before failed refresh, and reload recovers with GET only", async ({ page }) => {
  const { state, writes } = await fixture(page);
  let runPosts = 0;
  let persistedAtBoundary = "";
  let refreshFails = true;
  await page.route(`**/api/qualification/${id}/run`, async route => {
    runPosts++;
    persistedAtBoundary = await page.evaluate(() => localStorage.getItem("prospectia.gemma.pending.v1") || "");
    expect(route.request().postDataJSON()).toEqual({ confirmed: true });
    await route.fulfill({ json: completed() });
  });
  await page.route(`**/api/qualification/${id}`, route => route.fulfill({ json: completed() }));
  await prepare(page);
  await page.route("**/api/state", route => refreshFails ? route.fulfill({ status: 503, json: { error: "readback unavailable" } }) : route.fulfill({ json: { ...state, prospects: state.prospects.map(p => p.id === "selected" ? { ...p, aiQualification: qualification } : p) } }));
  await page.getByRole("button", { name: /Confirmer la qualification/ }).click();
  await expect(page.getByRole("alert")).toContainText("enregistrée");
  expect(JSON.parse(persistedAtBoundary).id).toBe(id);
  await expect(page.getByLabel("Critères de qualification")).toBeDisabled();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("prospectia.gemma.pending.v1") || "{}").receipt.status)).toBe("completed");
  await page.getByRole("button", { name: "Actualiser le résultat", exact: true }).click();
  expect(runPosts).toBe(1);
  let reloadReads = 0;
  await page.route("**/api/state", route => ++reloadReads <= 2 || !refreshFails ? route.fulfill({ json: { ...state, prospects: state.prospects.map(p => p.id === "selected" ? { ...p, aiQualification: qualification } : p) } }) : route.fulfill({ status: 503, json: { error: "readback unavailable" } }));
  await page.reload();
  await expect(page.getByRole("dialog", { name: "Requalifier avec Gemma" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("enregistrée");
  refreshFails = false;
  await page.getByRole("button", { name: "Actualiser le résultat", exact: true }).click();
  await expect(page.getByText("Qualification terminée : 1 mis à jour, 0 ignoré.")).toBeVisible();
  await page.getByRole("button", { name: "Fermer", exact: true }).click();
  await page.getByRole("button", { name: /^Tous les leads/ }).click();
  const row = page.locator("tbody tr").filter({ hasText: "Entreprise selected" });
  await expect(row).toContainText("Gemma · Qualifié · 78/100");
  await expect(row).toContainText(qualification.reason);
  await expect(row).toContainText("Contacté");
  await expect(row.getByRole("checkbox")).toBeChecked();
  await page.getByRole("combobox", { name: "Qualification Gemma", exact: true }).selectOption("qualified");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  expect(writes.filter(w => w.path.endsWith("/run"))).toHaveLength(1);
  expect(await page.evaluate(() => localStorage.getItem("prospectia.gemma.pending.v1"))).toBeNull();
});

test("OpenRouter password settings show presence, preserve blank and never test connectivity", async ({ page }) => {
  const { writes } = await fixture(page);
  await page.getByRole("button", { name: /Paramètres/ }).click();
  const key = page.getByLabel(/CLÉ API OPENROUTER/);
  await expect(key).toHaveAttribute("type", "password");
  await expect(key).toHaveValue("");
  await expect(page.getByText("Présence uniquement · connexion non testée.", { exact: true })).toBeVisible();
  await key.fill("synthetic-ui-key-not-a-credential");
  expect(writes).toEqual([]);
  await page.route("**/api/settings", route => route.fulfill({ json: { ok: true } }));
  await page.getByRole("button", { name: "Enregistrer mon espace" }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].body.openrouterKey).toBe("synthetic-ui-key-not-a-credential");
  await expect(key).toHaveValue("");
  await page.getByRole("button", { name: "Enregistrer mon espace" }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1].body).not.toHaveProperty("openrouterKey");
  expect(writes.every(w => w.path === "/api/settings")).toBe(true);
  await expect(page.getByRole("button", { name: "Enregistrer mon espace" })).toBeEnabled();
});

test("expired previews can be explicitly replaced without any run", async ({ page }) => {
  const { writes } = await fixture(page);
  await page.clock.install();
  await prepare(page);
  await page.clock.fastForward(610000);
  await expect(page.getByRole("button", { name: /Confirmer la qualification/ })).toBeDisabled();
  await page.getByRole("button", { name: "Préparer un nouvel aperçu", exact: true }).click();
  await expect(page.getByRole("button", { name: "Préparer l’aperçu", exact: true })).toBeVisible();
  expect(writes.filter(w => w.path.endsWith("/run"))).toEqual([]);
});

test("lost response survives reload as a GET-only running/uncertain operation", async ({ page }) => {
  const { writes } = await fixture(page);
  let status: QualificationRun["status"] = "running";
  const reads: string[] = [];
  await page.route(`**/api/qualification/${id}/run`, route => route.abort("failed"));
  await page.route(`**/api/qualification/${id}`, route => { reads.push(status); return route.fulfill({ json: { ...completed(), status, results: [] } }); });
  await prepare(page);
  await page.getByRole("button", { name: /Confirmer la qualification/ }).click();
  await expect(page.getByRole("alert")).toContainText("Réponse perdue");
  await expect(page.getByRole("button", { name: "Annuler", exact: true })).toBeDisabled();
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("en cours");
  await expect(page.getByRole("button", { name: /Reprendre la confirmation|Confirmer la qualification/ })).toHaveCount(0);
  status = "uncertain";
  await page.getByRole("button", { name: "Actualiser le résultat", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("incertaine");
  await expect(page.getByRole("button", { name: "Préparer un nouveau lot", exact: true })).toHaveCount(0);
  expect(writes.filter(w => w.path.endsWith("/run"))).toHaveLength(1);
  expect(reads).toContain("running");
  expect(reads).toContain("uncertain");
});

test("a prepared recovery requires an explicit same-ID confirmation and known failure permits only an explicit new preview", async ({ page }) => {
  const { writes } = await fixture(page);
  await page.evaluate(id => localStorage.setItem("prospectia.gemma.pending.v1", JSON.stringify({ id })), id);
  await page.route(`**/api/qualification/${id}`, route => route.fulfill({ json: { ...completed(), status: "prepared", results: [], preview: preview() } }));
  await page.route(`**/api/qualification/${id}/run`, route => route.fulfill({ json: { ...completed(), status: "failed", updated: 0, results: [], error: "quota" } }));
  await page.reload();
  const resume = page.getByRole("button", { name: /Reprendre la confirmation/ });
  await expect(resume).toBeVisible();
  expect(writes).toEqual([]);
  await resume.click();
  await expect(page.getByRole("alert")).toContainText("précédentes sont conservées");
  expect(writes).toEqual([{ path: `/api/qualification/${id}/run`, body: { confirmed: true } }]);
  await page.getByRole("button", { name: "Préparer un nouveau lot", exact: true }).click();
  await expect(page.getByRole("button", { name: "Préparer l’aperçu", exact: true })).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(await page.evaluate(() => localStorage.getItem("prospectia.gemma.pending.v1"))).toBeNull();
});

// Retain actual React event handlers, not substitutes: exercise stale closures
// and overlapping invocation before React can render disabled controls.
async function retainConfirm(page: Page) {
  await page.getByRole("button", { name: /Confirmer la qualification/ }).evaluate(button => {
    const propKey = Object.keys(button).find(key => key.startsWith("__reactProps$"))!;
    (window as any).__gemmaConfirm = (button as any)[propKey].onClick;
  });
}
async function invokeRetained(page: Page, times = 1) {
  await page.evaluate(times => { for (let i = 0; i < times; i++) void (window as any).__gemmaConfirm(); }, times);
}

test("retained confirmation handlers invalidate synchronously on edits and cancel, and double invocation submits once", async ({ page }) => {
  const { writes } = await fixture(page);
  await prepare(page);
  await retainConfirm(page);
  await page.getByLabel("Critères de qualification").fill(criteria + " Avec preuves publiques.");
  await invokeRetained(page);
  expect(writes.filter(w => w.path.endsWith("/run"))).toHaveLength(0);
  await page.getByRole("button", { name: "Préparer l’aperçu", exact: true }).click();
  await retainConfirm(page);
  await page.getByRole("dialog").getByRole("checkbox", { name: /Entreprise old/ }).check();
  await invokeRetained(page);
  expect(writes.filter(w => w.path.endsWith("/run"))).toHaveLength(0);
  await page.getByRole("button", { name: "Préparer l’aperçu", exact: true }).click();
  await retainConfirm(page);
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  await invokeRetained(page);
  expect(writes.filter(w => w.path.endsWith("/run"))).toHaveLength(0);
  await prepare(page);
  await retainConfirm(page);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/qualification/${id}/run`, async route => { await held; await route.fulfill({ json: { ...completed(), status: "running", results: [] } }); });
  await invokeRetained(page, 2);
  await expect.poll(() => writes.filter(w => w.path.endsWith("/run")).length).toBe(1);
  await expect(page.getByRole("button", { name: "Annuler", exact: true })).toBeDisabled();
  release();
  await expect(page.getByRole("alert")).toContainText("en cours");
  await invokeRetained(page, 2);
  expect(writes.filter(w => w.path.endsWith("/run"))).toHaveLength(1);
});

test("more than ten selected is blocked until an explicit choice, never silently truncated", async ({ page }) => {
  const { writes } = await fixture(page, Array.from({ length: 15 }, (_, index) => lead(`eligible-${index}`, { selected: true })));
  await page.getByRole("button", { name: "Requalifier avec Gemma", exact: true }).click();
  await page.getByLabel("Critères de qualification").fill(criteria);
  await expect(page.getByRole("alert")).toContainText("Plus de 10");
  await expect(page.getByRole("button", { name: "Préparer l’aperçu", exact: true })).toBeDisabled();
  expect(writes).toEqual([]);
  await page.getByRole("button", { name: "Choisir les 10 premiers éligibles affichés", exact: true }).click();
  await page.route("**/api/qualification/preview", route => route.fulfill({ json: preview(Array.from({ length: 10 }, (_, index) => `eligible-${index}`)) }));
  await page.getByRole("button", { name: "Préparer l’aperçu", exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].body.ids).toEqual(Array.from({ length: 10 }, (_, index) => `eligible-${index}`));
  expect(writes[0].body).toEqual({ ids: Array.from({ length: 10 }, (_, index) => `eligible-${index}`), criteria });
});

test("storage failure before confirmation sends no POST", async ({ page }) => {
  const { writes } = await fixture(page);
  await prepare(page);
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw Error("synthetic storage failure"); }; });
  await page.getByRole("button", { name: /Confirmer la qualification/ }).click();
  await expect(page.getByRole("alert")).toContainText("aucun lancement");
  expect(writes.filter(w => w.path.endsWith("/run"))).toHaveLength(0);
  await expect(page.getByRole("button", { name: "Annuler", exact: true })).toBeEnabled();
});

test("a durable acknowledged receipt can never become a resumable POST even if recovery readback is stale", async ({ page }) => {
  const { writes } = await fixture(page);
  await page.evaluate(receipt => localStorage.setItem("prospectia.gemma.pending.v1", JSON.stringify({ id: receipt.id, receipt })), completed());
  await page.route(`**/api/qualification/${id}`, route => route.fulfill({ json: { ...completed(), status: "prepared", results: [], preview: preview() } }));
  await page.reload();
  await expect(page.getByRole("dialog", { name: "Requalifier avec Gemma" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("enregistrée");
  await expect(page.getByRole("button", { name: /Reprendre la confirmation/ })).toHaveCount(0);
  expect(writes).toEqual([]);
});

test("an expired prepared recovery releases only through an explicit new-preview action", async ({ page }) => {
  const { writes } = await fixture(page);
  await page.evaluate(id => localStorage.setItem("prospectia.gemma.pending.v1", JSON.stringify({ id })), id);
  await page.route(`**/api/qualification/${id}`, route => route.fulfill({ json: { ...completed(), status: "prepared", results: [], preview: { ...preview(), expiresAt: "2020-01-01T00:00:00Z" } } }));
  await page.reload();
  await expect(page.getByRole("button", { name: /Reprendre la confirmation/ })).toBeDisabled();
  await page.getByRole("button", { name: "Préparer un nouvel aperçu", exact: true }).click();
  await expect(page.getByRole("button", { name: "Préparer l’aperçu", exact: true })).toBeVisible();
  expect(writes).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem("prospectia.gemma.pending.v1"))).toBeNull();
});


test("persisted qualifications filter only on explicit choice and stay distinct from commercial tracking", async ({ page }) => {
  const { writes } = await fixture(page, [lead("pending"), lead("qualified", { aiQualification: qualification, audit: { score: 19, checkedAt: qualification.evaluatedAt, observations: [] } }), lead("review", { aiQualification: { ...qualification, score: 49, decision: "review" } }), lead("rejected", { aiQualification: { ...qualification, score: 25, decision: "rejected" } })]);
  await expect(page.locator("tbody tr")).toHaveCount(4);
  const filter = page.getByRole("combobox", { name: "Qualification Gemma", exact: true });
  await expect(filter).toHaveValue("all");
  for (const value of ["pending", "qualified", "review", "rejected"]) {
    await filter.selectOption(value);
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(page.locator("tbody tr")).toContainText(`Entreprise ${value}`);
    await expect(page.locator("tbody tr")).toContainText("Contacté");
  }
  await filter.selectOption("qualified");
  await page.getByRole("button", { name: /Voir la fiche/ }).click();
  const drawer = page.getByRole("complementary", { name: "Fiche prospect" });
  await expect(drawer).toContainText(qualification.reason);
  await expect(drawer).toContainText("12/11/2026");
  await expect(drawer).toContainText("Budget inconnu");
  expect(writes).toEqual([]);
});

test("83 synthetic directory records default to three selected with a wrapping mobile toolbar", async ({ page }) => {
  const { writes } = await fixture(page, Array.from({ length: 83 }, (_, index) => lead(`synthetic-${index}`, { selected: [3, 40, 82].includes(index) })));
  await expect(page.locator("tbody tr")).toHaveCount(83);
  await page.screenshot({ path: "/opt/data/output/ProspectIa-v2-gemma/frontend-desktop-directory.png" });
  await page.getByRole("button", { name: "Requalifier avec Gemma", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Sélection éligible affichée : 3 lead");
  await expect(page.getByRole("dialog").getByRole("checkbox", { checked: true })).toHaveCount(3);
  expect(await page.getByRole("group", { name: "Leads à qualifier · 3/10", exact: true }).evaluate(node => node.clientHeight <= 240 && node.scrollHeight > node.clientHeight)).toBe(true);
  await page.screenshot({ path: "/opt/data/output/ProspectIa-v2-gemma/frontend-desktop-dialog.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  const dialog = page.getByRole("dialog");
  expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: "/opt/data/output/ProspectIa-v2-gemma/frontend-mobile-dialog.png" });
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  await page.getByRole("button", { name: "Requalifier avec Gemma", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/opt/data/output/ProspectIa-v2-gemma/frontend-mobile-toolbar.png" });
  expect(writes).toEqual([]);
});

test("no selection defaults explicitly to the first ten eligible displayed records", async ({ page }) => {
  const { writes } = await fixture(page, Array.from({ length: 12 }, (_, index) => lead(`scope-${index}`)));
  await page.route("**/api/qualification/preview", route => route.fulfill({ json: preview(Array.from({ length: 10 }, (_, index) => `scope-${index}`)) }));
  await page.getByRole("button", { name: "Requalifier avec Gemma", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Par défaut : les 10 premiers leads éligibles affichés");
  await page.getByLabel("Critères de qualification").fill(criteria);
  await page.getByRole("button", { name: "Préparer l’aperçu", exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].body.ids).toEqual(Array.from({ length: 10 }, (_, index) => `scope-${index}`));
});

test("acknowledged refresh still pending locks stale confirmation and never duplicates POST", async ({ page }) => {
  const { writes, state } = await fixture(page);
  await prepare(page);
  await retainConfirm(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/qualification/${id}/run`, route => route.fulfill({ json: completed() }));
  let readbackStarted = false;
  await page.route("**/api/state", async route => { readbackStarted = true; await gate; await route.fulfill({ json: state }); });
  await invokeRetained(page, 2);
  await expect.poll(() => readbackStarted).toBe(true);
  await expect(page.getByRole("button", { name: "Actualiser le résultat", exact: true })).toBeDisabled();
  await invokeRetained(page, 2);
  expect(writes.filter(w => w.path.endsWith("/run"))).toHaveLength(1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("prospectia.gemma.pending.v1") || "{}").receipt.status)).toBe("completed");
  release();
  await expect(page.getByRole("status")).toContainText("Qualification terminée");
  await invokeRetained(page, 2);
  expect(writes.filter(w => w.path.endsWith("/run"))).toHaveLength(1);
});

test("missing key presence blocks confirmation but permits non-inference preview and cancellation", async ({ page }) => {
  const { state, writes } = await fixture(page);
  state.settings.openrouterConfigured = false;
  await page.reload();
  await page.getByRole("button", { name: /^Tous les leads/ }).click();
  await prepare(page);
  await expect(page.getByRole("dialog")).toContainText("Clé OpenRouter manquante");
  await expect(page.getByRole("button", { name: /Confirmer la qualification/ })).toBeDisabled();
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  expect(writes.map(w => w.path)).toEqual(["/api/qualification/preview"]);
});

test("retained prepare handlers cannot submit old criteria or run after cancellation", async ({ page }) => {
  const { writes } = await fixture(page);
  await page.getByRole("button", { name: "Requalifier avec Gemma", exact: true }).click();
  await page.getByLabel("Critères de qualification").fill(criteria);
  await page.getByRole("button", { name: "Préparer l’aperçu", exact: true }).evaluate(button => {
    const propKey = Object.keys(button).find(key => key.startsWith("__reactProps$"))!;
    (window as any).__gemmaPrepare = (button as any)[propKey].onClick;
  });
  await page.getByLabel("Critères de qualification").fill(criteria + " Critères actualisés.");
  await page.evaluate(async () => { await (window as any).__gemmaPrepare(); });
  expect(writes).toEqual([]);
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  await page.evaluate(async () => { await (window as any).__gemmaPrepare(); });
  expect(writes).toEqual([]);
});
