import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Prospect, Search } from '../server/types';

// Plausible mock values, using exactly the official discovery README OUTPUT keys.
// Not an actual business, paid dataset, or claim that the Actor returns emails.
const officialRow = {
  name: 'Atelier contrat fixture', rating: 4.7, review_count: 42,
  address: '12 rue du Contrat, 33000 Bordeaux, France', phone: '05 56 00 00 00',
  phone_international: '+33 5 56 00 00 00', website: 'https://atelier-fixture.fr',
  categories: ['Menuisier', 'Ébéniste'], place_id: 'ChIJ' + 'a'.repeat(23),
  cid: '18446744073709551615', feature_id: '0xabc:0xdef', category: 'Menuisier',
  description: 'Atelier de menuiserie (fixture)', latitude: 44.84, longitude: -0.58,
  street: '12 rue du Contrat', city: 'Bordeaux', state: 'Nouvelle-Aquitaine',
  postal_code: '33000', country_code: 'FR', opening_hours: ['Lundi: 09:00–18:00'],
  url: 'https://www.google.com/maps?cid=18446744073709551615',
  scraped_at: '2026-01-01T10:01:00Z',
};

test('official discovery output preserves essential fields through collection, persistence and reopen without invented contacts', async () => {
  const env = { ...process.env };
  process.env.DOTENV_CONFIG_PATH = '/dev/null';
  process.env.TURSO_DATABASE_URL = '';
  process.env.TURSO_AUTH_TOKEN = '';
  delete process.env.VERCEL;
  const dir = await mkdtemp(path.join('/opt/data/cache/scratch', 'apify-fields-'));
  process.env.DATA_DIR = dir;
  const { db, setSetting, list, saveProspect } = await import('../server/db');
  const { collectApify } = await import('../server/services/apify');
  const { persistResults, resolveSearch } = await import('../server/searches');
  const original = globalThis.fetch;
  const calls: string[] = [];
  const absentRow = {
    ...officialRow, name: 'Sans contacts fixture', place_id: 'ChIJ' + 'b'.repeat(23),
    cid: '18446744073709551614', feature_id: '0xabc:0xdee',
    url: 'https://www.google.com/maps?cid=18446744073709551614',
    website: '', phone: '05 56 00 00 01', phone_international: '',
  };
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    assert.equal(init?.method ?? 'GET', 'GET', 'no launch, crawl or paid call');
    calls.push(target);
    if (target === 'https://api.apify.com/v2/actor-runs/fixture-fields-run') {
      return Response.json({ data: {
        id: 'fixture-fields-run', actId: 'uU8ybh0dgvI68Q3o2', status: 'SUCCEEDED',
        finishedAt: '2026-01-01T10:01:00Z', defaultDatasetId: 'fixture-fields-data', usageTotalUsd: 0,
      } });
    }
    assert.equal(target, 'https://api.apify.com/v2/datasets/fixture-fields-data/items?clean=true&limit=20001');
    return Response.json([officialRow, officialRow, absentRow]);
  };
  try {
    const args = { city: 'Bordeaux', activity: 'Menuisier', engine: 'website' as const, runId: 'fixture-fields-run' };
    await setSetting('apifyPending', {
      ...args, mode: 'discovery', actorSlug: 'benthepythondev~google-maps-business-scraper',
      actorId: 'uU8ybh0dgvI68Q3o2', max: 25, exclusionSnapshot: { ids: [], urls: [] },
    });
    const collected = await collectApify('fixture-token-not-a-secret');
    assert.equal(collected.items?.length, 2, 'duplicate identity remains deduplicated');
    const items = collected.items!;
    const check = (prospects: Prospect[]) => {
      const item = prospects.find(p => p.id === `apify-${officialRow.place_id}`)!;
      assert.ok(item);
      assert.equal(item.name, officialRow.name);
      assert.equal(item.address, officialRow.address);
      assert.equal(item.city, officialRow.city);
      assert.equal(item.website, officialRow.website);
      assert.equal(item.phone, officialRow.phone_international, 'prefer supplied international number');
      assert.equal(item.category, officialRow.category);
      assert.equal(item.rating, officialRow.rating);
      assert.equal(item.reviews, officialRow.review_count);
      assert.equal(item.lat, officialRow.latitude);
      assert.equal(item.lng, officialRow.longitude);
      assert.equal(item.hours, JSON.stringify(officialRow.opening_hours));
      const expected = {
        name: officialRow.name, address: officialRow.address, city: officialRow.city,
        website: officialRow.website, phone: officialRow.phone_international,
        phoneInternational: officialRow.phone_international, category: officialRow.category,
        rating: '4.7', reviews: '42', latitude: '44.84', longitude: '-0.58',
        hours: JSON.stringify(officialRow.opening_hours), placeId: officialRow.place_id,
        cid: officialRow.cid, featureId: officialRow.feature_id, googleMaps: officialRow.url,
        street: officialRow.street, state: officialRow.state, postalCode: officialRow.postal_code,
        countryCode: officialRow.country_code, description: officialRow.description,
        categories: JSON.stringify(officialRow.categories), scrapedAt: officialRow.scraped_at,
      };
      for (const [key, value] of Object.entries(expected)) {
        assert.equal(item.fields[key]?.value, value, `field ${key}`);
        assert.equal(item.fields[key].source, 'Apify · Google Maps', `source ${key}`);
        assert.equal(item.fields[key].url, officialRow.url, `provenance URL ${key}`);
        assert.ok(Number.isFinite(Date.parse(item.fields[key].collectedAt)));
      }
      assert.equal(item.email, '', 'official output does not contain emails');
      assert.equal(item.fields.email, undefined);
      const absent = prospects.find(p => p.id === `apify-${absentRow.place_id}`)!;
      assert.equal(absent.website, '');
      assert.equal(absent.email, '');
      assert.equal(absent.fields.website, undefined);
      assert.equal(absent.fields.email, undefined);
      assert.equal(absent.fields.phoneInternational, undefined);
      assert.equal(absent.phone, absentRow.phone, 'keep local format without inventing conversion');
      assert.equal(absent.webStatus, 'Pas de site renseigné');
    };
    check(items);
    const saved = await persistResults(items, args, 'Apify', collected.cost!, [], { kind: 'discovery' });
    check(saved.prospects);
    await db.close();
    const searches = await list<Search>('searches');
    assert.equal(searches.length, 1);
    const reopened = await resolveSearch(searches[0]);
    check(reopened.prospects);
    const cached = await persistResults(items, args, 'Apify', 0, [], { kind: 'discovery' });
    assert.equal(cached.cached, true);
    assert.deepEqual(cached.search.ids, saved.search.ids);
    assert.equal((await list<Prospect>('prospects')).length, 2);

    // A later website observation stays website-sourced; Maps is never asserted
    // to be the origin of an email discovered by a separate public-site pass.
    const siteEmail = { value: 'contact@atelier-fixture.fr', source: 'Site web public',
      url: officialRow.website + '/contact', collectedAt: '2026-01-01T11:00:00Z' };
    const enriched = { ...reopened.prospects.find(p => p.id === items[0].id)!, email: siteEmail.value };
    enriched.fields = { ...enriched.fields, email: siteEmail };
    await saveProspect(enriched);
    await db.close();
    const withWebsiteEmail = (await resolveSearch(searches[0])).prospects.find(p => p.id === enriched.id)!;
    assert.deepEqual(withWebsiteEmail.fields.email, siteEmail);
    assert.equal(withWebsiteEmail.fields.name.source, 'Apify · Google Maps');
    assert.equal(calls.length, 2, 'only mocked run/dataset GET reads');
  } finally {
    globalThis.fetch = original;
    await db.close();
    await rm(dir, { recursive: true, force: true });
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
  }
});
