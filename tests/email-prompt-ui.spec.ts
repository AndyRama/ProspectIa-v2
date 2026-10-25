import { test, expect } from "@playwright/test";
import { days, renderBody, templateHash } from '../server/services/followups/templates';

test("real local API: distinct default email and coder refonte prompts, legacy drafts preserved", async ({ page, request }) => {
  await request.delete("/api/data", { data: { confirm: "SUPPRIMER" } });
  const imported = await (await request.post("/api/import", { data: { text: "name,city,category,email\nAtelier Prompt,Paris,Artisan,bonjour@atelier-fixture.fr" } })).json();
  expect(imported.prospects).toHaveLength(1); const p = imported.prospects[0];
  // Historical API stays readable; this is NOT the new UI action.
  expect((await request.post(`/api/prospects/${p.id}/drafts`, { data: { engine: "website" } })).ok()).toBeTruthy();
  const before = await (await request.get("/api/state")).json();
  const errors: string[] = [], newDraftCalls: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("request", r => { if (/\/drafts$/.test(r.url()) && r.method() === "POST") newDraftCalls.push(r.url()); });
  await page.route("**/*", route => { const url = new URL(route.request().url()); return url.hostname === "127.0.0.1" || url.hostname === "localhost" ? route.continue() : route.abort(); });
  await page.goto("/");
  await page.getByRole("button", { name: /Tous les leads/ }).click();
  await page.getByRole("button", { name: "Voir la fiche" }).click();
  await expect(page.getByRole("button", { name: "Préparer le prompt refonte · coder" })).toBeVisible();
  await page.getByRole("button", { name: "Préparer le prompt email · default" }).click();
  await expect(page.getByRole("dialog")).toContainText("default");
  const prompt = page.getByLabel("PROMPT À TRANSMETTRE À HERMÈS");
  await expect(prompt).toHaveValue(/brouillon Gmail/); await expect(prompt).toHaveValue(/J3, J7, J15, J31/);
  const emailText = await prompt.inputValue();
  for (const day of days) expect(emailText).toContain(`J${day} :\n\`\`\`text\n${renderBody(day)}\n\`\`\``);
  expect(emailText).toContain(templateHash);
  const emailState = await (await request.get('/api/state')).json();
  const emailHandoff = emailState.handoffs.find((h: any) => h.kind === 'email' && h.prospectId === p.id);
  expect(emailText).toContain(`--handoff-id '${emailHandoff.id}'`);
  const exportLink = page.getByRole("link", { name: "Prompt · Markdown" });
  expect(await (await request.get((await exportLink.getAttribute("href"))!)).text()).toBe(emailText);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copier le prompt", exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(emailText);
  await page.setViewportSize({ width: 390, height: 844 }); await expect(prompt).toBeVisible();
  await page.screenshot({ path: "/opt/data/cache/scratch/prospectai-email-prompt-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1512, height: 1100 });
  await page.getByRole("button", { name: "Fermer", exact: true }).click();
  await page.getByRole("button", { name: /Tous les leads/ }).click(); await page.getByRole("button", { name: "Voir la fiche" }).click();
  await page.getByRole("button", { name: "Préparer le prompt refonte · coder" }).click();
  await expect(prompt).toHaveValue(/PROFIL coder/); await expect(prompt).not.toHaveValue(/# PROMPT EMAIL/);
  await page.screenshot({ path: "/opt/data/cache/scratch/prospectai-coder-prompt-desktop.png", fullPage: true });
  const after = await (await request.get("/api/state")).json();
  expect(after.drafts).toEqual(before.drafts); expect(after.handoffs).toHaveLength(before.handoffs.length + 2);
  expect(newDraftCalls).toEqual([]); expect(errors).toEqual([]);
});

test("demo email prompt disabled", async ({ page, request }) => {
  await request.delete("/api/data", { data: { confirm: "SUPPRIMER" } }); await request.post("/api/demo");
  await page.goto("/"); await page.getByRole("button", { name: /Tous les leads/ }).click(); await page.getByRole("button", { name: "Voir la fiche" }).first().click();
  await expect(page.getByRole("button", { name: "Préparer le prompt email · default" })).toBeDisabled();
});
