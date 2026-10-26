import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { businessPlan } from "./fixtures/apify-business-plan";

const lead = (id: string, extra = {}) => ({ id, name: `Entreprise ${id}`, category: "Artisan", city: "Bordeaux", address: "1 rue Fictive", website: "", email: "", phone: "", lat: 44.8, lng: -0.5, rating: null, reviews: null, selected: true, status: "À contacter", demo: false, fields: {}, socials: {}, hours: "", photos: [], engine: "website", webStatus: "Non vérifié", ...extra });
const search = (ids: string[]) => ({ id: "last-lot", city: "Bordeaux", activity: "artisan", keyword: "", provider: "Apify", engine: "website", count: ids.length, ids, cost: 0, createdAt: "2026-10-26T10:00:00Z" });
async function fixture(page: Page, request: APIRequestContext, prospects = [lead("known")], ids: string[] = []) {
  const state = { prospects, searches: [search(ids)], drafts: [], handoffs: [], settings: { business: { name: "Atelier", zone: "Bordeaux", userName: "Test" }, limits: { max: 25, budget: 1 }, pending: null, apifyConfigured: true, onboarded: true, storage: "Fixture" } };
  const writes: string[] = [];
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET") writes.push(path);
    if (path === "/api/auth/status") return route.fulfill({ json: { required: false, authenticated: true } });
    if (path === "/api/state") return route.fulfill({ json: state });
    return route.fulfill({ status: 400, json: { error: `Unexpected request ${path}` } });
  });
  await page.goto("/");
  return { state, writes };
}

test("empty last lot preserves the saved base and offers a non-billable recovery", async ({ page, request }) => {
  const { writes } = await fixture(page, request);
  await expect(page.locator("tbody tr")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Aucun résultat dans le dernier lot" })).toBeVisible();
  await expect(page.getByText(/1 lead\(s\) enregistré\(s\).*conserv/)).toBeVisible();
  await page.screenshot({ path: "/opt/data/cache/scratch/prospectai-empty-lot-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.screenshot({ path: "/opt/data/cache/scratch/prospectai-empty-lot-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Afficher tous les leads", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  expect(writes).toEqual([]);
});

test("filters have an explicit reset that keeps the current lot", async ({ page, request }) => {
  await fixture(page, request, [lead("known"), lead("other")], ["known"]);
  await page.getByRole("button", { name: "Avec email", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Aucun résultat avec ces filtres" })).toBeVisible();
  await page.getByRole("button", { name: "Réinitialiser les filtres", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody tr")).toContainText("Entreprise known");
});

test("history alias IDs resolve only through explicit duplicateOf links", async ({ page, request }) => {
  await fixture(page, request, [lead("known"), lead("alias", { duplicateOf: "known" })], ["alias"]);
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody tr")).toContainText("Entreprise known");
});

test("archived lot offers archive navigation without restoring it", async ({ page, request }) => {
  await fixture(page, request, [lead("archived", { archived: true })], ["archived"]);
  await expect(page.getByRole("heading", { name: "Les leads de ce lot sont archivés" })).toBeVisible();
  await page.getByRole("button", { name: "Afficher les archives", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
});

test("genuinely empty base is not described as a lost last lot", async ({ page, request }) => {
  const { writes } = await fixture(page, request, []);
  await expect(page.getByRole("heading", { name: "Aucun prospect enregistré" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Afficher tous les leads", exact: true })).toHaveCount(0);
  expect(writes).toEqual([]);
});

test("history response IDs are authoritative even when the saved search contains a missing alias", async ({ page, request }) => {
  const { writes } = await fixture(page, request, [lead("known")], ["old-missing-alias"]);
  await expect(page.getByRole("heading", { name: "Aucune fiche disponible pour ce lot" })).toBeVisible();
  await page.route("**/api/searches/last-lot", route => route.fulfill({ json: { cached: true, search: search(["known"]) } }));
  await page.getByRole("button", { name: "Revoir ces résultats", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody tr")).toContainText("Entreprise known");
  expect(writes).toEqual([]);
});

test("plan errors remain near the primary search action after transient notices expire", async ({ page, request }) => {
  await fixture(page, request);
  await page.clock.install();
  await page.route("**/api/apify/discovery/plan", route => route.fulfill({ status: 503, json: { error: "Tarification indisponible, aperçu bloqué" } }));
  await page.getByRole("button", { name: "Préparer une recherche Apify", exact: true }).click();
  await page.clock.fastForward(9000);
  await expect(page.locator("#search-diagnostic")).toContainText("Tarification indisponible, aperçu bloqué");
  await page.locator("#search-diagnostic").getByRole("button", { name: "Ouvrir les Paramètres" }).click();
  await expect(page.getByRole("button", { name: "Enregistrer mon espace" })).toBeVisible();
});

test("a zero-result paid response does not suggest the demo instead of the existing base", async ({ page, request }) => {
  const { writes } = await fixture(page, request, [lead("known")], ["known"]);
  await page.route("**/api/apify/discovery/plan", route => route.fulfill({ json: businessPlan({ city: "Bordeaux", query: "artisan", max: 25, budget: 1, excludedCount: 1, unidentifiedCount: 0, warnings: [] }) }));
  await page.route("**/api/apify/discovery/start", route => route.fulfill({ json: { message: "Aucun candidat inédit. Des frais de lancement restent possibles." } }));
  await page.getByRole("button", { name: "Préparer une recherche Apify", exact: true }).click();
  await page.getByRole("button", { name: "Confirmer et lancer la collecte Apify", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Aucun résultat dans le dernier lot" })).toBeVisible();
  await page.getByRole("button", { name: "Afficher tous les leads", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  expect(writes.filter(path => !path.startsWith("/api/apify/discovery/"))).toEqual([]);
});
