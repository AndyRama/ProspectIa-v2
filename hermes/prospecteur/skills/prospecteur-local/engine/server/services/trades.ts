import { normalizedText } from "../searchQuery";

export function trade(keyword: string) {
  return /^(menuisier|menuisiers|menuiserie|menuiseries)$/.test(normalizedText(keyword))
    ? { osm: '[craft~"^(carpenter|joiner)$"]', naf: "43.32A", terms: /menuis|carpenter|joiner|43\.32A/i } : undefined;
}
export function matchesKeyword(keyword: string, name: string, category: string) {
  const job = trade(keyword);
  return !keyword || (job ? job.terms.test(name + " " + category) : normalizedText(name + " " + category).includes(normalizedText(keyword)));
}
