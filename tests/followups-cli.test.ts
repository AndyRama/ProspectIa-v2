import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const dataDir = mkdtempSync(path.join(process.env.TMPDIR || tmpdir(), 'followups-cli-'));
const env = { ...process.env, VERCEL: '', DATA_DIR: dataDir, TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '', DOTENV_CONFIG_PATH: '/dev/null', FOLLOWUPS_GMAIL_USER: '', FOLLOWUPS_GMAIL_APP_PASSWORD: '' };
function run(...args: string[]) { return spawnSync(process.execPath, ['--import', 'tsx', 'scripts/email-followups.ts', ...args], { cwd: process.cwd(), env, encoding: 'utf8', timeout: 20000 }); }

test('CLI help needs no database or credentials; unknown flags rejected', () => {
  const result = run('--help');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /prepare/);
  assert.match(result.stdout, /--execute/);
  assert.notEqual(run('tick', '--secret', 'bad').status, 0);
});

test('CLI prepare/status/dry-run use isolated SQLite; no mailbox access or activation', async () => {
  Object.assign(process.env, env);
  const { db, saveProspect, saveDraft } = await import('../server/db');
  const { templateHash, templateVersion } = await import('../server/services/followups/templates');
  await saveProspect({ id: 'cli-test', name: 'CLI', email: 'cli@example.com', demo: false, fields: {}, socials: {}, photos: [] } as any);
  await saveDraft({ id: 'cli-draft', prospectId: 'cli-test', prospectName: 'CLI', subject: 'Premier brouillon', body: 'Bonjour', createdAt: new Date().toISOString(), variant: 'default' });
  for (const [id, prospectId, kind, targetProfile] of [
    ['cli-email', 'cli-test', 'email', 'default'], ['wrong-kind', 'cli-test', 'project', 'default'],
    ['wrong-prospect', 'another', 'email', 'default'], ['wrong-profile', 'cli-test', 'email', 'coder'],
    ['old-template', 'cli-test', 'email', 'default'],
  ]) await db.execute({ sql: 'INSERT INTO handoffs(id, prospect_id, data) VALUES(?,?,?)', args: [id, prospectId, JSON.stringify({ id, prospectId, kind, targetProfile, dossier: { followupTemplateHash: id === 'old-template' ? 'old-hash' : templateHash, followupTemplateVersion: templateVersion } })] });
  await db.close();
  for (const invalid of ['missing', 'wrong-kind', 'wrong-prospect', 'wrong-profile', 'old-template']) {
    assert.notEqual(run('prepare', '--prospect-id', 'cli-test', '--handoff-id', invalid).status, 0);
    assert.notEqual(run('status', '--campaign', 'cli-test').status, 0);
  }
  assert.notEqual(run('prepare', '--prospect-id', 'cli-test', '--handoff-id', 'cli-email', '--draft-id', 'cli-draft').status, 0);
  const prepare = run('prepare', '--prospect-id', 'cli-test', '--handoff-id', 'cli-email');
  assert.equal(prepare.status, 0, prepare.stderr);
  assert.equal(JSON.parse(prepare.stdout).state, 'prepared');
  const tick = run('tick', '--campaign', 'cli-test', '--dry-run');
  assert.equal(tick.status, 0, tick.stderr);
  assert.equal(JSON.parse(tick.stdout).action, 'prepared');
  const approval = run('approve', '--campaign', 'cli-test', '--message-id', '<real@example.com>');
  assert.equal(approval.status, 0, approval.stderr);
  assert.equal(JSON.parse(approval.stdout).action, 'dry-run');
  assert.equal(JSON.parse(run('status', '--campaign', 'cli-test').stdout).state, 'prepared');
  const executed = run('approve', '--campaign', 'cli-test', '--message-id', '<real@example.com>', '--execute');
  assert.notEqual(executed.status, 0);
  assert.equal(JSON.parse(run('status', '--campaign', 'cli-test').stdout).state, 'prepared');
  const { Followups, ANDY } = await import('../server/services/followups/runner');
  const fakeSentAt = Date.now() - 7 * 86400000;
  const runner = new Followups({ findSent: async () => ({ messageId: '<real@example.com>', from: ANDY, to: ['cli@example.com'], cc: [], bcc: [], sentAt: fakeSentAt, subject: 'Premier brouillon' }), hasReply: async () => false, send: async () => { throw Error('Never send in CLI fixture'); } });
  await runner.approve('cli-test', '<real@example.com>');
  await db.close();
  const due = run('tick', '--campaign', 'cli-test', '--dry-run');
  assert.equal(due.status, 0, due.stderr);
  assert.equal(JSON.parse(due.stdout).action, 'dry-run');
  assert.equal(JSON.parse(due.stdout).day, 7);
});
