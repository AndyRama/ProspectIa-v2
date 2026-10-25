import { test, expect, type Page } from '@playwright/test';

// Render the actual application. Only the API boundary is mocked; no public network.
async function fixture(page: Page, extra: any[] = [], options: { activeIds?: string[]; delay?: number; holdId?: string; pollIds?: string[]; poll?: 'new' | 'cached' | 'noeligible' | 'partial' } = {}) {
  const base = { lat: null, lng: null, category: 'Artisan', city: 'Lyon', address: 'Lyon', engine: 'website', status: 'À contacter', selected: false, fields: {}, socials: {}, photos: [], rating: null, reviews: null, email: '', phone: '', website: 'https://fixture.test', webStatus: 'Non vérifié' };
  let prospects: any[] = [{ ...base, id: 'found', name: 'Contact public' }, { ...base, id: 'missing', name: 'Sans site', website: '' }, { ...base, id: 'refused', name: 'Opposition', doNotContact: true }, { ...base, id: 'demo', name: 'Démo', demo: true }, { ...base, id: 'archive', name: 'Archivé', archived: true }, { ...base, id: 'valid', name: 'Email existant', email: 'bonjour@atelier-fixture.fr' }, ...extra.map(p => ({ ...base, ...p }))];
  const calls: string[] = [], errors: string[] = [], events: string[] = [];
  let release!: () => void;
  const heldResponse = new Promise<void>(resolve => { release = resolve; });
  let persist = true, outcome = 'found', active = 0, maxActive = 0, polled = false;
  const pollSearch = { id: 'approved-poll', ids: options.pollIds || (options.poll === 'noeligible' ? ['missing', 'valid'] : ['found', 'missing']), city: 'Lyon', activity: 'artisan', engine: 'website', kind: 'discovery', count: 2, cost: 1, provider: 'Apify', createdAt: '2026-01-01' };
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname.startsWith('/api/tiles/')) return route.fulfill({ status: 204 });
    if (url.pathname === '/api/auth/status') return route.fulfill({ json: { required: false, authenticated: true } });
    if (url.pathname === '/api/apify/discovery/plan') return route.fulfill({ json: { planId: 'local-plan', city: 'Lyon', query: 'artisan', max: 25, budget: 1, excludedCount: 6, unidentifiedCount: 0, warnings: [] } });
    if (url.pathname === '/api/apify/poll' && options.poll) { events.push('poll'); polled = true; return route.fulfill({ json: { search: pollSearch, cached: options.poll === 'cached', runStatus: options.poll === 'partial' ? 'FAILED' : 'SUCCEEDED', enriched: false } }); }
    if (url.pathname === '/api/state') { events.push('state'); return route.fulfill({ json: { prospects, searches: polled ? [pollSearch] : options.activeIds ? [{ id: 'saved', ids: options.activeIds, kind: 'discovery', city: 'Lyon', activity: 'artisan', engine: 'website', count: options.activeIds.length, cost: 1, provider: 'Apify', createdAt: '2026-01-01' }] : [], drafts: [], handoffs: [], settings: { pending: options.poll && !polled ? { runId: 'approved-run' } : null, business: { name: 'Fixture', userName: 'Test', zone: 'Lyon' }, limits: { max: 25, budget: 1 }, storage: 'Local', onboarded: true } } }); }
    const match = url.pathname.match(/^\/api\/prospects\/([^/]+)\/contact-check$/);
    if (match) {
      events.push(`contact:${match[1]}`);
      calls.push(match[1]); active++; maxActive = Math.max(maxActive, active);
      expect(route.request().method()).toBe('POST'); expect(route.request().postDataJSON()).toEqual({});
      if (match[1] === options.holdId) await heldResponse;
      await new Promise(resolve => setTimeout(resolve, options.delay ?? 100));
      const old = prospects.find(p => p.id === match[1]);
      const status = match[1] === 'not-found' ? 'not_found' : match[1] === 'failed' ? 'failed' : outcome;
      const next = { ...old, email: status === 'found' ? (old.email?.includes('@') ? old.email : 'public@atelier-fixture.fr') : old.email, contactCheck: { status, checkedAt: new Date().toISOString(), ...(status === 'failed' ? { error: 'Lecture du site impossible' } : {}) }, fields: status === 'found' ? { email: { value: 'public@atelier-fixture.fr', source: 'Site public', url: 'https://fixture.test/contact', collectedAt: new Date().toISOString() } } : old.fields };
      if (persist) prospects = prospects.map(p => p.id === old.id ? next : p);
      active--;
      return route.fulfill({ status: status === 'failed' ? 502 : 200, json: status === 'failed' ? { error: next.contactCheck.error, prospect: next } : next });
    }
    throw new Error(`Unexpected API call ${url.pathname}`);
  });
  await page.goto('/'); await expect(page.locator('tbody tr')).toHaveCount(prospects.filter(p => !p.archived && !p.duplicateOf && (!options.activeIds || options.activeIds.includes(p.id))).length);
  return { calls, errors, events, release, maxActive: () => maxActive, persist: (v: boolean) => { persist = v; }, outcome: (v: string) => { outcome = v; } };
}
const search = 'Rechercher l’email sur le site';
const batch = 'Récupérer les emails des sites affichés';
const wholeBase = 'Récupérer les emails de toute la base';

test('whole catalogue ignores active search and filters, confirms then processes more than 25 with readback', async ({ page }) => {
  const api = await fixture(page, [
    { id: 'not-found', name: 'Introuvable' }, { id: 'failed', name: 'Échec' },
    { id: 'invalid', name: 'Email invalide', email: 'nope' },
    { id: 'duplicate', name: 'Doublon', duplicateOf: 'found' },
    ...Array.from({ length: 28 }, (_, i) => ({ id: `whole-${i}`, name: `Entreprise ${i}` })),
  ], { activeIds: ['valid', 'invalid'] });
  await page.getByRole('button', { name: 'Avec email', exact: true }).click();
  expect(api.calls).toEqual([]);
  await expect(page.locator('.contact-check-batch')).toContainText('1 sans site');
  await expect(page.locator('.contact-check-batch')).toContainText('1 opposé(s)');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: wholeBase, exact: true }).click();
  expect(api.calls).toEqual([]);
  page.once('dialog', async dialog => { expect(dialog.message()).toContain('32'); await dialog.accept(); });
  await page.getByRole('button', { name: wholeBase, exact: true }).click();
  await expect(page.getByRole('button', { name: wholeBase, exact: true })).toBeDisabled();
  await expect(page.locator('.contact-check-batch')).toContainText('32/32 traités', { timeout: 25000 });
  await expect(page.locator('.contact-check-batch')).toContainText('30 trouvé(s) · 1 introuvable(s) · 1 échec(s)');
  expect(api.calls).toHaveLength(32); expect(new Set(api.calls).size).toBe(32); expect(api.maxActive()).toBe(1);
  for (const id of ['missing', 'refused', 'demo', 'archive', 'valid', 'duplicate']) expect(api.calls).not.toContain(id);
  await page.reload();
  page.once('dialog', async dialog => { expect(dialog.message()).toContain('2'); await dialog.accept(); });
  await page.getByRole('button', { name: wholeBase, exact: true }).click();
  await expect(page.locator('.contact-check-batch')).toContainText('2/2 traités');
  expect(api.calls.slice(32)).toEqual(['not-found', 'failed']); expect(api.errors).toEqual([]);
});

test('new persisted Apify poll automatically retrieves email and reload does not repeat the approved lot', async ({ page }) => {
  const api = await fixture(page, [], { poll: 'new' });
  expect(api.calls).toEqual([]);
  await page.getByRole('button', { name: 'Récupérer la collecte', exact: true }).click();
  const row = page.locator('tbody tr').filter({ hasText: 'Contact public' });
  await expect(row.getByRole('button', { name: 'Préparer le prompt email · default' })).toBeEnabled();
  await expect(page.locator('.contact-check-batch')).toContainText('1/1 traités');
  await expect(page.locator('.contact-check-batch')).toContainText('1 sans site');
  expect(api.calls).toEqual(['found']);
  expect(api.events.slice(api.events.indexOf('poll'), api.events.indexOf('contact:found') + 1)).toEqual(['poll', 'state', 'contact:found']);
  await expect(page.locator('.contact-check-batch')).toContainText('1 emails récupérés · 0 indisponibles · 1 sans site');
  await page.reload();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await expect(page.locator('tbody tr').filter({ hasText: 'Contact public' })).toContainText('Email public trouvé');
  expect(api.calls).toEqual(['found']); expect(api.errors).toEqual([]);
});

test('automatic contact failure preserves the saved Apify lot and reports missing contacts without paid retry', async ({ page }) => {
  const api = await fixture(page, [{ id: 'failed', name: 'Site illisible' }, { id: 'not-found', name: 'Site sans email' }], { poll: 'new', pollIds: ['found', 'failed', 'not-found', 'missing', 'refused', 'demo', 'archive', 'valid'] });
  await page.getByRole('button', { name: 'Récupérer la collecte', exact: true }).click();
  await expect(page.locator('.contact-check-batch')).toContainText('3/3 traités');
  await expect(page.locator('.contact-check-batch')).toContainText('1 emails récupérés · 2 indisponibles · 1 sans site');
  expect(api.calls).toEqual(['found', 'failed', 'not-found']);
  expect(api.maxActive()).toBe(1);
  await page.reload();
  await expect(page.locator('tbody tr')).toHaveCount(7);
  await expect(page.locator('tbody tr').filter({ hasText: 'Contact public' })).toContainText('public@atelier-fixture.fr');
  await expect(page.locator('tbody tr').filter({ hasText: 'Site illisible' })).toContainText('Lecture du site impossible');
  await page.waitForTimeout(300);
  expect(api.calls).toEqual(['found', 'failed', 'not-found']);
  expect(api.errors).toEqual([]);
});

for (const mode of ['cached', 'noeligible', 'partial'] as const) test(`Apify ${mode} result does not crawl any site automatically`, async ({ page }) => {
  const api = await fixture(page, [], { poll: mode });
  await page.getByRole('button', { name: 'Récupérer la collecte', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Récupérer la collecte', exact: true })).toHaveCount(0);
  await expect(page.locator('tbody tr')).toHaveCount(2);
  if (mode === 'noeligible') await expect(page.locator('.contact-check-batch')).toContainText('0/0 traités');
  expect(api.calls).toEqual([]); expect(api.errors).toEqual([]);
});

test('pre-payment plan states email limits and drawer shows missing values with provenance', async ({ page }) => {
  const api = await fixture(page);
  await page.getByRole('button', { name: 'Préparer une recherche Apify', exact: true }).click();
  const modal = page.getByRole('dialog');
  await expect(modal).toContainText('Google Maps ne fournit pas d’emails');
  await expect(modal).toContainText('identifiant Google');
  await expect(modal).toContainText('téléphone');
  await expect(modal).toContainText('adresse');
  await expect(modal).toContainText('démarre automatiquement');
  await expect(modal).toContainText('Email non garanti');
  await expect(modal).toContainText('récupération est impossible');
  await modal.getByRole('button', { name: 'Annuler', exact: true }).click();
  await page.locator('tbody tr').filter({ hasText: 'Contact public' }).getByRole('button', { name: 'Voir la fiche' }).click();
  const fields = page.getByLabel('Coordonnées et provenance');
  await expect(fields).toContainText('ActivitéArtisan');
  await expect(fields).toContainText('TéléphoneNon renseigné');
  await expect(fields).toContainText('EmailNon renseigné');
  await expect(fields).toContainText('Source : non disponible');
  expect(api.calls).toEqual([]); expect(api.errors).toEqual([]);
  await page.getByRole('button', { name: 'Fermer la fiche' }).click();
  const row = page.locator('tbody tr').filter({ hasText: 'Contact public' });
  await expect(row).toContainText('Téléphone : Non renseigné');
  await expect(row).toContainText('ID : found');
  await page.locator('.sidebar').getByRole('button', { name: 'Paramètres', exact: true }).click();
  await page.getByText('Supprimer les données locales', { exact: true }).click();
  await expect(page.locator('.data-card')).toContainText('exclusions');
  await expect(page.locator('.data-card')).toContainText('repayer des doublons');
});

for (const status of ['pending', 'paused'] as const) test(`loaded ${status} checkpoint never triggers contact reads`, async ({ page }) => {
  await page.addInitScript(({ status }) => {
    const key = 'prospectai:approved-contact-lots:v1';
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ saved: { searchId: 'saved', ids: ['found', 'not-found', 'remaining'], done: ['found', 'not-found'], startedAt: '2026-01-01T00:00:00Z', status } }));
  }, { status });
  const api = await fixture(page, [{ id: 'not-found', name: 'Déjà tenté' }, { id: 'remaining', name: 'Restant' }], { activeIds: ['found', 'not-found', 'remaining'] });
  await page.waitForTimeout(500);
  expect(api.calls).toEqual([]);
  await page.reload();
  await expect(page.locator('tbody tr')).toHaveCount(3);
  await page.waitForTimeout(500);
  expect(api.calls).toEqual([]);
  if (status === 'paused') await expect(page.locator('.contact-check-batch')).toContainText('aucune reprise automatique après rechargement');
  expect(api.errors).toEqual([]);
});

for (const reloadDuringResponse of [true, false]) test(`automatic stop persists immediately and survives ${reloadDuringResponse ? 'reload during suspended response' : 'completion of the last response'}`, async ({ page }) => {
  const ids = reloadDuringResponse ? ['found', 'in-flight', 'remaining'] : ['found', 'in-flight'];
  const api = await fixture(page, [{ id: 'in-flight', name: 'Site en cours' }, { id: 'remaining', name: 'Restant' }], { activeIds: ids, holdId: 'in-flight', poll: 'new', pollIds: ids });
  await page.getByRole('button', { name: 'Récupérer la collecte', exact: true }).click();
  const checkpoint = () => page.evaluate(() => JSON.parse(localStorage.getItem('prospectai:approved-contact-lots:v1')!)['approved-poll']);
  await expect.poll(() => api.calls).toEqual(['found', 'in-flight']);
  await expect(page.locator('tbody tr').filter({ hasText: 'Contact public' })).toContainText('Email public trouvé');
  await page.getByRole('button', { name: 'Arrêter après le site en cours', exact: true }).click();
  const stopped = await checkpoint();
  expect.soft(stopped.status).toBe('paused');
  expect(stopped.done).toEqual(['found', 'in-flight']);
  if (!reloadDuringResponse) {
    api.release();
    await expect(page.getByRole('button', { name: wholeBase, exact: true })).toBeEnabled();
    expect.soft((await checkpoint()).status).toBe('paused');
  }
  await page.reload();
  await expect(page.locator('tbody tr')).toHaveCount(ids.length);
  await page.waitForTimeout(500);
  expect(api.calls).toEqual(['found', 'in-flight']);
  expect((await checkpoint()).status).toBe('paused');
  await expect(page.locator('tbody tr').filter({ hasText: 'Contact public' })).toContainText('Email public trouvé');
  await expect(page.locator('.contact-check-batch')).toContainText('aucune reprise automatique après rechargement');
  api.release();
  expect(api.errors).toEqual([]);
});

test('whole-base cap warns, stop remains accessible while busy and finishes only the in-flight request', async ({ page }) => {
  const api = await fixture(page, Array.from({ length: 2000 }, (_, i) => ({ id: `large-${i}`, name: `Entreprise ${i}` })), { activeIds: ['valid'], delay: 1500 });
  await expect(page.locator('.contact-check-batch')).toContainText('2001 site(s) éligible(s)');
  await expect(page.locator('.contact-check-batch')).toContainText('1 candidat(s) au-delà');
  page.once('dialog', async dialog => {
    expect(dialog.message()).toContain('2000 site(s)');
    expect(dialog.message()).toContain('1 candidat(s) ne seront pas traités');
    await dialog.accept();
  });
  await page.getByRole('button', { name: wholeBase, exact: true }).click();
  await expect.poll(() => api.calls.length).toBe(1);
  await expect(page.locator('.contact-check-batch')).toContainText('0/2000 traités');
  await expect(page.getByRole('button', { name: batch, exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Arrêter après le site en cours', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Arrêt demandé…', exact: true })).toBeDisabled();
  await expect(page.locator('.contact-check-batch')).toContainText('1/2000 traités · Arrêté');
  await expect(page.getByRole('button', { name: wholeBase, exact: true })).toBeEnabled();
  expect(api.calls).toEqual(['found']); expect(api.maxActive()).toBe(1);
  await page.reload();
  await expect(page.locator('.contact-check-batch')).toContainText('2000 site(s) éligible(s)');
  expect(api.calls).toEqual(['found']); expect(api.errors).toEqual([]);
});

test('explicit row and drawer lookup confirms persistence before unlocking existing email prompt', async ({ page }) => {
  const api = await fixture(page);
  expect(api.calls).toEqual([]);
  await expect(page.getByText(/Google Maps ne fournit pas/)).toBeVisible();
  const row = page.locator('tbody tr').filter({ hasText: 'Contact public' });
  await expect(row.getByRole('button', { name: 'Préparer le prompt email · default' })).toBeDisabled();
  await row.getByRole('button', { name: search, exact: true }).click();
  await expect(row.getByRole('button', { name: 'Préparer le prompt email · default' })).toBeEnabled();
  await expect(row).toContainText('Email public trouvé');
  await row.getByRole('button', { name: 'Voir la fiche' }).click();
  const drawer = page.getByRole('complementary', { name: 'Fiche prospect' });
  await expect(drawer.getByRole('button', { name: search, exact: true })).toBeEnabled();
  await expect(drawer.getByLabel('Adresse email du prospect')).toHaveValue('public@atelier-fixture.fr');
  await page.reload(); expect(api.calls).toEqual(['found']); expect(api.errors).toEqual([]);
});

test('missing URL, opposition, demo and archive stay blocked; drawer lookup is explicit and mobile fits', async ({ page }) => {
  const api = await fixture(page);
  for (const name of ['Sans site', 'Opposition', 'Démo']) {
    const row = page.locator('tbody tr').filter({ hasText: name });
    await expect(row.getByRole('button', { name: search, exact: true })).toBeDisabled();
  }
  await expect(page.locator('tbody tr').filter({ hasText: 'Sans site' })).toContainText('Aucun site renseigné · ajout manuel possible');
  await page.locator('tbody tr').filter({ hasText: 'Contact public' }).getByRole('button', { name: 'Voir la fiche' }).click();
  const drawer = page.getByRole('complementary', { name: 'Fiche prospect' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  expect(api.calls).toEqual([]);
  await drawer.getByRole('button', { name: search, exact: true }).click();
  await expect(drawer.getByRole('button', { name: 'Préparer le prompt email · default' })).toBeEnabled();
  await drawer.getByRole('button', { name: 'Fermer la fiche' }).click();
  await page.setViewportSize({ width: 1512, height: 1100 });
  await page.getByRole('button', { name: 'Archives 1', exact: true }).click();
  await expect(page.getByRole('button', { name: batch, exact: true })).toHaveCount(0);
  await expect(page.locator('tbody').getByRole('button', { name: search, exact: true })).toBeDisabled();
  expect(api.calls).toEqual(['found']);
});

test('stale readback never unlocks email; failures and not found stay retryable without sending', async ({ page }) => {
  const api = await fixture(page);
  const row = page.locator('tbody tr').filter({ hasText: 'Contact public' });
  api.persist(false);
  await row.getByRole('button', { name: search, exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('n’a pas été confirmée');
  await expect(row.getByRole('button', { name: 'Préparer le prompt email · default' })).toBeDisabled();
  api.persist(true); api.outcome('failed');
  await row.getByRole('button', { name: search, exact: true }).click();
  await expect(row).toContainText('Lecture du site impossible');
  await expect(page.getByRole('alert')).toContainText('Lecture du site impossible');
  api.outcome('not_found');
  await row.getByRole('button', { name: search, exact: true }).click();
  await expect(row).toContainText('Aucun email public trouvé sur les pages consultées');
  await expect(row.getByRole('button', { name: 'Préparer le prompt email · default' })).toBeDisabled();
  await expect(row.getByRole('button', { name: search, exact: true })).toBeEnabled();
  expect(api.calls).toEqual(['found', 'found', 'found']);
});

test('batch explicitly visits at most 25 displayed eligible missing or invalid emails sequentially with mixed summary', async ({ page }) => {
  const api = await fixture(page, [{ id: 'not-found', name: 'Introuvable' }, { id: 'failed', name: 'Échec' }, { id: 'invalid', name: 'Email invalide', email: 'nope' }, ...Array.from({ length: 27 }, (_, i) => ({ id: `batch-${i}`, name: `Entreprise ${i}` }))]);
  expect(api.calls).toEqual([]);
  await page.getByRole('button', { name: batch, exact: true }).click();
  await expect(page.getByRole('button', { name: batch, exact: true })).toBeDisabled();
  await expect(page.locator('tbody').getByRole('button', { name: search, exact: true }).first()).toBeDisabled();
  await expect(page.locator('.contact-check-batch')).toContainText('23 trouvé(s) · 1 introuvable(s) · 1 échec(s)', { timeout: 25000 });
  expect(api.calls).toHaveLength(25); expect(new Set(api.calls).size).toBe(25); expect(api.maxActive()).toBe(1);
  for (const id of ['missing', 'refused', 'demo', 'archive', 'valid']) expect(api.calls).not.toContain(id);
  expect(api.calls).toContain('invalid'); expect(api.errors).toEqual([]);
});

test('batch follows displayed filters and stale persistence counts as failure', async ({ page }) => {
  const api = await fixture(page, [{ id: 'invalid', name: 'Email invalide', email: 'nope' }]);
  await page.getByRole('button', { name: 'Avec email', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  api.persist(false);
  await page.getByRole('button', { name: batch, exact: true }).click();
  await expect(page.locator('.contact-check-batch')).toContainText('0 trouvé(s) · 0 introuvable(s) · 1 échec(s)');
  expect(api.calls).toEqual(['invalid']);
});
