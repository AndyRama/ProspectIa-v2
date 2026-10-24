import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("Espace privé : cookie opaque, protection API, révocation et limite de tentatives persistante", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "prospectai-auth-"));
  process.env.DATA_DIR = dir; process.env.APP_PASSWORD = "fixture-password-long-enough"; process.env.TURSO_DATABASE_URL = "";
  const { db } = await import("../server/db");
  const { mountAuth, validateHosting } = await import("../server/auth");
  validateHosting();
  const app = express(); app.use(express.json()); mountAuth(app);
  app.get("/api/private", (_req, res) => res.json({ private: true }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as { port: number }, base = `http://127.0.0.1:${address.port}`;
  const login = (password: string) => fetch(base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
  try {
    assert.equal((await fetch(base + "/api/private")).status, 401);
    assert.equal((await login("wrong")).status, 401);
    const ok = await login(process.env.APP_PASSWORD); assert.equal(ok.status, 200);
    const setCookie = ok.headers.get("set-cookie")!; assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /SameSite=Strict/);
    const cookie = setCookie.split(";")[0];
    assert.equal((await fetch(base + "/api/private", { headers: { Cookie: cookie } })).status, 200);
    const rows = (await db.execute("SELECT hash FROM sessions")).rows;
    assert.ok(!JSON.stringify(rows).includes(cookie.split("=")[1]));
    await fetch(base + "/api/auth/logout", { method: "POST", headers: { Cookie: cookie } });
    assert.equal((await fetch(base + "/api/private", { headers: { Cookie: cookie } })).status, 401);
    for (let i = 0; i < 9; i++) await login("wrong");
    assert.equal((await login("wrong")).status, 429);
    await db.close();
    assert.equal((await login("wrong")).status, 429);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); await db.close(); await rm(dir, { recursive: true, force: true }); }
});
