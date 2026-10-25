import { test, expect, type Page } from "@playwright/test";

// Real app rendered against a deterministic local API boundary; no public website or paid service.
async function fixture(page: Page, extra: any[] = []) {
  page.on("pageerror", error => { throw error; });
  const base = { lat: null, lng: null, category: "Artisan", city: "Lyon", address: "Lyon", engine: "website", status: "À contacter", selected: false, fields: {}, socials: {}, photos: [], rating: null, reviews: null, email: "", phone: "", website: "https://fixture.test", webStatus: "Non vérifié" };
  let prospects = [{ ...base, id: "pending", name: "Site à vérifier", doNotContact: true }, { ...base, id: "missing", name: "Sans URL", website: "", webStatus: "Pas de site" }, { ...base, id: "archived", name: "Site archivé", archived: true }, { ...base, id: "demo", name: "Site démo", demo: true }, ...extra.map(p => ({ ...base, ...p }))];
  const calls: string[] = [];
  let fail = false, persist = true, legacy = false, active = 0, maxActive = 0;
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/api/tiles/")) return route.fulfill({ status: 204 });
    if (url.pathname === "/api/auth/status") return route.fulfill({ json: { required: false, authenticated: true } });
    if (url.pathname === "/api/state") return route.fulfill({ json: { prospects, searches: [], drafts: [], handoffs: [], settings: { business: { name: "Fixture", userName: "Test", zone: "Lyon" }, limits: { max: 25, budget: 1 }, storage: "Local", onboarded: true } } });
    const match = url.pathname.match(/^\/api\/prospects\/([^/]+)\/site-check$/);
    if (match) {
      calls.push(match[1]);
      active++; maxActive = Math.max(maxActive, active);
      expect(route.request().method()).toBe("POST");
      expect(route.request().postDataJSON()).toEqual({});
      await new Promise(resolve => setTimeout(resolve, 120));
      const old = prospects.find(p => p.id === match[1])!;
      const checkedAt = new Date().toISOString();
      const next = fail ? { ...old, webStatus: "Vérification impossible", siteCheck: { status: "failed", checkedAt, error: "Délai de lecture dépassé" } } : { ...old, siteCheck: legacy ? undefined : { status: "succeeded", checkedAt }, webStatus: "Site analysé", audit: { score: 20, checkedAt, scope: "homepage", sourceUrl: old.website, observations: ["Page d’accueil consultée"], technology: "HTML" } };
      if (persist) prospects = prospects.map(p => p.id === old.id ? next : p);
      active--;
      return route.fulfill({ status: fail ? 502 : 200, json: fail ? { error: next.siteCheck!.error, prospect: next } : next });
    }
    throw new Error(`Unexpected API call ${url.pathname}`);
  });
  await page.goto("/");
  await expect(page.locator("tbody tr")).toHaveCount(prospects.filter(p => !p.archived).length);
  return { calls, maxActive: () => maxActive, legacy: () => { legacy = true; }, fail: (value: boolean) => { fail = value; }, persist: (value: boolean) => { persist = value; } };
}

test("row amber CTA checks homepage, no-site red is disabled, status changes after persisted success", async ({ page }) => {
  const api = await fixture(page);
  api.legacy(); // Historical success response containing only an audit.
  const row = page.locator("tbody tr").filter({ hasText: "Site à vérifier" });
  const check = row.getByRole("button", { name: "Vérifier le site · contrôle préliminaire", exact: true });
  await expect(check).toHaveCSS("background-color", "rgb(254, 243, 199)");
  await expect(check).toHaveCSS("color", "rgb(120, 53, 15)");
  const missing = page.getByRole("button", { name: "Aucun site renseigné", exact: true });
  await expect(missing).toBeDisabled();
  await expect(missing).toHaveCSS("background-color", "rgb(254, 226, 226)");
  expect(api.calls).toEqual([]);
  await check.click();
  await expect(row.getByText("Vérification en cours…", { exact: true })).toBeVisible();
  await expect(row.locator(".web-badge")).toHaveText("Site analysé");
  await expect(row.getByRole("button", { name: /Revérifier/ })).not.toHaveCSS("background-color", "rgb(254, 243, 199)");
  expect(api.calls).toEqual(["pending"]);
  await row.getByRole("button", { name: "Voir la fiche" }).click();
  const drawer = page.getByRole("complementary", { name: "Fiche prospect" });
  await expect(drawer.getByRole("button", { name: /Revérifier/ })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Analyse complète du site" })).toBeEnabled();
});

test("failure reason persists beside retry and stale readback never reports success", async ({ page }) => {
  const api = await fixture(page);
  api.fail(true);
  const row = page.locator("tbody tr").filter({ hasText: "Site à vérifier" });
  await row.getByRole("button", { name: /Vérifier le site/ }).click();
  await expect(row.getByText("Vérification impossible", { exact: true })).toBeVisible();
  await expect(row.getByText("Délai de lecture dépassé", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Délai de lecture dépassé");
  api.fail(false); api.persist(false);
  await row.getByRole("button", { name: /Réessayer/ }).click();
  await expect(page.getByRole("alert")).toContainText("n’a pas été confirmée");
  api.persist(true);
  await row.getByRole("button", { name: /Réessayer/ }).click();
  await expect(row.locator(".web-badge")).toHaveText("Site analysé");
});

test("explicit sequential batch caps 25 eligible displayed active non-demo prospects", async ({ page }) => {
  const api = await fixture(page, Array.from({ length: 27 }, (_, i) => ({ id: `batch-${i}`, name: `Entreprise ${i}` })));
  expect(api.calls).toEqual([]);
  await page.getByRole("button", { name: "Vérifier les sites affichés", exact: true }).click();
  await expect(page.getByRole("button", { name: "Vérifier les sites affichés", exact: true })).toBeDisabled();
  await expect(page.locator("tbody").getByRole("button", { name: /contrôle préliminaire/ }).first()).toBeDisabled();
  await expect(page.locator(".site-check-batch")).toContainText("25 réussite(s) · 0 échec(s)", { timeout: 15000 });
  expect(api.maxActive()).toBe(1);
  expect(api.calls).toHaveLength(25);
  expect(new Set(api.calls).size).toBe(25);
  expect(api.calls).not.toContain("missing"); expect(api.calls).not.toContain("archived"); expect(api.calls).not.toContain("demo");
});

test("drawer controls and failures preserve prior audit; reload never triggers a check", async ({ page }) => {
  const api = await fixture(page, [{ id: "old-audit", name: "Ancien audit", audit: { score: 40, checkedAt: "2025-01-01T00:00:00.000Z", observations: ["Observation conservée"], technology: "HTML" } }]);
  await page.locator("tbody tr").filter({ hasText: "Ancien audit" }).getByRole("button", { name: "Voir la fiche" }).click();
  const drawer = page.getByRole("complementary", { name: "Fiche prospect" });
  api.fail(true);
  await drawer.getByRole("button", { name: /Revérifier/ }).click();
  await expect(drawer.getByText("Délai de lecture dépassé", { exact: true })).toBeVisible();
  await expect(drawer.getByText("Observation conservée", { exact: true })).toBeVisible();
  await expect(drawer.getByRole("button", { name: /Réessayer/ })).toHaveCSS("background-color", "rgb(254, 243, 199)");
  await page.reload();
  await expect(page.locator("tbody tr")).toHaveCount(4);
  expect(api.calls).toEqual(["old-audit"]);
  await page.locator("tbody tr").filter({ hasText: "Sans URL" }).getByRole("button", { name: "Voir la fiche" }).click();
  await expect(drawer.getByRole("button", { name: "Aucun site renseigné", exact: true })).toHaveCSS("background-color", "rgb(254, 226, 226)");
  await expect(drawer.getByText(/cela ne prouve pas l’absence/)).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Analyse complète du site" })).toBeDisabled();
  await page.getByRole("button", { name: "Fermer la fiche" }).click();
  await page.locator("tbody tr").filter({ hasText: "Site démo" }).getByRole("button", { name: "Voir la fiche" }).click();
  await expect(drawer.getByRole("button", { name: /contrôle préliminaire/ })).toBeDisabled();
  await expect(drawer.getByRole("button", { name: "Analyse complète du site" })).toBeDisabled();
});

test("batch respects displayed filters and reports failed persistence without stopping", async ({ page }) => {
  const api = await fixture(page, [{ id: "visible", name: "Visible", email: "public@fixture.test" }, { id: "visible2", name: "Visible aussi", email: "other@fixture.test" }]);
  await page.getByRole("button", { name: "Avec email", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(2);
  api.persist(false);
  await page.getByRole("button", { name: "Vérifier les sites affichés", exact: true }).click();
  await expect(page.locator(".site-check-batch")).toContainText("0 réussite(s) · 2 échec(s)");
  await expect(page.getByRole("alert")).toContainText("n’a pas été confirmée");
  expect(api.calls).toEqual(["visible", "visible2"]);
});

test("successful readback survives reload with neutral retry and homepage scope", async ({ page }) => {
  const api = await fixture(page);
  const row = page.locator("tbody tr").filter({ hasText: "Site à vérifier" });
  await row.getByRole("button", { name: /Vérifier le site/ }).click();
  await expect(row.getByRole("button", { name: /Revérifier/ })).toBeEnabled();
  await page.reload();
  await expect(row.getByRole("button", { name: /Revérifier/ })).toHaveCSS("background-color", "rgb(241, 245, 244)");
  await row.getByRole("button", { name: "Voir la fiche" }).click();
  const drawer = page.getByRole("complementary", { name: "Fiche prospect" });
  await expect(drawer.getByText("Contrôle préliminaire · page d’accueil uniquement", { exact: true })).toBeVisible();
  await expect(drawer.getByRole("link", { name: "Source du contrôle" })).toHaveAttribute("href", "https://fixture.test/");
  expect(api.calls).toEqual(["pending"]);
});

test("archive controls stay guarded and mobile does not overflow", async ({ page }) => {
  await fixture(page);
  await page.getByRole("button", { name: "Archives 1", exact: true }).click();
  await expect(page.getByRole("button", { name: "Vérifier les sites affichés", exact: true })).toHaveCount(0);
  await expect(page.locator("tbody").getByRole("button", { name: /contrôle préliminaire/ })).toBeDisabled();
  await page.getByRole("button", { name: "Voir la fiche" }).click();
  await expect(page.getByRole("complementary", { name: "Fiche prospect" }).getByRole("button", { name: "Analyse complète du site" })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.getByRole("button", { name: "Fermer la fiche" }).click();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
});
