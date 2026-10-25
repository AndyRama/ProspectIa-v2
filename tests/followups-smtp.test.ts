import test from 'node:test';
import assert from 'node:assert/strict';
import { GmailTransport } from '../server/services/followups/gmail';
import { ANDY, type Mail } from '../server/services/followups/runner';

test('SMTP uses fixed Andy envelope, no remote/file attachments, verifies exact acceptance', async () => {
  let acceptance = { accepted: ['prospect@example.com'], rejected: [] as string[] };
  let payload: any;
  const transport = new GmailTransport({ user: ANDY, password: 'FAKE-test-only' }, { imap: () => { throw Error('No network'); }, smtp: () => ({ sendMail: async (mail: object) => { payload = mail; return acceptance; } }) });
  const mail: Mail = { from: ANDY, to: 'prospect@example.com', subject: 'Re: Proposition', text: 'Bonjour\nAndy Ramaroson', messageId: '<followup@example.com>', inReplyTo: '<first@example.com>', references: ['<first@example.com>'] };
  await transport.send(mail);
  assert.deepEqual(payload.envelope, { from: ANDY, to: [mail.to] });
  assert.equal(payload.disableFileAccess, true);
  assert.equal(payload.disableUrlAccess, true);
  assert.deepEqual(payload.from, { name: 'Andy Ramaroson', address: ANDY });
  acceptance = { accepted: [], rejected: [mail.to] };
  await assert.rejects(() => transport.send(mail), /uncertain/);
  await assert.rejects(() => transport.send({ ...mail, from: 'someone@gmail.com' }), /envelope/);
  await assert.rejects(() => transport.send({ ...mail, to: 'a@example.com\r\nBcc: b@example.com' }), /envelope/);
  assert.throws(() => new GmailTransport({ user: 'someone@gmail.com', password: 'FAKE' }), /credentials/);
});
