import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import path from "node:path";

const capturePath = (name: string) => process.env.SITE_TOOLS_CAPTURE_DIR
  ? path.join(process.env.SITE_TOOLS_CAPTURE_DIR, name)
  : test.info().outputPath(name);

const psiName = "Analyse complète du site · Lighthouse / PageSpeed Insights";
const wappName = "Identifier les technologies · Wappalyzer";
const base = { id: "external", name: "Atelier synthétique", lat: null, lng: null, category: "Artisan", city: "Lyon", address: "Lyon", engine: "website", status: "À contacter", selected: false, fields: {}, socials: {}, photos: [], rating: null, reviews: null, email: "bonjour@atelier-fixture.fr", phone: "", website: "https://WWW.Atelier-Fixture.fr/services/renovation?token=secret#private", webStatus: "Non vérifié" };
async function fixture(page: Page, context: BrowserContext, overrides = {}) {
  let prospect: any = { ...base, ...overrides };
  const mutations: string[] = [], external: string[] = [], errors: string[] = [];
  let release: (() => void) | undefined;
  let held = false;
  page.on("pageerror", e => errors.push(e.message));
  await context.route("**/*", async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
      if (["pagespeed.web.dev", "www.wappalyzer.com"].includes(url.hostname)) external.push(req.url());
      return route.fulfill({ contentType: req.resourceType() === "stylesheet" ? "text/css" : "text/html", body: req.resourceType() === "stylesheet" ? "" : "<title>Intercepted synthetic provider transport</title>" });
    }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (req.method() !== "GET") mutations.push(`${req.method()} ${url.pathname}`);
    if (url.pathname.startsWith("/api/tiles/")) return route.fulfill({ status: 204 });
    if (url.pathname === "/api/auth/status") return route.fulfill({ json: { required: false, authenticated: true } });
    if (url.pathname === "/api/state") return route.fulfill({ json: { prospects: [prospect], searches: [], drafts: [], handoffs: [], settings: { business: { name: "Fixture", userName: "Test", zone: "Lyon" }, limits: { max: 25, budget: 1 }, storage: "Local", onboarded: true } } });
    if (url.pathname === "/api/prospects/external/site-check") {
      expect(req.method()).toBe("POST"); expect(req.postDataJSON()).toEqual({});
      if (held) await new Promise<void>(resolve => { release = resolve; });
      prospect = { ...prospect, siteCheck: { status: "succeeded", checkedAt: "2026-11-14T12:00:00Z" }, webStatus: "Site analysé" };
      return route.fulfill({ json: prospect });
    }
    return route.fulfill({ status: 500, json: { error: `Unexpected fixture API ${req.method()} ${url.pathname}` } });
  });
  await page.goto("/");
  if (prospect.archived) await page.getByRole("button", { name: "Archives 1", exact: true }).click();
  await page.getByRole("button", { name: "Voir la fiche" }).click();
  const drawer = page.getByRole("complementary", { name: "Fiche prospect" });
  return { drawer, mutations, external, errors, hold: () => { held = true; }, release: () => release?.() };
}

test("external tools are ordered native safe links, only clicked provider tabs navigate; preliminary stays local", async ({ page, context }) => {
  const f = await fixture(page, context);
  const psi = f.drawer.getByRole("link", { name: psiName, exact: true });
  const wapp = f.drawer.getByRole("link", { name: wappName, exact: true });
  await expect(psi).toBeVisible();
  await expect(wapp).toBeVisible();
  const controls = f.drawer.locator(".site-check-action button, a.button, .drawer-actions button");
  expect(await controls.allTextContents()).toEqual(["Vérifier le site · contrôle préliminaire", psiName, wappName, "Préparer le prompt refonte · coder", "Préparer le prompt email · default"]);
  const expectedPsi = new URL("https://pagespeed.web.dev/analysis");
  expectedPsi.searchParams.set("url", "https://www.atelier-fixture.fr/services/renovation");
  const expectedWapp = "https://www.wappalyzer.com/lookup/www.atelier-fixture.fr/";
  for (const [link, href] of [[psi, expectedPsi.href], [wapp, expectedWapp]] as const) {
    await expect(link).toHaveAttribute("href", href);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await expect(link).toHaveAttribute("referrerpolicy", "no-referrer");
    await expect(link).toHaveClass("button ghost full");
  }
  await expect(f.drawer).toContainText("ne sont pas enregistrés dans le CRM");
  await expect(f.drawer).toContainText("Wappalyzer peut nécessiter un compte");
  expect(f.external).toEqual([]); expect(f.mutations).toEqual([]);
  for (const [link, href] of [[psi, expectedPsi.href], [wapp, expectedWapp]] as const) {
    const nextTab = context.waitForEvent("page");
    await link.click();
    const tab = await nextTab;
    await tab.waitForLoadState("domcontentloaded");
    expect(tab.url()).toBe(href);
    expect(await tab.evaluate(() => window.opener)).toBeNull();
    expect(await tab.evaluate(() => document.referrer)).toBe("");
    expect(page.url()).toBe("http://127.0.0.1:5174/");
    await tab.close();
  }
  expect(f.external).toEqual([expectedPsi.href, expectedWapp]);
  expect(f.mutations).toEqual([]);
  await f.drawer.getByRole("button", { name: "Vérifier le site · contrôle préliminaire", exact: true }).click();
  await expect(f.drawer.getByRole("button", { name: /Revérifier/ })).toBeEnabled();
  expect(f.mutations).toEqual(["POST /api/prospects/external/site-check"]);
  expect(f.errors).toEqual([]);
  await page.screenshot({ path: capturePath("desktop.png"), fullPage: false });
});

for (const [label, website] of [
  ["missing", ""], ["malformed", "not a URL"], ["script", "javascript:alert(1)"],
  ["credentials", "https://private:secret@atelier-fixture.fr/path"], ["loopback", "http://127.1/private"],
  ["privateIPv4", "http://192.168.1.1/private"], ["privateIPv6", "http://[fd00::1]/private"],
  ["localhost", "http://localhost/private"], ["internal", "http://crm.internal/private"],
]) test(`${label} target has disabled fallbacks and explanatory hint without any provider URL`, async ({ page, context }) => {
  const f = await fixture(page, context, { website });
  for (const name of [psiName, wappName]) {
    await expect(f.drawer.getByRole("link", { name, exact: true })).toHaveCount(0);
    await expect(f.drawer.getByRole("button", { name, exact: true })).toBeDisabled();
  }
  await expect(f.drawer).toContainText(website ? "URL invalide ou non publique" : "Aucun site renseigné");
  expect(await f.drawer.locator('a[href*="pagespeed.web.dev"], a[href*="wappalyzer.com"]').count()).toBe(0);
  expect(f.external).toEqual([]); expect(f.mutations).toEqual([]); expect(f.errors).toEqual([]);
});

for (const guard of ["archived", "demo"]) test(`${guard} blocks external actions consistently`, async ({ page, context }) => {
  const f = await fixture(page, context, { [guard]: true });
  for (const name of [psiName, wappName]) {
    await expect(f.drawer.getByRole("link", { name, exact: true })).toHaveCount(0);
    await expect(f.drawer.getByRole("button", { name, exact: true })).toBeDisabled();
  }
  await expect(f.drawer).toContainText(guard === "archived" ? "Lead archivé" : "Fiche de démonstration");
  expect(f.external).toEqual([]); expect(f.mutations).toEqual([]);
});

test("pending preliminary request disables external navigation until local confirmation", async ({ page, context }) => {
  const f = await fixture(page, context);
  f.hold();
  await f.drawer.getByRole("button", { name: /Vérifier le site · contrôle préliminaire/ }).click();
  for (const name of [psiName, wappName]) {
    await expect(f.drawer.getByRole("link", { name, exact: true })).toHaveCount(0);
    await expect(f.drawer.getByRole("button", { name, exact: true })).toBeDisabled();
  }
  await expect(f.drawer).toContainText("Une opération est en cours");
  expect(f.external).toEqual([]);
  await expect.poll(() => f.mutations).toEqual(["POST /api/prospects/external/site-check"]);
  f.release();
  await expect(f.drawer.getByRole("link", { name: psiName, exact: true })).toBeEnabled();
  expect(f.external).toEqual([]);
});

test("390px mobile external controls and drawer have no horizontal overflow", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const f = await fixture(page, context);
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  expect(await f.drawer.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  for (const name of [psiName, wappName]) {
    const link = f.drawer.getByRole("link", { name, exact: true });
    await expect(link).toBeVisible();
    expect(await link.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
  expect(f.external).toEqual([]); expect(f.mutations).toEqual([]);
  await f.drawer.getByRole("link", { name: psiName, exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: capturePath("mobile-390.png"), fullPage: false });
});
