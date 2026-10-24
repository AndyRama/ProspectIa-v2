const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 24 || (major === 24 && minor < 10)) {
  console.error(`ProspectAI nécessite Node.js 24.10 ou supérieur. Version détectée : ${process.version}.`);
  console.error("Installez Node.js 24 LTS, rouvrez le terminal, puis exécutez npm ci et npm run dev.");
  process.exit(1);
}
