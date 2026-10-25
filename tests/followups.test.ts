import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
process.env.TURSO_DATABASE_URL = '';
process.env.TURSO_AUTH_TOKEN = '';
process.env.VERCEL = '';
process.env.DOTENV_CONFIG_PATH = '/dev/null';
process.env.DATA_DIR = mkdtempSync(path.join(process.env.TMPDIR || tmpdir(), 'followups-'));
const { db, saveProspect, saveDraft } = await import('../server/db');
const { Followups, ANDY } = await import('../server/services/followups/runner');

const origin = Date.parse('2026-01-01T12:00:00Z');
let counter = 0;
async function fixture() {
  const id = `p-${++counter}`;
  const recipient = `prospect-${counter}@example.com`;
  const p: any = { id, name: `Test ${id}`, email: recipient, demo: false, fields: {}, socials: {}, photos: [], website: '', address: '', city: '', services: '' };
  await saveProspect(p);
  await saveDraft({ id: `d-${id}`, prospectId: id, prospectName: 'Test', subject: 'Une proposition', body: 'Bonjour', variant: 'default', createdAt: new Date(origin).toISOString() });
  const sent: any[] = [];
  let proof: any = { messageId: '<first@example.com>', from: ANDY, to: [recipient], cc: [], bcc: [], sentAt: origin, subject: 'Une proposition' };
  const transport: any = { findSent: async () => proof, hasReply: async () => false, send: async (mail: any) => { sent.push(mail); } };
  const runner = new Followups(transport, () => origin);
  const c = await runner.prepare(id, `d-${id}`);
  return { id, p, c, sent, transport, runner, proof, setProof: (x: any) => { proof = x; } };
}

test('prepare saves a draft reference, never sends; approval requires exact sent proof', async () => {
  const f = await fixture();
  assert.equal(f.c.state, 'prepared');
  assert.equal(f.sent.length, 0);
  f.setProof(null);
  await assert.rejects(() => f.runner.approve(f.c.id, '<first@example.com>'), /proof/i);
  assert.equal((await f.runner.status(f.c.id)).state, 'prepared');
  f.setProof(f.proof);
  const c = await f.runner.approve(f.c.id, '<first@example.com>');
  assert.equal(c.sentAt, origin);
  assert.equal(c.state, 'approved');
  assert.equal(f.sent.length, 0);
});

test('dry run is offline and cumulative days are measured from first sent proof', async () => {
  const f = await fixture();
  await f.runner.approve(f.c.id, '<first@example.com>');
  f.transport.findSent = async () => { throw Error('must stay offline'); };
  const preview = await new Followups(undefined, () => origin + 7 * 86400000).tick(f.c.id);
  assert.equal(preview.action, 'dry-run');
  assert.equal(preview.day, 7);
  assert.equal(f.sent.length, 0);
});

test('late ticks send only latest due stage, reboot is idempotent, interval is at least 3 days', async () => {
  const f = await fixture();
  await f.runner.approve(f.c.id, '<first@example.com>');
  f.transport.findSent = async () => null;
  const late = new Followups(f.transport, () => origin + 14 * 86400000);
  assert.equal((await late.tick(f.c.id, true)).action, 'sent');
  assert.equal(f.sent.length, 1);
  assert.equal((await late.status(f.c.id)).stages[0].state, 'skipped');
  assert.equal((await new Followups(f.transport, () => origin + 15 * 86400000).tick(f.c.id, true)).action, 'waiting');
  assert.equal((await new Followups(f.transport, () => origin + 17 * 86400000).tick(f.c.id, true)).action, 'sent');
  assert.equal(f.sent.length, 2);
  assert.equal((await new Followups(f.transport, () => origin + 17 * 86400000).tick(f.c.id, true)).action, 'waiting');
  assert.equal(f.sent.length, 2);
  assert.match(f.sent[0].text, /Andy Ramaroson/);
  assert.equal(f.sent[0].inReplyTo, '<first@example.com>');
});

test('SMTP failure is durably uncertain, never retried without a positive Sent proof', async () => {
  const f = await fixture();
  await f.runner.approve(f.c.id, '<first@example.com>');
  f.transport.findSent = async () => null;
  let attempts = 0;
  f.transport.send = async () => { attempts++; throw Error('connection lost after DATA'); };
  const tick = () => new Followups(f.transport, () => origin + 3 * 86400000).tick(f.c.id, true);
  assert.equal((await tick()).action, 'uncertain');
  await db.close(); // Reopen SQLite from disk, not an in-memory runner cache.
  assert.equal((await tick()).action, 'uncertain');
  assert.equal(attempts, 1);
  const c = await f.runner.status(f.c.id);
  f.transport.findSent = async () => ({ ...f.proof, messageId: c.stages[0].messageId, sentAt: origin });
  await assert.rejects(tick, /predates/);
  f.transport.findSent = async () => ({ ...f.proof, messageId: c.stages[0].messageId, sentAt: origin + 3 * 86400000 });
  assert.equal((await tick()).action, 'reconciled');
  assert.equal(attempts, 1);
});

for (const change of ['wrong-id', 'wrong-from', 'wrong-to', 'extra-to', 'cc', 'future', 'nan']) {
  test(`approval refuses ${change} Sent proof`, async () => {
    const f = await fixture();
    const proof = { ...f.proof };
    if (change === 'wrong-id') proof.messageId = '<wrong@example.com>';
    if (change === 'wrong-from') proof.from = 'other@gmail.com';
    if (change === 'wrong-to') proof.to = ['wrong@example.com'];
    if (change === 'extra-to') proof.to = [f.c.recipient, 'other@example.com'];
    if (change === 'cc') proof.cc = ['other@example.com'];
    if (change === 'future') proof.sentAt = origin + 1;
    if (change === 'nan') proof.sentAt = NaN;
    f.setProof(proof);
    await assert.rejects(() => f.runner.approve(f.c.id, '<first@example.com>'), /proof/i);
    assert.equal((await f.runner.status(f.c.id)).state, 'prepared');
    assert.equal(f.sent.length, 0);
  });
}
for (const reason of ['reply', 'refusal', 'archived', 'doNotContact', 'suppression', 'email-changed']) {
  test(`tick stops durably on ${reason}`, async () => {
    const f = await fixture();
    await f.runner.approve(f.c.id, '<first@example.com>');
    f.transport.findSent = async () => null;
    if (reason === 'reply' || reason === 'refusal') f.transport.hasReply = async () => true;
    if (reason === 'archived') await saveProspect({ ...f.p, archived: true });
    if (reason === 'doNotContact') await saveProspect({ ...f.p, doNotContact: true });
    if (reason === 'email-changed') await saveProspect({ ...f.p, email: 'changed@example.com' });
    if (reason === 'suppression') await db.execute({ sql: 'INSERT OR REPLACE INTO suppressions VALUES(?,?)', args: [f.c.recipient, new Date().toISOString()] });
    const tick = () => new Followups(f.transport, () => origin + 31 * 86400000).tick(f.c.id, true);
    assert.equal((await tick()).action, 'stopped');
    assert.equal((await tick()).action, 'stopped');
    assert.equal(f.sent.length, 0);
    if (reason === 'suppression') await db.execute('DELETE FROM suppressions');
  });
}

test('guard is revalidated after IMAP immediately before SMTP', async () => {
  const f = await fixture(); await f.runner.approve(f.c.id, '<first@example.com>');
  f.transport.findSent = async () => { await saveProspect({ ...f.p, archived: true }); return null; };
  assert.equal((await new Followups(f.transport, () => origin + 3 * 86400000).tick(f.c.id, true)).action, 'stopped');
  assert.equal(f.sent.length, 0);
});

test('IMAP errors fail closed; prepared campaign never sends; duplicate prepare cannot reset history', async () => {
  const f = await fixture();
  assert.equal((await f.runner.tick(f.c.id, true)).action, 'prepared');
  await assert.rejects(() => f.runner.prepare(f.id, `d-${f.id}`), /exists/);
  await f.runner.approve(f.c.id, '<first@example.com>');
  f.transport.hasReply = async () => { throw Error('IMAP unavailable'); };
  await assert.rejects(() => new Followups(f.transport, () => origin + 3 * 86400000).tick(f.c.id, true), /IMAP/);
  f.transport.hasReply = async () => false;
  f.transport.findSent = async () => { throw Error('Sent unavailable'); };
  await assert.rejects(() => new Followups(f.transport, () => origin + 3 * 86400000).tick(f.c.id, true), /Sent/);
  assert.equal(f.sent.length, 0);
});

test('cumulative J+3/7/15/31 and max one SMTP action per tick', async () => {
  const f = await fixture(); await f.runner.approve(f.c.id, '<first@example.com>');
  f.transport.findSent = async () => null;
  for (const day of [3, 7, 15, 31]) {
    const runner = new Followups(f.transport, () => origin + day * 86400000);
    assert.equal((await runner.tick(f.c.id, true)).day, day);
    assert.ok(['waiting', 'complete'].includes((await runner.tick(f.c.id, true)).action));
  }
  const { days, renderBody } = await import('../server/services/followups/templates');
  assert.deepEqual(f.sent.map(m => m.text), days.map(renderBody));
  assert.equal(f.sent.length, 4);
  assert.equal(new Set(f.sent.map(m => m.messageId)).size, 4);
  assert.equal((await f.runner.status(f.c.id)).state, 'complete');
});

test('durable lock serializes independent runners and never expires a crashed holder', async () => {
  const f = await fixture(); await f.runner.approve(f.c.id, '<first@example.com>');
  await db.execute({ sql: 'INSERT OR REPLACE INTO settings VALUES(?,?)', args: ['followups:lock', JSON.stringify('crashed-worker')] });
  await assert.rejects(() => new Followups(f.transport).tick(f.c.id, true), /locked/);
  assert.equal(f.sent.length, 0);
  await db.execute("UPDATE settings SET data='null' WHERE key='followups:lock'");
});

test('canonical prospect alias is persisted, canonical opposition checked on tick', async () => {
  const f = await fixture();
  await saveProspect({ ...f.p, id: 'alias-' + f.id, duplicateOf: f.id });
  // A new prepared campaign uses canonical id, so the alias cannot create a second campaign.
  await assert.rejects(() => f.runner.prepare('alias-' + f.id, `d-${f.id}`), /exists/);
  await f.runner.approve(f.c.id, '<first@example.com>');
  await saveProspect({ ...f.p, doNotContact: true });
  assert.equal((await new Followups(f.transport, () => origin + 3 * 86400000).tick(f.c.id, true)).action, 'stopped');
});

test('reconciliation of final due stage completes campaign and rejects prematurely dated stage proof', async () => {
  const f = await fixture(); await f.runner.approve(f.c.id, '<first@example.com>');
  const runner = new Followups(f.transport, () => origin + 31 * 86400000);
  f.transport.findSent = async (messageId: string) => ({ ...f.proof, messageId, sentAt: origin + 86400000 });
  await assert.rejects(() => runner.tick(f.c.id, true), /predates/);
  f.transport.findSent = async (messageId: string) => ({ ...f.proof, messageId, sentAt: origin + 31 * 86400000 });
  assert.equal((await runner.tick(f.c.id, true)).action, 'reconciled');
  assert.equal((await runner.status(f.c.id)).state, 'complete');
  assert.equal(f.sent.length, 0);
});

test('concurrent runners cannot overlap SMTP actions', async () => {
  const f = await fixture(); await f.runner.approve(f.c.id, '<first@example.com>');
  f.transport.findSent = async () => null;
  let release!: () => void; let entered!: () => void;
  const blocked = new Promise<void>(r => { release = r; });
  const sending = new Promise<void>(r => { entered = r; });
  f.transport.send = async () => { entered(); await blocked; };
  const first = new Followups(f.transport, () => origin + 3 * 86400000).tick(f.c.id, true);
  await sending;
  try { await assert.rejects(() => new Followups(f.transport, () => origin + 3 * 86400000).tick(f.c.id, true), /locked/); }
  finally { release(); }
  assert.equal((await first).action, 'sent');
});

test('even an unapproved tick checks canonical archive/opposition guards', async () => {
  const f = await fixture();
  await saveProspect({ ...f.p, archived: true });
  assert.equal((await f.runner.tick(f.c.id, true)).action, 'stopped');
  assert.equal(f.sent.length, 0);
});

test('reply arriving during slow Sent lookup blocks SMTP', async () => {
  const f = await fixture(); await f.runner.approve(f.c.id, '<first@example.com>');
  let reply = false;
  f.transport.hasReply = async () => reply;
  f.transport.findSent = async () => { reply = true; return null; };
  assert.equal((await new Followups(f.transport, () => origin + 3 * 86400000).tick(f.c.id, true)).action, 'stopped');
  assert.equal(f.sent.length, 0);
  assert.equal((await f.runner.status(f.c.id)).stages[0].state, 'pending');
});

test('second reply check failure blocks SMTP before uncertain persistence', async () => {
  const f = await fixture(); await f.runner.approve(f.c.id, '<first@example.com>');
  let checks = 0;
  f.transport.hasReply = async () => { if (++checks === 2) throw Error('late IMAP error'); return false; };
  f.transport.findSent = async () => null;
  await assert.rejects(() => new Followups(f.transport, () => origin + 3 * 86400000).tick(f.c.id, true), /late IMAP/);
  assert.equal(f.sent.length, 0);
  assert.equal((await f.runner.status(f.c.id)).stages[0].state, 'pending');
});

for (const phase of ['prepare', 'approved']) {
  test(`durable template drift blocks ${phase === 'prepare' ? 'approval' : 'tick'} before network`, async () => {
    const f = await fixture();
    if (phase === 'approved') await f.runner.approve(f.c.id, '<first@example.com>');
    const c: any = await f.runner.status(f.c.id);
    c.templateHash = 'previous-deployment-hash';
    await db.execute({ sql: 'UPDATE settings SET data=? WHERE key=?', args: [JSON.stringify(c), `followups:campaign:${c.id}`] });
    await db.close();
    f.transport.findSent = async () => { throw Error('network must not be reached'); };
    const runner = new Followups(f.transport, () => origin + 3 * 86400000);
    await assert.rejects(() => phase === 'prepare' ? runner.approve(c.id, '<first@example.com>') : runner.tick(c.id, true), /template drift/i);
    assert.equal(f.sent.length, 0);
    assert.equal((await runner.status(c.id) as any).templateHash, 'previous-deployment-hash');
  });
}

test.after(async () => { await db.close(); });
