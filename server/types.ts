export type Source = {
  value: string;
  source: string;
  url?: string;
  collectedAt: string;
  qualification?: string;
};
export type Status =
  | "À contacter"
  | "Contacté"
  | "En discussion"
  | "Gagné"
  | "Perdu";
// "voice" reste l’identifiant historique de l’offre désormais « Agent personnel ».
export type Engine = "website" | "voice" | "menu";
export interface Prospect {
  id: string;
  name: string;
  category: string;
  city: string;
  address: string;
  lat: number | null;
  lng: number | null;
  website: string;
  email: string;
  phone: string;
  rating: number | null;
  reviews: number | null;
  selected: boolean;
  status: Status;
  demo: boolean;
  webStatus: string;
  fields: Record<string, Source>;
  socials: Record<string, string>;
  hours: string;
  photos: string[];
  engine: Engine;
  audit?: Audit;
  doNotContact?: boolean;
  /** Retiré de la prospection, sans effacer le suivi ni l’opposition au contact. */
  archived?: boolean;
  /** Ancienne fiche conservée, redirigée vers la fiche unique. */
  duplicateOf?: string;
}
export interface Audit {
  checkedAt: string;
  https: boolean;
  responsive: boolean;
  copyright: string | null;
  technology: string;
  elapsedMs: number;
  score: number;
  observations: string[];
  title: string;
  description: string;
  texts: string[];
  images: string[];
  logo: string;
  colors: string[];
  links: string[];
  pages?: SitePage[];
  crawlWarnings?: string[];
}
export interface SitePage {
  url: string;
  title: string;
  texts: string[];
  images: string[];
  links: string[];
  collectedAt: string;
}
export interface Business {
  name: string;
  services: string;
  zone: string;
  tone: string;
  prices: string;
  website: string;
  instagram: string;
  facebook: string;
  userName: string;
  hermesInstructions?: string;
}
export interface Draft {
  id: string;
  prospectId: string;
  prospectName: string;
  subject: string;
  body: string;
  variant: string;
  createdAt: string;
}
export interface HermesHandoff {
  /** Optional so historical handoffs remain readable. Manual destination only. */
  targetProfile?: "default" | "coder";
  kind?: "email" | "project";
  id: string;
  prospectId: string;
  prospectName: string;
  engine: Engine;
  title: string;
  createdAt: string;
  prompt: string;
  dossier: Record<string, unknown>;
  warnings: string[];
}
export interface Search {
  id: string;
  city: string;
  activity: string;
  provider: string;
  count: number;
  cost: number | null;
  createdAt: string;
  ids: string[];
  engine: Engine;
  warnings?: string[];
  keyword?: string;
  query?: SearchQuery;
  newCount?: number;
  knownCount?: number;
  requestId?: string;
  kind?: "discovery" | "enrichment";
}
export interface SearchQuery {
  city: string;
  activity: string;
  keyword: string;
  paid: boolean;
}
