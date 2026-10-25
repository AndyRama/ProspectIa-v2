import * as cheerio from "cheerio";
import { resolveMx } from "node:dns/promises";
import { readPublic } from "./http";
import type { Audit, Prospect, Source, SitePage } from "../types";
export async function inspectSite(website: string, options: { signal?: AbortSignal } = {}) {
  const start = Date.now();
  // Only an explicit dotted host may receive an implicit HTTPS scheme.
  // Never repair credentials, backslashes, protocol-relative or non-HTTP URLs.
  const raw = website.trim();
  const normalized = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:[/?#][^\s\\]*)?$/i.test(raw)
    ? `https://${raw}` : raw;
  const { html, url } = await readPublic(normalized, options);
  const $ = cheerio.load(html);
  $("script,style,noscript,svg").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  const links = $("a[href]")
    .map((_, a) => $(a).attr("href") || "")
    .get();
  const email = (
    links
      .find((x) => x.startsWith("mailto:"))
      ?.slice(7)
      .split("?")[0] ||
    text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ||
    ""
  ).trim();
  const phone = links.find((x) => x.startsWith("tel:"))?.slice(4) || "";
  const socials: Record<string, string> = {};
  for (const platform of ["instagram", "facebook", "linkedin", "whatsapp"]) {
    const link = links.find((x) => {
      try {
        const h = new URL(x, url).hostname;
        return (
          h === `${platform}.com` ||
          h.endsWith(`.${platform}.com`) ||
          (platform === "whatsapp" && h === "wa.me")
        );
      } catch {
        return false;
      }
    });
    if (link) socials[platform] = new URL(link, url).href;
  }
  const copyright = text.match(/(?:©|copyright)\s*(\d{4})/i)?.[1] || null;
  const responsive = !!$('meta[name="viewport"]').attr("content");
  const technology = /wp-content/i.test(html)
    ? "WordPress"
    : /wixstatic|wix.com/i.test(html)
      ? "Wix"
      : /shopify/i.test(html)
        ? "Shopify"
        : "Non identifiée";
  const https = url.startsWith("https:");
  const elapsedMs = Date.now() - start;
  const observations = [
    https ? "Connexion HTTPS observée" : "Connexion HTTP observée",
    responsive ? "Balise viewport présente" : "Aucune balise viewport trouvée",
    `Temps de récupération : ${elapsedMs} ms (indicatif)`,
  ];
  if (copyright) observations.push(`Copyright affiché : ${copyright}`);
  const score =
    (https ? 0 : 25) +
    (responsive ? 0 : 40) +
    (copyright && Number(copyright) < new Date().getFullYear() - 3 ? 20 : 0) +
    (elapsedMs > 3000 ? 15 : 0);
  const absolute = (s: string) => {
    try {
      const u = new URL(s, url);
      return ["https:", "http:"].includes(u.protocol) ? u.href : "";
    } catch {
      return "";
    }
  };
  const audit: Audit = {
    checkedAt: new Date().toISOString(),
    https,
    responsive,
    copyright,
    technology,
    elapsedMs,
    score,
    observations,
    title: $("title").text().trim(),
    description: $('meta[name="description"]').attr("content") || "",
    texts: $("h1,h2,h3,p,li")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean),
    images: $("img[src]")
      .map((_, el) => absolute($(el).attr("src") || ""))
      .get()
      .filter(Boolean),
    logo: $('img[alt*="logo" i]').attr("src")
      ? absolute($('img[alt*="logo" i]').attr("src")!) : "",
    colors: [...new Set(html.match(/#[0-9a-f]{6}\b/gi) || [])].slice(0, 12),
    links: links.map(absolute).filter(Boolean),
  };
  return { audit, email, phone, socials, url };
}
/** Read a bounded snapshot of public HTML pages on the business's own site. */
export async function inspectBusinessSite(website: string) {
  const home = await inspectSite(website);
  const origin = new URL(home.url).origin;
  const seen = new Set([new URL(home.url).href.replace(/\/$/, "")]);
  const pages: SitePage[] = [];
  const warnings: string[] = [];
  const contacts: Record<string, Source> = {};
  const queue: string[] = [];
  const add = (data: Awaited<ReturnType<typeof inspectSite>>) => {
    pages.push({ url: data.url, title: data.audit.title, texts: data.audit.texts,
      images: data.audit.images, links: data.audit.links, collectedAt: data.audit.checkedAt });
    for (const [key, value] of Object.entries({ email: data.email, phone: data.phone, ...data.socials })) {
      if (value && !contacts[key]) contacts[key] = { value, source: "Site web", url: data.url,
        collectedAt: data.audit.checkedAt, qualification: "Trouvé sur le site · coordonnée publique, à confirmer" };
    }
    const candidates = data.audit.links.filter((link) => {
      const u = new URL(link);
      return u.origin === origin && !u.search && !/\.(pdf|jpe?g|png|webp|gif|zip|xml|svg)$/i.test(u.pathname)
        && !/logout|login|wp-admin|panier|checkout|cart/i.test(u.pathname);
    }).sort((a, b) => Number(/contact|menu|carte|service|prestation|about|propos/i.test(b))
      - Number(/contact|menu|carte|service|prestation|about|propos/i.test(a)));
    for (const link of candidates) {
      const u = new URL(link); u.hash = "";
      const key = u.href.replace(/\/$/, "");
      if (!seen.has(key)) { seen.add(key); queue.push(u.href); }
    }
  };
  add(home);
  const deadline = Date.now() + 35000;
  while (queue.length && pages.length < 8 && Date.now() < deadline) {
    const url = queue.shift()!;
    try {
      const data = await inspectSite(url);
      if (new URL(data.url).origin !== origin) {
        warnings.push(`Page redirigée hors du site, non conservée : ${url}`); continue;
      }
      add(data);
    } catch (e) { warnings.push(`${url} : ${(e as Error).message}`); }
  }
  if (queue.length) warnings.push("Collecte limitée à 8 pages et 35 secondes ; des pages peuvent manquer.");
  home.audit.pages = pages;
  home.audit.crawlWarnings = warnings;
  home.audit.texts = [...new Set(pages.flatMap((p) => p.texts))];
  home.audit.images = [...new Set(pages.flatMap((p) => p.images))];
  home.audit.links = [...new Set(pages.flatMap((p) => p.links))];
  return { ...home, contacts };
}
export async function analyze(p: Prospect) {
  if (p.demo)
    throw Error(
      "Les fiches fictives ne peuvent pas faire l’objet d’un audit réel.",
    );
  if (!p.website) throw Error("Aucun site renseigné pour ce prospect.");
  const data = await inspectBusinessSite(p.website);
  const fields = { ...p.fields };
  const now = new Date().toISOString();
  for (const [key, contact] of Object.entries(data.contacts)) {
    // Enrichment fills gaps; it must never replace a saved/user contact.
    const existing = key === "email" ? p.email : key === "phone" ? p.phone : p.socials[key];
    if (existing || fields[key]?.value) continue;
    const value = contact.value;
    if (value) {
      const field: Source = {
        value,
        source: "Site web",
        url: contact.url,
        collectedAt: contact.collectedAt || now,
        qualification: "Trouvé sur le site · coordonnée publique, à confirmer",
      };
      if (key === "email") {
        try {
          const mx = await resolveMx(value.split("@")[1]);
          field.qualification = mx.length
            ? "Domaine avec MX — boîte non vérifiée"
            : "Aucun MX trouvé — boîte non vérifiée";
        } catch {
          field.qualification = "MX non confirmé — boîte non vérifiée";
        }
      }
      fields[key] = field;
    }
  }
  return {
    ...p,
    audit: data.audit,
    email: p.email || fields.email?.value || "",
    phone: p.phone || fields.phone?.value || "",
    socials: Object.fromEntries([...new Set([...Object.keys(p.socials), ...Object.keys(data.contacts).filter(key => !["email", "phone"].includes(key))])]
      .map(key => [key, p.socials[key] || fields[key]?.value || data.contacts[key]?.value || ""])),
    fields,
    webStatus: data.audit.score >= 35 ? "À examiner" : "Site analysé",
  };
}
