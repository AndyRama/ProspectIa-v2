import { normalizedText } from "../searchQuery";

const trades = [
  { keywords: /^(menuisiers?|menuiseries?)$/, osm: '[craft~"^(carpenter|joiner)$"]', naf: "43.32A", terms: /\b(menuisiers?|menuiseries?|carpenter|joiner|43\s32a)\b/ },
  { keywords: /^(plombiers?|plomberies?)$/, osm: '[craft="plumber"]', naf: "43.22A", terms: /\b(plombiers?|plomberies?|plumber|43\s22a)\b/ },
  { keywords: /^(electriciens?|electricite)$/, osm: '[craft="electrician"]', naf: "43.21A", terms: /\b(electriciens?|electricite|electrician|43\s21a)\b/ },
  { keywords: /^peintres?$/, osm: '[craft="painter"]', naf: "43.34Z", terms: /\b(peintres?|painter|43\s34z)\b/ },
  { keywords: /^couvreurs?$/, osm: '[craft="roofer"]', naf: "43.91B", terms: /\b(couvreurs?|roofer|43\s91b)\b/ },
];

export function trade(keyword: string) {
  return trades.find((job) => job.keywords.test(normalizedText(keyword)));
}
export function matchesKeyword(keyword: string, name: string, category: string) {
  const job = trade(keyword);
  // Le métier est attesté par craft/NAF/catégorie, jamais déduit d'un patronyme.
  return !keyword || (job ? job.terms.test(normalizedText(category)) : normalizedText(name + " " + category).includes(normalizedText(keyword)));
}
