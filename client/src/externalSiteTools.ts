/** Prepare navigation only: never fetch a site or provider here. */
export function externalSiteTools(website: string): { pagespeed: string; wappalyzer: string } | null {
  try {
    const raw = website.trim();
    if (!/^https?:\/\//i.test(raw) || /[\u0000-\u0020\u007f\\]/.test(raw)) return null;
    const site = new URL(raw);
    if (!['http:', 'https:'].includes(site.protocol) || site.username || site.password || (site.port && !['80', '443'].includes(site.port))) return null;
    // Conservative DNS-name-only navigation: IP literals (including alternate
    // IPv4 spellings normalized by URL), single-label and local/reserved names
    // never leave the CRM. This is syntax validation, not a DNS lookup.
    const hostname = site.hostname.replace(/\.$/, '');
    const labels = hostname.split('.');
    if (hostname.length > 253 || labels.length < 2 || !/[a-z]/i.test(labels.at(-1)!) ||
      labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)) ||
      /(?:^|\.)(?:localhost|local|internal|intranet|lan|home|corp|test|invalid|example|onion|arpa)$/.test(hostname) ||
      /(?:^|\.)(?:nip\.io|sslip\.io|localtest\.me|lvh\.me|vcap\.me)$/.test(hostname)) return null;
    site.hostname = hostname;
    site.search = '';
    site.hash = '';
    const params = new URLSearchParams({ url: site.href });
    return {
      pagespeed: `https://pagespeed.web.dev/analysis?${params}`,
      wappalyzer: `https://www.wappalyzer.com/lookup/${encodeURIComponent(site.hostname)}/`,
    };
  } catch {
    return null;
  }
}
