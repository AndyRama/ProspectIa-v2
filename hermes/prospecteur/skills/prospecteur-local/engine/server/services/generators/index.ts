import type { Business, Engine, Prospect, Draft } from "../../types";
import { randomUUID } from "node:crypto";
export const engines: Record<
  Engine,
  { name: string; offer: string; criteria: (p: Prospect) => boolean }
> = {
  website: {
    name: "Création / refonte de site",
    offer: "un site clair, moderne et adapté au mobile",
    criteria: (p) => !p.website || (!!p.audit && p.audit.score >= 35),
  },
  voice: {
    name: "Agent personnel",
    offer:
      "un agent personnel pour organiser vos tâches, préparer vos documents et suivre vos clients",
    criteria: (p) =>
      /artisan|menuis|carpenter|joiner|plomb|craft|électric|coiff|hair|garage|43\.|45\.20|96\.02/i.test(p.category),
  },
  menu: {
    name: "Menus & supports",
    offer: "une présentation plus lisible de votre carte et de vos supports",
    criteria: (p) => /restaurant|cafe|café|bar|food|56\./i.test(p.category),
  },
};
export async function generateDrafts(
  p: Prospect,
  b: Business,
  engine: Engine,
): Promise<Draft[]> {
  const offer = engines[engine].offer;
  const variants = [
    "Une première rencontre",
    "Une idée pour votre activité",
    "Un échange, tout simplement",
  ];
  let messages = variants.map((variant, i) => ({
    subject: [
      `Une idée pour ${p.name}`,
      `${p.name} : et si nous échangions ?`,
      `Un projet à imaginer ensemble · ${p.name}`,
    ][i],
    body: `Bonjour,\n\nJe suis ${b.userName}, de ${b.name}${b.zone ? `, à ${b.zone}` : ""}. Je vous contacte au sujet de ${p.name}.\n\n${i === 0 ? "Je souhaitais vous proposer" : i === 1 ? "Seriez-vous intéressé par" : "Je serais ravi de discuter avec vous de"} ${offer}. ${p.audit ? `Lors de la consultation de votre site, voici un point observé : ${p.audit.observations[0]}.` : "Je ne dispose pas encore d’un audit de votre présence en ligne ; je vous propose un échange pour comprendre vos besoins."}\n\nMes services : ${b.services}. ${b.prices ? `Tarifs indicatifs : ${b.prices}.` : ""}\n\nAuriez-vous quelques minutes pour en parler ?\n\n${b.userName}\n${b.name}\n${b.website}\n\nSi vous ne souhaitez plus être contacté, dites-le-moi simplement et je respecterai votre choix.`,
  }));
  return messages.map((m, i) => ({
    id: randomUUID(),
    prospectId: p.id,
    prospectName: p.name,
    variant: variants[i],
    subject: m.subject,
    body: m.body,
    createdAt: new Date().toISOString(),
  }));
}
