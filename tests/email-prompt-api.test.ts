import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import path from "node:path";
import type { Server } from "node:http";
import type { Prospect } from "../server/types";

const env = { ...process.env }, originalFetch = globalThis.fetch;
let base: string, dir: string, cookie: string, server: Server, store: typeof import("../server/db");
let externalCalls = 0;
const p: Prospect = { id: "email-prompt-fixture", name: "Atelier fixture", category: "Artisan", city: "Paris", address: "", lat: null, lng: null, website: "https://atelier-fixture.fr", email: "bonjour@atelier-fixture.fr", phone: "", rating: null, reviews: null, selected: false, status: "À contacter", demo: false, webStatus: "Non vérifié", fields: {}, socials: {}, hours: "", photos: [], engine: "website" };
const post = (id = p.id, body: unknown = { engine: "website" }, headers: Record<string, string> = { Cookie: cookie }) => originalFetch(base + `/api/prospects/${id}/email-prompt`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
before(async () => {
  for (const key of Object.keys(process.env)) if (/TURSO|VERCEL|APIFY|SMTP|AI_API|APP_PASSWORD|PROSPECTIA_AGENT_TOKEN|DATA_ENCRYPTION|PROXY/i.test(key)) delete process.env[key];
  const scratch = process.env.TMPDIR || "/opt/data/cache/scratch"; await mkdir(scratch, { recursive: true }); dir = await mkdtemp(path.join(scratch, "prospectai-email-prompt-"));
  process.env.DATA_DIR = dir; process.env.DOTENV_CONFIG_PATH = path.join(dir, "absent.env"); process.env.APP_PASSWORD = "fixture-only-password"; process.env.VERCEL = "1";
  const app = (await import("../server/index")).default; delete process.env.VERCEL; store = await import("../server/db");
  server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve)); base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  globalThis.fetch = async () => { externalCalls++; throw Error("No external network allowed"); };
  const login = await originalFetch(base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: process.env.APP_PASSWORD }) }); assert.equal(login.status, 200); cookie = login.headers.get("set-cookie")!.split(";")[0];
  await store.saveProspect(p);
});
after(async () => { globalThis.fetch = originalFetch; if (server) await new Promise<void>(resolve => server.close(() => resolve())); if (store) await store.db.close(); if (dir) await rm(dir, { recursive: true, force: true }); for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]; Object.assign(process.env, env); });

test("dedicated route persists exactly one exportable prompt, no drafts and no networking", async () => {
  const oldDraft = { id: "old", prospectId: p.id, prospectName: p.name, variant: "historique", subject: "Ancien", body: "À conserver", createdAt: new Date().toISOString() }; await store.saveDraft(oldDraft);
  const before = await store.list("drafts"); const handoffs = await store.list("handoffs");
  const response = await post(); assert.equal(response.status, 200); const h = await response.json(); assert.equal(h.targetProfile, "default"); assert.equal(h.kind, "email"); assert.equal(h.drafts, undefined);
  assert.deepEqual(await store.list("drafts"), before); assert.equal((await store.list("handoffs")).length, handoffs.length + 1);
  const read = await originalFetch(base + `/api/handoffs/${h.id}`, { headers: { Cookie: cookie } }); assert.equal((await read.json()).prompt, h.prompt);
  const exported = await originalFetch(base + `/api/handoffs/${h.id}/export`, { headers: { Cookie: cookie } }); assert.equal(await exported.text(), h.prompt);
  const dossier = await originalFetch(base + `/api/handoffs/${h.id}/export?format=dossier`, { headers: { Cookie: cookie } }); assert.equal((await dossier.json()).prospect.email, p.email);
  assert.equal(externalCalls, 0);
});
test("email prompt refuses archiving during eligibility lookup without storing new work", async () => {
  await store.saveProspect(p); const before = await store.list("handoffs"); const execute = store.db.execute;
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  store.db.execute = async statement => {
    if (typeof statement !== "string" && statement.sql === "SELECT 1 FROM suppressions WHERE email=?") { entered(); await gate; }
    return execute(statement);
  };
  try {
    const pending = post(); await started; await store.saveProspect({ ...p, archived: true }); release();
    assert.equal((await pending).status, 403); assert.deepEqual(await store.list("handoffs"), before);
  } finally { release(); store.db.execute = execute; await store.saveProspect(p); }
});

test("dedicated route enforces authentication, origin, strict inputs and recipient eligibility", async () => {
  assert.equal((await post(p.id, { engine: "website" }, {})).status, 401);
  assert.equal((await post(p.id, { engine: "website" }, { Cookie: cookie, Origin: "https://evil.invalid" })).status, 403);
  assert.equal((await post("absent")).status, 404);
  for (const body of [{ engine: "website", send: true }, { engine: "other" }]) assert.equal((await post(p.id, body)).status, 400);
  const before = await store.list("handoffs");
  for (const patch of [{ archived: true }, { doNotContact: true }, { demo: true }, { email: "bad" }, { email: "contact@example.com" }]) {
    await store.saveProspect({ ...p, ...patch }); assert.equal((await post()).status, 403, JSON.stringify(patch));
  }
  assert.deepEqual(await store.list("handoffs"), before); await store.saveProspect(p);
  await store.db.execute({ sql: "INSERT INTO suppressions(email,created_at) VALUES(?,?)", args: [p.email.toLowerCase(), new Date().toISOString()] });
  assert.equal((await post()).status, 403, "email suppression applies across prospects");
  await store.db.execute({ sql: "DELETE FROM suppressions WHERE email=?", args: [p.email.toLowerCase()] });
  assert.equal(externalCalls, 0);
});
