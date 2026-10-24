import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("Configuration invalide : API joignable, erreur explicite et accès aux données bloqué", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "prospectai-startup-"));
  const proc = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    env: { ...process.env, VERCEL: "", PORT: "3212", DATA_DIR: dir, APP_PASSWORD: "court", TURSO_DATABASE_URL: "", TURSO_AUTH_TOKEN: "", EMAIL_ENABLED: "false" }, stdio: "pipe",
  });
  let logs = "";
  proc.stdout.on("data", (b) => { logs += b; }); proc.stderr.on("data", (b) => { logs += b; });
  const base = "http://127.0.0.1:3212/api";
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(base + "/health")).ok) { ready = true; break; } } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(ready, true, "Le serveur doit répondre même si APP_PASSWORD est trop court.");
    const status = await fetch(base + "/auth/status"); assert.equal(status.status, 422);
    assert.match((await status.json()).error, /APP_PASSWORD.*16 caractères/);
    const data = await fetch(base + "/state"); assert.equal(data.status, 422);
    assert.equal(proc.exitCode, null); assert.match(logs, /Configuration à corriger/);
  } finally {
    proc.kill(); await new Promise((resolve) => proc.once("exit", resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
