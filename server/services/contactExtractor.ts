import * as cheerio from 'cheerio';
import { validProspectEmail } from './generators/emailEligibility';

/** Syntax/policy validation plus rejection of asset-like false positives. No inference. */
export function publicContactEmail(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  const email = value.trim();
  if (!validProspectEmail(email) || /\.(?:png|jpe?g|gif|webp|svg|ico|css|js|mjs|map|woff2?|ttf|eot|pdf|zip|mp4|webm)$/i.test(email)) return;
  // Validate before case folding: Unicode such as K must not become ASCII k.
  return email.toLowerCase();
}

export function extractContactEmails(html: string): string[] {
  const $ = cheerio.load(html);
  $('script,style,noscript,svg,template').remove();
  const found = new Set<string>();
  const add = (value: string) => { const email = publicContactEmail(value); if (email) found.add(email); };
  $('a[href]').each((_, el) => {
    const href = ($(el).attr('href') || '').trim();
    if (!/^mailto:/i.test(href)) return;
    try { decodeURIComponent(href.slice(7).split('?')[0]).split(/[,;]/).forEach(add); } catch { /* malformed percent encoding is not evidence */ }
  });
  // Preserve element boundaries, including inline labels: .text() otherwise
  // invents addresses by concatenating unrelated adjacent text. Only explicit
  // [at]/[dot] obfuscation below may join across these boundaries.
  $('body *').before(' ').after(' ');
  const text = $('body').text().replace(/\s*\[at\]\s*/gi, '@').replace(/\s*\[dot\]\s*/gi, '.');
  // Tokenize broadly before applying the shared ASCII-only policy. Matching
  // only supported syntax would turn équipe@atelier.fr or a domain suffix
  // into a different, seemingly valid address. Unicode email-like characters
  // and domain continuations belong to the same token and must fail whole.
  for (const match of text.matchAll(/[\p{L}\p{M}\p{N}\p{S}\p{Cf}\p{Pc}\p{Pd}.!#$%&'*+/=?^_`{|}~@\u3002\uff0e\uff61\uff20-]+/gu)) {
    // Sentence punctuation is not domain content; never trim a hyphen,
    // Unicode character or repeated dots to salvage an unsupported address.
    const token = match[0].replace(/[!?]+$/, '').replace(/(?<!\.)\.$/, '');
    if (token.includes('@')) add(token);
  }
  return [...found];
}
