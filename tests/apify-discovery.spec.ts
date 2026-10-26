import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { businessPlan } from './fixtures/apify-business-plan';

test("source UI : aucune route de recherche gratuite, plan local et start confirmé séparés", async () => {
  const source = await readFile(new URL("../client/src/App.tsx", import.meta.url), "utf8");
  expect(source).not.toMatch(/api\(["']\/search["']/);
  expect(source).not.toMatch(/doSearch|freeResult|sources gratuites|bouton gratuit/);
  expect(source).toContain('api("/apify/discovery/plan", "POST", discoveryInput)');
  expect(source).toContain('api("/apify/discovery/start", "POST", { ...intention.input, planId: intention.plan.planId, requestId: intention.requestId, confirmed: true })');
});

async function fixture(page: Page, pending: any = null) {
  const state = { prospects: [], searches: [], drafts: [], handoffs: [], settings: { business: { name: "Atelier", zone: "Bordeaux", userName: "Test" }, limits: { max: 25, budget: 1 }, pending, apifyConfigured: true, onboarded: true, storage: "SQLite local" } };
  const plans: any[] = [], starts: any[] = [], free: any[] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth/status") return route.fulfill({ json: { required: false, authenticated: true } });
    if (url.pathname === "/api/state") return route.fulfill({ json: state });
    if (url.pathname === "/api/apify/discovery/plan") {
      const args = route.request().postDataJSON(); plans.push(args);
      return route.fulfill({ json: businessPlan({ ...args, query: { city: args.city, keyword: args.keyword, activity: args.activity, paid: true }, excludedCount: 37, unidentifiedCount: 0, warnings: [] }) });
    }
    if (url.pathname === "/api/apify/discovery/start") {
      starts.push(route.request().postDataJSON()); state.settings.pending = { runId: "runFixture12345" };
      return route.fulfill({ json: { pending: true, runId: "runFixture12345" } });
    }
    if (url.pathname === "/api/search") { free.push(route.request().postDataJSON()); return route.fulfill({ json: { exhausted: true, warnings: ["Source gratuite temporairement indisponible"], message: "Réserve épuisée" } }); }
    return route.fulfill({ status: 404, json: { error: "Unmocked API" } });
  });
  await page.goto("/");
  return { plans, starts, free, state };
}

test("bouton principal → aperçu → confirmation → start → poll → liste, sans paiement implicite", async ({ page }) => {
  const f = await fixture(page);
  let polls = 0;
  const prospect = { id: "fixture-result", name: "Atelier local simulé", category: "Artisan", city: "Bordeaux", address: "1 rue fictive Bordeaux", website: "", email: "", phone: "", lat: null, lng: null, rating: null, reviews: null, selected: false, status: "Nouveau", demo: false, fields: {}, socials: {}, hours: "", photos: [], engine: "website", webStatus: "Non vérifié" };
  const search = { id: "fixture-discovery", city: "Bordeaux", activity: "restaurant", keyword: "", provider: "Apify", kind: "discovery", engine: "website", ids: [prospect.id], count: 1, cost: 0.0125, warnings: [], createdAt: "2026-10-24T00:00:00Z" };
  await page.route("**/api/apify/poll", async route => {
    polls++;
    Object.assign(f.state, { prospects: [prospect], searches: [search] });
    f.state.settings.pending = null;
    await route.fulfill({ json: { pending: false, runStatus: "SUCCEEDED", search } });
  });
  const prepare = page.getByRole("button", { name: "Préparer une recherche Apify", exact: true });
  await page.getByLabel("Budget d’arrêt Apify (USD)").fill("0.5");
  await prepare.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("nom, activité, adresse, ville, téléphone, site et identifiant Google");
  await expect(page.getByRole("dialog")).toContainText("L’Actor recherche les emails publiés");
  await expect(page.getByRole("dialog")).toContainText("demande explicite");
  await expect(page.getByRole("dialog")).not.toContainText("automatiquement");
  await expect(page.getByRole("dialog")).toContainText("Email non garanti");
  expect(f.plans).toHaveLength(1); expect(f.starts).toHaveLength(0); expect(polls).toBe(0);
  await page.getByRole("button", { name: "Confirmer et lancer la collecte Apify", exact: true }).click();
  await expect(prepare).toBeDisabled();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(f.starts).toHaveLength(1); expect(f.starts[0]).toMatchObject({ budget: 0.5, confirmed: true });
  expect(polls).toBe(0);
  await page.getByRole("button", { name: "Récupérer la collecte", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody tr")).toContainText("Atelier local simulé");
  await expect(page.locator(".search-history")).toContainText("0.0125 USD");
  await expect(prepare).toBeEnabled();
  expect(f.starts).toHaveLength(1); expect(polls).toBe(1); expect(f.free).toHaveLength(0);
});

test('official business rates and actor are displayed before start with unverified Free reference', async ({ page }) => {
  const f = await fixture(page);
  await page.getByRole('button', { name: 'Préparer une recherche Apify', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('benthepythondev/google-maps-business-scraper');
  await expect(dialog).toContainText('scrapeContacts=true');
  await expect(dialog).toContainText('non testé pour la délivrabilité');
  await expect(dialog).toContainText('0.0015 USD');
  await expect(dialog).toContainText('0.00005 USD');
  await expect(dialog).toContainText('0.0014 USD');
  await expect(dialog).toContainText('Entreprises sans email conservées');
  await expect(dialog).toContainText('FREE');
  await expect(dialog).toContainText('tarif du compte non certifié');
  await expect(dialog.getByRole('link', { name: 'Source officielle des tarifs' })).toHaveAttribute('href', /api.apify.com/);
  await page.screenshot({ path: "/opt/data/cache/scratch/prospectai-business-plan-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.screenshot({ path: "/opt/data/cache/scratch/prospectai-business-plan-mobile.png", fullPage: true });
  expect(f.starts).toHaveLength(0);
});

for (const scenario of ['blocked', 'missing pricing', 'missing result rate', 'invalid rate', 'missing fingerprint', 'wrong actor', 'wrong actor id', 'missing contacts coverage', 'email-only coverage'] as const) test(`${scenario} prevents any paid POST`, async ({ page }) => {
  const f = await fixture(page);
  await page.route('**/api/apify/discovery/plan', route => {
    const pricing = businessPlan().pricing;
    return route.fulfill({ json: businessPlan({ ...route.request().postDataJSON(), excludedCount: 0, unidentifiedCount: 0, warnings: [],
      ...(scenario === 'blocked' ? { blocked: true, blockedReason: 'Migration bloquée : URL historique non convertible', unresolvedUrlCount: 1 } : {}),
      ...(scenario === 'missing pricing' ? { pricing: null } : {}),
      ...(scenario === 'missing result rate' ? { pricing: { ...pricing, events: { 'apify-actor-start': { eventPriceUsd: 0.1 } } } } : {}),
      ...(scenario === 'invalid rate' ? { pricing: { ...pricing, events: { ...pricing.events, 'apify-default-dataset-item': { eventPriceUsd: -1 } } } } : {}),
      ...(scenario === 'missing fingerprint' ? { planId: '' } : {}),
      ...(scenario === 'wrong actor' ? { actor: 'benthepythondev/google-maps-email-scraper' } : {}),
      ...(scenario === 'wrong actor id' ? { actorId: '4MTxdHfGoKTLDoTrD' } : {}),
      ...(scenario === 'missing contacts coverage' ? { coverage: { requireEmail: false } } : {}),
      ...(scenario === 'email-only coverage' ? { coverage: { requireEmail: true, scrapeContacts: true } } : {}),
    }) });
  });
  await page.getByRole('button', { name: 'Préparer une recherche Apify', exact: true }).click();
  const confirm = page.getByRole('button', { name: 'Confirmer et lancer la collecte Apify', exact: true });
  await expect(confirm).toBeDisabled();
  await expect(confirm).toHaveAccessibleDescription(scenario === 'blocked' ? /Migration bloquée/ : /non valid|indisponible/i);
  await confirm.evaluate((button: HTMLButtonElement) => button.click());
  expect(f.starts).toHaveLength(0);
});

test("budget et critères invalident l’aperçu ; aucune confirmation implicite", async ({ page }) => {
  const f = await fixture(page);
  const prepare = page.getByRole("button", { name: "Préparer une recherche Apify", exact: true });
  await prepare.click();
  await page.getByLabel("Modifier le budget Apify").fill("0.5");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(f.starts).toHaveLength(0);
  await prepare.click();
  await page.keyboard.press("Escape");
  await page.getByLabel("DANS QUELLE VILLE ?").fill("Paris");
  await prepare.click();
  await expect(page.getByRole("dialog")).toContainText("Paris");
  expect(f.plans.at(-1).budget).toBe(0.5);
  expect(f.starts).toHaveLength(0);
});

test("submit principal prépare seulement Apify ; navigation et critères ne lancent aucune collecte", async ({ page }) => {
  const f = await fixture(page);
  const prepare = page.getByRole("button", { name: "Préparer une recherche Apify", exact: true });
  await expect(prepare).toHaveCount(1);
  await expect(prepare).toHaveClass(/primary/);
  await expect(page.getByRole("button", { name: /Trouver 25 nouveaux|sources gratuites/ })).toHaveCount(0);
  await page.getByLabel("Budget d’arrêt Apify (USD)").fill("0.5");
  await page.getByLabel("NOM OU MOT-CLÉ").fill("artisan");
  await page.getByRole("button", { name: "Tous les leads 0", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tous les leads", exact: true })).toBeVisible();
  await page.locator(".sidebar").getByRole("button", { name: "Trouver des prospects", exact: true }).click();
  expect(f.plans).toHaveLength(0); expect(f.starts).toHaveLength(0); expect(f.free).toHaveLength(0);
  await page.getByLabel("NOM OU MOT-CLÉ").press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(f.plans).toEqual([{ city: "Bordeaux", activity: "restaurant", keyword: "artisan", engine: "website", max: 25, budget: 0.5 }]);
  expect(f.starts).toHaveLength(0); expect(f.free).toHaveLength(0);
});

test("pending verrouille la recherche ; récupération explicite sans nouvelle dépense", async ({ page }) => {
  const f = await fixture(page, { runId: "runFixture12345" });
  await expect(page.getByRole("button", { name: "Préparer une recherche Apify", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: /Trouver 25 nouveaux|sources gratuites/ })).toHaveCount(0);
  await page.route("**/api/apify/poll", route => route.fulfill({ json: { pending: true, status: "RUNNING" } }));
  await page.getByRole("button", { name: "Récupérer la collecte", exact: true }).click();
  expect(f.plans).toHaveLength(0); expect(f.starts).toHaveLength(0); expect(f.free).toHaveLength(0);
});

test("FINALIZING annonce le coût en cours et le résultat Apify conserve son vrai coût", async ({ page }) => {
  await fixture(page, { runId: "runFixture12345" });
  let polls = 0;
  await page.route("**/api/apify/poll", (route) => route.fulfill({ json: ++polls === 1 ? { pending: true, status: "FINALIZING" } : { pending: false, runStatus: "SUCCEEDED", search: { id: "paid", ids: [], count: 0, kind: "discovery", city: "Bordeaux", provider: "Apify", cost: 0.00001, warnings: [] } } }));
  const poll = page.getByRole("button", { name: "Récupérer la collecte", exact: true });
  await poll.click();
  await expect(page.getByRole("status").filter({ hasText: /coût.*mise à jour/i })).toBeVisible();
  await expect(poll).toBeEnabled(); await poll.click();
  await expect(page.getByRole("status").filter({ hasText: /Coût retourné par Apify : 0.00001 USD/ })).toBeVisible();
  await expect(page.locator(".search-history")).toContainText("0.00001 USD");
});

test("lancement incertain : rafraîchit l’état, verrouille les paiements et ne réessaie pas", async ({ page }) => {
  const f = await fixture(page);
  await page.clock.install();
  await page.route("**/api/apify/discovery/start", (route) => {
    f.starts.push(route.request().postDataJSON()); f.state.settings.pending = { runId: null, mode: "discovery" };
    return route.fulfill({ status: 422, json: { error: "Lancement incertain ; verrou conservé" } });
  });
  await page.getByRole("button", { name: "Préparer une recherche Apify", exact: true }).click();
  await page.getByRole("button", { name: "Confirmer et lancer la collecte Apify", exact: true }).click();
  await expect(page.getByRole("button", { name: "Associer le run", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Préparer une recherche Apify", exact: true })).toBeDisabled();
  await page.clock.fastForward(9000);
  await expect(page.locator("#search-diagnostic")).toContainText("Lancement incertain ; verrou conservé");
  await expect(page.getByRole("button", { name: "Trouver 25 nouveaux prospects", exact: true })).toHaveCount(0);
  expect(f.free).toHaveLength(0);
  expect(f.starts).toHaveLength(1);
});

test("clé absente : navigation Paramètres et fournisseur nommé, sans lancement", async ({ page }) => {
  const f = await fixture(page); f.state.settings.apifyConfigured = false;
  await page.reload();
  await page.getByRole("button", { name: "Préparer une recherche Apify", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Confirmer et lancer la collecte Apify", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Configurer Apify dans les Paramètres", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Vos outils, vos limites" })).toBeVisible();
  await expect(page.locator(".settings-card").filter({ hasText: "Vos outils, vos limites" })).toContainText("benthepythondev/google-maps-business-scraper");
  expect(f.starts).toHaveLength(0);
});

test("aperçu local annulable, confirmation unique explicite et paramètres exacts", async ({ page }) => {
  const f = await fixture(page);
  await page.getByLabel("NOM OU MOT-CLÉ").fill("menuisier");
  const prepare = page.getByRole("button", { name: "Préparer une recherche Apify", exact: true });
  await prepare.click();
  const dialog = page.getByRole("dialog", { name: "Recherche Apify · vérifier avant de payer" });
  await expect(dialog).toContainText("benthepythondev/google-maps-business-scraper");
  await expect(dialog).toContainText("37 identifiants connus"); await expect(dialog).toContainText("0 URL historique(s) non résolue(s)");
  await expect(dialog).toContainText(/même.*0 résultat/);
  await expect(dialog).toContainText(/25 résultats.*pas garantis/);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.setViewportSize({ width: 1512, height: 1100 });
  expect(f.starts).toHaveLength(0);
  await dialog.getByRole("button", { name: "Annuler", exact: true }).click();
  expect(f.starts).toHaveLength(0);
  await prepare.click();
  const confirm = dialog.getByRole("button", { name: "Confirmer et lancer la collecte Apify", exact: true });
  await confirm.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect.poll(() => f.starts.length).toBe(1);
  expect(f.plans[0]).toEqual({ city: "Bordeaux", activity: "restaurant", keyword: "menuisier", engine: "website", max: 25, budget: 1 });
  expect(f.starts[0]).toEqual({ ...f.plans[1], planId: "a".repeat(64), confirmed: true, requestId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  await expect(prepare).toBeDisabled();
  await expect(page.getByRole("button", { name: "Trouver 25 nouveaux prospects" })).toHaveCount(0);
  expect(f.free).toHaveLength(0);
});
