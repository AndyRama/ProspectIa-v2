import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { ANDY, validateMessageId, type Mail, type SentProof, type Transport } from './runner';

type ImapClient = Pick<ImapFlow, 'connect' | 'logout' | 'close' | 'on' | 'list' | 'getMailboxLock' | 'search' | 'fetchOne'>;
type Dependencies = { imap: () => ImapClient; smtp: () => { sendMail(mail: object): Promise<{ accepted: unknown[]; rejected: unknown[] }> } };
export class GmailTransport implements Transport {
  private deps: Dependencies;
  constructor(credentials: { user: string; password: string }, deps?: Dependencies) {
    if (credentials.user !== ANDY || !credentials.password) throw Error('Gmail credentials required for Andy (external environment only)');
    const auth = { user: credentials.user, pass: credentials.password };
    this.deps = deps || {
      imap: () => new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth, logger: false, tls: { rejectUnauthorized: true }, connectionTimeout: 30000, greetingTimeout: 30000, socketTimeout: 60000 }),
      smtp: () => nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth, tls: { rejectUnauthorized: true }, logger: false, debug: false, connectionTimeout: 30000, greetingTimeout: 30000, socketTimeout: 60000, disableFileAccess: true, disableUrlAccess: true }),
    };
  }
  private async mailbox<T>(fn: (client: ImapClient) => Promise<T>): Promise<T> {
    const client = this.deps.imap();
    // Do not log IMAP diagnostics: they can contain mailbox data or credentials.
    client.on('error', () => {});
    try { await client.connect(); return await fn(client); }
    finally { try { await client.logout(); } catch { client.close(); } }
  }
  private uids(value: unknown): number[] {
    if (!Array.isArray(value) || value.some(v => !Number.isSafeInteger(v) || v <= 0)) throw Error('IMAP search failed');
    if (value.length > 5000) throw Error('IMAP search too large; manual review required');
    return value;
  }
  private receivedDate(value: unknown) {
    if (!(value instanceof Date) || !Number.isFinite(value.getTime()) || value.getTime() <= 0) throw Error('Missing/invalid IMAP INTERNALDATE');
    return value.getTime();
  }
  async findSent(messageId: string): Promise<SentProof | null> {
    validateMessageId(messageId);
    return this.mailbox(async client => {
      const boxes = (await client.list()).filter(b => b.specialUse === '\\Sent');
      if (boxes.length !== 1) throw Error('Gmail Sent mailbox missing or ambiguous');
      const lock = await client.getMailboxLock(boxes[0].path, { readOnly: true });
      try {
        const uids = this.uids(await client.search({ header: { 'message-id': messageId } }, { uid: true }));
        if (!uids.length) return null;
        if (uids.length !== 1) throw Error('Sent proof ambiguous');
        const msg = await client.fetchOne(String(uids[0]), { envelope: true, internalDate: true }, { uid: true });
        if (!msg || !msg.envelope || msg.envelope.messageId !== messageId) throw Error('Sent Message-ID mismatch or missing envelope');
        const e = msg.envelope;
        if (e.from?.length !== 1 || !e.from[0].address || !e.to?.length || e.to.some(a => !a.address) || e.cc?.some(a => !a.address) || e.bcc?.some(a => !a.address)) throw Error('Invalid Sent addressing');
        return { messageId, from: e.from[0].address, to: e.to.map(a => a.address!), cc: (e.cc || []).map(a => a.address!), bcc: (e.bcc || []).map(a => a.address!), sentAt: this.receivedDate(msg.internalDate), subject: e.subject || '' };
      } finally { lock.release(); }
    });
  }
  async hasReply(recipient: string, since: number): Promise<boolean> {
    return this.mailbox(async client => {
      const boxes = (await client.list()).filter(b => ![...b.flags].some(f => f.toLowerCase() === '\\noselect'));
      if (!boxes.length) throw Error('No readable mailboxes; cannot rule out replies');
      // Includes Spam and Trash, not just INBOX. Search a day early to avoid IMAP day/timezone truncation.
      for (const box of boxes) {
        const lock = await client.getMailboxLock(box.path, { readOnly: true });
        try {
          const uids = this.uids(await client.search({ from: recipient, since: new Date(since - 86400000) }, { uid: true }));
          for (const uid of uids) {
            const msg = await client.fetchOne(String(uid), { envelope: true, internalDate: true }, { uid: true });
            if (!msg || !msg.envelope?.from?.length || msg.envelope.from.some(a => !a.address)) throw Error('Cannot verify reply envelope');
            const received = this.receivedDate(msg.internalDate);
            if (received >= since && msg.envelope.from.some(a => a.address!.toLowerCase() === recipient.toLowerCase())) return true;
          }
        } finally { lock.release(); }
      }
      return false;
    });
  }
  async send(mail: Mail): Promise<void> {
    if (mail.from !== ANDY || /[\r\n]/.test(mail.to + mail.subject)) throw Error('Invalid SMTP envelope');
    validateMessageId(mail.messageId);
    validateMessageId(mail.inReplyTo);
    const info = await this.deps.smtp().sendMail({ ...mail, from: { name: 'Andy Ramaroson', address: ANDY }, envelope: { from: ANDY, to: [mail.to] }, disableFileAccess: true, disableUrlAccess: true });
    if (info.rejected.length || info.accepted.length !== 1 || String(info.accepted[0]).toLowerCase() !== mail.to.toLowerCase()) throw Error('SMTP acceptance uncertain');
  }
}
