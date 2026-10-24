import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Express, Request } from "express";
import { db } from "./db";

const cookieName = "prospectai_session";
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const sessionHash = (s: string) => digest(s + (process.env.APP_PASSWORD || ""));
export const authRequired = () => !!process.env.APP_PASSWORD || !!process.env.VERCEL;
export function validateHosting() {
  if (authRequired() && (process.env.APP_PASSWORD || "").length < 16)
    throw Error("APP_PASSWORD doit contenir au moins 16 caractères pour protéger cet espace.");
  if (process.env.VERCEL && !/^[a-f0-9]{64}$/i.test(process.env.DATA_ENCRYPTION_KEY || ""))
    throw Error("Vercel : configurez DATA_ENCRYPTION_KEY avec 64 caractères hexadécimaux.");
}
function token(req: Request) {
  return req.headers.cookie?.split(";").map((s) => s.trim()).find((s) => s.startsWith(cookieName + "="))?.slice(cookieName.length + 1) || "";
}
async function authenticated(req: Request) {
  if (!authRequired()) return true;
  const raw = token(req);
  if (!/^[a-f0-9]{64}$/.test(raw)) return false;
  const row = (await db.execute({ sql: "SELECT expires_at FROM sessions WHERE hash=?", args: [sessionHash(raw)] })).rows[0];
  return !!row && Number(row.expires_at) > Date.now();
}
export function mountAuth(app: Express) {
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.get("/api/auth/status", async (req, res) => {
    validateHosting();
    res.json({ required: authRequired(), authenticated: await authenticated(req) });
  });
  app.post("/api/auth/login", async (req, res) => {
    validateHosting();
    if (!authRequired()) return res.json({ ok: true });
    const now = Date.now(), key = digest((req.ip || "local") + ":" + Math.floor(now / 900000));
    const result = await db.execute({ sql: "INSERT INTO login_limits(key,attempts,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1 RETURNING attempts", args: [key, now + 900000] });
    if (Number(result.rows[0].attempts) > 10) return res.status(429).json({ error: "Trop de tentatives. Réessayez dans 15 minutes." });
    const provided = typeof req.body.password === "string" && req.body.password.length <= 300 ? req.body.password : "";
    if (!timingSafeEqual(Buffer.from(digest(provided)), Buffer.from(digest(process.env.APP_PASSWORD || ""))))
      return res.status(401).json({ error: "Mot de passe incorrect." });
    const raw = randomBytes(32).toString("hex"), expires = now + 12 * 3600000;
    await db.batch([
      { sql: "DELETE FROM sessions WHERE expires_at<?", args: [now] },
      { sql: "DELETE FROM login_limits WHERE expires_at<?", args: [now] },
      { sql: "INSERT INTO sessions VALUES(?,?)", args: [sessionHash(raw), expires] },
    ]);
    res.cookie(cookieName, raw, { httpOnly: true, secure: !!process.env.VERCEL || process.env.APP_URL?.startsWith("https:"), sameSite: "strict", maxAge: 12 * 3600000, path: "/" });
    res.json({ ok: true });
  });
  app.post("/api/auth/logout", async (req, res) => {
    const raw = token(req);
    if (raw) await db.execute({ sql: "DELETE FROM sessions WHERE hash=?", args: [sessionHash(raw)] });
    res.clearCookie(cookieName, { httpOnly: true, secure: !!process.env.VERCEL || process.env.APP_URL?.startsWith("https:"), sameSite: "strict", path: "/" });
    res.json({ ok: true });
  });
  app.use("/api", async (req, res, next) => {
    validateHosting();
    if (!await authenticated(req)) return res.status(401).json({ error: "Connexion requise. Reconnectez-vous à votre espace." });
    next();
  });
}
