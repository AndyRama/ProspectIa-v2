import { cpSync, mkdirSync, rmSync } from "node:fs";
// public/ est généré exclusivement par ce script (voir .gitignore).
rmSync("public", { recursive: true, force: true });
mkdirSync("public", { recursive: true });
cpSync("dist", "public", { recursive: true });
console.log("Frontend Vite préparé dans public/ pour les ressources statiques Vercel.");
