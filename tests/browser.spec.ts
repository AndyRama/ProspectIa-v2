import { test, expect } from "@playwright/test";
test("Connexion : écran privé et retour à la prospection après authentification", async ({ page }) => {
  let authenticated = false;
  await page.route("**/api/auth/status", (route) => route.fulfill({ json: { required: true, authenticated } }));
  await page.route("**/api/auth/login", (route) => { authenticated = true; return route.fulfill({ json: { ok: true } }); });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Votre espace privé." })).toBeVisible();
  await page.getByLabel("Mot de passe de l’espace").fill("fixture-password");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByRole("heading", { name: "Trouvez vos prochains clients." })).toBeVisible();
});

test("Parcours bureau et mobile : recherche, fiche, sélection, rédaction, prompt Hermès et paramètres", async ({
  page,
  request,
}) => {
  await request.delete("/api/data", { data: { confirm: "SUPPRIMER" } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Trouvez vos prochains clients." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Explorer la démo" }).first().click();
  await expect(page.locator("tbody tr")).toHaveCount(9);
  await page.getByRole("button", { name: "Voir la fiche" }).first().click();
  await expect(
    page.getByRole("complementary", { name: "Fiche prospect" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sélectionner", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Dans ma sélection" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Préparer le prompt email · default" })).toBeDisabled();
  // Old drafts remain editable/readable, without exposing legacy generation as the new UI action.
  const historicalState = await (await request.get("/api/state")).json();
  const selected = historicalState.prospects.find((p: { selected: boolean }) => p.selected);
  await request.post(`/api/prospects/${selected.id}/drafts`, { data: { engine: "website" } });
  await page.reload();
  await page.getByRole("button", { name: /Mes brouillons/ }).click();
  await expect(page.locator(".draft-card")).toHaveCount(3);
  await page
    .locator(".draft-card")
    .first()
    .getByLabel("OBJET")
    .fill("Une proposition à relire");
  await page
    .locator(".draft-card")
    .first()
    .getByRole("button", { name: "Enregistrer", exact: true })
    .click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Trouvez vos prochains clients." }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Mes brouillons/ }).click();
  await expect(page.locator(".draft-card input").first()).toHaveValue(
    "Une proposition à relire",
  );
  await page.getByRole("button", { name: /Ma sélection/ }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.getByRole("button", { name: "Voir la fiche" }).click();
  await page
    .getByRole("button", { name: "Préparer le prompt refonte · coder" })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("PROMPT À TRANSMETTRE À HERMÈS")).toHaveValue(/ATTENDS MON « OK »/);
  await page.screenshot({ path: ".data/prospectai-hermes-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("PROMPT À TRANSMETTRE À HERMÈS")).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.screenshot({ path: ".data/prospectai-hermes-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1512, height: 1100 });
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Dossier complet · JSON" }).click();
  expect((await download).suggestedFilename()).toBe("dossier-prospectai.json");
  await expect(page.locator("iframe")).toHaveCount(0);
  await page.getByRole("button", { name: "Fermer", exact: true }).click();
  await page.getByRole("button", { name: "Mon atelier et pipeline" }).click();
  await expect(page.locator(".pipeline-prospect")).toHaveCount(1);
  await page.locator(".pipeline-prospect select").selectOption("En discussion");
  await expect(
    page
      .locator(".pipeline-column")
      .filter({ has: page.getByRole("heading", { name: /En discussion/ }) })
      .locator(".pipeline-prospect"),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Paramètres", exact: true }).click();
  await expect(page.getByRole("button", { name: /envoyer avec Gmail|Publier sur mon compte Vercel/ })).toHaveCount(0);
  await expect(page.getByLabel("CLÉ API VERCEL")).toHaveCount(0);
  await page.getByLabel("NOM DU BUSINESS").fill("TahitiTechDigital");
  await page.getByLabel("VOS CONSIGNES COMPLÉMENTAIRES POUR HERMÈS").fill("Privilégier une mise en page très lisible.");
  await page.getByRole("button", { name: "Enregistrer mon espace" }).click();
  await expect(page.locator(".workspace strong")).toHaveText(
    "TahitiTechDigital",
  );
  await page.getByRole("button", { name: "Trouver des prospects" }).click();
  await expect(page.getByLabel("Recherche payante (Apify)")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Préparer une recherche Apify" })).toBeVisible();
  await page.screenshot({
    path: ".data/prospectai-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  await expect(page.locator(".sidebar")).toBeVisible();
  await page.getByRole("button", { name: /Ma sélection/ }).click();
  await expect(
    page.getByRole("heading", { name: "Votre prochaine conversation." }),
  ).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  await page.getByRole("button", { name: "Trouver des prospects" }).click();
  await expect(page.locator(".sidebar")).toHaveCSS(
    "transform",
    "matrix(1, 0, 0, 1, -260, 0)",
  );
  await page.screenshot({
    path: ".data/prospectai-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("Historique Bordeaux : restauration des critères, fiche unique, collecte antérieure et agent personnel", async ({ page, request }) => {
  const { createClient } = await import("@libsql/client");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  await request.delete("/api/data", { data: { confirm: "SUPPRIMER" } });
  const imported = await (await request.post("/api/import", { data: { text: "name,city,category,address\nMenuisier Martin,Bordeaux,Artisan menuisier,10 rue des Lilas Bordeaux" } })).json();
  const p = imported.prospects[0];
  await request.patch(`/api/prospects/${p.id}`, { data: { selected: true, status: "En discussion" } });
  const client = createClient({ url: pathToFileURL(path.join(tmpdir(), "prospectai-browser-tests", "prospectai.sqlite")).href });
  await client.batch(["a", "b"].map((id, i) => {
    const search = { id: `history-bordeaux-${id}`, city: "Bordeaux", activity: "artisan", keyword: "menuisier", provider: "OpenStreetMap", engine: "voice", count: 1, ids: [p.id], cost: 0, createdAt: `2026-10-18T1${i}:00:00Z` };
    return { sql: "INSERT INTO searches VALUES(?,?)", args: [search.id, JSON.stringify(search)] };
  }), "write"); client.close();
  await page.goto("/");
  await expect(page.getByLabel("DANS QUELLE VILLE ?")).toHaveValue("Bordeaux");
  await expect(page.getByLabel("NOM OU MOT-CLÉ")).toHaveValue("menuisier");
  await expect(page.getByRole("button", { name: "Agents personnels", exact: true })).toHaveClass(/chosen/);
  await expect(page.getByRole("button", { name: /Agents vocaux/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Revoir les 1 fiches enregistrées" }).click();
  await expect(page.getByText(/sans nouvelle collecte ni paiement/)).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  expect((await (await request.get("/api/state")).json()).searches).toHaveLength(3);
  await page.getByText("Historique des recherches · résultats conservés", { exact: true }).click();
  await expect(page.locator(".history-group")).toHaveCount(2); // Une requête Bordeaux, ses deux versions ; un import.
  await page.getByText("1 collecte(s) précédente(s) conservée(s)", { exact: true }).click();
  await page.locator(".history-versions button").click();
  await expect(page.getByLabel("NOM OU MOT-CLÉ")).toHaveValue("menuisier");
  await expect(page.getByRole("button", { name: "Préparer une recherche Apify" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.screenshot({ path: ".data/prospectai-history-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1512, height: 1100 });
  await page.getByRole("button", { name: "Voir la fiche" }).click();
  await page.getByRole("button", { name: "Préparer le prompt Hermès" }).click();
  await expect(page.getByLabel("PROMPT À TRANSMETTRE À HERMÈS")).toHaveValue(/AGENT PERSONNEL/);
  await expect(page.getByLabel("PROMPT À TRANSMETTRE À HERMÈS")).not.toHaveValue(/agent vocal|accueil vocal/i);
  expect((await (await request.get("/api/state")).json()).prospects).toHaveLength(1);
});

test("Trois lots Apify confirmés de 25 inédits : historique préservé et anciens identifiants interdits au paiement", async ({ page, request }) => {
  const { createClient } = await import("@libsql/client");

  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { pathToFileURL } = await import("node:url");

  await request.delete("/api/data", { data: { confirm: "SUPPRIMER" } });
  const client = createClient({ url: pathToFileURL(path.join(tmpdir(), "prospectai-browser-tests", "prospectai.sqlite")).href });
  const query = { city: "Bordeaux", activity: "artisan", keyword: "menuisier", paid: false };
  const rows = Array.from({ length: 112 }, (_, i) => {
    const placeId = "ChIJ" + String(i).padStart(23, "0");
    return { id: i < 37 ? "apify-" + placeId : `reserve-${i}`, name: `Atelier ${i}`, category: "Artisan menuisier", city: "Bordeaux", address: `${i + 1} rue des Lilas Bordeaux`, website: "", email: "", phone: "", lat: 44.84, lng: -0.58, rating: null, reviews: null, selected: i < 37, status: "Contacté", demo: false, fields: i < 37 ? { placeId: { value: placeId, source: "Apify", collectedAt: "2026-10-19" } } : {}, socials: {}, hours: "", photos: [], engine: "voice", webStatus: "Non vérifié" };
  });
  const history = { id: "paid-legacy", ...query, query: { ...query, paid: true }, provider: "Apify", cost: 0.1342, ids: rows.slice(0, 37).map((p) => p.id), count: 37, engine: "voice", createdAt: "2026-10-19T10:00:00Z" };
  await client.batch([
    ...rows.slice(0, 37).map((p) => ({ sql: "INSERT INTO prospects VALUES(?,?)", args: [p.id, JSON.stringify(p)] })),
    { sql: "INSERT INTO searches VALUES(?,?)", args: [history.id, JSON.stringify(history)] },
  ], "write"); client.close();
  const plans: any[] = [], starts: any[] = [], forbidden: string[] = [];
  page.on("request", req => { if (new URL(req.url()).pathname === "/api/search") forbidden.push(req.url()); });
  await page.route("**/api/state", async route => {
    const state = await (await request.get("/api/state")).json();
    state.settings.apifyConfigured = true;
    await route.fulfill({ json: state });
  });
  // Provider boundary simulated; fixture imports persist into the isolated test database.
  await page.route("**/api/apify/discovery/plan", async route => {
    const input = route.request().postDataJSON(); plans.push(input);
    const state = await (await request.get("/api/state")).json();
    await route.fulfill({ json: { ...input, planId: "a".repeat(64), actor: "benthepythondev/google-maps-business-scraper", excludedCount: state.prospects.length, unidentifiedCount: 0, warnings: [] } });
  });
  await page.route("**/api/apify/discovery/start", async route => {
    const input = route.request().postDataJSON(); starts.push(input);
    const batch = starts.length - 1;
    if (batch === 3) return route.fulfill({ json: { message: "Aucun candidat inédit retourné par Apify. Des frais de lancement restent possibles." } });
    const candidates = rows.slice(37 + batch * 25, 62 + batch * 25);
    const imported = await (await request.post("/api/import", { data: { text: "name,city,category,address\n" + candidates.map(p => `${p.name},${p.city},${p.category},${p.address}`).join("\n") } })).json();
    await route.fulfill({ json: { search: { id: `fixture-paid-${batch}`, city: "Bordeaux", activity: "artisan", keyword: "menuisier", engine: "voice", provider: "Apify", ids: imported.prospects.map((p: any) => p.id), count: 25, newCount: 25, cost: 0.0125, warnings: [] } } });
  });
  await page.goto("/");
  const seen = new Set<string>();
  for (let batch = 0; batch < 3; batch++) {
    await page.getByRole("button", { name: "Préparer une recherche Apify" }).click();
    await expect(page.getByRole("dialog")).toContainText(`${37 + batch * 25}`);
    expect(starts).toHaveLength(batch);
    const response = page.waitForResponse((r) => r.url().endsWith("/api/apify/discovery/start") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Confirmer et lancer la collecte Apify", exact: true }).click();
    const result = await (await response).json();
    expect(result.search.count).toBe(25); expect(result.search.newCount).toBe(25); expect(result.search.cost).toBe(0.0125);
    for (const id of result.search.ids) { expect(seen.has(id)).toBe(false); expect(id.startsWith("apify-")).toBe(false); seen.add(id); }
    await expect(page.locator("tbody tr")).toHaveCount(25);
    await expect(page.getByRole("button", { name: "Préparer une recherche Apify" })).toBeEnabled();
  }
  expect(seen.size).toBe(75);
  await page.getByRole("button", { name: "Préparer une recherche Apify" }).click();
  expect(starts).toHaveLength(3);
  await page.getByRole("button", { name: "Confirmer et lancer la collecte Apify", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Aucun candidat inédit retourné par Apify");
  await expect(page.locator("tbody tr")).toHaveCount(0);
  const persisted = await (await request.get("/api/state")).json();
  expect(persisted.prospects).toHaveLength(112);
  expect(persisted.searches).toContainEqual(history);
  expect(forbidden).toEqual([]);
  expect(plans).toHaveLength(4); expect(starts).toHaveLength(4);
  for (const input of starts) expect(input).toMatchObject({ confirmed: true, budget: 1, max: 25, planId: "a".repeat(64) });
  expect(new Set(starts.map(input => input.requestId)).size).toBe(4);
  await page.getByRole("button", { name: /Ma sélection/ }).click();
  await page.getByRole("button", { name: "Vérifier un lot Apify avant paiement" }).click();
  await expect(page.getByRole("dialog")).toContainText("37 déjà collecté(s) ou réservé(s) exclu(s)");
  await expect(page.getByRole("button", { name: /Enrichir .*identifiants inédits/ })).toHaveCount(0);
});
