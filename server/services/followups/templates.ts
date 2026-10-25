import { createHash } from 'node:crypto';

// Pure shared contract: no database, environment, mailbox or transport imports.
export const days = [3, 7, 15, 31] as const;
export const sender = 'andyramaroson@gmail.com';
export const templateVersion = 'followups-v1';
const paragraphs: Record<number, string> = {
  3: 'Je me permets de revenir vers vous au sujet de mon premier message. Seriez-vous disponible pour découvrir comment je pourrais vous accompagner dans votre présence en ligne ?',
  7: 'Je reviens brièvement sur mon premier message concernant votre présence en ligne. Si cela vous intéresse, je peux vous présenter les possibilités, sans engagement.',
  15: 'Votre présence en ligne fait-elle partie de vos priorités actuellement ? Je reste disponible si vous souhaitez en savoir plus sur mes services.',
  31: 'Ce message sera ma dernière relance. Si vous souhaitez en savoir plus sur mes services pour votre présence en ligne, vous pouvez simplement me répondre.',
};
export function renderBody(day: number): string {
  if (!days.includes(day as typeof days[number])) throw Error('Invalid followup day');
  return `Bonjour,\n\n${paragraphs[day]}\n\nSi vous ne souhaitez plus recevoir mes messages, dites-le-moi simplement en réponse.\n\nAndy Ramaroson\n${sender}`;
}
export const templateHash = createHash('sha256').update(JSON.stringify({ version: templateVersion, sender, bodies: days.map(day => [day, renderBody(day)]) })).digest('hex');
