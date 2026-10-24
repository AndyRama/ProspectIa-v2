import { test } from "node:test";
import assert from "node:assert/strict";
import { inspectSite, analyze } from "../server/services/siteAnalyzer";
import { buildHermesHandoff } from "../server/services/handoffs/hermes";
import { defaultBusiness } from "../server/db";
import type { Prospect } from "../server/types";
test("Extraction de vrais éléments HTML et observations sans audit inventé", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      '<html><head><title>Atelier Test</title><meta name="viewport" content="width=device-width"><meta name="description" content="Notre activité publique"></head><body><h1>Bienvenue</h1><p>Nos horaires : du lundi au vendredi.</p><a href="mailto:bonjour@example.com">Email</a><a href="tel:+33123456789">Téléphone</a><a href="https://instagram.com/atelier">Instagram</a><img src="/logo.png" alt="logo"><p>© 2020</p><script>secret</script></body></html>',
      { headers: { "content-type": "text/html" } },
    );
  try {
    const result = await inspectSite("https://93.184.216.34");
    assert.equal(result.email, "bonjour@example.com");
    assert.equal(result.phone, "+33123456789");
    assert.equal(result.audit.responsive, true);
    assert.equal(result.audit.https, true);
    assert.equal(result.audit.copyright, "2020");
    assert.equal(result.socials.instagram, "https://instagram.com/atelier");
    assert.ok(
      result.audit.texts.includes("Nos horaires : du lundi au vendredi."),
    );
    assert.equal(result.audit.logo, "https://93.184.216.34/logo.png");
    assert.ok(!result.audit.texts.some((x) => x.includes("secret")));
  } finally {
    globalThis.fetch = original;
  }
});
test("Prompt Hermès : source de démonstration et règles de travail, sans faux prix", () => {
  const p = { name: "Restaurant fictif", category: "Restaurant", city: "Papeete", address: "", email: "", phone: "", website: "", fields: {}, socials: {}, demo: true } as unknown as Prospect;
  const handoff = buildHermesHandoff(p, defaultBusiness, "menu");
  assert.match(handoff.prompt, /DÉMONSTRATION FICTIVE/);
  assert.match(handoff.prompt, /N’invente aucun plat, tarif/);
  assert.match(handoff.prompt, /ATTENDS MON « OK »/);
  assert.equal((handoff.dossier.prospect as Prospect).website, "");
});

test("Collecte multi-page : contact sourcé sur sa page et contenus conservés dans le dossier Hermès", async () => {
  const original = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = async (raw: any) => {
    const pathname = new URL(raw).pathname;
    requested.push(pathname);
    const content = pathname === "/contact" ? '<h1>Contact</h1><a href="tel:+33123456789">Appeler</a>'
      : pathname === "/menu" ? '<h1>Notre menu</h1><p>Plat publié : 22 euros</p><a href="/carte.pdf">Carte PDF</a>'
      : '<h1>Restaurant test</h1><a href="/contact">Contact</a><a href="/menu">Menu</a><a href="/contact#adresse">Adresse</a><a href="https://outside.example/contact">Autre site</a><a href="/login">Connexion</a>';
    return new Response(`<html><head><title>${pathname}</title><meta name="viewport" content="width=device-width"></head><body>${content}</body></html>`, { headers: { "content-type": "text/html" } });
  };
  try {
    const p = { id: "fixture", name: "Restaurant test", website: "https://93.184.216.34", fields: {}, socials: {}, demo: false, phone: "", email: "", category: "Restaurant", city: "Test", address: "" } as Prospect;
    const result = await analyze(p);
    assert.deepEqual(requested.sort(), ["/", "/contact", "/menu"]);
    assert.equal(result.fields.phone.url, "https://93.184.216.34/contact");
    assert.equal(result.audit.pages?.length, 3);
    assert.equal(result.audit.logo, "");
    const handoff = buildHermesHandoff(result, defaultBusiness, "website");
    const dossier = JSON.stringify(handoff.dossier);
    assert.match(dossier, /Plat publié : 22 euros/);
    assert.match(dossier, /carte\.pdf/);
    assert.equal((handoff.dossier.prospect as Prospect).audit?.pages?.length, 3);
  } finally { globalThis.fetch = original; }
});
