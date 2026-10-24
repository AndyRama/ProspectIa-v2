import "dotenv/config";
import { db } from "../server/db";
import { secret } from "../server/secrets";
import { validateHosting } from "../server/auth";
import { verifyApify } from "../server/services/apify";

let failed = false;
async function check(label: string, run: () => Promise<unknown>) {
  try { await run(); console.log(`OK · ${label}`); }
  catch (e) { failed = true; console.log(`À vérifier · ${label} : ${(e as Error).message}`); }
}
await check("Protection de l’espace", async () => validateHosting());
await check("Base de données persistante", async () => db.execute("SELECT 1"));
await check("Apify (sans collecte payante)", async () => verifyApify(await secret("apifyKey")));
console.log("Aucune collecte, aucune requête IA et aucun email de prospection déclenchés.");
await db.close();
process.exitCode = failed ? 1 : 0;
