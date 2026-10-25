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
/** Bound even DNS (lookup itself is not cancellable); late results cannot fetch. */
async function abortable<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal.reason); };
    const cleanup = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    work.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}
export async function readPublic(raw: string, options: { signal?: AbortSignal } = {}) {
  let url = raw;
  for (let n = 0; n < 5; n++) {
    const signal = options.signal || AbortSignal.timeout(15000);
    signal.throwIfAborted();
    const u = await abortable(publicUrl(url), signal);
    signal.throwIfAborted();
    const r = await abortable(fetch(u, {
      redirect: "manual",
      signal,
      headers: {
        "User-Agent":
          "ProspectAI/1.0 (public business research; local application)",
        Accept: "text/html",
      },
    }).then(response => {
      if (signal.aborted) { void response.body?.cancel().catch(() => {}); signal.throwIfAborted(); }
      return response;
    }), signal);
    if ([301, 302, 303, 307, 308].includes(r.status)) {
      void r.body?.cancel().catch(() => {});
      const l = r.headers.get("location");
      if (!l) throw Error("Redirection invalide.");
      url = new URL(l, u).href;
      continue;
    }
    if (!r.ok || !r.headers.get("content-type")?.includes("text/html")) {
      void r.body?.cancel().catch(() => {});
      if (!r.ok) throw Error(`Le site a répondu HTTP ${r.status}.`);
      throw Error("Cette URL ne renvoie pas une page HTML.");
    }
    const reader = r.body!.getReader();
    const cancel = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener("abort", cancel, { once: true });
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const { done, value } = await abortable(reader.read(), signal);
        signal.throwIfAborted();
        if (done) break;
        bytes += value.length;
        if (bytes > 2_000_000) {
          cancel();
          throw Error("Page trop volumineuse (maximum 2 Mo).");
        }
        chunks.push(value);
      }
      return { html: Buffer.concat(chunks).toString("utf8"), url: u.href };
    } finally {
      signal.removeEventListener("abort", cancel);
      reader.releaseLock();
    }
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
