import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { parse } from "dotenv";

const template = readFileSync(".env.example", "utf8");
let text = existsSync(".env") ? readFileSync(".env", "utf8") : template;
const current = parse(text), defaults = parse(template);
for (const [key, value] of Object.entries(defaults)) {
  if (!(key in current)) text += `\n${key}=${value}`;
}
const final = parse(text);
const set = (key, value) => { text = text.replace(new RegExp(`^${key}=.*$`, "m"), `${key}=${value}`); };
if (!final.APP_PASSWORD) set("APP_PASSWORD", randomBytes(24).toString("base64url"));
if (!final.DATA_ENCRYPTION_KEY) {
  const oldKey = path.join(final.DATA_DIR || ".data", "secret.key");
  set("DATA_ENCRYPTION_KEY", existsSync(oldKey) ? readFileSync(oldKey).toString("hex") : randomBytes(32).toString("hex"));
}
writeFileSync(".env", text.trimEnd() + "\n", { mode: 0o600 });
chmodSync(".env", 0o600);
console.log(".env préparé. Les valeurs existantes sont conservées ; les secrets générés restent dans ce fichier.");
console.log("Facultatif : renseigner APIFY_TOKEN pour la collecte payante. Les prompts Hermès ne demandent aucune clé API IA.");
console.log("Hébergement Vercel facultatif : TURSO_DATABASE_URL, TURSO_AUTH_TOKEN et APP_URL. Aucun accès à un compte Vercel n’est demandé par l’application. Ne jamais publier .env dans Git.");
