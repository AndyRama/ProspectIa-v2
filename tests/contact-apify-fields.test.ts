import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import type { Prospect } from '../server/types';

const dir = await mkdtemp('/opt/data/cache/scratch/contact-apify-fields-');
Object.assign(process.env, { DATA_DIR: dir, TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '', VERCEL: '', DOTENV_CONFIG_PATH: '/dev/null' });
const { db, setSetting, list } = await import('../server/db');
const { collectApify, startApify } = await import('../server/services/apify');
const { persistResults, resolveSearch } = await import('../server/searches');
after(async () => { await db.close(); await rm(dir, { recursive: true, force: true }); });

const placeId = 'ChIJ' + 'a'.repeat(23);
const cid = '009007199254740993';
const featureId = '0xabc:0x123';
const maps = 'https://www.google.com/maps?cid=' + cid;
const hours = [{ day: 'Monday', hours: '09:00–17:00' }];

async function collect(rows: Record<string, unknown>[], discovery: boolean, runId: string) {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(init?.method ?? 'GET', 'GET', 'no paid launch or website crawling');
    const u = String(url); calls.push(u);
    assert.match(u, /^https:\/\/api\.apify\.com\/v2\/(actor-runs|datasets)\//);
    return Response.json(u.includes('/datasets/') ? rows : { data: {
      id: runId, actId: discovery ? 'uU8ybh0dgvI68Q3o2' : 'nwua9Gu5YrADL7ZDj',
      status: 'SUCCEEDED', finishedAt: '2026-01-01T00:00:00Z', defaultDatasetId: 'fixture', usageTotalUsd: 0,
    } });
  };
  try {
    await setSetting('apifyPending', {
      ...(discovery ? { mode: 'discovery', actorSlug: 'benthepythondev~google-maps-business-scraper', actorId: 'uU8ybh0dgvI68Q3o2' } : {}),
      runId, city: 'Search area, not establishment city', activity: 'Search activity', engine: 'website', max: 25,
    });
    const result = await collectApify('fixture-only');
    assert.equal(calls.length, 2);
    assert.ok(result.items);
    return result;
  } finally { globalThis.fetch = original; }
}

// Field names/shapes follow the anonymous default-build READMEs, not a live paid run.
for (const discovery of [true, false]) {
  test(`${discovery ? 'discovery' : 'compass'} essential fields survive collection, persistence and database reopen`, async () => {
    await db.execute('DELETE FROM prospects'); await db.execute('DELETE FROM searches');
    const common = { city: 'Lyon', address: '01 rue Atelier', website: 'https://atelier.fr/', cid,
      url: maps, phone: '', emails: ['Contact@atelier.fr', 'second@atelier.fr'],
      instagrams: ['https://www.instagram.com/atelier/'], facebooks: ['https://www.facebook.com/atelier/'],
      linkedIns: ['https://www.linkedin.com/company/atelier/'], youtubes: ['https://www.youtube.com/@atelier'],
      tiktoks: ['https://www.tiktok.com/@atelier'], twitters: ['https://twitter.com/atelier'],
      pinterests: ['https://www.pinterest.com/atelier/'],
    };
    const row = discovery ? { ...common, name: 'Atelier', category: 'Artisan', place_id: placeId,
      feature_id: featureId, phone_international: '+33 01 02 03 04 05', latitude: 0, longitude: 2.3,
      rating: 0, review_count: 0, opening_hours: hours,
    } : { ...common, title: 'Atelier', categoryName: 'Artisan', placeId, fid: featureId,
      phoneUnformatted: '+33 01 02 03 04 05', location: { lat: 0, lng: 2.3 },
      totalScore: 0, reviewsCount: 0, openingHours: hours,
    };
    const result = await collect([row], discovery, `fields-${discovery}`);
    const p = result.items![0];
    assert.equal(p.phone, '+33 01 02 03 04 05', 'documented alternate phone must not be dropped');
    assert.deepEqual([p.name, p.category, p.city, p.address, p.website, p.email, p.lat, p.lng, p.rating, p.reviews, p.hours],
      ['Atelier', 'Artisan', 'Lyon', '01 rue Atelier', 'https://atelier.fr/', 'contact@atelier.fr', 0, 2.3, 0, 0, JSON.stringify(hours)]);
    const expectedFields = { name: 'Atelier', category: 'Artisan', city: 'Lyon', address: '01 rue Atelier',
      phone: '+33 01 02 03 04 05', phoneInternational: '+33 01 02 03 04 05', website: 'https://atelier.fr/',
      email: 'contact@atelier.fr', email_2: 'second@atelier.fr', placeId, cid, featureId, googleMaps: maps,
      latitude: '0', longitude: '2.3', rating: '0', reviews: '0', hours: JSON.stringify(hours),
      instagram: common.instagrams[0], facebook: common.facebooks[0], linkedin: common.linkedIns[0],
      youtube: common.youtubes[0], tiktok: common.tiktoks[0], twitter: common.twitters[0], pinterest: common.pinterests[0],
    };
    for (const [key, value] of Object.entries(expectedFields)) {
      assert.equal(p.fields[key]?.value, value, key);
      assert.equal(p.fields[key].source, 'Apify · Google Maps', key);
      assert.equal(p.fields[key].url, maps, key);
      assert.ok(Number.isFinite(Date.parse(p.fields[key].collectedAt)), key);
    }
    assert.deepEqual(p.socials, { instagram: common.instagrams[0], facebook: common.facebooks[0], linkedin: common.linkedIns[0],
      youtube: common.youtubes[0], tiktok: common.tiktoks[0], twitter: common.twitters[0], pinterest: common.pinterests[0] });
    const saved = await persistResults(result.items!, result.args, 'Apify', result.cost!);
    await db.close();
    const stored = await list<Prospect>('prospects');
    assert.equal(stored.length, 1); assert.deepEqual(stored[0], p);
    assert.deepEqual((await resolveSearch(saved.search)).prospects, [p]);
  });
}

for (const discovery of [true, false]) {
  test(`${discovery ? 'discovery' : 'compass'} absent essentials remain explicit empty/null after database reopen`, async () => {
    await db.execute('DELETE FROM prospects'); await db.execute('DELETE FROM searches');
    const result = await collect([discovery ? { name: 'Only name' } : { title: 'Only name' }], discovery, `absent-${discovery}`);
    const p = result.items![0];
    for (const key of ['category', 'city', 'address', 'phone', 'website', 'email', 'hours'] as const) assert.equal(p[key], '', key);
    for (const key of ['lat', 'lng', 'rating', 'reviews'] as const) assert.equal(p[key], null, key);
    assert.deepEqual(Object.keys(p.fields), ['name']); assert.deepEqual(p.socials, {});
    const saved = await persistResults(result.items!, result.args, 'Apify', 0);
    const serialized = JSON.parse(JSON.stringify(p));
    await db.close(); assert.deepEqual(await list<Prospect>('prospects'), [serialized]);
    assert.deepEqual((await resolveSearch(saved.search)).prospects, [serialized]);
  });
}

test('documented strings retain leading zeros; malformed values and undocumented website aliases are not fabricated', async () => {
  const result = await collect([{
    title: 'String fields', city: 'Lyon', phone: '00123456789', phoneUnformatted: '+33123456789',
    website: '', websiteUrl: 'https://not-a-documented-alias.fr', domain: 'not-a-website.fr',
    address: { street: 'not a string' }, categories: ['Artisan'],
    location: { lat: '48', lng: Infinity }, totalScore: '4.5', reviewsCount: '12',
    instagrams: 'https://www.instagram.com/not-an-array', facebooks: [null, { url: 'https://facebook.com/not-a-string' }],
    linkedIns: [null, 'https://www.linkedin.com/company/atelier/'], openingHours: null,
  }], false, 'malformed-fields');
  const p = result.items![0];
  assert.equal(p.phone, '00123456789'); assert.equal(p.fields.phone.value, '00123456789');
  assert.equal(p.fields.phoneInternational.value, '+33123456789');
  assert.equal(p.website, ''); assert.equal(p.fields.website, undefined);
  assert.equal(p.address, ''); assert.equal(p.fields.address, undefined);
  assert.equal(p.category, 'Artisan'); assert.equal(p.fields.category.value, 'Artisan');
  for (const key of ['lat', 'lng', 'rating', 'reviews'] as const) assert.equal(p[key], null, key);
  for (const key of ['latitude', 'longitude', 'rating', 'reviews', 'instagram', 'facebook', 'hours']) assert.equal(p.fields[key], undefined, key);
  assert.deepEqual(p.socials, { linkedin: 'https://www.linkedin.com/company/atelier/' });
});

test('targeted Maps input disables the documented paid contacts add-on; free site extraction stays separate', async () => {
  await setSetting('apifyPending', null);
  const original = globalThis.fetch;
  let input: Record<string, unknown> | undefined;
  globalThis.fetch = async (url, init) => {
    const u = String(url); assert.match(u, /^https:\/\/api\.apify\.com\/v2\//);
    if (init?.method === 'POST') {
      assert.match(u, /\/runs\?/); input = JSON.parse(String(init.body));
      return Response.json({ data: { id: 'fixture-no-paid-enrichment' } });
    }
    if (u.endsWith('/builds/default')) return Response.json({ data: { buildNumber: 'fixture', inputSchema: { properties: {
      placeIds: {}, maxCrawledPlacesPerSearch: {}, scrapeContacts: {}, scrapeSocialMediaProfiles: {},
      maximumLeadsEnrichmentRecords: {},
    } } } });
    assert.match(u, /\/acts\/compass~crawler-google-places$/);
    return Response.json({ data: { pricingInfos: [{ pricingModel: 'PAY_PER_EVENT' }] } });
  };
  try {
    await startApify('fixture-only', { city: 'Lyon', activity: 'Artisan', keyword: '', engine: 'website', max: 1,
      budget: 1, placeIds: ['ChIJ' + 'z'.repeat(23)] });
    assert.ok(input); assert.equal(input.scrapeContacts, false);
    assert.equal(input.maximumLeadsEnrichmentRecords, 0);
    assert.deepEqual(input.scrapeSocialMediaProfiles, { instagrams: false, facebooks: false, youtubes: false, tiktoks: false, twitters: false });
    assert.equal(input.scrapeEmails, undefined);
  } finally { globalThis.fetch = original; }
});

test('Compass identities reject unsafe numeric CIDs instead of stringifying rounded values', async () => {
  await assert.rejects(() => collect([{ title: 'Unsafe CID', cid: 9007199254740992 }], false, 'unsafe-cid'), /Identité Google Apify invalide/);
  await assert.rejects(() => collect([{ title: 'Unsafe feature', fid: { id: '0xabc:0x123' } }], false, 'unsafe-fid'), /Identité Google Apify invalide/);
});
