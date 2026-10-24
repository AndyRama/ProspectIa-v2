import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
export function isPublicAddress(ip: string) {
  if (ip.includes(":"))
    return !(/^(::|fc|fd|fe[89ab]|ff)/i.test(ip) || ip.includes("::ffff:"));
  const a = ip.split(".").map(Number);
  return !(
    a[0] === 0 ||
    a[0] === 10 ||
    a[0] === 127 ||
    a[0] >= 224 ||
    (a[0] === 169 && a[1] === 254) ||
    (a[0] === 172 && a[1] >= 16 && a[1] <= 31) ||
    (a[0] === 192 && a[1] === 168) ||
    (a[0] === 100 && a[1] >= 64 && a[1] <= 127) ||
    (a[0] === 198 && [18, 19].includes(a[1]))
  );
}
export async function publicUrl(raw: string) {
  const u = new URL(raw);
  if (
    !["https:", "http:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    (u.port && !["80", "443"].includes(u.port))
  )
    throw Error("URL publique HTTP(S) requise.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const ips = isIP(host)
    ? [{ address: host }]
    : await lookup(host, { all: true });
  if (!ips.length || ips.some((x) => !isPublicAddress(x.address)))
    throw Error("Les adresses locales ou privées ne sont pas autorisées.");
  return u;
}
export async function readPublic(raw: string) {
  let url = raw;
  for (let n = 0; n < 5; n++) {
    const u = await publicUrl(url);
    const r = await fetch(u, {
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
      headers: {
        "User-Agent":
          "ProspectAI/1.0 (public business research; local application)",
        Accept: "text/html",
      },
    });
    if ([301, 302, 303, 307, 308].includes(r.status)) {
      const l = r.headers.get("location");
      if (!l) throw Error("Redirection invalide.");
      url = new URL(l, u).href;
      continue;
    }
    if (!r.ok) throw Error(`Le site a répondu HTTP ${r.status}.`);
    if (!r.headers.get("content-type")?.includes("text/html"))
      throw Error("Cette URL ne renvoie pas une page HTML.");
    const reader = r.body!.getReader();
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 2_000_000) {
        await reader.cancel();
        throw Error("Page trop volumineuse (maximum 2 Mo).");
      }
      chunks.push(value);
    }
    return { html: Buffer.concat(chunks).toString("utf8"), url: u.href };
  }
  throw Error("Trop de redirections.");
}
export async function jsonRequest(url: string, init?: RequestInit) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(30000) });
  if (!r.ok)
    throw Error(
      `${new URL(url).hostname} : service indisponible (HTTP ${r.status}).`,
    );
  return r.json();
}
