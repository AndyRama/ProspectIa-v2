import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const capture = '/opt/data/cache/scratch/prospectia-lead-info-captures';
const longName = 'DONNÉES FICTIVES — Atelier de menuiserie et restauration du patrimoine ' + 'TrèsLongNomSansSéparateur'.repeat(6);
test('compact lead information keeps controls, scoped geometry, statuses and Google identity across views', async ({ page }) => {
  const source = (value: string, source = 'Import de démonstration') => ({ value, source, collectedAt: '2026-01-01' });
  const base = { name: longName, category: 'Artisan', city: 'Lyon', address: 'Adresse fictive uniquement', engine: 'website', status: 'À contacter', selected: true, fields: { googleMaps: source('https://www.google.com/maps?cid=123'), provenance: source('x', 'SourceTrèsLongue'.repeat(12)) }, socials: {}, hours: '', photos: [], lat: null, lng: null, rating: null, reviews: null, email: '', phone: '', website: '', webStatus: 'Pas de site renseigné' };
  const prospects = [{ ...base, id: 'fixture-' + 'id'.repeat(70) }, { ...base, id: 'audited', name: 'FICTIF — Audit conservé', webStatus: 'Site analysé' }, { ...base, id: 'with-url', name: 'FICTIF — URL renseignée', website: 'https://fixture.test/' + 'path'.repeat(50) }, { ...base, id: 'archived', name: 'FICTIF — Archive', archived: true }];
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith('/api/tiles/')) return route.fulfill({ status: 204 });
    if (path === '/api/auth/status') return route.fulfill({ json: { required: false, authenticated: true } });
    if (path === '/api/state') return route.fulfill({ json: { prospects, searches: [], drafts: [], handoffs: [], settings: { business: { name: 'Fixture', userName: 'Test', zone: 'Lyon' }, limits: { max: 25, budget: 1 }, storage: 'Local', onboarded: true } } });
    throw new Error('Unexpected API ' + path);
  });
  await page.goto('/');
  const row = page.locator('tbody tr').first();
  await expect(row.locator('.web-badge')).toHaveCount(0);
  await expect(row.getByRole('button', { name: 'Aucun site renseigné', exact: true })).toBeDisabled();
  await expect(page.locator('tbody tr').nth(1).locator('.web-badge')).toHaveText('Site analysé');
  await expect(page.locator('tbody tr').nth(2).locator('.web-badge')).toHaveText('Pas de site renseigné');
  const link = row.getByRole('link', { name: 'Google Business', exact: true });
  await expect(link).toHaveAttribute('href', 'https://www.google.com/maps?cid=123');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', /noopener/);
  mkdirSync(capture, { recursive: true });
  for (const width of [1440, 1920, 2560, 650, 390]) {
    await page.setViewportSize({ width, height: 1100 });
    const geometry = await row.evaluate(tr => {
      const cells = tr.querySelectorAll('td'); const cell = cells[1]; const company = cell.querySelector('.company')!;
      const scroll = tr.closest('.table-scroll')!;
      return { columns: Array.from(cells, cell => cell.getBoundingClientRect().width), actionsContained: Array.from(cells[5].querySelectorAll('button')).every(button => button.getBoundingClientRect().right <= cells[5].getBoundingClientRect().right + 1), table: tr.closest('table')!.getBoundingClientRect().width, cell: cell.getBoundingClientRect().width, header: tr.closest('table')!.querySelectorAll('th')[1].getBoundingClientRect().width, company: company.getBoundingClientRect().width, content: cell.scrollWidth, doc: document.documentElement.scrollWidth, viewport: innerWidth, scroll: scroll.scrollWidth, container: scroll.clientWidth };
    });
    if (width >= 1440) {
      expect(Math.abs(geometry.table - geometry.container)).toBeLessThanOrEqual(1);
      expect(geometry.scroll).toBeLessThanOrEqual(geometry.container + 1);
    }
    expect(geometry.cell / geometry.table).toBeCloseTo(0.36, 2);
    [0.04, 0.36, 0.18, 0.12, 0.14, 0.16].forEach((share, i) => expect(geometry.columns[i] / geometry.table).toBeCloseTo(share, 2));
    expect(geometry.actionsContained).toBe(true);
    expect(geometry.cell).toBe(geometry.header);
    expect(geometry.content).toBeLessThanOrEqual(geometry.cell + 1);
    expect(geometry.doc).toBe(geometry.viewport);
    if (width < 700) expect(geometry.scroll).toBeGreaterThan(geometry.container);
    await expect(row.getByRole('button', { name: longName })).toContainText(longName);
    await page.screenshot({ path: `${capture}/table-${width}.png`, fullPage: true });
  }
  await row.getByRole('button', { name: 'Voir la fiche' }).click();
  const drawer = page.getByRole('complementary', { name: 'Fiche prospect' });
  await expect(drawer.getByRole('link', { name: 'Google Business', exact: true })).toHaveAttribute('href', 'https://www.google.com/maps?cid=123');
  await expect(drawer.getByText(/cela ne prouve pas l’absence/)).toBeVisible();
  const drawerGeometry = await drawer.evaluate(el => ({ width: el.clientWidth, content: el.scrollWidth, heading: el.querySelector('h2')!.scrollWidth, headingWidth: el.querySelector('h2')!.clientWidth }));
  expect(drawerGeometry.content).toBeLessThanOrEqual(drawerGeometry.width);
  expect(drawerGeometry.heading).toBeLessThanOrEqual(drawerGeometry.headingWidth);
  await page.screenshot({ path: `${capture}/drawer-390.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.screenshot({ path: `${capture}/drawer-1440.png`, fullPage: true });
  await page.getByRole('button', { name: 'Fermer la fiche' }).click();
  for (const name of ['Tous les leads 3', 'Ma sélection 3', 'Archives 1']) {
    await page.getByRole('button', { name, exact: true }).click();
    const first = page.locator('.leads-table tbody tr').first();
    await expect(first.locator('.web-badge')).toHaveCount(0);
    await expect(first.getByRole('link', { name: 'Google Business', exact: true })).toBeVisible();
    expect(await first.locator('td').nth(1).evaluate(el => el.getBoundingClientRect().width / el.closest('table')!.getBoundingClientRect().width)).toBeCloseTo(0.36, 2);
  }
});
