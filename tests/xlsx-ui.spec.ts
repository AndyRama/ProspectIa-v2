import { test, expect } from "@playwright/test";
import { tmpdir } from "node:os";
import path from "node:path";
import writeXlsxFile from "write-excel-file/node";

for (const invalidRows of [
  [['Instructions'], ['Lire avant import']],
  [['Nom', 'Site web'], ['Première invalide', 'javascript:alert(1)']],
]) {
  test(`Excel recovers from invalid first sheet (${invalidRows[0][0]}) and requires fresh confirmation`, async ({ page, request }) => {
    const buffer = await writeXlsxFile([
      { sheet: 'Aide', data: invalidRows.map(row => row.map(value => ({ value, type: String }))) },
      { sheet: 'Valide', data: [['Nom', 'Ville'], ['Seconde valide', 'Lyon']].map(row => row.map(value => ({ value, type: String }))) },
    ]).toBuffer();
    const before = await (await request.get('/api/state')).json();
    const commits: any[] = [];
    page.on('request', req => { if (req.url().endsWith('/api/import/xlsx')) commits.push(req.postDataJSON()); });
    await page.goto('/');
    await page.getByRole('button', { name: 'Importer Excel', exact: true }).click();
    const modal = page.getByRole('dialog', { name: 'Importer Excel' });
    await modal.getByLabel('Fichier Excel (.xlsx)').setInputFiles({ name: 'multifeuille.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer });
    await expect(modal.getByRole('alert')).toContainText(invalidRows[0][0] === 'Nom' ? 'URL invalide' : 'Colonne Nom');
    await expect(modal.getByLabel('Feuille à importer')).toHaveValue('Aide');
    await expect(modal.getByRole('button', { name: 'Confirmer et importer' })).toBeDisabled();
    expect(commits).toEqual([]);
    expect(await (await request.get('/api/state')).json()).toEqual(before);
    const rejected = await request.post('/api/import/xlsx', { data: { fileName: 'multifeuille.xlsx', data: buffer.toString('base64'), sheet: 'Aide', confirmed: true } });
    expect(rejected.status()).toBe(422);
    expect(await (await request.get('/api/state')).json()).toEqual(before);
    await modal.getByLabel('Feuille à importer').selectOption('Valide');
    await expect(modal.getByText('Seconde valide', { exact: true })).toBeVisible();
    await modal.getByLabel('Je confirme l’import de cette feuille').check();
    await modal.getByLabel('Feuille à importer').selectOption('Aide');
    await expect(modal.getByText('Seconde valide', { exact: true })).toHaveCount(0);
    await expect(modal.getByRole('alert')).toBeVisible();
    await expect(modal.getByRole('button', { name: 'Confirmer et importer' })).toBeDisabled();
    await modal.getByLabel('Feuille à importer').selectOption('Valide');
    await expect(modal.getByText('Seconde valide', { exact: true })).toBeVisible();
    await expect(modal.getByLabel('Je confirme l’import de cette feuille')).not.toBeChecked();
    await expect(modal.getByRole('button', { name: 'Confirmer et importer' })).toBeDisabled();
    await modal.getByLabel('Je confirme l’import de cette feuille').check();
    await modal.getByRole('button', { name: 'Confirmer et importer' }).click();
    await expect(modal).toHaveCount(0);
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({ sheet: 'Valide', confirmed: true });
    const after = await (await request.get('/api/state')).json();
    expect(after.prospects).toHaveLength(before.prospects.length + 1);
    expect(after.searches).toHaveLength(before.searches.length + 1);
    expect(after.prospects).toEqual(expect.arrayContaining(before.prospects));
    expect(after.prospects.some((p: { name: string }) => p.name === 'Seconde valide')).toBe(true);
  });
}
// Embedded real two-sheet OOXML fixture: no runtime generator or external binary.
const fixtureBytes = Buffer.from('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', "base64");
const fixture = { name: "prospects.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: fixtureBytes };




test('Excel cancellation and invalid replacement never write and clear previous preview', async ({ page, request }) => {
  const before = await (await request.get('/api/state')).json();
  let commits = 0;
  page.on('request', req => { if (req.url().endsWith('/api/import/xlsx')) commits++; });
  await page.goto('/');
  await page.getByRole('button', { name: 'Importer Excel', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Importer Excel' });
  await modal.getByLabel('Fichier Excel (.xlsx)').setInputFiles(fixture);
  await expect(modal.getByText('Atelier Excel Fictif', { exact: true })).toBeVisible();
  await modal.getByLabel('Je confirme l’import de cette feuille').check();
  await modal.getByLabel('Fichier Excel (.xlsx)').setInputFiles({ name: 'invalid.csv', mimeType: 'text/csv', buffer: Buffer.from('not Excel') });
  await expect(modal.getByRole('alert')).toContainText('Choisissez un fichier .xlsx');
  await expect(modal.getByText('Atelier Excel Fictif', { exact: true })).toHaveCount(0);
  await expect(modal.getByRole('button', { name: 'Confirmer et importer' })).toBeDisabled();
  await modal.getByLabel('Fichier Excel (.xlsx)').setInputFiles({ name: 'large.xlsx', mimeType: fixture.mimeType, buffer: Buffer.alloc(5 * 1024 * 1024 + 1) });
  await expect(modal.getByRole('alert')).toContainText('5 Mio');
  await modal.getByLabel('Fichier Excel (.xlsx)').setInputFiles(fixture);
  await expect(modal.getByText('Atelier Excel Fictif', { exact: true })).toBeVisible();
  await modal.getByRole('button', { name: 'Annuler', exact: true }).click();
  expect(commits).toBe(0);
  expect(await (await request.get('/api/state')).json()).toEqual(before);
});

test('Excel errors preserve existing leads and busy import cannot double-submit or dismiss', async ({ page, request }) => {
  const before = await (await request.get('/api/state')).json();
  let commits = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/import/xlsx', async route => {
    commits++;
    await gate;
    await route.fulfill({ status: 422, json: { error: 'Import refusé : fichier invalide.' } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Importer Excel', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Importer Excel' });
  await modal.getByLabel('Fichier Excel (.xlsx)').setInputFiles(fixture);
  await expect(modal.getByText('Atelier Excel Fictif', { exact: true })).toBeVisible();
  await modal.getByLabel('Je confirme l’import de cette feuille').check();
  await modal.getByRole('button', { name: 'Confirmer et importer' }).click();
  await expect(modal.getByRole('button', { name: 'Import en cours…' })).toBeDisabled();
  await expect(modal.getByRole('button', { name: 'Annuler' })).toBeDisabled();
  await modal.getByRole('button', { name: 'Fermer', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(modal).toBeVisible();
  release();
  await expect(modal.getByRole('alert')).toHaveText('Import refusé : fichier invalide.');
  expect(commits).toBe(1);
  expect(await (await request.get('/api/state')).json()).toEqual(before);
  await modal.getByRole('button', { name: 'Annuler' }).click();
  await page.getByRole('button', { name: /Tous les leads/ }).click();
  await expect(page.locator('tbody')).toContainText('Existant préservé');
});

test('Excel mobile preview is bounded and warnings are rendered as text, stale sheet responses are ignored', async ({ page, request }) => {
  const before = await (await request.get('/api/state')).json();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const row = { name: '<img src=x onerror=alert(1)>', city: 'Lyon', website: '', email: '', phone: '' };
  await page.route('**/api/import/xlsx/preview', async route => {
    const sheet = route.request().postDataJSON().sheet;
    if (sheet === 'Autre') {
      await gate;
      await route.fulfill({ status: 422, json: { error: 'Feuille invalide' } });
      return;
    }
    await route.fulfill({ json: { sheets: ['Prospects', 'Autre'], sheet: 'Prospects', rows: [row], count: 1, warnings: ['Vérifiez les coordonnées'] } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Importer Excel', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Importer Excel' });
  await modal.getByLabel('Fichier Excel (.xlsx)').setInputFiles(fixture);
  await expect(modal.getByText(row.name, { exact: true })).toBeVisible();
  await expect(modal.getByText('Vérifiez les coordonnées')).toBeVisible();
  await expect(modal.locator('img')).toHaveCount(0);
  expect((await modal.locator('tbody td').first().boundingBox())!.width).toBeGreaterThanOrEqual(140);
  await modal.getByLabel('Je confirme l’import de cette feuille').check();
  await modal.getByLabel('Feuille à importer').selectOption('Autre');
  await expect(modal.getByRole('button', { name: 'Confirmer et importer' })).toBeDisabled();
  await expect(modal.getByText(row.name, { exact: true })).toHaveCount(0);
  await modal.getByLabel('Feuille à importer').selectOption('Prospects');
  await expect(modal.getByText(row.name, { exact: true })).toBeVisible();
  release();
  await expect(modal.getByLabel('Je confirme l’import de cette feuille')).not.toBeChecked();
  await expect(modal.getByRole('alert')).toHaveCount(0);
  const box = await modal.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  await page.keyboard.press('Escape');
  expect(await (await request.get('/api/state')).json()).toEqual(before);
});

test('Excel import response must be verified in persisted state before success', async ({ page }) => {
  await page.route('**/api/import/xlsx', route => route.fulfill({ json: { search: { id: 'unpersisted', ids: ['missing'], count: 1 }, prospects: [] } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Importer Excel', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Importer Excel' });
  await modal.getByLabel('Fichier Excel (.xlsx)').setInputFiles(fixture);
  await expect(modal.getByText('Atelier Excel Fictif', { exact: true })).toBeVisible();
  await modal.getByLabel('Je confirme l’import de cette feuille').check();
  await modal.getByRole('button', { name: 'Confirmer et importer' }).click();
  await expect(modal.getByRole('alert')).toContainText('actualisation impossible');
  await expect(modal.getByRole('button', { name: 'Confirmer et importer' })).toBeDisabled();
});

test('Excel accepts a 5 MiB file without stack overflow and blocks more than 200 preview rows', async ({ page, request }) => {
  const before = await (await request.get('/api/state')).json();
  let bytes = 0;
  await page.route('**/api/import/xlsx/sheets', route => route.fulfill({ json: { sheets: ['Prospects'], sheet: 'Prospects' } }));
  await page.route('**/api/import/xlsx/preview', route => {
    bytes = Buffer.from(route.request().postDataJSON().data, 'base64').length;
    return route.fulfill({ json: { sheets: ['Prospects'], sheet: 'Prospects', rows: Array.from({ length: 201 }, (_, i) => ({ name: `Entreprise ${i}`, city: 'Lyon' })), count: 201, warnings: ['Maximum 200 lignes'] } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Importer Excel', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Importer Excel' });
  await modal.getByLabel('Fichier Excel (.xlsx)').setInputFiles({ ...fixture, buffer: Buffer.alloc(5 * 1024 * 1024) });
  await expect(modal.getByText('Maximum 200 lignes', { exact: true })).toBeVisible();
  expect(bytes).toBe(5 * 1024 * 1024);
  await expect(modal.locator('tbody tr')).toHaveCount(200);
  await modal.getByLabel('Je confirme l’import de cette feuille').check();
  await expect(modal.getByRole('button', { name: 'Confirmer et importer' })).toBeDisabled();
  await modal.getByRole('button', { name: 'Annuler' }).click();
  expect(await (await request.get('/api/state')).json()).toEqual(before);
});

test('CSV import remains available from the directory', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Tous les leads/ }).click();
  await page.getByRole('button', { name: 'Importer CSV', exact: true }).click();
  const modal = page.getByRole('dialog');
  await modal.locator('textarea').fill('name,city\nCSV conservé,Nantes');
  await modal.getByRole('button', { name: 'Importer mes entreprises', exact: true }).click();
  await expect(modal).toHaveCount(0);
  await page.getByRole('button', { name: /Tous les leads/ }).click();
  await expect(page.locator('tbody')).toContainText('CSV conservé');
});

test.beforeEach(async ({ page, request, baseURL }, testInfo) => {
  // Refuse destructive setup unless the standard Playwright-owned server is
  // configured with its disposable database. Never target a reused/user server.
  const server = testInfo.config.webServer;
  expect(baseURL).toBe('http://127.0.0.1:5174');
  expect(server?.reuseExistingServer).toBe(false);
  expect(server?.env).toMatchObject({
    DATA_DIR: path.join(tmpdir(), 'prospectai-browser-tests'),
    PORT: '3201', API_PORT: '3201', VITE_PORT: '5174',
    TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '',
    APIFY_TOKEN: '', AI_API_KEY: '', EMAIL_ENABLED: 'false',
  });
  expect(testInfo.config.workers).toBe(1);
  const providerCalls: string[] = [];
  await page.route(/\/api\/(?:apify\/|search(?:\?|$)|business\/read-site|prospects\/[^/]+\/(?:analyze|drafts))/, route => {
    providerCalls.push(route.request().url());
    return route.fulfill({ status: 503, json: { error: 'Providers disabled in XLSX UI tests' } });
  });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:5174(?:\/|$))/, route => route.abort());
  await expect.poll(async () => (await request.get('/api/state')).status()).toBe(200);
  expect((await request.delete('/api/data', { data: { confirm: 'SUPPRIMER' } })).ok()).toBe(true);
  const seeded = await request.post('/api/import', { data: { text: 'name,city\nExistant préservé,Bordeaux' } });
  expect(seeded.ok()).toBe(true);
  const state = await (await request.get('/api/state')).json();
  expect(state.prospects).toHaveLength(1);
  expect(state.prospects[0]).toMatchObject({ name: 'Existant préservé', city: 'Bordeaux' });
  // A browser provider request is always a test failure, even though mocked.
  page.on('close', () => expect(providerCalls).toEqual([]));
});

test('Excel preview is read-only, sheet selection is explicit, confirmed import refreshes catalogue and history', async ({ page, request }) => {
  const before = await (await request.get('/api/state')).json();
  const commits: any[] = [];
  page.on('request', req => { if (req.url().endsWith('/api/import/xlsx')) commits.push(req.postDataJSON()); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Importer Excel', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Importer Excel' });
  const modelLink = modal.getByRole('link', { name: 'Télécharger le modèle Excel' });
  await expect(modelLink).toHaveAttribute('href', '/modele-prospects.xlsx');
  const [download] = await Promise.all([page.waitForEvent('download'), modelLink.click()]);
  expect(download.suggestedFilename()).toBe('modele-prospects.xlsx');
  expect(await download.failure()).toBeNull();
  const chunks: Buffer[] = [];
  for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk));
  const modelBytes = Buffer.concat(chunks);
  expect(modelBytes.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  const modelPreview = await request.post('/api/import/xlsx/preview', {
    data: { fileName: download.suggestedFilename(), data: modelBytes.toString('base64') },
  });
  expect(modelPreview.ok()).toBe(true);
  expect((await modelPreview.json()).sheets.length).toBeGreaterThan(0);
  await modal.getByLabel('Fichier Excel (.xlsx)').setInputFiles(fixture);
  await expect(modal.getByText('Atelier Excel Fictif', { exact: true })).toBeVisible();
  await expect(modal.getByText('atelier@example.test', { exact: true })).toBeVisible();
  expect(await (await request.get('/api/state')).json()).toEqual(before);
  expect(commits).toEqual([]);
  await modal.getByLabel('Feuille à importer').selectOption('Autre');
  await expect(modal.getByText('Autre Excel Fictif', { exact: true })).toBeVisible();
  await expect(modal.getByText('Atelier Excel Fictif', { exact: true })).toHaveCount(0);
  const confirm = modal.getByRole('button', { name: 'Confirmer et importer', exact: true });
  await expect(confirm).toBeDisabled();
  await modal.getByLabel('Je confirme l’import de cette feuille').check();
  await confirm.click();
  await expect(modal).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Tous les leads', exact: true })).toBeVisible();
  await expect(page.locator('tbody')).toContainText('Autre Excel Fictif');
  await expect(page.locator('tbody')).toContainText('Existant préservé');
  expect(commits).toHaveLength(1);
  expect(commits[0]).toMatchObject({ sheet: 'Autre', confirmed: true, fileName: 'prospects.xlsx' });
  expect(Buffer.from(commits[0].data, 'base64')).toEqual(fixtureBytes);
  const after = await (await request.get('/api/state')).json();
  expect(after.searches).toHaveLength(before.searches.length + 1);
  expect(after.prospects).toHaveLength(before.prospects.length + 1);
  expect(after.prospects).toEqual(expect.arrayContaining(before.prospects));
  const imported = after.prospects.find((prospect: { name: string }) => prospect.name === 'Autre Excel Fictif');
  expect(imported).toBeDefined();
  expect(after.searches.find((search: { ids: string[] }) => search.ids.includes(imported.id)))
    .toMatchObject({ ids: [imported.id], count: 1 });
  await page.getByRole('button', { name: 'Trouver des prospects', exact: true }).click();
  await page.getByText('Historique des recherches · résultats conservés', { exact: true }).click();
  await expect(page.locator('.history-list')).toContainText('Import Excel');
  await page.reload();
  await page.getByRole('button', { name: /Tous les leads/ }).click();
  await expect(page.locator('tbody')).toContainText('Autre Excel Fictif');
  expect(await (await request.get('/api/state')).json()).toEqual(after);
});
