import { test } from 'node:test';
import assert from 'node:assert/strict';

test('Google Business uses proven field URL or exact place/CID, never internal IDs or unsafe URLs', async () => {
  const module = await import('../client/src/googleBusinessUrl').catch(() => ({})) as any;
  assert.equal(typeof module.safeGoogleBusinessUrl, 'function', 'pure frontend Google Business helper exists');
  const link = (values: Record<string, string>, id = 'apify-123') => module.safeGoogleBusinessUrl({ id, name: 'Atelier fictif', fields: Object.fromEntries(Object.entries(values).map(([k, value]) => [k, { value }])) });
  const placeId = 'ChIJ' + 'a'.repeat(23);
  for (const url of ['https://www.google.com/maps/place/Atelier', 'http://www.google.fr/maps?cid=123', 'https://maps.google.com/maps?cid=123']) assert.equal(link({ googleMaps: url }), url);
  assert.equal(link({ placeId }), `https://www.google.com/maps/search/?api=1&query=Atelier%20fictif&query_place_id=${placeId}`);
  assert.equal(link({ cid: '18446744073709551615' }), 'https://www.google.com/maps?cid=18446744073709551615');
  for (const googleMaps of ['javascript:alert(1)', 'data:text/html,x', 'https://google.com.evil.test/maps/place/x', 'https://evil@google.com/maps/place/x', 'https://google.com@evil.test/maps/place/x', 'https://google.com/search?q=atelier', 'https://google.com/maps', 'https://google.com/maps/search/?query=atelier', 'https://google.com/business/', 'https://evil.test/maps']) assert.equal(link({ googleMaps }), undefined, googleMaps);
  for (const values of [{}, { placeId: ' ' + placeId }, { placeId: 'invalid' }, { cid: '12oops' }, { cid: ' 123' }] as Record<string, string>[]) assert.equal(link(values), undefined);
  assert.equal(link({}, 'apify-' + placeId), undefined);
  assert.equal(link({ googleMaps: 'https://evil.test', placeId }), `https://www.google.com/maps/search/?api=1&query=Atelier%20fictif&query_place_id=${placeId}`);
});
