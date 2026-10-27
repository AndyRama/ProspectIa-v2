// Frontend-only: only persisted, proven identity fields; never infer from an internal ID.
type Identity = { name: string; fields: Record<string, { value: string }> };
const placePattern = /^(ChIJ|GhIJ)[A-Za-z0-9_-]{23}$/;
const cidPattern = /^\d+$/;
export function safeGoogleBusinessUrl(prospect: Identity): string | undefined {
  const value = prospect.fields.googleMaps?.value;
  if (value) {
    try {
      const url = new URL(value);
      const googleHost = /^(?:(?:www|maps)\.)?google\.(?:com|fr|co\.uk|de|es|it|be|ch|ca|com\.au|co\.nz)$/;
      const place = url.searchParams.get('query_place_id') || '';
      const cid = url.searchParams.get('cid') || '';
      if (/^https?:$/.test(url.protocol) && !url.username && !url.password && !url.port && googleHost.test(url.hostname) &&
          /^\/maps(?:\/|$)/.test(url.pathname) &&
          (/^\/maps\/place\/[^/]+/.test(url.pathname) || placePattern.test(place) || cidPattern.test(cid))) return url.href;
    } catch { /* An unsafe/malformed URL does not prevent a proven identity fallback. */ }
  }
  const placeId = prospect.fields.placeId?.value;
  if (placeId && placePattern.test(placeId)) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(prospect.name)}&query_place_id=${placeId}`;
  const cid = prospect.fields.cid?.value;
  if (cid && cidPattern.test(cid)) return `https://www.google.com/maps?cid=${cid}`;
}
