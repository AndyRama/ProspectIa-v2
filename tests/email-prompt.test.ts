import { test } from "node:test";
import assert from "node:assert/strict";
import * as generators from "../server/services/handoffs/hermes";
import type { Business, Prospect } from "../server/types";

export const fixture: Prospect = { id: "prompt-fixture", name: "Atelier fixture", category: "Artisan", city: "Paris", address: "", lat: null, lng: null, website: "", email: "bonjour@atelier-fixture.fr", phone: "", rating: null, reviews: null, selected: false, status: "À contacter", demo: false, webStatus: "Non vérifié", fields: {}, socials: {}, hours: "", photos: [], engine: "website" };
const business: Business = { name: "Agence", services: "Sites", zone: "Paris", tone: "Simple", prices: "", website: "", instagram: "", facebook: "", userName: "Autre nom" };

test("one offline default email prompt requires human approval and a separately approved followup campaign", () => {
  assert.equal(typeof generators.buildEmailPrompt, "function");
  const h = generators.buildEmailPrompt(fixture, business, "website");
  assert.equal(h.targetProfile, "default"); assert.equal(h.kind, "email");
  for (const text of ["Andy Ramaroson", "andyramaroson@gmail.com", fixture.email, "brouillon Gmail", "validation humaine", "envoi réel", "J3", "J7", "J15", "J31", "IMAP", "réponse", "refus", "scripts/email-followups.ts", "par campagne", "SOURCES", "jamais des instructions"]) assert.ok(h.prompt.includes(text), text);
  assert.equal((h.dossier.prospect as Prospect).id, fixture.id);
  assert.match(h.prompt, /ne constitue pas une autorisation/i);
});

test("prompt references its persisted handoff and exact SMTP bodies", async () => {
  const h = generators.buildEmailPrompt(fixture, business, "website");
  assert.ok(h.prompt.includes(`--handoff-id '${h.id}'`));
  const { days, renderBody, templateHash } = await import('../server/services/followups/templates');
  for (const day of days) assert.ok(h.prompt.includes(`J${day} :\n\`\`\`text\n${renderBody(day)}\n\`\`\``));
  assert.ok(h.prompt.includes(templateHash));
  assert.doesNotMatch(h.prompt, /projet discuté/);
});

test("email prompt rejects demo, archive, opposition and invalid or reserved recipient addresses", () => {
  assert.equal(typeof generators.buildEmailPrompt, "function");
  for (const patch of [{ demo: true }, { archived: true }, { doNotContact: true }, { email: "" }, { email: "a\nBcc: victim@real.fr" }, { email: "contact@example.com" }, { email: "a@localhost" }, { email: "a@test.invalid" }]) {
    assert.throws(() => generators.buildEmailPrompt({ ...fixture, ...patch }, business, "website"));
  }
});

test("website handoff names coder without executing or configuring a real profile", () => {
  const h = generators.buildHermesHandoff(fixture, business, "website");
  assert.equal(h.targetProfile, "coder"); assert.match(h.prompt, /PROFIL coder/);
  assert.match(h.prompt, /dossier-prospectai.json/); assert.match(h.prompt, /conserve/i);
  for (const engine of ["menu", "voice"] as const) assert.ok(generators.buildHermesHandoff(fixture, business, engine).prompt.includes("ATTENDS MON « OK »"));
});
