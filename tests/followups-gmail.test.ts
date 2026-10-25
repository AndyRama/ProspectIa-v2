import test from 'node:test';
import assert from 'node:assert/strict';
import { GmailTransport } from '../server/services/followups/gmail';
import { ANDY } from '../server/services/followups/runner';
const when = Date.parse('2026-01-01T12:00:00Z');
function fixture() {
  const messages: any[] = [{ internalDate: new Date(when), envelope: { messageId: '<real@example.com>', from: [{address: ANDY}], to: [{address: 'prospect@example.com'}], cc: [], bcc: [], subject: 'Bonjour' } }];
  const boxes = [{path: 'Sent', specialUse: '\\Sent', flags: new Set()}, {path: 'Spam', flags: new Set()}, {path: 'Trash', flags: new Set()}];
  let selected = ''; let searchResult: any = [1]; let smtpCalls = 0;
  const client: any = { on() {}, connect: async () => {}, logout: async () => {}, close() {}, list: async () => boxes, getMailboxLock: async (p: string) => {selected = p; return { release() {} };}, search: async () => searchResult, fetchOne: async () => messages[0] };
  const transport = new GmailTransport({ user: ANDY, password: 'FAKE-test-only' }, { imap: () => client, smtp: () => ({ sendMail: async () => {smtpCalls++; return {accepted: ['prospect@example.com'], rejected: []};} }) });
  return {transport, messages, boxes, client, selected: () => selected, setSearch: (x: any) => {searchResult = x;}, smtpCalls: () => smtpCalls};
}

test('Sent proof uses exact envelope and INTERNALDATE, requires unique match and a Sent special-use folder', async () => {
  const f = fixture();
  assert.equal((await f.transport.findSent('<real@example.com>'))?.sentAt, when);
  assert.equal(f.selected(), 'Sent');
  f.setSearch([]);
  assert.equal(await f.transport.findSent('<real@example.com>'), null);
  f.setSearch([1, 2]);
  await assert.rejects(() => f.transport.findSent('<real@example.com>'), /ambiguous/i);
  f.setSearch([1]); f.messages[0].internalDate = undefined;
  await assert.rejects(() => f.transport.findSent('<real@example.com>'), /date/i);
  f.messages[0].internalDate = new Date(when); f.messages[0].envelope.messageId = '<other@example.com>';
  await assert.rejects(() => f.transport.findSent('<real@example.com>'), /id/i);
  f.boxes[0].specialUse = '';
  await assert.rejects(() => f.transport.findSent('<real@example.com>'), /Sent/);
});

test('reply detection checks exact sender and received time, scans spam/trash, fails closed on failed search', async () => {
  const f = fixture();
  assert.equal(await f.transport.hasReply('prospect@example.com', when - 1), false);
  assert.equal(f.selected(), 'Trash');
  f.messages[0].envelope.from = [{address: 'prospect@example.com'}];
  assert.equal(await f.transport.hasReply('prospect@example.com', when - 1), true);
  assert.equal(await f.transport.hasReply('prospect@example.com', when + 1), false);
  f.setSearch(false);
  await assert.rejects(() => f.transport.hasReply('prospect@example.com', when - 1), /search/i);
  assert.equal(f.smtpCalls(), 0);
});
