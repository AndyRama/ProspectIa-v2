import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import type { Server } from "node:http";
import type { Prospect } from "../server/types";

const env = { ...process.env }, originalFetch = globalThis.fetch;
let base: string, dir: string, cookie: string, server: Server, store: typeof import("../server/db");
let externalCalls = 0;
const p: Prospect = { id: "email-edit-fixture", name: "Atelier correction", category: "Artisan", city: "Paris", address: "Adresse conservée", lat: null, lng: null, website: "https://atelier-correction.fr", email: "", phone: "0123456789", rating: null, reviews: null, selected: true, status: "En discussion", demo: false, webStatus: "Non vérifié", fields: { phone: { value: "0123456789", source: "Import", collectedAt: "2026-01-01T00:00:00.000Z" } }, socials: { instagram: "atelier" }, hours: "Sur rendez-vous", photos: [], engine: "website", identity: { placeId: "fixture-place", aliases: ["legacy-id"] } } as Prospect;
const patch = (body: unknown = { email: "bonjour@atelier-correction.fr" }, id = p.id, headers: Record<string, string> = { Cookie: cookie }) => originalFetch(base + `/api/prospects/${id}/email`, { method: "PATCH", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
const prompt = () => originalFetch(base + `/api/prospects/${p.id}/email-prompt`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ engine: "website" }) });
before(async () => {
  for (const key of Object.keys(process.env)) if (/TURSO|VERCEL|APIFY|SMTP|AI_API|APP_PASSWORD|PROSPECTIA_AGENT_TOKEN|DATA_ENCRYPTION|PROXY/i.test(key)) delete process.env[key];
  const scratch = process.env.TMPDIR || "/opt/data/cache/scratch"; await mkdir(scratch, { recursive: true }); dir = await mkdtemp(path.join(scratch, "prospectai-email-edit-"));
  process.env.DATA_DIR = dir; process.env.DOTENV_CONFIG_PATH = "/dev/null"; process.env.APP_PASSWORD = "fixture-only-password"; process.env.VERCEL = "1";
  const app = (await import("../server/index")).default; delete process.env.VERCEL; store = await import("../server/db");
  server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve)); base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  globalThis.fetch = async () => { externalCalls++; throw Error("External network forbidden"); };
  const login = await originalFetch(base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: process.env.APP_PASSWORD }) }); assert.equal(login.status, 200); cookie = login.headers.get("set-cookie")!.split(";")[0];
  await store.saveProspect(p);
});
after(async () => { globalThis.fetch = originalFetch; if (server) await new Promise<void>(resolve => server.close(() => resolve())); if (store) await store.db.close(); if (dir) await rm(dir, { recursive: true, force: true }); for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]; Object.assign(process.env, env); });

test("manual email correction preserves all other data, survives reopen and unlocks only eligible prompts without networking", async () => {
  assert.equal((await prompt()).status, 403);
  const tables = ["searches", "drafts", "handoffs", "deliverables", "mail_attempts"] as const;
  const before = await Promise.all(tables.map(t => store.list(t)));
  const response = await patch({ email: "  Bonjour@atelier-correction.fr  " }); assert.equal(response.status, 200);
  const saved = await response.json();
  assert.deepEqual(saved, { ...p, email: "Bonjour@atelier-correction.fr", fields: { ...p.fields, email: { value: "Bonjour@atelier-correction.fr", source: "Saisie utilisateur, non vérifiée", collectedAt: saved.fields.email.collectedAt } } });
  assert.ok(Number.isFinite(Date.parse(saved.fields.email.collectedAt)));
  assert.deepEqual(await Promise.all(tables.map(t => store.list(t))), before);
  await store.db.close(); assert.deepEqual(await store.prospect(p.id), saved);
  const state = await originalFetch(base + "/api/state", { headers: { Cookie: cookie } }); assert.equal(state.status, 200); assert.deepEqual((await state.json()).prospects.find((x: Prospect) => x.id === p.id), saved);
  assert.equal((await prompt()).status, 200);
  await store.saveProspect({ ...saved, doNotContact: true }); assert.equal((await prompt()).status, 403);
  assert.equal(externalCalls, 0);
});

test("email correction rejects archived, demo and opposed records and both old/new suppressed addresses without any changes", async () => {
  const target = "contact@atelier-correction.fr", previous = "ancien@atelier-correction.fr";
  const suppression = { sql: "INSERT OR IGNORE INTO suppressions(email,created_at) VALUES(?,?)", args: [target, "2026-01-01T00:00:00.000Z"] };
  for (const change of [{ archived: true }, { demo: true }, { doNotContact: true }]) {
    const blocked = { ...p, ...change }; await store.saveProspect(blocked);
    assert.equal((await patch({ email: target })).status, 403, JSON.stringify(change));
    assert.deepEqual(await store.prospect(p.id), blocked);
  }
  for (const suppressed of [target, previous]) {
    await store.saveProspect({ ...p, email: previous });
    await store.db.execute({ ...suppression, args: [suppressed, suppression.args[1]] });
    const before = await store.db.execute("SELECT * FROM suppressions");
    assert.equal((await patch({ email: "  " + target.toUpperCase() + "  " })).status, 403, suppressed);
    assert.deepEqual(await store.prospect(p.id), { ...p, email: previous });
    assert.deepEqual((await store.db.execute("SELECT * FROM suppressions")).rows, before.rows);
    await store.db.execute({ sql: "DELETE FROM suppressions WHERE email=?", args: [suppressed] });
  }
  assert.equal(externalCalls, 0);
});

test("email correction compare-and-set never silently overwrites concurrent record changes or deletions", async () => {
  for (const change of [{ archived: true }, { status: "Gagné" as const }, { doNotContact: true }, { demo: true }, { email: "autre@atelier.fr" }, { duplicateOf: "another-id" }, null]) {
    await store.saveProspect(p);
    const execute = store.db.execute;
    let intercepted = false;
    store.db.execute = async statement => {
      if (!intercepted && typeof statement !== "string" && statement.sql.startsWith("UPDATE prospects SET data=")) {
        intercepted = true;
        if (change) await execute({ sql: "UPDATE prospects SET data=? WHERE id=?", args: [JSON.stringify({ ...p, ...change }), p.id] });
        else await execute({ sql: "DELETE FROM prospects WHERE id=?", args: [p.id] });
      }
      return execute(statement);
    };
    try {
      assert.equal((await patch()).status, 409, JSON.stringify(change));
      assert.equal(intercepted, true);
      const row = (await execute({ sql: "SELECT data FROM prospects WHERE id=?", args: [p.id] })).rows[0];
      assert.deepEqual(row ? JSON.parse(String(row.data)) : null, change ? { ...p, ...change } : null);
    } finally { store.db.execute = execute; }
  }
});

test("email correction atomically refuses suppression added after preflight for either old or new email", async () => {
  const old = "ancien@atelier-correction.fr", target = "bonjour@atelier-correction.fr";
  for (const email of [old, target]) {
    const current = { ...p, email: old }; await store.saveProspect(current);
    const execute = store.db.execute;
    let intercepted = false;
    store.db.execute = async statement => {
      if (!intercepted && typeof statement !== "string" && statement.sql.startsWith("UPDATE prospects SET data=")) {
        intercepted = true;
        await execute({ sql: "INSERT INTO suppressions(email,created_at) VALUES(?,?)", args: [email, "2026-01-01T00:00:00.000Z"] });
      }
      return execute(statement);
    };
    try {
      assert.equal((await patch()).status, 403, email);
      assert.equal(intercepted, true);
      assert.deepEqual(await store.prospect(p.id), current);
      assert.equal((await prompt()).status, email === old ? 403 : 200);
    } finally { store.db.execute = execute; await execute({ sql: "DELETE FROM suppressions WHERE email=?", args: [email] }); }
  }
  assert.equal(externalCalls, 0);
});

test("email correction enforces auth, origin, exact body and shared real-recipient validation", async () => {
  await store.saveProspect(p);
  assert.equal((await patch(undefined, p.id, {})).status, 401);
  assert.equal((await patch(undefined, p.id, { Cookie: cookie, Origin: "https://evil.invalid" })).status, 403);
  assert.equal((await patch(undefined, "missing")).status, 404);
  assert.equal((await patch(undefined, "bad.id")).status, 400);
  for (const body of [null, [], {}, { email: null }, { email: 42 }, { email: "contact@atelier.fr", doNotContact: false }, { email: "contact@atelier.fr", status: "Gagné" }, { email: "contact@atelier.fr", archived: false }, { email: "contact@atelier.fr", send: true }]) {
    assert.equal((await patch(body)).status, body === null ? 422 : 400, JSON.stringify(body));
    assert.deepEqual(await store.prospect(p.id), p);
  }
  const { validProspectEmail, emailPromptEligible } = await import("../server/services/generators/emailEligibility");
  const invalid = ["", "   ", "bad", "Name <contact@atelier.fr>", "a@localhost", "a@demo.test", "a@sub.example.com", "a@example.org", "a@host.invalid", "a@host.local", ".a@atelier.fr", "a..b@atelier.fr", "a.@atelier.fr", "a@-atelier.fr", "a@atelier-.fr", "a@atelier.fr\r\nBcc:b@atelier.fr", "a".repeat(65) + "@atelier.fr", "a@" + "b".repeat(64) + ".fr", "a".repeat(64) + "@" + ["b".repeat(63), "c".repeat(63), "d".repeat(63), "fr"].join(".")];
  for (const email of invalid) {
    assert.equal(validProspectEmail(email), false, email);
    assert.equal(emailPromptEligible({ ...p, email }), false, email);
    assert.equal((await patch({ email })).status, 400, email);
    assert.deepEqual(await store.prospect(p.id), p);
  }
  for (const email of ["contact@atelier.fr\n", "contact@atelier.fr\r", " contact@atelier.fr"]) {
    assert.equal(validProspectEmail(email), false, "Stored recipients must not contain whitespace");
    assert.equal(emailPromptEligible({ ...p, email }), false);
  }
  const boundary = "a".repeat(64) + "@" + ["b".repeat(63), "c".repeat(63), "d".repeat(58), "fr"].join(".");
  assert.equal(boundary.length, 254);
  assert.equal(validProspectEmail(boundary.replace(".fr", "d.fr")), false);
  assert.equal((await patch({ email: boundary.replace(".fr", "d.fr") })).status, 400);
  for (const email of ["a+b@atelier.fr", "prenom.nom@sub.atelier.fr", boundary]) {
    assert.equal(validProspectEmail(email), true, email);
    assert.equal((await patch({ email })).status, 200, email);
  }
  assert.equal(externalCalls, 0);
});
