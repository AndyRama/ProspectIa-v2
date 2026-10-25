import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Server } from 'node:http';
import type { Prospect } from '../server/types';
const env = { ...process.env }, realFetch = globalThis.fetch;
let dir: string, base: string, cookie: string, server: Server, store: typeof import('../server/db');
let transport: (url: string, init?: RequestInit) => Promise<Response>;
const calls: string[] = [];
const page = (html: string) => new Response(html, { headers: { 'content-type': 'text/html' } });
const p: Prospect = { id: 'contact-fixture', name: 'Atelier', category: 'Artisan', city: 'Paris', address: '', lat: null, lng: null, website: 'https://93.184.216.34', email: '', phone: '123', rating: null, reviews: null, selected: true, status: 'En discussion', demo: false, webStatus: 'Non vérifié', fields: {}, socials: { instagram: 'manual' }, hours: '', photos: [], engine: 'website' };
const check = (body: unknown = {}, headers: Record<string,string> = { Cookie: cookie }, id = p.id) => realFetch(`${base}/api/prospects/${id}/contact-check`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
before(async () => {
  for (const key of Object.keys(process.env)) if (/TURSO|VERCEL|APIFY|SMTP|AI_API|APP_PASSWORD|PROSPECTIA_AGENT_TOKEN|DATA_ENCRYPTION|PROXY/i.test(key)) delete process.env[key];
  dir = await mkdtemp(path.join(process.env.TMPDIR || '/opt/data/cache/scratch', 'contact-check-'));
  process.env.DATA_DIR = dir; process.env.DOTENV_CONFIG_PATH = '/dev/null'; process.env.APP_PASSWORD = 'fixture-only-password'; process.env.VERCEL = '1';
  const app = (await import('../server/index')).default; delete process.env.VERCEL; store = await import('../server/db');
  server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r)); base = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
  globalThis.fetch = async (url, init) => { calls.push(String(url)); return transport(String(url), init); };
  const login = await realFetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: process.env.APP_PASSWORD }) });
  assert.equal(login.status, 200); cookie = login.headers.get('set-cookie')!.split(';')[0];
});
after(async () => { globalThis.fetch = realFetch; if (server) await new Promise<void>(r => server.close(() => r())); if (store) await store.db.close(); if (dir) await rm(dir, { recursive: true, force: true }); for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]; Object.assign(process.env, env); });

test('explicit two-page contact check persists evidence only, preserves manual values, survives reopen', async () => {
  for (const email of ['', 'invalid', 'manual@atelier.fr']) {
    const current = { ...p, email }; await store.saveProspect(current); calls.length = 0;
    transport = async url => page(url.endsWith('/contact') ? '<footer>contact&#64;atelier.fr</footer>' : '<a href="/contact">Contact</a>');
    const response = await check(); assert.equal(response.status, 200); const saved = await response.json();
    assert.equal(saved.email, email === 'manual@atelier.fr' ? email : 'contact@atelier.fr');
    assert.equal(saved.contactCheck.status, 'found'); assert.equal(saved.contactCheck.emails[0].url, 'https://93.184.216.34/contact');
    assert.match(saved.contactCheck.emails[0].qualification, /publique.*non vérifiée/);
    assert.ok(Number.isFinite(Date.parse(saved.contactCheck.checkedAt))); assert.equal(saved.audit, undefined); assert.equal(saved.webStatus, p.webStatus);
    assert.equal(saved.phone, p.phone); assert.deepEqual(saved.socials, p.socials); assert.equal(calls.length, 2);
    if (email !== 'manual@atelier.fr') assert.equal(saved.fields.email.value, saved.email);
    else assert.deepEqual(saved.fields, current.fields);
    await store.db.close(); assert.deepEqual(await store.prospect(p.id), saved);
  }
});

test('unsupported whole email tokens never become found evidence or persisted addresses', async () => {
  for (const token of ['équipe@atelier.fr', 'contact@atelier.fré', 'contact@atelier.fr-invalide']) {
    for (const html of [`<footer>${token}</footer>`, `<a href="mailto:${encodeURIComponent(token)}">${token}</a>`]) {
      for (const email of ['', 'invalid']) {
        const current = { ...p, email };
        await store.saveProspect(current); calls.length = 0;
        transport = async () => page(html);
        const response = await check(); assert.equal(response.status, 200);
        const saved = await response.json();
        assert.equal(saved.contactCheck.status, 'not_found', html);
        assert.deepEqual(saved.contactCheck.emails, []);
        assert.equal(saved.email, email); assert.deepEqual(saved.fields, current.fields);
        assert.equal(calls.length, 1);
        await store.db.close(); assert.deepEqual(await store.prospect(p.id), saved);
      }
    }
  }
});

test('strict guards and no-site never fetch; suppression prevents recollection', async () => {
  calls.length = 0;
  for (const change of [{ website: '' }, { website: '  ' }, { demo: true }, { archived: true }, { doNotContact: true }]) {
    await store.saveProspect({ ...p, ...change }); assert.equal((await check()).status, 'website' in change ? 422 : 403);
  }
  await store.saveProspect(p); assert.equal((await check({}, {})).status, 401); assert.equal((await check({}, {Cookie:cookie,Origin:'https://evil.invalid'})).status,403);
  assert.equal((await check({force:true})).status,400); assert.equal((await check({}, {Cookie:cookie}, 'bad.id')).status,400); assert.equal((await check({}, {Cookie:cookie}, 'missing')).status,404);
  await store.saveProspect({...p,email:'blocked@atelier.fr'}); await store.db.execute("INSERT INTO suppressions VALUES('blocked@atelier.fr','now')"); assert.equal((await check()).status,403);
  assert.deepEqual(calls,[]); await store.db.execute('DELETE FROM suppressions');
});

test('four-page bound, same-origin contact/about/legal only and unique evidence', async () => {
  await store.saveProspect(p); calls.length=0;
  transport=async () => page('<footer>public@atelier.fr public@atelier.fr</footer><a href="/contact">Contact</a><a href="/about">About</a><a href="/legal">Legal</a><a href="/mentions-legales">Mentions</a><a href="/products">Products</a><a href="https://1.1.1.1/contact">External</a><a href="/contact.pdf">Contact PDF</a>');
  const response=await check(); assert.equal(response.status,200); const saved=await response.json(); assert.equal(calls.length,4); assert.equal(saved.contactCheck.emails.length,1); assert.equal(saved.contactCheck.pages.length,4); assert.ok(calls.every(u=>u.startsWith('https://93.184.216.34/')));
});

test('not_found is distinct from failed; no invented audit or contact on errors', async () => {
  await store.saveProspect(p); transport=async()=>page('<footer>Pas de contact</footer>');
  let response=await check(); assert.equal(response.status,200); assert.equal((await response.json()).contactCheck.status,'not_found');
  for (const fail of [async()=>new Response('',{status:503}),async()=>{throw Error('secret failure');}]) {
    await store.saveProspect(p); transport=fail; response=await check(); assert.equal(response.status,502); const body=await response.json(); assert.equal(body.prospect.contactCheck.status,'failed'); assert.equal(body.prospect.email,''); assert.equal(body.prospect.audit,undefined); assert.doesNotMatch(JSON.stringify(body),/secret/);
  }
});

test('CAS blocks archive/email edit/opposition/deletion and atomic late suppression', async () => {
  for (const change of [{archived:true},{email:'manual@atelier.fr'},{doNotContact:true},null]) {
    await store.saveProspect(p); const concurrent=change?{...p,...change}:null;
    transport=async()=>{if(concurrent)await store.saveProspect(concurrent);else await store.db.execute({sql:'DELETE FROM prospects WHERE id=?',args:[p.id]});return page('<footer>public@atelier.fr</footer>');};
    assert.equal((await check()).status,409); assert.deepEqual((await store.prospect(p.id))||null,concurrent);
  }
  await store.saveProspect(p); transport=async()=>page('<footer>public@atelier.fr</footer>');
  const execute=store.db.execute;let intercepted=false;
  store.db.execute=async statement=>{if(!intercepted&&typeof statement!=='string'&&statement.sql.startsWith('UPDATE prospects SET data=')){intercepted=true;await execute("INSERT INTO suppressions VALUES('public@atelier.fr','now')");}return execute(statement);};
  try {assert.equal((await check()).status,403);assert.ok(intercepted);assert.deepEqual(await store.prospect(p.id),p);}finally{store.db.execute=execute;await execute('DELETE FROM suppressions');}
});

test('15-second total signal cancels body on second page without declaring not_found',async()=>{
  await store.saveProspect(p);calls.length=0;let canceled=false;const budgets:number[]=[];const timeout=AbortSignal.timeout;
  const clock=mock.method(AbortSignal,'timeout',(ms:number)=>{budgets.push(ms);return timeout(ms===15000?25:ms);});
  transport=async url=>url.endsWith('/contact')?new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('<html>'));},cancel(){canceled=true;}}),{headers:{'content-type':'text/html'}}):page('<a href="/contact">Contact</a>');
  try {const response=await check();assert.equal(response.status,502);assert.equal((await response.json()).prospect.contactCheck.status,'failed');assert.ok(canceled);assert.deepEqual(budgets,[15000]);assert.equal(calls.length,2);}finally{clock.mock.restore();}
});

test('suppressed discovered addresses cannot be retained even in evidence, including after crawl', async () => {
  for (const during of [false, true]) {
    await store.saveProspect(p);
    if (!during) await store.db.execute("INSERT INTO suppressions VALUES('blocked@atelier.fr','now')");
    transport = async () => { if(during) await store.db.execute("INSERT INTO suppressions VALUES('blocked@atelier.fr','now')"); return page('<footer>blocked@atelier.fr</footer>'); };
    assert.equal((await check()).status,403); assert.deepEqual(await store.prospect(p.id),p);
    await store.db.execute('DELETE FROM suppressions');
  }
});

test('valid user provenance in fields.email is never overwritten and existing audit is untouched',async()=>{
  const current={...p,fields:{email:{value:'user@atelier.fr',source:'Saisie utilisateur',collectedAt:'2026-01-01T00:00:00Z'}}};
  await store.saveProspect(current);transport=async()=>page('<footer>published@atelier.fr</footer>');
  const preliminary = await realFetch(`${base}/api/prospects/${p.id}/site-check`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: '{}' });
  assert.equal(preliminary.status,200); const before = await preliminary.json();
  const response=await check();assert.equal(response.status,200);const saved=await response.json();assert.equal(saved.email,'');assert.deepEqual(saved.fields,current.fields);assert.deepEqual(saved.audit,before.audit);assert.deepEqual(saved.siteCheck,before.siteCheck);assert.equal(saved.webStatus,before.webStatus);assert.equal(saved.contactCheck.emails[0].value,'published@atelier.fr');
});

test('failed contact page is not reported as absence; external redirect evidence is discarded',async()=>{
  await store.saveProspect(p);calls.length=0;
  transport=async url=>url==='https://93.184.216.34/'?page('<a href="/contact">Contact</a>'):url.endsWith('/contact')?new Response(null,{status:302,headers:{location:'https://1.1.1.1/other'}}):page('<footer>external@atelier.fr</footer>');
  const response=await check();assert.equal(response.status,502);const saved=(await response.json()).prospect;assert.equal(saved.contactCheck.status,'failed');assert.deepEqual(saved.contactCheck.emails,[]);assert.deepEqual(saved.contactCheck.pages,['https://93.184.216.34/']);assert.equal(saved.email,'');
});

test('SSRF protects originals and every redirect',async()=>{
  for(const website of ['http://127.0.0.1','192.168.1.1','file:///etc/passwd','https://u:p@93.184.216.34']){await store.saveProspect({...p,website});calls.length=0;assert.equal((await check()).status,502);assert.equal(calls.length,0);}
  await store.saveProspect(p);calls.length=0;transport=async()=>new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}});assert.equal((await check()).status,502);assert.equal(calls.length,1);
});
