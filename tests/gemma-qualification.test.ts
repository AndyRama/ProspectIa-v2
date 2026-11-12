import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Server } from 'node:http';
import type { Prospect } from '../server/types';
const env = { ...process.env }, realFetch = globalThis.fetch;
let dir: string, base: string, cookie: string, server: Server, store: typeof import('../server/db');
let transport: (url: string, init?: RequestInit) => Promise<Response> = async () => { throw Error("Unexpected provider traffic"); };
const calls: {
    url: string;
    init?: RequestInit;
}[] = [];
const model = 'google/gemma-4-26b-a4b-it:free';
const p: Prospect = { id: 'gemma-fixture', name: 'Atelier', category: 'Artisan', city: 'Paris', address: 'Rue publique', lat: null, lng: null, website: 'https://atelier.example/path?secret=private', email: 'private@atelier.example', phone: 'secret-phone', rating: null, reviews: null, selected: true, status: 'En discussion', demo: false, webStatus: 'Non vérifié', fields: {}, socials: {}, hours: '', photos: [], engine: 'website' };
async function request(route: string, body?: unknown, headers: Record<string, string> = { Cookie: cookie }) { return realFetch(base + '/api/' + route, { method: body === undefined ? 'GET' : route === 'settings' ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
const criteria = 'Identifier les besoins de création de sites web publics.';
async function preview(ids = [p.id]) { const r = await request('qualification/preview', { ids, criteria }); assert.equal(r.status, 200, await r.clone().text()); return r.json(); }
before(async () => { for (const k of Object.keys(process.env))
    if (/TURSO|VERCEL|APIFY|OPENROUTER|SMTP|APP_PASSWORD|DATA_ENCRYPTION|PROSPECTIA_AGENT|PROXY/i.test(k))
        delete process.env[k]; dir = await mkdtemp(path.join(process.env.TMPDIR || '/opt/data/cache/scratch', 'gemma-')); process.env.DATA_DIR = dir; process.env.DOTENV_CONFIG_PATH = '/dev/null'; process.env.APP_PASSWORD = 'synthetic-password-only'; process.env.VERCEL = '1'; const app = (await import('../server/index')).default; delete process.env.VERCEL; store = await import('../server/db'); server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r)); base = `http://127.0.0.1:${(server.address() as {
    port: number;
}).port}`; globalThis.fetch = async (u, i) => { calls.push({ url: String(u), init: i }); return transport(String(u), i); }; const login = await request('auth/login', { password: process.env.APP_PASSWORD }, {}); cookie = login.headers.get('set-cookie')!.split(';')[0]; await store.setSetting('business', { ...store.defaultBusiness, name: 'Agence Atelier', services: 'Création de sites web', zone: 'Paris' }); await store.setSetting('onboarded', true); await store.saveProspect(p); });
after(async () => { globalThis.fetch = realFetch; if (server)
    await new Promise<void>(r => server.close(() => r())); if (store)
    await store.db.close(); if (dir)
    await rm(dir, { recursive: true, force: true }); for (const k of Object.keys(process.env))
    if (!(k in env))
        delete process.env[k]; Object.assign(process.env, env); });
test('local durable preview excludes aliases and contact-policy records without any provider traffic', async () => { calls.length = 0; await store.saveProspect({ ...p, id: 'alias', duplicateOf: p.id }); await store.saveProspect({ ...p, id: 'archived', name: 'Autre commerce', website: 'https://different.example', address: 'Autre rue', email: 'other@example.test', phone: 'different', archived: true }); const plan = await preview([p.id, 'alias', 'archived', 'unknown']); assert.equal(plan.status, 'prepared'); assert.equal(plan.model, model); assert.deepEqual(plan.leads.map((l: any) => l.id), [p.id]); assert.equal(plan.excluded.length, 3); assert.deepEqual(plan.thresholds, { qualified: 60, review: 40 }); assert.deepEqual(calls, []); await store.db.close(); const recovered = await request('qualification/' + plan.id); assert.equal(recovered.status, 200); assert.deepEqual((await recovered.json()).preview, plan); assert.deepEqual(await store.prospect(p.id), p); });
test('OpenRouter key is encrypted, separately mapped and presence-only through settings/export', async () => { const secrets = await import('../server/secrets'); process.env.APIFY_TOKEN = 'apify-not-openrouter'; const config = await (await request('state')).json(); assert.equal(config.settings.openrouterConfigured, false); const body = { business: { ...store.defaultBusiness, name: 'Agence Atelier', services: 'Création de sites web', zone: 'Paris' }, limits: { max: 10, budget: 1 }, openrouterKey: 'synthetic-openrouter-secret' }; let r = await request('settings', body); assert.equal(r.status, 200); assert.equal((await r.json()).openrouterConfigured, true); assert.equal(await secrets.secret('openrouterKey' as any), 'synthetic-openrouter-secret'); const stored = await store.getSetting('openrouterKey', null); assert.doesNotMatch(JSON.stringify(stored), /synthetic-openrouter-secret/); assert.doesNotMatch(await (await request('export')).text(), /synthetic-openrouter-secret|"openrouterKey"/); r = await request('settings', { ...body, openrouterKey: '' }); assert.equal((await r.json()).openrouterConfigured, true); process.env.OPENROUTER_API_KEY = 'dedicated-env'; assert.equal(await secrets.secret('openrouterKey' as any), 'dedicated-env'); delete process.env.OPENROUTER_API_KEY; delete process.env.APIFY_TOKEN; });
function catalog(price: unknown = '0') { if (arguments.length && arguments[0] === undefined)
    price = undefined; return new Response(JSON.stringify({ data: [{ id: model, pricing: { prompt: price, completion: price } }] })); }
function completion(results: unknown = [{ id: p.id, score: 72, reason: 'Service pertinent selon les informations publiques.', missingData: ['Budget inconnu'] }], extra: object = {}) { return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ results }) } }], ...extra })); }
async function run(id: string, body: unknown = { confirmed: true }) { const r = await request('qualification/' + id + '/run', body); assert.equal(r.status, 200, await r.clone().text()); return r.json(); }
test('explicit confirmation uses fixed free OpenRouter wire exactly once, stores canonical receipt and reopens', async () => { calls.length = 0; await store.saveProspect(p); const plan = await preview(); transport = async (url) => url.endsWith('/models') ? catalog() : completion(); const receipt = await run(plan.id); assert.equal(receipt.status, 'completed'); assert.equal(receipt.updated, 1); assert.equal(calls.length, 2); assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/models'); assert.equal(calls[1].url, 'https://openrouter.ai/api/v1/chat/completions'); const wire = JSON.parse(String(calls[1].init?.body)); assert.equal(wire.model, model); assert.deepEqual(wire.provider, { allow_fallbacks: false, require_parameters: true, max_price: { prompt: 0, completion: 0, request: 0 } }); assert.deepEqual(wire.response_format, { type: 'json_object' }); assert.equal(wire.stream, false); assert.equal(calls[1].init?.redirect, 'error'); assert.doesNotMatch(JSON.stringify(wire), /private@|secret-phone|private|hermesInstructions/); const current = await store.prospect(p.id); assert.equal(current?.aiQualification?.score, 72); assert.equal(current?.aiQualification?.decision, 'qualified'); const { aiQualification, aiQualificationHistory, ...rest } = current!; assert.deepEqual(rest, p); assert.deepEqual(await run(plan.id), receipt); await store.db.close(); assert.deepEqual(await (await request('qualification/' + plan.id)).json(), receipt); assert.deepEqual(await run(plan.id), receipt); assert.equal(calls.length, 2); });
test('catalog must confirm exact model with explicit finite zero prices before any completion POST', async () => { for (const price of ['0.001', '', null, undefined, 'NaN', -1]) {
    await store.saveProspect(p);
    calls.length = 0;
    const plan = await preview();
    transport = async (url) => url.endsWith('/models') ? catalog(price) : completion();
    const receipt = await run(plan.id);
    assert.equal(receipt.status, 'failed', String(price));
    assert.equal(calls.length, 1);
    assert.equal((await store.prospect(p.id))?.aiQualification, undefined);
    assert.deepEqual(await run(plan.id), receipt);
    assert.equal(calls.length, 1);
} for (const response of [new Response(JSON.stringify({ data: [{ id: model + '-wrong', pricing: { prompt: '0', completion: '0' } }] })), new Response('secret-provider-body', { status: 503 }), new Response('{invalid')]) {
    await store.saveProspect(p);
    calls.length = 0;
    const plan = await preview();
    transport = async () => response;
    const receipt = await run(plan.id);
    assert.equal(receipt.status, 'failed');
    assert.equal(calls.length, 1);
    assert.doesNotMatch(JSON.stringify(receipt), /secret-provider-body|synthetic-openrouter-secret/);
} });
test('strict complete ID scores, finish state, tools and usage cost fail closed without overwriting prior AI', async () => { const prior = { runId: 'old-run', model: model as any, score: 45, decision: 'review' as const, reason: 'Ancienne qualification', missingData: [], criteria, evaluatedAt: '2026-01-01', profileFingerprint: 'old' }; const valid = { id: p.id, score: 60, reason: 'Preuve publique', missingData: [] }; const invalid = [[], [valid, valid], [{ ...valid, id: 'foreign' }], [{ ...valid, score: 60.5 }], [{ ...valid, score: 101 }], [{ ...valid, score: '60' }], [{ ...valid, reason: '' }], [{ ...valid, reason: 'x'.repeat(501) }], [{ ...valid, missingData: ['x', 'x', 'x', 'x', 'x', 'x'] }], [{ ...valid, decision: 'qualified' }]]; for (const result of invalid) {
    await store.saveProspect({ ...p, aiQualification: prior });
    const plan = await preview();
    transport = async (url) => url.endsWith('/models') ? catalog() : completion(result);
    const receipt = await run(plan.id);
    assert.equal(receipt.status, 'failed', JSON.stringify(result));
    assert.deepEqual((await store.prospect(p.id))?.aiQualification, prior);
} for (const extra of [{ choices: [{ finish_reason: 'length', message: { content: JSON.stringify({ results: [valid] }) } }] }, { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ results: [valid] }), tool_calls: [{}] } }] }, { usage: { cost: 0.01 } }]) {
    await store.saveProspect({ ...p, aiQualification: prior });
    const plan = await preview();
    transport = async (url) => url.endsWith('/models') ? catalog() : completion([valid], extra);
    assert.equal((await run(plan.id)).status, 'failed');
    assert.deepEqual((await store.prospect(p.id))?.aiQualification, prior);
} });
test('unknown completion network outcomes lock uncertain; explicit provider failures never retry', async () => { for (const mode of ['lost', '429', '503', 'invalid-json']) {
    await store.saveProspect(p);
    calls.length = 0;
    const plan = await preview();
    transport = async (url) => { if (url.endsWith('/models'))
        return catalog(); if (mode === 'lost')
        throw Error('synthetic-openrouter-secret lost response'); if (mode === 'invalid-json')
        return new Response('{invalid'); return new Response('synthetic-openrouter-secret', { status: Number(mode) }); };
    const receipt = await run(plan.id);
    assert.equal(receipt.status, mode === 'lost' ? 'uncertain' : 'failed');
    assert.equal(calls.length, 2);
    assert.doesNotMatch(JSON.stringify(receipt), /synthetic-openrouter-secret/);
    await store.db.close();
    assert.deepEqual(await run(plan.id), receipt);
    assert.equal(calls.length, 2);
    assert.equal((await store.prospect(p.id))?.aiQualification, undefined);
} });
test('confirmation revalidates expiry, profile, eligibility and public snapshot before any provider I/O', async () => { for (const change of ['profile', 'archived', 'identity', 'expired', 'missing-key']) {
    await store.saveProspect(p);
    calls.length = 0;
    const plan = await preview();
    if (change === 'profile')
        await store.setSetting('business', { ...store.defaultBusiness, name: 'Agence Atelier', services: 'Autre prestation', zone: 'Paris' });
    if (change === 'archived')
        await store.saveProspect({ ...p, archived: true });
    if (change === 'identity')
        await store.saveProspect({ ...p, city: 'Lyon' });
    if (change === 'expired') {
        const row = (await store.db.execute({ sql: 'SELECT data FROM qualification_runs WHERE id=?', args: [plan.id] })).rows[0];
        const data = JSON.parse(String(row.data));
        data.run.preview.expiresAt = '2000-01-01T00:00:00Z';
        await store.db.execute({ sql: 'UPDATE qualification_runs SET data=? WHERE id=?', args: [JSON.stringify(data), plan.id] });
    }
    if (change === 'missing-key')
        await (await import('../server/secrets')).saveSecret('openrouterKey', '');
    transport = async (url) => url.endsWith('/models') ? catalog() : completion();
    const response = await request('qualification/' + plan.id + '/run', { confirmed: true });
    assert.equal(response.status, 422, change);
    assert.deepEqual(calls, [], change);
    await store.setSetting('business', { ...store.defaultBusiness, name: 'Agence Atelier', services: 'Création de sites web', zone: 'Paris' });
    await (await import('../server/secrets')).saveSecret('openrouterKey', 'synthetic-openrouter-secret');
} });
test('fresh transactional merge skips removed/ineligible/drifted records and preserves late CRM edits', async () => { for (const change of ['archive', 'dnc', 'suppressed', 'delete', 'identity', 'profile', 'late-crm', 'archive-restore']) {
    await store.saveProspect(p);
    const plan = await preview();
    let canonical: Prospect | undefined = p;
    transport = async (url) => { if (url.endsWith('/models'))
        return catalog(); if (change === 'delete') {
        await store.db.execute({ sql: 'DELETE FROM prospects WHERE id=?', args: [p.id] });
        canonical = undefined;
    }
    else if (change === 'profile') {
        await store.setSetting('business', { ...store.defaultBusiness, name: 'Changed Agency', services: 'Autres services', zone: 'Paris' });
    }
    else if (change === 'suppressed') {
        await store.db.execute({ sql: 'INSERT OR IGNORE INTO suppressions VALUES(?,?)', args: [p.email, 'now'] });
    }
    else {
        canonical = { ...p, ...(change === 'archive' ? { archived: true, selected: false } : change === 'dnc' ? { doNotContact: true } : change === 'identity' ? { city: 'Lyon' } : { status: 'Gagné', selected: false, archived: false, doNotContact: false }) } as Prospect;
        if (change === 'archive-restore')
            await store.saveProspect({ ...p, archived: true, selected: false });
        await store.saveProspect(canonical);
    } return completion(); };
    const receipt = await run(plan.id);
    if (change === 'profile') {
        assert.equal(receipt.status, 'failed');
        assert.deepEqual(await store.prospect(p.id), p);
    }
    else if (['late-crm', 'archive-restore'].includes(change)) {
        assert.equal(receipt.updated, 1);
        const saved = await store.prospect(p.id);
        const { aiQualification, aiQualificationHistory, ...rest } = saved!;
        assert.deepEqual(rest, canonical);
    }
    else {
        assert.equal(receipt.updated, 0, change);
        assert.equal(receipt.skipped, 1, change);
        assert.equal(receipt.results[0].status, 'skipped');
        assert.deepEqual(await store.prospect(p.id), canonical);
    }
    await store.db.execute('DELETE FROM suppressions');
    await store.setSetting('business', { ...store.defaultBusiness, name: 'Agence Atelier', services: 'Création de sites web', zone: 'Paris' });
} });
test('a newer qualification wins over an older in-flight run and prior history is retained', async () => { await store.saveProspect(p); const older = await preview(); let release!: () => void, entered!: () => void; const boundary = new Promise<void>(r => entered = r), hold = new Promise<void>(r => release = r); let post = 0; transport = async (url) => { if (url.endsWith('/models'))
    return catalog(); post++; if (post === 1) {
    entered();
    await hold;
    return completion([{ id: p.id, score: 20, reason: 'Ancienne évaluation', missingData: [] }]);
} return completion([{ id: p.id, score: 90, reason: 'Nouvelle évaluation', missingData: [] }]); }; const pending = run(older.id); await boundary; const newer = await preview(); const receipt = await run(newer.id); assert.equal(receipt.updated, 1); release(); const previous = await pending; assert.equal(previous.skipped, 1); assert.equal((await store.prospect(p.id))?.aiQualification?.runId, newer.id); transport = async (url) => url.endsWith('/models') ? catalog() : completion(); const third = await preview(); assert.equal((await run(third.id)).updated, 1); assert.equal((await store.prospect(p.id))?.aiQualificationHistory?.at(-1)?.runId, newer.id); });
test('provider response byte bounds and body timeouts cancel streams without secret leaks or retries', async () => { for (const mode of ['catalog-large', 'completion-large', 'completion-timeout']) {
    await store.saveProspect(p);
    const plan = await preview();
    let canceled = false;
    const timeout = AbortSignal.timeout;
    const { mock } = await import('node:test');
    const clock = mock.method(AbortSignal, 'timeout', (ms: number) => timeout(mode === 'completion-timeout' && ms === 40000 ? 25 : ms));
    transport = async (url) => { if (url.endsWith('/models') && mode !== 'catalog-large')
        return catalog(); if (mode === 'completion-timeout')
        return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{')); }, cancel() { canceled = true; } })); return new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(url.endsWith('/models') ? 8 * 1024 * 1024 + 1 : 256 * 1024 + 1)); }, cancel() { canceled = true; } })); };
    try {
        const receipt = await run(plan.id);
        assert.equal(receipt.status, mode === 'completion-timeout' ? 'uncertain' : 'failed');
        assert.ok(canceled, mode);
        assert.equal((await store.prospect(p.id))?.aiQualification, undefined);
    }
    finally {
        clock.mock.restore();
    }
} });
test('exports include immutable qualification receipts; reset cancels old operations without resurrection', async () => { await store.saveProspect(p); const plan = await preview(); const exported = await (await request('export')).json(); assert.ok(exported.qualifications.some((r: any) => r.id === plan.id)); let release!: () => void, entered!: () => void; const enteredPromise = new Promise<void>(r => entered = r), hold = new Promise<void>(r => release = r); transport = async (url) => { if (url.endsWith('/models'))
    return catalog(); entered(); await hold; return completion(); }; const pending = request('qualification/' + plan.id + '/run', { confirmed: true }); await enteredPromise; const reset = await realFetch(base + '/api/data', { method: 'DELETE', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'SUPPRIMER' }) }); assert.equal(reset.status, 200); await store.setSetting('business', { ...store.defaultBusiness, name: 'Agence Atelier', services: 'Création de sites web', zone: 'Paris' }); await store.setSetting('onboarded', true); await (await import('../server/secrets')).saveSecret('openrouterKey', 'synthetic-openrouter-secret'); await store.saveProspect(p); release(); assert.equal((await pending).status, 422); assert.deepEqual(await store.prospect(p.id), p); assert.equal((await store.db.execute('SELECT id FROM qualification_runs')).rows.length, 0); assert.equal((await request('qualification/' + plan.id)).status, 422); });
test('separate processes serialize a shared durable claim and crashed running claims remain locked after restart', async () => { const { fork } = await import('node:child_process'); const { readFile } = await import('node:fs/promises'); const log = path.join(dir, 'provider-posts.log'); const children: import('node:child_process').ChildProcess[] = []; async function worker(crash = false) { const child = fork(path.resolve('tests/fixtures/gemma-worker.ts'), [], { execArgv: ['--import', 'tsx'], env: { ...process.env, GEMMA_TEST_CALLS: log, GEMMA_TEST_CRASH: crash ? '1' : '0' }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }); children.push(child); let errors = ''; child.stderr!.on('data', d => { errors += d; }); const port = await new Promise<number>((resolve, reject) => { const timeout = setTimeout(() => reject(Error('Worker timeout ' + errors)), 15000); child.on('error', reject); child.on('exit', () => reject(Error('Worker exited ' + errors))); child.on('message', (m: any) => { if (m.port) {
    clearTimeout(timeout);
    resolve(m.port);
} }); }); return { child, url: `http://127.0.0.1:${port}` }; } async function remote(url: string, id: string) { return realFetch(url + '/api/qualification/' + id + '/run', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: true }) }); } try {
    await store.saveProspect(p);
    const plan = await preview();
    const workers = await Promise.all([worker(), worker()]);
    const responses = await Promise.all(workers.map(w => remote(w.url, plan.id)));
    const receipts = await Promise.all(responses.map(r => r.json()));
    assert.deepEqual(responses.map(r => r.status), [200, 200], JSON.stringify(receipts));
    assert.ok(receipts.every(r => ['running', 'completed'].includes(r.status)));
    assert.equal((await readFile(log, 'utf8')).trim().split('\n').length, 1);
    const done = await (await request('qualification/' + plan.id)).json();
    assert.equal(done.status, 'completed');
    assert.equal(done.updated, 1);
    assert.deepEqual(await (await remote(workers[1].url, plan.id)).json(), done);
    const crashPlan = await preview();
    const crashing = await worker(true);
    const posted = new Promise<void>(r => crashing.child.on('message', (m: any) => { if (m.posted)
        r(); }));
    const lost = remote(crashing.url, crashPlan.id).catch(() => null);
    await posted;
    crashing.child.kill('SIGKILL');
    await lost;
    await store.db.close();
    const recovered = await (await request('qualification/' + crashPlan.id)).json();
    assert.equal(recovered.status, 'running');
    assert.equal((await (await remote(workers[0].url, crashPlan.id)).json()).status, 'running');
    assert.equal((await readFile(log, 'utf8')).trim().split('\n').length, 2);
}
finally {
    for (const c of children)
        if (c.exitCode === null)
            c.kill('SIGKILL');
} });
test('qualification writes and receipt roll back together on real SQLite write/receipt faults', async () => { const other = { ...p, id: 'second-gemma', name: 'Autre Atelier', website: 'https://other.example', email: 'other@other.example', phone: 'other-phone', address: 'Rue secondaire' }; for (const fault of ['lead', 'receipt']) {
    await store.saveProspect(p);
    await store.saveProspect(other);
    const plan = await preview([p.id, other.id]);
    calls.length = 0;
    const sql = fault === 'lead' ? "CREATE TRIGGER gemma_fault BEFORE UPDATE ON prospects WHEN NEW.id='second-gemma' BEGIN SELECT RAISE(ABORT,'synthetic secret storage fault'); END" : "CREATE TRIGGER gemma_fault BEFORE UPDATE ON qualification_runs WHEN json_extract(NEW.data,'$.run.status')='completed' BEGIN SELECT RAISE(ABORT,'synthetic secret receipt fault'); END";
    await store.db.execute(sql);
    transport = async (url) => url.endsWith('/models') ? catalog() : completion([{ id: p.id, score: 60, reason: 'Pertinent', missingData: [] }, { id: other.id, score: 39, reason: 'Peu pertinent', missingData: [] }]);
    try {
        const receipt = await run(plan.id);
        assert.equal(receipt.status, 'failed');
        assert.equal(receipt.updated, 0);
        assert.deepEqual(await store.prospect(p.id), p);
        assert.deepEqual(await store.prospect(other.id), other);
        assert.doesNotMatch(JSON.stringify(receipt), /synthetic secret/);
        await store.db.close();
        assert.deepEqual(await run(plan.id), receipt);
        assert.equal(calls.filter(c => c.init?.method === 'POST').length, 1);
    }
    finally {
        await store.db.execute('DROP TRIGGER IF EXISTS gemma_fault');
    }
} });
test('auth, Origin, strict preview/run payloads and AI read-only ordinary PATCH guard every new boundary', async () => { await store.saveProspect(p); calls.length = 0; assert.equal((await request('qualification/preview', { ids: [p.id], criteria }, {})).status, 401); assert.equal((await request('qualification/preview', { ids: [p.id], criteria }, { Cookie: cookie, Origin: 'https://evil.invalid' })).status, 403); for (const body of [{ ids: [p.id, p.id], criteria }, { ids: [], criteria }, { ids: Array.from({ length: 11 }, (_, i) => 'id-' + i), criteria }, { ids: ['bad.id'], criteria }, { ids: [p.id], criteria: 'short' }, { ids: [p.id], criteria, model }, { ids: [p.id], criteria, ["api" + "Key"]: "forbidden-fixture-field" }])
    assert.equal((await request('qualification/preview', body)).status, 400); const plan = await preview(); for (const body of [{}, { confirmed: false }, { confirmed: true, ids: [p.id] }, { confirmed: true, model }])
    assert.equal((await request('qualification/' + plan.id + '/run', body)).status, 400); assert.equal((await request('qualification/' + plan.id, undefined, {})).status, 401); const patch = await realFetch(base + '/api/prospects/' + p.id, { method: 'PATCH', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ selected: false, aiQualification: { score: 100 }, aiQualificationHistory: [{}] }) }); assert.equal(patch.status, 200); assert.equal((await patch.json()).aiQualification, undefined); assert.deepEqual(calls, []); });
test('free routing rejects per-request fees before inference and caps every request fee at zero', async () => {
  await (await import('../server/secrets')).saveSecret('openrouterKey', 'synthetic-route-fee-fixture');
  for (const fee of ['0.01', null, '']) {
    await store.saveProspect(p); calls.length = 0; const plan = await preview();
    transport = async url => url.endsWith('/models') ? new Response(JSON.stringify({ data: [{ id: model, pricing: { prompt: '0', completion: '0', request: fee } }] })) : completion();
    assert.equal((await run(plan.id)).status, 'failed'); assert.equal(calls.length, 1);
  }
  await store.saveProspect(p); calls.length = 0; const plan = await preview();
  transport = async url => url.endsWith('/models') ? catalog() : completion();
  assert.equal((await run(plan.id)).status, 'completed');
  assert.equal(JSON.parse(String(calls[1].init?.body)).provider.max_price.request, 0);
});
test('every advertised catalog pricing dimension must be a valid zero before inference', async () => {
    await (await import('../server/secrets')).saveSecret('openrouterKey', 'synthetic-all-fees-fixture');
    const fields = ['prompt', 'completion', 'request', 'internal_reasoning', 'input_cache_read', 'input_cache_write', 'future_fee'];
    const invalid = ['0.01', 0.01, -1, '-0.01', '', ' ', null, false, true, [], {}, 'NaN', 'Infinity', '-Infinity', '1e400'];
    const outcomes: { field: string; value: unknown; status: string; completionPosts: number }[] = [];
    for (const field of fields) for (const value of invalid) {
        await store.saveProspect(p); calls.length = 0; const plan = await preview();
        transport = async url => url.endsWith('/models') ? new Response(JSON.stringify({ data: [{ id: model, pricing: { prompt: '0', completion: '0', [field]: value } }] })) : completion();
        const receipt = await run(plan.id);
        outcomes.push({ field, value, status: receipt.status, completionPosts: calls.filter(c => c.init?.method === 'POST').length });
        if (receipt.status === 'failed') assert.deepEqual(await store.prospect(p.id), p);
    }
    assert.deepEqual(outcomes.filter(o => o.status !== 'failed' || o.completionPosts !== 0), [], 'invalid advertised fees must fail before completion submission');
    for (const missing of ['prompt', 'completion']) {
        await store.saveProspect(p); calls.length = 0; const plan = await preview();
        const pricing: Record<string, unknown> = { prompt: '0', completion: '0' }; delete pricing[missing];
        transport = async url => url.endsWith('/models') ? new Response(JSON.stringify({ data: [{ id: model, pricing }] })) : completion();
        assert.equal((await run(plan.id)).status, 'failed', missing); assert.equal(calls.length, 1);
        assert.deepEqual(await store.prospect(p.id), p);
    }
    for (const zero of ['0', 0, '0.000']) {
        await store.saveProspect(p); calls.length = 0; const plan = await preview();
        transport = async url => url.endsWith('/models') ? new Response(JSON.stringify({ data: [{ id: model, pricing: Object.fromEntries(fields.map(field => [field, zero])) }] })) : completion();
        assert.equal((await run(plan.id)).status, 'completed');
        assert.deepEqual(JSON.parse(String(calls[1].init?.body)).provider.max_price, { prompt: 0, completion: 0, request: 0 });
    }
});
test('nonzero string fees cannot underflow through catalog preflight before inference', async () => {
    await (await import('../server/secrets')).saveSecret('openrouterKey', 'synthetic-underflow-fixture');
    const fields = ['prompt', 'completion', 'request', 'internal_reasoning', 'input_cache_read', 'input_cache_write', 'future_fee'];
    const tinyDecimal = '0.' + '0'.repeat(400) + '1';
    const outcomes: { field: string; value: string; status: string; completionPosts: number }[] = [];
    for (const field of fields) for (const value of ['1e-400', tinyDecimal, '-1e-400', '-' + tinyDecimal]) {
        await store.saveProspect(p); calls.length = 0; const plan = await preview();
        transport = async url => url.endsWith('/models') ? new Response(JSON.stringify({ data: [{ id: model, pricing: { prompt: '0', completion: '0', [field]: value } }] })) : completion();
        const receipt = await run(plan.id);
        outcomes.push({ field, value, status: receipt.status, completionPosts: calls.filter(c => c.init?.method === 'POST').length });
        if (receipt.status === 'failed') {
            assert.deepEqual(await store.prospect(p.id), p);
            assert.deepEqual(await (await request('qualification/' + plan.id)).json(), receipt);
            assert.deepEqual(await run(plan.id), receipt);
            assert.equal(calls.length, 1, 'a failed preflight must never retry or submit inference');
        }
    }
    assert.deepEqual(outcomes.filter(o => o.status !== 'failed' || o.completionPosts !== 0), [], 'nonzero significands must fail closed before any completion POST, even when Number(value) is zero');
});
test('exact lexical zero fee forms remain allowed without widening supported wire caps', async () => {
    await (await import('../server/secrets')).saveSecret('openrouterKey', 'synthetic-lexical-zero-fixture');
    const fields = ['prompt', 'completion', 'request', 'internal_reasoning', 'input_cache_read', 'input_cache_write', 'future_fee'];
    // Signed, fractional, exponent and surrounding-whitespace forms are intentionally zero.
    for (const zero of [0, -0, '0', '-0', '+0', '00', '0.000', '-0.000', '.0', '+.000', '0.', '0e-400', '-0.00E+400', '+00.000e-9999', '0e9999', '  0.000  ']) {
        await store.saveProspect(p); calls.length = 0; const plan = await preview();
        transport = async url => url.endsWith('/models') ? new Response(JSON.stringify({ data: [{ id: model, pricing: Object.fromEntries(fields.map(field => [field, zero])) }] })) : completion();
        const receipt = await run(plan.id);
        assert.equal(receipt.status, 'completed', String(zero));
        assert.equal(receipt.updated, 1);
        assert.equal(calls.filter(c => c.init?.method === 'POST').length, 1);
        assert.deepEqual(JSON.parse(String(calls[1].init?.body)).provider, { allow_fallbacks: false, require_parameters: true, max_price: { prompt: 0, completion: 0, request: 0 } });
        assert.equal((await store.prospect(p.id))?.aiQualification?.runId, plan.id);
    }
});
test('successful qualification preserves all fresh history beyond ten entries plus prior current qualification', async () => {
    await (await import('../server/secrets')).saveSecret('openrouterKey', 'synthetic-history-fixture');
    const prior: NonNullable<Prospect['aiQualification']> = { runId: 'prior-current', model, score: 45, decision: 'review', reason: 'Qualification synthétique précédente', missingData: [], criteria, evaluatedAt: '2026-01-01T00:00:00Z', profileFingerprint: 'synthetic-profile' };
    const history = Array.from({ length: 12 }, (_, i) => ({ ...prior, runId: `historical-${i}` }));
    await store.saveProspect({ ...p, aiQualification: prior, aiQualificationHistory: history });
    calls.length = 0; const plan = await preview();
    const freshHistory = [...history, { ...prior, runId: 'history-added-in-flight' }];
    transport = async url => {
        if (url.endsWith('/models')) return catalog();
        await store.saveProspect({ ...p, aiQualification: prior, aiQualificationHistory: freshHistory });
        return completion();
    };
    const receipt = await run(plan.id);
    assert.equal(receipt.status, 'completed'); assert.equal(receipt.updated, 1);
    assert.equal(calls.filter(c => c.init?.method === 'POST').length, 1);
    await store.db.close();
    const saved = await store.prospect(p.id);
    assert.deepEqual(saved?.aiQualificationHistory, [...freshHistory, prior]);
    assert.equal(saved?.aiQualification?.runId, plan.id);
    assert.deepEqual(await (await request('qualification/' + plan.id)).json(), receipt);
    assert.deepEqual(await run(plan.id), receipt);
    assert.deepEqual((await store.prospect(p.id))?.aiQualificationHistory, [...freshHistory, prior]);
    assert.equal(calls.filter(c => c.init?.method === 'POST').length, 1);
});
test('scope drift during catalog lookup blocks completion submission', async () => { await store.saveProspect(p); const plan = await preview(); calls.length = 0; transport = async (url) => { if (url.endsWith('/models')) {
    await store.saveProspect({ ...p, archived: true, selected: false });
    return catalog();
} return completion(); }; const receipt = await run(plan.id); assert.equal(receipt.status, 'failed'); assert.equal(calls.length, 1); assert.equal((await store.prospect(p.id))?.aiQualification, undefined); });