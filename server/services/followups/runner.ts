import { randomUUID, createHash } from 'node:crypto';
import { db, getSetting, setSetting, claimSetting, prospect } from '../../db';
import { days, sender, renderBody, templateHash, templateVersion } from './templates';

export const ANDY = sender;
export type SentProof = { messageId: string; from: string; to: string[]; cc: string[]; bcc: string[]; sentAt: number; subject: string };
export type Mail = { from: string; to: string; subject: string; text: string; messageId: string; inReplyTo: string; references: string[] };
export interface Transport {
  findSent(messageId: string): Promise<SentProof | null>;
  hasReply(recipient: string, since: number): Promise<boolean>;
  send(mail: Mail): Promise<void>;
}
export type Campaign = {
  id: string; prospectId: string; draftId?: string; handoffId?: string; recipient: string; sender: string;
  state: 'prepared' | 'approved' | 'stopped' | 'complete'; reason?: string;
  firstMessageId?: string; sentAt?: number; subject?: string;
  templateHash: string; templateVersion: string;
  stages: { day: number; state: 'pending' | 'uncertain' | 'sent' | 'skipped'; messageId?: string; sentAt?: number }[];
};
const key = (id: string) => `followups:campaign:${id}`;
export function validateMessageId(id: string) {
  if (!/^<[^<>\s@]+@[^<>\s@]+>$/.test(id) || id.length > 250) throw Error('Invalid Message-ID');
}
export class Followups {
  constructor(private transport?: Transport, private now = () => Date.now()) {}
  private async locked<T>(fn: () => Promise<T>): Promise<T> {
    const token = randomUUID();
    if (!await claimSetting('followups:lock', token)) throw Error('Followups locked; crash locks require manual investigation, never automatic expiry');
    try { return await fn(); }
    finally { await db.execute({ sql: "UPDATE settings SET data='null' WHERE key='followups:lock' AND data=?", args: [JSON.stringify(token)] }); }
  }
  private network() { if (!this.transport) throw Error('Transport required'); return this.transport; }
  private checkTemplate(c: Campaign) {
    if (c.templateHash !== templateHash || c.templateVersion !== templateVersion || c.sender !== sender || JSON.stringify(c.stages.map(s => s.day)) !== JSON.stringify(days)) throw Error('Template drift: explicit review and new preparation required; stored approval is never migrated automatically');
  }
  async status(id: string): Promise<Campaign> {
    const c = await getSetting<Campaign | null>(key(id), null);
    if (!c) throw Error('Campaign not found');
    return c;
  }
  private async guard(c: Campaign) {
    const p = await prospect(c.prospectId);
    if (!p || p.archived || p.doNotContact || p.demo || p.email.trim().toLowerCase() !== c.recipient) throw Error('Prospect missing, archived, opposed, demo or email changed');
    if ((await db.execute({ sql: 'SELECT 1 FROM suppressions WHERE lower(trim(email))=?', args: [c.recipient] })).rows.length) throw Error('Recipient suppression');
    return p;
  }
  async prepare(prospectId: string, source: string | { handoffId: string }): Promise<Campaign> {
    return this.locked(async () => {
      const p = await prospect(prospectId);
      if (!p) throw Error('Prospect not found');
      const recipient = p.email.trim().toLowerCase();
      if (!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(recipient) || recipient === ANDY) throw Error('Invalid recipient');
      const c: Campaign = { id: p.id, prospectId: p.id, ...(typeof source === 'string' ? { draftId: source } : source), recipient, sender: ANDY, templateHash, templateVersion, state: 'prepared', stages: days.map(day => ({ day, state: 'pending' })) };
      await this.guard(c);
      if (typeof source === 'string') {
        const row = (await db.execute({ sql: 'SELECT data FROM drafts WHERE id=?', args: [source] })).rows[0];
        const draft = row && JSON.parse(String(row.data));
        if (!draft || (await prospect(draft.prospectId))?.id !== p.id) throw Error('Existing first-email draft required for this prospect');
      } else {
        const row = (await db.execute({ sql: 'SELECT prospect_id, data FROM handoffs WHERE id=?', args: [source.handoffId] })).rows[0];
        const h = row && JSON.parse(String(row.data));
        if (!h || h.id !== source.handoffId || h.kind !== 'email' || h.targetProfile !== 'default' || h.prospectId !== row.prospect_id || (await prospect(h.prospectId))?.id !== p.id) throw Error('Existing email/default handoff required for this prospect');
        if (h.dossier?.followupTemplateHash !== templateHash || h.dossier?.followupTemplateVersion !== templateVersion) throw Error('Template drift: regenerate and review email handoff');
      }
      const existing = await getSetting<Campaign | null>(key(c.id), null);
      if (existing) throw Error('Campaign already exists; cannot reset its history');
      await setSetting(key(c.id), c);
      return c;
    });
  }
  private checkProof(proof: SentProof | null, c: Campaign, id: string) {
    if (!proof || proof.messageId !== id || proof.from.toLowerCase() !== c.sender || proof.to.length !== 1 || proof.to[0].toLowerCase() !== c.recipient || proof.cc.length || proof.bcc.length || !Number.isFinite(proof.sentAt) || proof.sentAt <= 0 || proof.sentAt > this.now() || /[\r\n]/.test(proof.subject)) throw Error('Sent proof invalid (id, sender, recipient or date)');
    return proof;
  }
  async tick(id: string, execute = false): Promise<{ action: string; day?: number; reason?: string }> {
    return this.locked(async () => {
      const c = await this.status(id);
      const stop = async (reason: string) => {
        if (execute) { c.state = 'stopped'; c.reason = reason; await setSetting(key(id), c); }
        return { action: 'stopped', reason };
      };
      try { await this.guard(c); } catch { return stop('Prospect unavailable or opposition/suppression'); }
      if (c.state !== 'approved') return { action: c.state };
      this.checkTemplate(c);
      if (!c.sentAt || !c.firstMessageId || !c.subject || c.sender !== ANDY) throw Error('Missing activation proof');
      const dayMs = 86400000;
      const uncertain = c.stages.find(s => s.state === 'uncertain');
      const due = c.stages.filter(s => s.state === 'pending' && c.sentAt! + s.day * dayMs <= this.now()).at(-1);
      if (!execute) return { action: 'dry-run', day: (uncertain || due)?.day, reason: 'Offline preview only; no mailbox checks, no sending' };
      const transport = this.network();
      // Fail closed: a failed/incomplete mailbox check escapes before any SMTP attempt.
      if (await transport.hasReply(c.recipient, c.sentAt)) return stop('Reply received (including refusals)');
      if (uncertain) {
        const proof = await transport.findSent(uncertain.messageId!);
        if (!proof) return { action: 'uncertain', day: uncertain.day, reason: 'No positive Sent proof; automatic retry forbidden' };
        const verified = this.checkProof(proof, c, uncertain.messageId!);
        if (verified.sentAt < c.sentAt + uncertain.day * dayMs) throw Error('Stage proof predates its scheduled date');
        uncertain.state = 'sent'; uncertain.sentAt = verified.sentAt;
        if (c.stages.every(s => s.state === 'sent' || s.state === 'skipped')) c.state = 'complete';
        await setSetting(key(id), c);
        return { action: 'reconciled', day: uncertain.day };
      }
      if (!due) return { action: 'waiting' };
      const lastSent = Math.max(c.sentAt, ...c.stages.filter(s => s.state === 'sent').map(s => s.sentAt!));
      if (this.now() < lastSent + 3 * dayMs) return { action: 'waiting' };
      const hash = createHash('sha256').update(`${c.id}:${c.firstMessageId}:${due.day}`).digest('hex');
      due.messageId = `<prospectai-followup-${hash}@gmail.com>`;
      const existing = await transport.findSent(due.messageId);
      if (existing) {
        const verified = this.checkProof(existing, c, due.messageId);
        if (verified.sentAt < c.sentAt + due.day * dayMs) throw Error('Stage proof predates its scheduled date');
        due.state = 'sent'; due.sentAt = verified.sentAt;
        for (const stage of c.stages) if (stage.day < due.day && stage.state === 'pending') stage.state = 'skipped';
        if (c.stages.every(s => s.state === 'sent' || s.state === 'skipped')) c.state = 'complete';
        await setSetting(key(id), c);
        return { action: 'reconciled', day: due.day };
      }
      if (await transport.hasReply(c.recipient, c.sentAt)) return stop('Reply received (including refusals)');
      try { await this.guard(c); } catch { return stop('Prospect changed before SMTP'); }
      // Persist BEFORE calling SMTP: any process/network/DB failure from here is uncertain.
      due.state = 'uncertain';
      for (const stage of c.stages) if (stage.day < due.day && stage.state === 'pending') stage.state = 'skipped';
      await setSetting(key(id), c);
      try { await this.guard(c); } catch { return stop('Prospect changed before SMTP'); }
      try {
        await transport.send({ from: c.sender, to: c.recipient, subject: `Re: ${c.subject.replace(/^Re:\s*/i, '')}`, text: renderBody(due.day), messageId: due.messageId, inReplyTo: c.firstMessageId, references: [c.firstMessageId] });
      } catch { return { action: 'uncertain', day: due.day, reason: 'SMTP outcome uncertain; no automatic retry' }; }
      due.state = 'sent'; due.sentAt = this.now();
      if (c.stages.every(s => s.state === 'sent' || s.state === 'skipped')) c.state = 'complete';
      await setSetting(key(id), c);
      return { action: 'sent', day: due.day };
    });
  }
  async approve(id: string, firstMessageId: string): Promise<Campaign> {
    validateMessageId(firstMessageId);
    return this.locked(async () => {
      const c = await this.status(id);
      if (c.state !== 'prepared') throw Error('Only prepared campaigns can be approved');
      this.checkTemplate(c);
      await this.guard(c);
      const proof = this.checkProof(await this.network().findSent(firstMessageId), c, firstMessageId);
      await this.guard(c);
      Object.assign(c, { state: 'approved', firstMessageId, sentAt: proof.sentAt, subject: proof.subject });
      await setSetting(key(id), c);
      return c;
    });
  }
}
