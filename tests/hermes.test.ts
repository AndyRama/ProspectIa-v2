import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHermesHandoff } from "../server/services/handoffs/hermes";
import { generateDrafts } from "../server/services/generators";
import type { Audit, Business, Prospect } from "../server/types";

test("Transfert Hermès : dossier complet, étapes validées, opposition respectée et aucun accès externe", async () => {
  const original = globalThis.fetch;
  const old = { smtp: process.env.SMTP_PASS, vercel: process.env.VERCEL_TOKEN, ai: process.env.AI_API_KEY };
  process.env.SMTP_PASS = "fixture-smtp-secret"; process.env.VERCEL_TOKEN = "fixture-vercel-secret"; process.env.AI_API_KEY = "fixture-ai-secret";
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw Error("Aucun fournisseur ne doit être appelé."); };
  try {
    const fullText = "Contenu source à conserver. ".repeat(500);
    const audit: Audit = { https: true, responsive: true, copyright: null, elapsedMs: 10, score: 50, title: "Restaurant de test", description: "", checkedAt: "2026-10-20T10:00:00Z", observations: ["Balise viewport présente"], technology: "Non identifiée", texts: [fullText], images: ["https://example.com/image.jpg"], colors: ["#123456"], logo: "https://example.com/logo.png", links: ["https://example.com/carte.pdf"], pages: [{ url: "https://example.com/menu", title: "Carte publiée", texts: [fullText], images: [], links: [], collectedAt: "2026-10-20T10:00:00Z" }], crawlWarnings: ["Une page inaccessible"] };
    const p: Prospect = { lat: null, lng: null, rating: null, reviews: null, selected: false, status: "À contacter", webStatus: "Site existant", hours: "", photos: [], engine: "website", id: "fixture", name: "Restaurant de test", category: "Restaurant", city: "Paris", address: "", website: "https://example.com", email: "contact@example.com", phone: "", fields: { email: { value: "contact@example.com", source: "Site web", url: "https://example.com/contact", collectedAt: "2026-10-20T10:00:00Z" } }, socials: {}, doNotContact: true, audit, demo: false };
    const business: Business = { name: "Mon agence", services: "Création de sites", userName: "Mon nom", tone: "Simple", zone: "Paris", prices: "Sur devis", website: "", instagram: "", facebook: "", hermesInstructions: "Utilise mes couleurs de marque après validation." };
    const h = buildHermesHandoff(p, business, "website");
    assert.match(h.prompt, /ATTENDS MON « OK »/); assert.match(h.prompt, /NE PLUS CONTACTER/);
    assert.match(h.prompt, /maximum trois questions/); assert.match(h.prompt, /deux essais sérieux/);
    assert.match(h.prompt, /Ne dépense pas d’argent/); assert.match(h.prompt, /aucun email et ne publie rien sans mon accord/);
    assert.match(h.prompt, /dossier-prospectai.json/); assert.match(h.prompt, /Utilise mes couleurs/);
    assert.ok(h.prompt.length < fullText.length + 12000);
    const dossier = h.dossier.prospect as Prospect;
    assert.equal(dossier.audit?.texts[0], fullText); assert.equal(dossier.audit?.pages?.[0].texts[0], fullText);
    assert.equal(dossier.fields.email.url, "https://example.com/contact"); assert.deepEqual(h.warnings, ["Une page inaccessible"]);
    const serialized = JSON.stringify(h);
    for (const secret of ["fixture-smtp-secret", "fixture-vercel-secret", "fixture-ai-secret"]) assert.ok(!serialized.includes(secret));
    assert.equal((await generateDrafts(p, business, "website")).length, 3); assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
    for (const [key, value] of [["SMTP_PASS", old.smtp], ["VERCEL_TOKEN", old.vercel], ["AI_API_KEY", old.ai]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
