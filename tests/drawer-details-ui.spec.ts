import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

// Capture-only: omit unrelated background map overlays caused by blocked synthetic tiles.
// All interaction and geometry assertions run against the unmodified rendered page.
const capture = process.env.DRAWER_CAPTURE_DIR || path.join(process.cwd(), 'test-results', 'drawer-details');
mkdirSync(capture, { recursive: true });

const json = JSON.stringify({ origin: 'SYNTHETIC ONLY', records: Array.from({ length: 18 }, (_, i) => ({ id: i, description: 'Provenance fictive sans donnée réelle' })), end: 'JSON_END' });
const plain = 'Description fictive. '.repeat(30) + 'PLAIN_END';
const source = (value: string) => ({ value, source: 'Import fictif', qualification: 'À confirmer', collectedAt: '2026-01-01', url: 'https://fixture.test/source' });
const hours = 'Lun 9h\nMar 9h\nMer 9h\nJeu 9h\nVen 9h\nSam 9h\nDim fermé';
const longUrl = 'https://fixture.test/' + 'token'.repeat(90);
async function fixture(page: Page, extensive = false, changeOnSelect = false) {
  const errors: string[] = [], mutations: string[] = [];
  const base = { category: 'Artisan', city: 'Lyon', address: 'Adresse fictive', engine: 'website', status: 'À contacter', selected: false, fields: { apifyProvenance: source(json), description: source(plain), phone: source('0123456789') }, socials: {}, hours: '', photos: [], lat: null, lng: null, rating: null, reviews: null, email: '', phone: '0123456789', website: '', webStatus: 'Pas de site renseigné' };
  const extra = extensive ? { website: longUrl, rating: 4, hours, fields: { ...base.fields, website: { ...source(longUrl), source: plain }, hours: source(hours), metadata: { ...source('Court'), source: plain, qualification: plain } } } : {};
  const prospects = [{ ...base, ...extra, id: 'first', name: 'FICTIF — Premier' }, { ...base, ...extra, id: 'second', name: 'FICTIF — Second' }];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (!['GET', 'HEAD'].includes(route.request().method())) mutations.push(route.request().method() + ' ' + url.pathname);
    if (url.pathname.startsWith('/api/tiles/')) return route.fulfill({ status: 204 });
    if (url.pathname === '/api/auth/status') return route.fulfill({ json: { required: false, authenticated: true } });
    if (url.pathname === '/api/prospects/first' && changeOnSelect && route.request().method() === 'PATCH') {
      expect(route.request().postDataJSON()).toEqual({ selected: true });
      prospects[0].selected = true;
      prospects[0].fields.apifyProvenance = source(plain);
      return route.fulfill({ json: prospects[0] });
    }
    if (url.pathname === '/api/state') return route.fulfill({ json: { prospects, searches: [], drafts: [], handoffs: [], settings: { business: { name: 'Fixture', userName: 'Test', zone: 'Lyon' }, limits: { max: 25, budget: 1 }, storage: 'Local', onboarded: true } } });
    throw new Error('Unexpected API ' + url.pathname);
  });
  await page.goto('/');
  await page.locator('.sidebar').getByRole('button', { name: /Tous les leads/ }).click();
  await page.locator('tbody tr').first().getByRole('button', { name: 'Voir la fiche' }).click();
  return { errors, mutations, prospects };
}
const drawer = (page: Page) => page.getByRole('complementary', { name: 'Fiche prospect' });
const field = (page: Page, label: string) => drawer(page).locator('.data-fields > div').filter({ has: page.locator(':scope > span').filter({ hasText: label }) });

test('long JSON and plain imported values disclose full text without mutations', async ({ page }) => {
  const api = await fixture(page);
  for (const [label, value] of [['apifyProvenance', json], ['description', plain]]) {
    const row = field(page, label);
    const button = row.getByRole('button', { name: /^Afficher (plus|moins)$/ });
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    const id = await button.getAttribute('aria-controls');
    expect(id).toBeTruthy();
    const text = page.locator(`[id="${id}"]`);
    expect((await text.textContent())!.length).toBeLessThanOrEqual(241);
    await expect(text).toContainText('…');
    await expect(text).not.toContainText(value.endsWith('PLAIN_END') ? 'PLAIN_END' : 'JSON_END');
    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(button).toHaveText('Afficher moins');
    await expect(text).toHaveText(value);
    await expect(row.getByRole('link', { name: 'Voir la source' })).toHaveAttribute('href', 'https://fixture.test/source');
    await expect(row).toContainText('À confirmer');
    await expect(row).toContainText('Collecté le');
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Space');
    await expect(text).toHaveText(value);
    await page.keyboard.press('Space');
  }
  const short = field(page, 'Téléphone ·');
  await expect(short).toContainText('0123456789');
  await expect(short.getByRole('button')).toHaveCount(0);
  await expect(drawer(page).getByRole('button', { name: 'Sélectionner', exact: true })).toBeEnabled();
  await expect(drawer(page).getByRole('button', { name: 'Archiver', exact: true })).toBeEnabled();
  await expect(drawer(page).getByRole('button', { name: 'Analyse complète du site', exact: true })).toBeDisabled();
  await field(page, 'apifyProvenance').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(capture, 'collapsed-desktop.png'), animations: 'disabled', style: '.map-warning, .map-legend { visibility: hidden; }' });
  expect(api.mutations).toEqual([]);
  expect(api.errors).toEqual([]);
});

test('changed field value resets disclosure while the existing selection action still works', async ({ page }) => {
  const api = await fixture(page, false, true);
  const row = field(page, 'apifyProvenance');
  await row.getByRole('button', { name: 'Afficher plus' }).click();
  await expect(row.locator('strong [id]')).toHaveText(json);
  expect(api.mutations).toEqual([]);
  await drawer(page).getByRole('button', { name: 'Sélectionner', exact: true }).click();
  await expect(drawer(page).getByRole('button', { name: 'Dans ma sélection', exact: true })).toBeEnabled();
  await expect(row.getByRole('button', { name: 'Afficher plus' })).toHaveAttribute('aria-expanded', 'false');
  await expect(row.locator('strong [id]')).not.toContainText('PLAIN_END');
  await row.getByRole('button', { name: 'Afficher plus' }).click();
  await expect(row.locator('strong [id]')).toHaveText(plain);
  expect(api.mutations).toEqual(['PATCH /api/prospects/first']);
  expect(api.errors).toEqual([]);
});

test('coordinates, provenance and multiline hours collapse, reset and fit mobile', async ({ page }) => {
  const api = await fixture(page, true);
  const coordinates = drawer(page).getByLabel('Coordonnées et provenance');

  // Match the direct label, not the disclosure's nested preview.
  const siteRow = coordinates.locator(':scope > div').filter({ hasText: /^Site/ });
  await expect(siteRow.getByRole('button', { name: 'Afficher plus' })).toHaveCount(2);
  const multiline = field(page, 'Horaires ·');
  await expect(multiline.getByRole('button', { name: 'Afficher plus' })).toBeVisible();
  const auditHours = drawer(page).locator('.audit').filter({ hasText: 'Avis et informations' });
  await expect(auditHours.getByRole('button', { name: 'Afficher plus' })).toBeVisible();
  const metadata = field(page, 'metadata ·');
  await expect(metadata.getByRole('button', { name: 'Afficher plus' })).toHaveCount(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await field(page, 'apifyProvenance').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(capture, 'collapsed-mobile-390.png'), animations: 'disabled', style: '.map-warning, .map-legend { visibility: hidden; }' });
  const importedLink = field(page, 'Site web ·').getByRole('link').first();
  await expect(importedLink).toHaveAttribute('href', longUrl);
  const buttons = drawer(page).getByRole('button', { name: 'Afficher plus', exact: true });
  while (await buttons.count()) await buttons.first().click();
  await expect(importedLink).toHaveText(longUrl);
  await expect(multiline.locator('strong [id]')).toHaveText(hours);
  const geometry = await drawer(page).evaluate(el => ({ drawer: el.clientWidth, content: el.scrollWidth, scroll: el.querySelector('.drawer-scroll')!.scrollWidth, scrollWidth: el.querySelector('.drawer-scroll')!.clientWidth, doc: document.documentElement.scrollWidth, viewport: innerWidth }));
  expect(geometry.content).toBeLessThanOrEqual(geometry.drawer);
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.scrollWidth);
  expect(geometry.doc).toBe(geometry.viewport);
  await field(page, 'apifyProvenance').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(capture, 'expanded-mobile-390.png'), animations: 'disabled', style: '.map-warning, .map-legend { visibility: hidden; }' });
  // Switch directly while the drawer remains mounted, as map/table selection can do.
  await page.locator('tbody tr').nth(1).getByRole('button', { name: 'Voir la fiche' }).evaluate((el: HTMLElement) => el.click());
  await expect(drawer(page).getByRole('heading', { name: 'FICTIF — Second' })).toBeVisible();
  await expect(drawer(page).getByRole('button', { name: 'Afficher moins', exact: true })).toHaveCount(0);
  await field(page, 'apifyProvenance').getByRole('button', { name: 'Afficher plus' }).click();
  await drawer(page).getByRole('button', { name: 'Fermer la fiche' }).click();
  await page.locator('tbody tr').nth(1).getByRole('button', { name: 'Voir la fiche' }).click();
  await expect(drawer(page).getByRole('button', { name: 'Afficher moins', exact: true })).toHaveCount(0);
  expect(api.mutations).toEqual([]);
  expect(api.errors).toEqual([]);
});
