import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { getSetting, setSetting } from "./db";
const file = path.join(
  process.env.DATA_DIR || path.resolve(".data"),
  "secret.key",
);
function key() {
  if (process.env.DATA_ENCRYPTION_KEY) {
    if (!/^[a-f0-9]{64}$/i.test(process.env.DATA_ENCRYPTION_KEY)) throw Error("DATA_ENCRYPTION_KEY doit contenir 64 caractères hexadécimaux.");
    return Buffer.from(process.env.DATA_ENCRYPTION_KEY, "hex");
  }
  if (process.env.VERCEL) throw Error("Vercel : DATA_ENCRYPTION_KEY est requise pour chiffrer les clés persistantes.");
  mkdirSync(path.dirname(file), { recursive: true });
  if (!existsSync(file))
    writeFileSync(file, randomBytes(32), { mode: 0o600, flag: "wx" });
  return readFileSync(file);
}
export async function saveSecret(name: "apifyKey", value: string) {
  if (!value) {
    await setSetting(name, null);
    return;
  }
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  await setSetting(name, {
    iv: iv.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
    data: encrypted.toString("hex"),
  });
}
export async function secret(name: "apifyKey") {
  const env = process.env.APIFY_TOKEN;
  if (env) return env;
  const item = await getSetting<any>(name, null);
  if (!item) return "";
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(item.iv, "hex"));
  d.setAuthTag(Buffer.from(item.tag, "hex"));
  return Buffer.concat([
    d.update(Buffer.from(item.data, "hex")),
    d.final(),
  ]).toString("utf8");
}
