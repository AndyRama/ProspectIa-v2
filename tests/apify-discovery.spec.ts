import { test, expect, type Page } from "@playwright/test";

async function fixture(page: Page, pending: any = null) {
  const state = { prospects: [], searches: [], drafts: [], handoffs: [], settings: { business: { name: "Atelier", zone: "Bordeaux", userName: "Test" }, limits: { max: 25, budget: 1 }, pending, apifyConfigured: true, onboarded: true, storage: "SQLite local" } };
  const plans: any[] = [], starts: any[] = [], free: any[] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth/status") return route.fulfill({ json: { required: false, authenticated: true } });
    if (url.pathname === "/api/state") return route.fulfill({ json: state });
    if (url.pathname === "/api/apify/discovery/plan") {
      const args = route.request().postDataJSON(); plans.push(args);
      return route.fulfill({ json: { ...args, planId: "a".repeat(64), actor: "benthepythondev/google-maps-business-scraper", query: { city: args.city, keyword: args.keyword, activity: args.activity, paid: true }, excludedCount: 37, unidentifiedCount: 2, warnings: ["Identités incomplètes"] } });
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

test("pending payant ne bloque pas le gratuit ; actualisation explicite et avertissements à zéro résultat", async ({ page }) => {
  const f = await fixture(page, { runId: "runFixture12345" });
  const free = page.getByRole("button", { name: "Trouver 25 nouveaux prospects", exact: true });
  await expect(free).toBeEnabled();
  await free.click();
  expect(f.free[0].refreshPool).toBe(false);
  await expect(page.getByText(/Source gratuite temporairement indisponible/)).toBeVisible();
  const refill = page.getByRole("button", { name: "Actualiser les sources gratuites", exact: true });
  await refill.click();
  expect(f.free).toHaveLength(2); expect(f.free[1].refreshPool).toBe(true);
  expect(f.free[0].requestId).not.toBe(f.free[1].requestId);
  await expect(refill).toBeEnabled();
  expect(f.starts).toHaveLength(0);
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
  await page.route("**/api/apify/discovery/start", (route) => {
    f.starts.push(route.request().postDataJSON()); f.state.settings.pending = { runId: null, mode: "discovery" };
    return route.fulfill({ status: 422, json: { error: "Lancement incertain ; verrou conservé" } });
  });
  await page.getByRole("button", { name: "Préparer une recherche Apify", exact: true }).click();
  await page.getByRole("button", { name: "Confirmer et lancer la collecte Apify", exact: true }).click();
  await expect(page.getByRole("button", { name: "Associer le run", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Préparer une recherche Apify", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Trouver 25 nouveaux prospects", exact: true })).toBeEnabled();
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
  await expect(dialog).toContainText("37"); await expect(dialog).toContainText("2");
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
  await expect(page.getByRole("button", { name: "Trouver 25 nouveaux prospects" })).toBeEnabled();
});
