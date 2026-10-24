import { useEffect, useRef, useState } from "react";
import {
  Target,
  Search,
  Bookmark,
  Mail,
  Monitor,
  LayoutGrid,
  SlidersHorizontal,
  ShieldCheck,
  ChevronDown,
  ChevronRight,
  ArrowRight,
  MapPin,
  Store,
  Globe,
  HelpCircle,
  X,
  Check,
  Plus,
  Download,
  Upload,
  Copy,
  ExternalLink,
  LoaderCircle,
  Sparkles,
  Phone,
  FileText,
  Archive,
  ArchiveRestore,
  ArrowDownWideNarrow,
  Settings2,
  Menu,
  CheckCircle2,
  Trash2,
  RefreshCw,
  Bot,
  Utensils,
  AlertCircle,
} from "lucide-react";
import type {
  Business,
  HermesHandoff,
  Draft,
  Engine,
  Prospect,
  Search as SearchRecord,
  Status,
} from "../../server/types";
import { api, safeUrl } from "./api";
import ProspectMap from "./Map";
import HermesPrompt from "./HermesPrompt";
import { makeQuery, queryForSearch, queryKey } from "../../server/searchQuery";
type Page =
  | "search"
  | "leads"
  | "selection"
  | "drafts"
  | "handoffs"
  | "pipeline"
  | "settings";
type HandoffSummary = Omit<HermesHandoff, "prompt" | "dossier">;
type Settings = {
  business: Business;
  limits: { max: number; budget: number };
  apifyConfigured: boolean;
  storage: string;
  pending: any;
  onboarded: boolean;
};
type State = { prospects: Prospect[]; searches: SearchRecord[]; drafts: Draft[]; handoffs: HandoffSummary[]; settings: Settings };
const engines = {
  website: {
    name: "Création / refonte de sites",
    short: "Refonte de site",
    icon: Monitor,
    description: "Une présence en ligne à la hauteur de leur activité.",
  },
  voice: {
    name: "Agent personnel",
    short: "Agents personnels",
    icon: Bot,
    description: "Les tâches, documents et suivis du quotidien mieux organisés.",
  },
  menu: {
    name: "Refonte de menus & supports",
    short: "Menus & supports",
    icon: Utensils,
    description: "Une nouvelle façon de présenter leur savoir-faire.",
  },
};
const statuses: Status[] = [
  "À contacter",
  "Contacté",
  "En discussion",
  "Gagné",
  "Perdu",
];
const initial = (name: string) =>
  name
    .split(/[\s’-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase();
const date = (s: string) =>
  new Date(s).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
const opportunity = (p: Prospect, e: Engine) =>
  e === "website"
    ? !p.website || (!!p.audit && p.audit.score >= 35)
    : e === "voice"
      ? /artisan|menuis|carpenter|joiner|plomb|craft|électric|coiff|hair|garage|43\.|45\.20|96\.02/i.test(p.category)
      : /restaurant|cafe|café|bar|food|56\./i.test(p.category);
function Link({ href, children }: { href: string; children: React.ReactNode }) {
  return safeUrl(href) ? (
    <a href={safeUrl(href)} target="_blank" rel="noreferrer">
      {children}
      <ExternalLink size={12} />
    </a>
  ) : (
    <span>{children}</span>
  );
}
export default function App({ onLogout }: { onLogout?: () => void } = {}) {
  const [state, setState] = useState<State | null>(null),
    [page, setPage] = useState<Page>("search"),
    [activeIds, setActiveIds] = useState<string[] | null>(null),
    [opened, setOpened] = useState<Prospect | null>(null),
    [engine, setEngine] = useState<Engine>("website"),
    [busy, setBusy] = useState(""),
    [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(
      null,
    ),
    [help, setHelp] = useState(false),
    [importing, setImporting] = useState(false),
    [mobile, setMobile] = useState(false),
    [preview, setPreview] = useState<Omit<HermesHandoff, "dossier"> | null>(null);
  const [city, setCity] = useState("Papeete"),
    [activity, setActivity] = useState("restaurant"),
    [keyword, setKeyword] = useState(""),
    [budget, setBudget] = useState(1),
    [searchRecord, setSearchRecord] = useState<SearchRecord | null>(null),
    [filterEmail, setFilterEmail] = useState("all"),
    [fit, setFit] = useState("all"),
    [sort, setSort] = useState("source"),
    [minRating, setMinRating] = useState(""),
    [minReviews, setMinReviews] = useState(""),
    [webFilter, setWebFilter] = useState("all"),
    [socialFilter, setSocialFilter] = useState(false);
  const [runRecovery, setRunRecovery] = useState("");
  const [archiveFilter, setArchiveFilter] = useState("all");
  const [enrichment, setEnrichment] = useState<{ ids: string[]; plan: { planId: string; candidates: { name: string; placeId: string }[]; excluded: number; missing: number; remaining: number; message: string } } | null>(null);
  const prepareEnrichment = (ids: string[]) => task("plan", async () => {
    const plan = await api("/apify/plan", "POST", { prospectIds: ids });
    setOpened(null); setEnrichment({ ids, plan });
  });
  const refresh = async () => {
    const s = await api<State>("/state");
    setState(s);
    setOpened((p) =>
      p ? s.prospects.find((x) => x.id === p.id) || null : null,
    );
    return s;
  };
  useEffect(() => {
    refresh()
      .then((s) => {
        setBudget(s.settings.limits.budget);
        setCity(s.settings.business.zone || "Papeete");
        if (s.searches.length) {
          setSearchRecord(s.searches[0]);
          setActiveIds(s.searches[0].ids);
          restoreQuery(s.searches[0]);
        }
      })
      .catch((e) => setNotice({ text: e.message, error: true }));
  }, []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 8000);
    return () => clearTimeout(t);
  }, [notice]);
  async function task(name: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(name);
    try {
      await fn();
    } catch (e) {
      setNotice({ text: (e as Error).message, error: true });
      await refresh().catch(() => {});
    } finally {
      setBusy("");
    }
  }
  const go = (p: Page) => {
    if (p === "leads") {
      setArchiveFilter("all"); setFilterEmail("all"); setFit("all"); setSort("source");
      setMinRating(""); setMinReviews(""); setWebFilter("all"); setSocialFilter(false);
    }
    setPage(p);
    setMobile(false);
    setOpened(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const setArchived = (p: Prospect) => task(`archive:${p.id}`, async () => {
    const archived = !p.archived;
    await api(`/prospects/${p.id}`, "PATCH", { archived });
    const updated = await refresh();
    if (updated.prospects.find((item) => item.id === p.id)?.archived !== archived) {
      throw new Error("La modification de l’archive n’a pas été confirmée. Réessayez.");
    }
    setNotice({ text: archived ? "Lead archivé. Son dossier et son historique sont conservés." : "Lead désarchivé. Il est à nouveau disponible pour la prospection." });
  });
  const archiveButton = (p: Prospect) => <button className="button ghost small" disabled={!!busy} aria-busy={busy === `archive:${p.id}`} onClick={() => setArchived(p)}>
    {busy === `archive:${p.id}` ? <LoaderCircle size={14} className="spin" /> : p.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
    {p.archived ? "Désarchiver" : "Archiver"}
  </button>;
  const toggle = async (p: Prospect, selected = !p.selected) => {
    if (p.archived) return;
    await api(`/prospects/${p.id}`, "PATCH", { selected });
    await refresh();
  };
  const selectMany = (items: Prospect[]) =>
    task("selection", async () => {
      await Promise.all(
        items.filter((p) => !p.archived).map((p) =>
          api(`/prospects/${p.id}`, "PATCH", { selected: true }),
        ),
      );
      await refresh();
      setNotice({
        text: `${items.length} entreprise(s) dans votre sélection.`,
      });
    });
  const restoreQuery = (s: SearchRecord) => {
    const q = queryForSearch(s);
    if (!q) return;
    setCity(q.city); setActivity(q.activity); setKeyword(q.keyword); setEngine(s.engine);
  };
  const receive = (r: any) => {
    if (r.pending) {
      setNotice({
        text: "Collecte Apify lancée. Utilisez « Récupérer la collecte » pour consulter son avancement, sans relancer ni repayer.",
      });
      return;
    }
    if (!r.search) {
      setActiveIds([]); setNotice({ text: r.message || "Aucun nouveau candidat. Aucune dépense." }); return;
    }
    setActiveIds(r.search.ids);
    setSearchRecord(r.search);
    setNotice({
      text: r.cached ? `${r.search.count} fiche(s) enregistrées réouvertes. Aucune nouvelle collecte ni dépense.` : r.enriched ? `${r.search.count} fiche(s) enrichies par identifiants validés. Coût retourné par Apify : ${r.search.cost === null ? "non communiqué" : `${r.search.cost.toFixed(4)} USD`}.` : `${r.search.count} fiche(s) uniques · ${r.search.newCount ?? r.search.count} nouvelle(s) · ${r.search.knownCount ?? 0} déjà connue(s).${r.remaining !== undefined ? ` ${r.remaining} candidat(s) en réserve. Aucun crédit Apify dépensé.` : ""}`,
    });
  };
  const doSearch = () =>
    task("search", async () => {
      receive(
        await api("/search", "POST", {
          city,
          activity,
          keyword,
          paid: false,
          max: 25,
          budget,
          engine,
          intent: "discover",
          requestId: crypto.randomUUID(),
        }),
      );
      await refresh();
    });
  const demo = () =>
    task("demo", async () => {
      receive(await api("/demo", "POST"));
      await refresh();
    });
  const cached = (id: string) =>
    task("cache", async () => {
      const result = await api<{ search: SearchRecord }>("/searches/" + id);
      restoreQuery(result.search); receive(result);
      await refresh();
    });
  const generate = (p: Prospect) =>
    task("drafts", async () => {
      const r = await api(`/prospects/${p.id}/drafts`, "POST", { engine });
      await refresh();
      setNotice({
        text: `3 variantes préparées · ${r.mode}. Relisez-les avant utilisation.`,
      });
      go("drafts");
    });
  const createHandoff = (p: Prospect) =>
    task("handoff", async () => {
      const result = await api<Omit<HermesHandoff, "dossier">>(`/prospects/${p.id}/handoffs`, "POST", { engine });
      await refresh(); go("handoffs"); setPreview(result);
      setNotice({ text: "Le prompt et le dossier sont prêts à transmettre à Hermès." });
    });
  if (!state)
    return (
      <div className="loading">
        <Target size={38} />
        <h2>Votre espace prend place.</h2>
        {notice ? (
          <p role="alert">
            {notice.text}{" "}
            <button onClick={() => location.reload()}>Réessayer</button>
          </p>
        ) : (
          <LoaderCircle className="spin" />
        )}
      </div>
    );
  const canonical = state.prospects.filter((p) => !p.duplicateOf);
  let rows = canonical.filter((p) =>
    page === "leads"
      ? archiveFilter === "all" || (archiveFilter === "archived" ? !!p.archived : !p.archived)
      : !p.archived && (page === "selection" ? p.selected : !activeIds || activeIds.includes(p.id)),
  );
  const total = rows.length;
  rows = page === "leads" ? rows : rows.filter(
    (p) =>
      (fit !== "opportunities" || opportunity(p, engine)) &&
      (filterEmail === "all" ||
        (filterEmail === "with" ? !!p.email : !p.email)) &&
      (!minRating || (p.rating !== null && p.rating >= Number(minRating))) &&
      (!minReviews ||
        (p.reviews !== null && p.reviews >= Number(minReviews))) &&
      (webFilter === "all" ||
        (webFilter === "with" ? !!p.website : !p.website)) &&
      (!socialFilter || Object.keys(p.socials).length > 0),
  );
  if (sort === "rating")
    rows.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
  if (sort === "reviews")
    rows.sort((a, b) => (b.reviews ?? -1) - (a.reviews ?? -1));
  if (page !== "leads" && sort === "source" && activeIds) {
    const order = new Map(activeIds.map((id, index) => [id, index]));
    rows.sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
  }
  const selected = canonical.filter((p) => p.selected && !p.archived);
  const selectableRows = rows.filter((p) => !p.archived);
  const archivedCount = canonical.filter((p) => p.archived).length;
  const currentQuery = makeQuery({ city, activity, keyword, paid: false, engine });
  const savedSearch = state.searches.find((s) => {
    const q = queryForSearch(s); return q && queryKey({ ...q, paid: false }) === queryKey(currentQuery);
  });
  const scopeIds = [...new Set(state.searches.filter((s) => { const q = queryForSearch(s); return q && queryKey({ ...q, paid: false }) === queryKey(currentQuery); }).flatMap((s) => s.ids))];
  const historyGroups = new Map<string, SearchRecord[]>();
  for (const s of state.searches) {
    const q = queryForSearch(s), key = q ? queryKey(q) : s.id;
    historyGroups.set(key, [...(historyGroups.get(key) || []), s]);
  }
  const activityLabel = (value: string) => ({ all: "Tous les commerces", artisan: "Artisans", restaurant: "Restaurants & cafés", beauty: "Coiffeurs / beauté", hotel: "Hôtels", retail: "Commerces de détail" }[value] || value);
  const demoShown = rows.some((p) => p.demo);
  const pageNames: Record<Page, string> = {
    search: "Recherche de prospects",
    leads: "Tous les leads",
    selection: "Ma sélection",
    drafts: "Mes brouillons",
    handoffs: "Prompts pour Hermès",
    pipeline: "Mon atelier et pipeline",
    settings: "Mon business & paramètres",
  };
  const nav = (
    id: Page,
    Icon: typeof Search,
    label: string,
    count?: number,
  ) => (
    <button
      className={"nav-item " + (page === id ? "active" : "")}
      aria-current={page === id ? "page" : undefined}
      onClick={() => go(id)}
    >
      <Icon size={19} />
      <span>{label}</span>
      {count !== undefined ? (
        <small>{count}</small>
      ) : page === id ? (
        <i className="nav-dot" />
      ) : null}
    </button>
  );
  return (
    <div className="app">
      <aside className={"sidebar " + (mobile ? "mobile-open" : "")}>
        <a
          className="logo"
          onClick={() => go("search")}
          href="#"
          aria-label="ProspectAI accueil"
        >
          <span className="logo-mark">
            <Target size={26} />
          </span>
          <span>
            prospect<span className="logo-ai">ai.</span>
          </span>
        </a>
        <button className="workspace" onClick={() => go("settings")}>
          <span className="business-avatar">
            {initial(state.settings.business.name)[0] || "M"}
          </span>
          <span>
            <strong>{state.settings.business.name}</strong>
            <small>Espace personnel</small>
          </span>
          <ChevronDown size={15} />
        </button>
        <div className="nav-label">VOTRE PROSPECTION</div>
        <nav>
          {nav("search", Search, "Trouver des prospects")}
          {nav("leads", Store, "Tous les leads", canonical.length)}
          {nav("selection", Bookmark, "Ma sélection", selected.length)}
          {nav("drafts", Mail, "Mes brouillons", state.drafts.length)}
        </nav>
        <div className="nav-label workshop-label">VOTRE ATELIER</div>
        <nav>
          {nav("handoffs", FileText, "Prompts pour Hermès")}
          {nav("pipeline", LayoutGrid, "Mon atelier et pipeline")}
        </nav>
        <div className="sidebar-bottom">
          {nav("settings", SlidersHorizontal, "Paramètres")}
          <div className="trust">
            <ShieldCheck size={23} />
            <strong>Vous gardez la main.</strong>
            <p>
              Des propositions à relire.
              <br />
              Jamais d’envoi automatique.
            </p>
            <small>
              <i className="dot" /> {state.settings.storage.startsWith("Turso") ? "Vos données restent privées" : "Vos données restent locales"}
            </small>
          </div>
          <button className="profile" onClick={() => go("settings")}>
            <span className="avatar">
              {initial(state.settings.business.userName)}
            </span>
            <strong>{state.settings.business.userName}</strong>
            <Settings2 size={16} />
          </button>
        </div>
      </aside>
      {mobile && (
        <button
          className="mobile-shade"
          onClick={() => setMobile(false)}
          aria-label="Fermer le menu"
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            onClick={() => setMobile(!mobile)}
            aria-label="Ouvrir le menu"
          >
            <Menu />
          </button>
          <div className="breadcrumbs">
            <span>Mon espace</span>
            <ChevronRight size={14} />
            <strong>{pageNames[page]}</strong>
          </div>
          <div className="topbar-right">
            {onLogout && <button className="text-link" onClick={onLogout}>Déconnexion</button>}
            <span className="local">
              <i className="dot" />
              {state.settings.storage.startsWith("Turso") ? "Application privée" : "Application locale"}
            </span>
            <button
              className="icon-button"
              onClick={() => setHelp(true)}
              aria-label="Aide"
            >
              <HelpCircle size={19} />
            </button>
            <button
              className="avatar"
              onClick={() => go("settings")}
              aria-label="Mon profil"
            >
              {initial(state.settings.business.userName)}
            </button>
          </div>
        </header>
        <main>
          {page === "search" && (
            <>
              <div className="page-hero">
                <div>
                  <div className="eyebrow">
                    <i className="dot" />
                    LES BONNES RENCONTRES COMMENCENT ICI
                  </div>
                  <h1>
                    Trouvez vos prochains <em>clients.</em>
                  </h1>
                  <p>
                    Repérez les commerces locaux, comprenez leur activité et
                    préparez votre prise de contact.
                  </p>
                </div>
                <div className="hero-orbit">
                  <div>
                    <Target size={36} />
                  </div>
                  <span>
                    <Sparkles size={19} />
                  </span>
                </div>
              </div>
              <section className="card search-card">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    doSearch();
                  }}
                >
                  <div className="search-fields">
                    <label className="search-field">
                      <span className="field-label">QUELLE ACTIVITÉ ?</span>
                      <div>
                        <Store size={19} />
                        <select
                          value={activity}
                          onChange={(e) => setActivity(e.target.value)}
                        >
                          <option value="all">Tous les commerces</option>
                          <option value="restaurant">
                            Restaurants & cafés
                          </option>
                          <option value="artisan">Artisans</option>
                          <option value="beauty">Coiffeurs / beauté</option>
                          <option value="hotel">Hôtels</option>
                          <option value="retail">Commerces de détail</option>
                        </select>
                      </div>
                    </label>
                    <label className="search-field">
                      <span className="field-label">DANS QUELLE VILLE ?</span>
                      <div>
                        <MapPin size={19} />
                        <input
                          required
                          minLength={2}
                          value={city}
                          onChange={(e) => setCity(e.target.value)}
                          placeholder="Ville et pays"
                        />
                      </div>
                    </label>
                    <label className="search-field keyword">
                      <span className="field-label">NOM OU MOT-CLÉ</span>
                      <div>
                        <Search size={18} />
                        <input
                          value={keyword}
                          onChange={(e) => setKeyword(e.target.value)}
                          placeholder="Facultatif"
                        />
                      </div>
                    </label>
                    <button
                      className="button primary search-button"
                      disabled={!!busy || !!state.settings.pending}
                    >
                      {busy === "search" ? (
                        <LoaderCircle size={17} className="spin" />
                      ) : (
                        <Search size={18} />
                      )}{" "}
                      {busy === "search"
                        ? "Recherche en cours…"
                        : "Trouver 25 nouveaux prospects"}
                    </button>
                  </div>
                  <div className="saved-search-note">
                    <p><strong>25 nouveaux au maximum, jamais une ancienne liste relancée.</strong> Les {state.prospects.filter((p) => !p.demo).length} entreprises déjà enregistrées sont exclues. La recherche utilise les sources gratuites ; les candidats restants sont gardés pour le lot suivant.</p>
                    {savedSearch && <button type="button" className="button ghost small" disabled={!!busy} onClick={() => {
                      setActiveIds(scopeIds); setSearchRecord({ ...savedSearch, ids: scopeIds, count: scopeIds.length });
                      setNotice({ text: `${scopeIds.length} fiches de cette recherche réunies, sans nouvelle collecte ni paiement.` });
                    }}>Revoir les {scopeIds.length} fiches enregistrées</button>}
                  </div>
                  <div className="engine-picker">
                    <span>JE SOUHAITE PROPOSER</span>
                    {Object.entries(engines).map(([key, e]) => (
                      <button
                        type="button"
                        key={key}
                        className={
                          "engine-pill " + (engine === key ? "chosen" : "")
                        }
                          onClick={() => {
                            setEngine(key as Engine);
                            if (key === "voice") setActivity("artisan");
                            if (key === "menu") setActivity("restaurant");
                          }}
                      >
                        <e.icon size={14} />
                        {e.short}
                        {engine === key && <Check size={12} />}
                      </button>
                    ))}
                  </div>
                  <p className="free-note"><ShieldCheck size={14} /> Aucun appel Google Maps payant depuis cette recherche. Les relances par mot-clé ont été bloquées pour éviter de repayer les mêmes entreprises.</p>
                </form>
                <div className="search-history">
                  <div>
                    {searchRecord ? (
                      <>
                        <span>
                          Dernière recherche{" "}
                          {searchRecord.provider === "Apify"
                            ? "payante"
                            : searchRecord.provider === "Démonstration fictive"
                              ? "de démonstration"
                              : "gratuite"}{" "}
                          : <b>{searchRecord.count} entreprises</b> à{" "}
                          {searchRecord.city} ·{" "}
                          {searchRecord.cost === null
                            ? "coût non communiqué"
                            : `${searchRecord.cost.toFixed(3)} USD`}
                          .
                        </span>
                        <button
                          className="text-link subtle"
                          onClick={() => cached(searchRecord.id)}
                        >
                          Revoir ces résultats <ArrowRight size={12} />
                        </button>
                      </>
                    ) : (
                      <>
                        <span>
                          Votre prochaine opportunité est peut-être à deux pas.
                        </span>
                        <span className="muted">
                          Lancez une recherche ou explorez la démonstration.
                        </span>
                      </>
                    )}
                  </div>
                  <button
                    className="button ghost small"
                    disabled={!!busy}
                    onClick={demo}
                  >
                    <Sparkles size={14} />
                    Explorer la démo
                  </button>
                </div>
              </section>
              {!state.settings.onboarded && (
                <div className="banner onboarding-banner">
                  <Store size={20} />
                  <span><strong>Votre agence, votre ton, vos services.</strong><br />Renseignez votre business pour personnaliser vos propositions.</span>
                  <button className="button ghost small" onClick={() => go("settings")}>Configurer mon business <ArrowRight size={14} /></button>
                </div>
              )}
              {!!searchRecord?.warnings?.length && (
                <div className="banner" role="status"><AlertCircle size={18} /><span>Résultats partiels. {searchRecord.warnings.join(" · ")}</span></div>
              )}
              {state.settings.pending && (
                <div className="banner">
                  <LoaderCircle size={17} />
                  <span>
                    Une collecte Apify est en cours. Ne relancez pas de
                    recherche payante.
                  </span>
                  {state.settings.pending.runId ? (
                    <button
                      className="button primary small"
                      disabled={!!busy}
                      onClick={() =>
                        task("poll", async () => {
                          const r = await api("/apify/poll", "POST", {});
                          receive(r);
                          if (r.runStatus && r.runStatus !== "SUCCEEDED")
                            setNotice({
                              text:
                                "Collecte partielle : " +
                                r.runStatus +
                                ". Les résultats disponibles sont conservés.",
                            });
                          await refresh();
                        })
                      }
                    >
                      Récupérer la collecte
                    </button>
                  ) : (
                    <div className="recover-run">
                      <input
                        aria-label="Run ID Apify"
                        placeholder="Run ID depuis la console Apify"
                        value={runRecovery}
                        onChange={(e) => setRunRecovery(e.target.value)}
                      />
                      <button
                        className="button primary small"
                        disabled={!!busy || !runRecovery}
                        onClick={() =>
                          task("recover", async () => {
                            await api("/apify/recover", "POST", {
                              runId: runRecovery,
                            });
                            await refresh();
                          })
                        }
                      >
                        Associer le run
                      </button>
                    </div>
                  )}
                </div>
              )}
              {demoShown && (
                <div className="demo-banner">
                  <Sparkles size={16} />
                  <span>
                    <b>Un terrain d’essai, en toute transparence.</b> Ces
                    entreprises sont fictives. Aucune coordonnée ni note
                    inventée n’est présentée comme réelle.
                  </span>
                </div>
              )}
              <ProspectMap
                items={rows}
                onOpen={setOpened}
                onSelect={selectMany}
              />
              <details className="card refine">
                <summary>
                  <SlidersHorizontal size={16} />
                  Affiner les entreprises affichées
                  <ChevronDown size={16} />
                </summary>
                <div className="refine-grid">
                  <label>
                    Note minimale
                    <input
                      type="number"
                      min="0"
                      max="5"
                      step="0.1"
                      value={minRating}
                      onChange={(e) => setMinRating(e.target.value)}
                      placeholder="Toutes"
                    />
                  </label>
                  <label>
                    Nombre d’avis minimum
                    <input
                      type="number"
                      min="0"
                      value={minReviews}
                      onChange={(e) => setMinReviews(e.target.value)}
                      placeholder="Tous"
                    />
                  </label>
                  <label>
                    Présence web
                    <select
                      value={webFilter}
                      onChange={(e) => setWebFilter(e.target.value)}
                    >
                      <option value="all">Avec ou sans site</option>
                      <option value="with">Avec un site</option>
                      <option value="without">Sans site renseigné</option>
                    </select>
                  </label>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={socialFilter}
                      onChange={(e) => setSocialFilter(e.target.checked)}
                    />
                    Réseau social renseigné
                  </label>
                  <button
                    className="text-link"
                    onClick={() => {
                      setMinRating("");
                      setMinReviews("");
                      setWebFilter("all");
                      setSocialFilter(false);
                    }}
                  >
                    Réinitialiser
                  </button>
                </div>
              </details>
              <button
                className="import-link"
                onClick={() => setImporting(true)}
              >
                <Upload size={14} />
                Importer mes entreprises <span>· CSV ou liste de sites</span>
                <ArrowRight size={13} />
              </button>
              <div className="kpis">
                <Kpi
                  Icon={Store}
                  value={String(rows.length).padStart(2, "0")}
                  label={
                    demoShown
                      ? "établissements de démonstration"
                      : "établissements réels affichés"
                  }
                  note={
                    demoShown
                      ? "Fiches fictives, clairement identifiées"
                      : "Sources publiques consultables"
                  }
                />
                <Kpi
                  Icon={Globe}
                  value={String(
                    rows.filter((p) => opportunity(p, engine)).length,
                  ).padStart(2, "0")}
                  label="pistes à examiner pour vos services"
                  note="Aucun audit ou email inventé"
                />
                <Kpi
                  Icon={Bookmark}
                  value={String(selected.length).padStart(2, "0")}
                  label="prospects dans votre sélection"
                  note="Le premier pas vers une conversation"
                />
              </div>
            </>
          )}
          {(page === "selection" || page === "search" || page === "leads") && (
            <>
              {page === "leads" && (
                <>
                  <div className="page-hero"><div><div className="eyebrow">VOTRE RÉPERTOIRE</div><h1>Tous les leads</h1><p>Toutes vos entreprises enregistrées, toutes villes et tous moteurs confondus. Archiver conserve le dossier et son historique, sans supprimer les données.</p></div><Store className="hero-icon" size={45} /></div>
                  <div className="tabs" aria-label="Filtrer les leads">
                    {[["all", "Tous", canonical.length], ["active", "Actifs", canonical.length - archivedCount], ["archived", "Archivés", archivedCount]].map(([id, label, count]) => <button key={id} aria-pressed={archiveFilter === id} className={archiveFilter === id ? "active" : ""} onClick={() => setArchiveFilter(String(id))}>{label} {count}</button>)}
                  </div>
                </>
              )}
              {page === "selection" && (
                <div className="page-hero">
                  <div>
                    <div className="eyebrow">LES RELATIONS SE CULTIVENT</div>
                    <h1>
                      Votre prochaine <em>conversation.</em>
                    </h1>
                    <p>Les entreprises que vous avez choisies. Avancez à votre rythme.</p>
                    <button className="button ghost small" disabled={!!busy || !selected.length} onClick={() => prepareEnrichment(selected.map((p) => p.id))}><ShieldCheck size={14} />Vérifier un lot Apify avant paiement</button>
                  </div>
                  <Bookmark className="hero-icon" size={45} />
                </div>
              )}
              {page === "search" && (
                <p className="results-summary">
                  {total} fiches collectées ·{" "}
                  {rows.filter((p) => opportunity(p, engine)).length} pistes
                  pour vos services · {rows.filter((p) => p.email).length} avec
                  email.{" "}
                  <span>Chaque donnée a son histoire, et sa source.</span>
                </p>
              )}
              <div className="table-heading">
                <h3>
                  {page === "selection"
                    ? "Ma sélection"
                    : page === "leads" ? "Entreprises enregistrées" : "Votre terrain d’opportunités"}{" "}
                  <span className="count">{rows.length}</span>
                </h3>
                <span>
                  <MapPin size={13} />
                  {page === "leads" ? "Toutes les villes" : city}
                </span>
              </div>
              <section className="card table-card">
                {page !== "leads" && <div className="table-toolbar">
                  <label>
                    Adéquation à mon entreprise
                    <select
                      value={fit}
                      onChange={(e) => setFit(e.target.value)}
                    >
                      <option value="all">Toutes les fiches</option>
                      <option value="opportunities">
                        Opportunités pour mes services
                      </option>
                    </select>
                  </label>
                  <div className="tabs">
                    {[
                      ["all", "Tous les prospects"],
                      ["with", "Avec email"],
                      ["without", "Email à trouver"],
                    ].map(([id, label]) => (
                      <button
                        key={id}
                        className={filterEmail === id ? "active" : ""}
                        onClick={() => setFilterEmail(id)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="sort">
                    <ArrowDownWideNarrow size={16} />
                    <select
                      aria-label="Trier les prospects"
                      value={sort}
                      onChange={(e) => setSort(e.target.value)}
                    >
                      <option value="source">Ordre de la source</option>
                      <option value="rating">Meilleure note</option>
                      <option value="reviews">Nombre d’avis</option>
                    </select>
                  </div>
                </div>
                }
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>
                          <input
                            type="checkbox"
                            aria-label="Sélectionner toutes les entreprises affichées"
                            checked={
                              selectableRows.length > 0 && selectableRows.every((p) => p.selected)
                            }
                            disabled={!!busy || !selectableRows.length}
                            onChange={(e) =>
                              task("selection", async () => {
                                await Promise.all(
                                  selectableRows.map((p) =>
                                    api(`/prospects/${p.id}`, "PATCH", {
                                      selected: e.target.checked,
                                    }),
                                  ),
                                );
                                await refresh();
                              })
                            }
                          />
                        </th>
                        <th>ENTREPRISE</th>
                        <th>PRÉSENCE WEB</th>
                        <th>IDENTIFIANT</th>
                        <th>
                          {page === "selection" || page === "leads" ? "STATUT" : "QUALIFICATION"}
                        </th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((p) => (
                        <tr key={p.id}>
                          <td>
                            <input
                              aria-label={`Sélectionner ${p.name}`}
                              type="checkbox"
                              checked={!p.archived && p.selected}
                              disabled={!!busy || !!p.archived}
                              onChange={() =>
                                task("selection", () => toggle(p))
                              }
                            />
                          </td>
                          <td>
                            <button
                              className="company"
                              onClick={() => setOpened(p)}
                            >
                              <span className="company-avatar">
                                {initial(p.name)}
                              </span>
                              <span>
                                <strong>{p.name}</strong>
                                <small>
                                  {p.category} <i>·</i> {p.city}
                                  {p.demo && <b className="demo-tag">DÉMO</b>}
                                  {p.archived && <b className="demo-tag">Archivé</b>}
                                </small>
                              </span>
                            </button>
                          </td>
                          <td>
                            <span
                              className={
                                "web-badge " + (p.audit ? "verified" : "")
                              }
                            >
                              <Globe size={12} />
                              {p.webStatus}
                            </span>
                          </td>
                          <td>
                            <span className="rating">
                              {p.rating === null
                                ? "— Données non collectées"
                                : `${p.rating.toFixed(1)}/5 · ${p.reviews ?? "—"} avis`}
                            </span>
                          </td>
                          <td>
                            {page === "selection" ? (
                              <select
                                className="status-select"
                                value={p.status}
                                onChange={(e) =>
                                  task("status", async () => {
                                    await api(`/prospects/${p.id}`, "PATCH", {
                                      status: e.target.value,
                                    });
                                    await refresh();
                                  })
                                }
                              >
                                {statuses.map((s) => (
                                  <option key={s}>{s}</option>
                                ))}
                              </select>
                            ) : (
                              <span className="qualification">
                                {page === "leads" ? p.status : opportunity(p, engine)
                                  ? engines[engine].name
                                  : "À qualifier"}
                                <small>
                                  {page === "leads" ? engines[p.engine].short : p.audit
                                    ? "Analyse indicative"
                                    : "À confirmer avec le professionnel"}
                                </small>
                              </span>
                            )}
                          </td>
                          <td>
                            <div className="flex items-center gap-2 whitespace-nowrap">
                              <button
                                className="row-link"
                                onClick={() => setOpened(p)}
                              >
                                Voir la fiche
                                <ArrowRight size={15} />
                              </button>
                              {archiveButton(p)}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!rows.length && (
                  <Empty
                    Icon={Search}
                    title={
                      total
                        ? "Aucun résultat avec ces filtres"
                        : "Les belles rencontres commencent ici"
                    }
                    text={
                      total
                        ? "Ajustez les filtres pour retrouver vos entreprises."
                        : "Recherchez une ville, importez vos entreprises ou explorez la démonstration."
                    }
                    action={
                      page === "search" ? (
                        <button className="button ghost" onClick={demo}>
                          <Sparkles size={16} />
                          Explorer la démo
                        </button>
                      ) : (
                        <button
                          className="button primary"
                          onClick={() => go("search")}
                        >
                          Trouver des prospects
                          <ArrowRight size={16} />
                        </button>
                      )
                    }
                  />
                )}
                <div className="table-bottom">
                  <span>
                    {rows.length} entreprise{rows.length > 1 ? "s" : ""} ·{" "}
                    {selected.length} sélectionnée
                    {selected.length > 1 ? "s" : ""}
                  </span>
                  <span>
                    <ShieldCheck size={13} />
                    Vos données restent chez vous
                  </span>
                </div>
              </section>
              {page === "search" && state.searches.length > 0 && (
                <details className="card history-list">
                  <summary>
                    Historique des recherches · résultats conservés
                  </summary>
                  {[...historyGroups.entries()].map(([key, versions]) => {
                    const s = versions[0];
                    return <section className="history-group" key={key}>
                      <button disabled={!!busy} onClick={() => cached(s.id)}>
                        <span>{s.city} · {activityLabel(s.query?.activity || s.activity)}{(s.query?.keyword ?? s.keyword) ? ` · ${s.query?.keyword ?? s.keyword}` : ""} · {s.count} entreprises · {s.provider}</span>
                        <span>{date(s.createdAt)} <ArrowRight size={14} /></span>
                      </button>
                      {versions.length > 1 && <details className="history-versions"><summary>{versions.length - 1} collecte(s) précédente(s) conservée(s)</summary>{versions.slice(1).map((old) => <button key={old.id} disabled={!!busy} onClick={() => cached(old.id)}><span>{date(old.createdAt)} · {old.count} entreprises · {old.provider}</span><ArrowRight size={14} /></button>)}</details>}
                    </section>;
                  })}
                </details>
              )}
            </>
          )}
          {page === "drafts" && (
            <>
              <PageHero
                eyebrow="DES MOTS QUI OUVRENT DES PORTES"
                title="Un premier mot,"
                accent="personnel."
                text="Trois façons d’engager la conversation. Toujours à relire, jamais envoyées automatiquement."
              />
              {!state.drafts.length ? (
                <Empty
                  Icon={Mail}
                  title="Vos prochains échanges prennent forme ici"
                  text="Ouvrez la fiche d’un prospect et préparez vos trois variantes personnalisées."
                  action={
                    <button
                      className="button primary"
                      onClick={() => go("selection")}
                    >
                      Ouvrir ma sélection
                      <ArrowRight size={16} />
                    </button>
                  }
                />
              ) : (
                <div className="draft-grid">
                  {state.drafts.map((d) => (
                    <DraftCard
                      key={d.id}
                      draft={d}
                      email={
                        state.prospects.find((p) => p.id === d.prospectId)
                          ?.email || ""
                      }
                      onSave={(subject, body) =>
                        task("save", async () => {
                          await api("/drafts/" + d.id, "PATCH", {
                            subject,
                            body,
                          });
                          await refresh();
                          setNotice({ text: "Brouillon enregistré." });
                        })
                      }
                      onCopy={(body) =>
                        task("copy", async () => {
                          await navigator.clipboard.writeText(body);
                          setNotice({ text: "Brouillon copié." });
                        })
                      }
                      onDelete={() =>
                        task("delete", async () => {
                          await api("/drafts/" + d.id, "DELETE");
                          await refresh();
                        })
                      }
                    />
                  ))}
                </div>
              )}
            </>
          )}
          {page === "handoffs" && (
            <>
              <PageHero eyebrow="VOTRE COLLABORATION AVEC HERMÈS" title="Un projet prêt à" accent="transmettre." text="Des prompts précis et des dossiers sourcés pour confier la réalisation à votre employé Hermès IA." />
              <div className="banner"><ShieldCheck size={19} /><span>Hermès reçoit vos consignes par copier-coller et par le dossier que vous lui joignez. Il doit attendre votre accord avant chaque étape, toute publication ou prise de contact.</span></div>
              {!state.handoffs.length ? <Empty Icon={FileText} title="Le bon dossier pour commencer" text="Depuis une fiche prospect, préparez un prompt adapté à la création du site, au menu ou à l’agent personnel." action={<button className="button primary" onClick={() => go("search")}>Explorer les prospects <ArrowRight size={16} /></button>} /> : (
                <div className="deliverable-grid">{state.handoffs.map((h) => (
                  <article className="card deliverable-card" key={h.id}>
                    <div className={"deliverable-cover " + h.engine}><FileText size={42} /><span>DOSSIER POUR HERMÈS IA</span><h2>{h.prospectName}</h2></div>
                    <div className="deliverable-body"><p className="eyebrow">{h.title}</p><h3>{h.prospectName}</h3><p>{date(h.createdAt)} · Prompt et sources</p>
                      <div className="button-group"><button className="button primary small" disabled={!!busy} onClick={() => task("open-handoff", async () => setPreview(await api(`/handoffs/${h.id}`)))}>Ouvrir le prompt <ArrowRight size={14} /></button><a className="button ghost small" href={`/api/handoffs/${h.id}/export?format=dossier`}><Download size={14} /> Dossier JSON</a></div>
                    </div>
                  </article>
                ))}</div>
              )}
            </>
          )}
          {page === "pipeline" && (
            <>
              <PageHero
                eyebrow="CHAQUE RENCONTRE A SON CHEMIN"
                title="Faites avancer vos"
                accent="projets."
                text="Une vue simple sur vos conversations, de la première idée au prochain client."
              />
              <div className="pipeline">
                {statuses.map((status, i) => (
                  <section
                    className="pipeline-column"
                    key={status}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const id = e.dataTransfer.getData("text/plain");
                      if (!canonical.some((p) => p.id === id && !p.archived)) return;
                      task("status", async () => {
                        await api(`/prospects/${id}`, "PATCH", {
                          status,
                          selected: true,
                        });
                        await refresh();
                      });
                    }}
                  >
                    <h3>
                      <i className={"dot status-" + i} />
                      {status}
                      <span>
                        {selected.filter((p) => p.status === status).length}
                      </span>
                    </h3>
                    {selected
                      .filter((p) => p.status === status)
                      .map((p) => (
                        <article
                          draggable
                          onDragStart={(e) =>
                            e.dataTransfer.setData("text/plain", p.id)
                          }
                          className="card pipeline-prospect"
                          key={p.id}
                        >
                          <button
                            className="company"
                            onClick={() => setOpened(p)}
                          >
                            <span className="company-avatar">
                              {initial(p.name)}
                            </span>
                            <span>
                              <strong>{p.name}</strong>
                              <small>
                                {p.city}
                                {p.demo ? " · Démo" : ""}
                              </small>
                            </span>
                          </button>
                          <p>{p.category}</p>
                          <select
                            aria-label={"Statut de " + p.name}
                            value={p.status}
                            onChange={(e) =>
                              task("status", async () => {
                                await api(`/prospects/${p.id}`, "PATCH", {
                                  status: e.target.value,
                                });
                                await refresh();
                              })
                            }
                          >
                            {statuses.map((s) => (
                              <option key={s}>{s}</option>
                            ))}
                          </select>
                        </article>
                      ))}
                    {!selected.some((p) => p.status === status) && (
                      <div className="pipeline-empty">
                        <Plus size={18} />
                        <span>Une place pour la suite</span>
                      </div>
                    )}
                  </section>
                ))}
              </div>
            </>
          )}
          {page === "settings" && (
            <SettingsPage
              settings={state.settings}
              busy={!!busy}
              onSave={(input) =>
                task("settings", async () => {
                  await api("/settings", "PUT", input);
                  const s = await refresh();
                            setBudget(s.settings.limits.budget);
                  setNotice({
                    text: "Votre espace a été enregistré. Les clés restent côté serveur.",
                  });
                })
              }
              onRead={(url) => api("/business/read-site", "POST", { url })}
              onError={(e) => setNotice({ text: e, error: true })}
              onVerify={() =>
                task("verify", async () => {
                  await api("/apify/verify", "POST", {});
                  setNotice({
                    text: "Schéma officiel et tarification Apify vérifiés. Aucun appel payant lancé.",
                  });
                })
              }
              onDelete={() =>
                task("delete", async () => {
                  await api("/data", "DELETE", { confirm: "SUPPRIMER" });
                  await refresh();
                  setActiveIds(null);
                  setSearchRecord(null);
                  setNotice({ text: "Données locales supprimées." });
                })
              }
            />
          )}
          <footer className="page-footer">
            <span>
              prospect<span>ai.</span>
            </span>
            <p>Des relations humaines. Des opportunités locales.</p>
            <small>
              <ShieldCheck size={12} />
              Conçu pour vous laisser la main.
            </small>
          </footer>
        </main>
      </div>
      {opened && (
        <>
          <div className="drawer-shade" onClick={() => setOpened(null)} />
          <aside className="prospect-drawer" aria-label="Fiche prospect">
            <div className="drawer-top">
              <span className="eyebrow">FICHE PROSPECT</span>
              <button
                className="icon-button"
                aria-label="Fermer la fiche"
                onClick={() => setOpened(null)}
              >
                <X size={20} />
              </button>
            </div>
            <div className="drawer-scroll">
              <div className="drawer-store">
                <Store size={25} />
                <button
                  className={
                    "button small " + (opened.selected ? "light" : "ghost")
                  }
                  disabled={!!busy || !!opened.archived}
                  onClick={() => task("selection", () => toggle(opened))}
                >
                  {opened.selected ? <Check size={13} /> : <Plus size={13} />}{" "}
                  {opened.selected ? "Dans ma sélection" : "Sélectionner"}
                </button>
              </div>
              <h2>{opened.name}</h2>
              <div className="button-group">{archiveButton(opened)}{opened.archived && <span className="demo-tag">Archivé</span>}</div>
              {opened.archived && <p className="source-note">Dossier conservé. Désarchivez ce lead pour le sélectionner ou préparer une nouvelle proposition.</p>}
              <p className="address">
                <MapPin size={13} />
                {opened.address}
              </p>
              <div className="tags">
                <span>{opened.category}</span>
                {opened.website && <span>Site web</span>}
                {opened.demo && (
                  <span className="demo-tag">Démonstration fictive</span>
                )}
              </div>
              <section className="dossier">
                <div className="section-top">
                  <h3>Le dossier de l’entreprise</h3>
                  <Download size={15} />
                </div>
                <p>
                  {Object.keys(opened.fields).length} informations ·{" "}
                  {["email", "phone", "website"].filter(
                    (k) => opened[k as "email" | "phone" | "website"],
                  ).length + Object.keys(opened.socials).length}{" "}
                  coordonnées et liens
                </p>
                <div className="contact-grid">
                  {[
                    ["email", "Email"],
                    ["phone", "Téléphone"],
                    ["website", "Site web"],
                    ["instagram", "Instagram"],
                    ["facebook", "Facebook"],
                    ["linkedin", "LinkedIn"],
                    ["whatsapp", "WhatsApp"],
                  ].map(([key, label]) => {
                    const exists =
                      key in opened
                        ? !!opened[key as "email" | "phone" | "website"]
                        : !!opened.socials[key];
                    return (
                      <div key={key} className={exists ? "found" : ""}>
                        <strong>{label}</strong>
                        <span>{exists ? "Trouvé" : "Non trouvé"}</span>
                      </div>
                    );
                  })}
                </div>
                <p className="source-note">
                  « Non trouvé » signifie absent des sources consultées. Les
                  données restent à confirmer.
                </p>
              </section>
              {opened.demo ? (
                <div className="banner demo-detail">
                  <Sparkles size={20} />
                  <span>
                    Fiche fictive pour découvrir les parcours. Les coordonnées,
                    avis et audits réels sont volontairement absents.
                  </span>
                </div>
              ) : (
                <>
                  <div className="data-fields">
                    {Object.entries(opened.fields).map(([key, field]) => (
                      <div key={key}>
                        <span>
                          {(
                            {
                              name: "Nom",
                              email: "Email",
                              phone: "Téléphone",
                              website: "Site web",
                              address: "Adresse",
                              rating: "Note",
                              reviews: "Avis",
                              hours: "Horaires",
                            } as Record<string, string>
                          )[key] || key}{" "}
                          · {field.source}
                        </span>
                        <strong>
                          {safeUrl(field.value) ? (
                            <Link href={field.value}>{field.value}</Link>
                          ) : (
                            field.value
                          )}
                        </strong>
                        <small>{field.qualification}</small>
                        <small>
                          Collecté le {date(field.collectedAt)}{" "}
                          {field.url && (
                            <Link href={field.url}>Voir la source</Link>
                          )}
                        </small>
                      </div>
                    ))}
                  </div>
                  {opened.rating !== null && (
                    <div className="audit">
                      <h3>Avis et informations</h3>
                      <p>
                        {opened.rating}/5 · {opened.reviews ?? "—"} avis
                      </p>
                      {opened.hours && <p>{opened.hours}</p>}
                    </div>
                  )}
                </>
              )}
              {opened.audit && (
                <section className="audit">
                  <span className="eyebrow">
                    OBSERVATIONS TECHNIQUES · {date(opened.audit.checkedAt)}
                  </span>
                  <h3>Un premier regard sur le site</h3>
                  <p>
                    Score indicatif : {opened.audit.score}/100 de signaux à
                    examiner. Ce contrôle ne juge pas le design.
                  </p>
                  {opened.audit.observations.map((s) => (
                    <p key={s}>
                      <CheckCircle2 size={14} />
                      {s}
                    </p>
                  ))}
                  <small>
                    Technologie : {opened.audit.technology}. Le rendu mobile n’a
                    pas été testé visuellement.
                  </small>
                  {!!opened.audit.pages?.length && (
                    <details className="audit-pages">
                      <summary>{opened.audit.pages.length} page(s) collectée(s) pour votre refonte</summary>
                      {opened.audit.pages.map((source) => <p key={source.url}><Link href={source.url}>{source.title || source.url}</Link></p>)}
                      {opened.audit.crawlWarnings?.map((warning) => <p key={warning}>{warning}</p>)}
                    </details>
                  )}
                </section>
              )}
              {opened.photos.length > 0 && (
                <section className="prospect-photos">
                  <h3>Photos publiques · source Apify</h3>
                  <div>
                    {opened.photos.filter(safeUrl).map((url) => (
                      <a
                        key={url}
                        href={safeUrl(url)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <img
                          referrerPolicy="no-referrer"
                          src={safeUrl(url)}
                          alt={"Photo publiée de " + opened.name}
                          loading="lazy"
                        />
                      </a>
                    ))}
                  </div>
                </section>
              )}
              <section className="drawer-engine">
                {!opened.demo && opened.email && <label className="check-label">
                  <input type="checkbox" checked={!!opened.doNotContact} disabled={!!busy} onChange={(e) => {
                    const doNotContact = e.target.checked;
                    task("opt-out", async () => { await api(`/prospects/${opened.id}`, "PATCH", { doNotContact }); await refresh(); setNotice({ text: doNotContact ? "Adresse ajoutée à la liste des personnes à ne plus contacter." : "Interdiction de contact retirée pour cette adresse." }); });
                  }} /> Ne plus contacter cette adresse
                </label>}
                <label>
                  MOTEUR DE PROPOSITION
                  <select
                    value={engine}
                    onChange={(e) => setEngine(e.target.value as Engine)}
                  >
                    {Object.entries(engines).map(([k, e]) => (
                      <option value={k} key={k}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </label>
                <p>{engines[engine].description}</p>
              </section>
              <button
                className="button ghost full"
                disabled={!!busy || !!opened.archived || !opened.website || opened.demo}
                onClick={() =>
                  task("analyze", async () => {
                    await api(`/prospects/${opened.id}/analyze`, "POST", {});
                    await refresh();
                    setNotice({
                      text: "Analyse enregistrée avec ses sources.",
                    });
                  })
                }
              >
                {busy === "analyze" ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Globe size={16} />
                )}
                Analyser le site existant
              </button>
              <p className="source-note">
                Les sites sont consultés uniquement à votre demande. Les
                informations collectées restent dans votre base privée.
              </p>
            </div>
            <div className="drawer-actions">
              <button
                className="button ghost full"
                disabled={!!busy || !!opened.archived}
                onClick={() => createHandoff(opened)}
              >
                <Monitor size={16} />
                {busy === "handoff"
                  ? "Préparation…"
                  : "Préparer le prompt Hermès"}
              </button>
              <button
                className="button primary full"
                disabled={!!busy || !!opened.archived}
                onClick={() => generate(opened)}
              >
                {busy === "drafts" ? (
                  <LoaderCircle className="spin" size={17} />
                ) : (
                  <Sparkles size={17} />
                )}
                Préparer les 3 variantes
                <ArrowRight size={16} />
              </button>
              <small>
                Modèles locaux personnalisés · aucune API IA
              </small>
            </div>
          </aside>
        </>
      )}
      {notice && (
        <div
          className={"toast " + (notice.error ? "error" : "")}
          role={notice.error ? "alert" : "status"}
        >
          {notice.error ? (
            <AlertCircle size={20} />
          ) : (
            <CheckCircle2 size={20} />
          )}
          <span>{notice.text}</span>
          <button
            className="icon-button"
            aria-label="Fermer la notification"
            onClick={() => setNotice(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {help && (
        <Modal title="Bienvenue chez vous." onClose={() => setHelp(false)}>
          <div className="help-content">
            <Target size={44} />
            <p>
              ProspectAI vous aide à découvrir des entreprises locales et à
              préparer une prise de contact qui vous ressemble.
            </p>
            <ol>
              <li>Renseignez votre business et vos services.</li>
              <li>
                Explorez la démo, recherchez dans OpenStreetMap ou activez
                Apify.
              </li>
              <li>Sélectionnez un prospect et vérifiez ses sources.</li>
              <li>Préparez vos brouillons et relisez-les.</li>
            </ol>
            <div className="banner">
              <ShieldCheck size={20} />
              <span>
                Aucun message n’est envoyé automatiquement. Les recherches et
                la lecture des sites consultent leurs sources. Les prompts sont
                transmis à Hermès uniquement quand vous les copiez et les lui donnez.
              </span>
            </div>
            <button
              className="button primary"
              onClick={() => {
                setHelp(false);
                go("settings");
              }}
            >
              Configurer mon business
              <ArrowRight size={15} />
            </button>
          </div>
        </Modal>
      )}
      {importing && (
        <ImportModal
          onClose={() => setImporting(false)}
          busy={!!busy}
          onImport={(text) =>
            task("import", async () => {
              receive(await api("/import", "POST", { text }));
              await refresh();
              setImporting(false);
              go("search");
            })
          }
        />
      )}
      {enrichment && <Modal title="Apify · vérifier avant de payer" onClose={() => setEnrichment(null)}>
        <p>{enrichment.plan.message}</p>
        <p>{enrichment.plan.excluded} déjà collecté(s) ou réservé(s) exclu(s) · {enrichment.plan.missing} sans identifiant exploitable · {enrichment.plan.remaining} pour un lot ultérieur.</p>
        <p className="source-note">Les recherches Google Maps par mot-clé sont bloquées. Ce mode ne traite que des Place IDs fournis dans vos candidats importés, vérifiés avant l’appel. Les détails et contacts sont facturés selon Apify.</p>
        {!!enrichment.plan.candidates.length && <><ol>{enrichment.plan.candidates.map((p) => <li key={p.placeId}>{p.name}</li>)}</ol>
          <label>Budget d’arrêt demandé (USD)<input type="number" min="0.05" step="0.05" max={state.settings.limits.budget} value={budget} onChange={(e) => setBudget(Number(e.target.value))} /></label>
          <p className="source-note">Le seuil de coût est transmis à Apify ; son application dépend des événements facturables. Aucun appel ne sera lancé si les identifiants ont déjà été réservés.</p>
          {state.settings.apifyConfigured ? <button className="button primary" disabled={!!busy || !!state.settings.pending} onClick={() => task("enrich", async () => {
            const result = await api("/apify/enrich", "POST", { prospectIds: enrichment.ids, planId: enrichment.plan.planId, requestId: crypto.randomUUID(), budget });
            receive(result); setEnrichment(null); await refresh();
          })}>Enrichir {enrichment.plan.candidates.length} identifiants inédits · max. {budget.toFixed(2)} USD</button> : <button className="button ghost" onClick={() => { setEnrichment(null); go("settings"); }}>Configurer Apify</button>}
        </>}
        <p>Pour proposer de nouveaux candidats à ce mode, importez un CSV avec une colonne <code>placeId</code> contenant leur véritable identifiant Google Maps. Un nom ou une adresse seuls ne suffisent pas pour lancer un paiement.</p>
      </Modal>}
      {preview && <Modal title="Prompt et dossier pour Hermès IA" onClose={() => setPreview(null)} wide><HermesPrompt key={preview.id} handoff={preview} /></Modal>}

    </div>
  );
}
function Kpi({
  Icon,
  value,
  label,
  note,
}: {
  Icon: typeof Store;
  value: string;
  label: string;
  note: string;
}) {
  return (
    <div className="card kpi">
      <div>
        <span>
          <Icon size={21} />
        </span>
        <strong>{value}</strong>
      </div>
      <h4>{label}</h4>
      <p>{note}</p>
    </div>
  );
}
function PageHero({
  eyebrow,
  title,
  accent,
  text,
}: {
  eyebrow: string;
  title: string;
  accent: string;
  text: string;
}) {
  return (
    <div className="page-hero">
      <div>
        <div className="eyebrow">
          <i className="dot" />
          {eyebrow}
        </div>
        <h1>
          {title} <em>{accent}</em>
        </h1>
        <p>{text}</p>
      </div>
      <div className="hero-orbit">
        <div>
          <Sparkles size={33} />
        </div>
      </div>
    </div>
  );
}
function Empty({
  Icon,
  title,
  text,
  action,
}: {
  Icon: typeof Search;
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={27} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const container = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    container.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
      if (e.key === "Tab") {
        const nodes = [...(container.current?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary,[tabindex="0"]') || [])].filter((node) => node.offsetParent !== null);
        const first = nodes[0], last = nodes.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", handler);
    return () => { window.removeEventListener("keydown", handler); document.body.style.overflow = oldOverflow; previous?.focus(); };
  }, []);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        ref={container}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={"modal " + (wide ? "wide" : "")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>{title}</h2>
          <button
            autoFocus
            className="icon-button"
            aria-label="Fermer"
            onClick={onClose}
          >
            <X size={21} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
function ImportModal({
  onClose,
  busy,
  onImport,
}: {
  onClose: () => void;
  busy: boolean;
  onImport: (s: string) => void;
}) {
  const [text, setText] = useState("");
  return (
    <Modal title="Votre terrain de prospection, à vous." onClose={onClose}>
      <p className="muted">
        Collez une liste d’URLs (une par ligne), ou importez un CSV avec les
        colonnes name, website, email, phone, city, category, address, lat, lng. Ajoutez placeId pour un enrichissement Apify ciblé (facultatif).
        Maximum 200 lignes.
      </p>
      <input
        type="file"
        accept=".csv,.txt"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) setText(await f.text());
        }}
      />
      <textarea
        rows={9}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={
          "name,website,city\nMon entreprise,https://exemple.fr,Papeete"
        }
      />
      <p className="source-note">
        Importez uniquement des coordonnées professionnelles publiques que vous
        êtes autorisé à utiliser.
      </p>
      <button
        className="button primary"
        disabled={busy || !text.trim()}
        onClick={() => onImport(text)}
      >
        <Upload size={15} />
        Importer mes entreprises
      </button>
    </Modal>
  );
}
function DraftCard({ draft, email, onSave, onCopy, onDelete }: {
  draft: Draft; email: string; onSave: (s: string, b: string) => void; onCopy: (b: string) => void; onDelete: () => void;
}) {
  const [subject, setSubject] = useState(draft.subject), [body, setBody] = useState(draft.body), [confirm, setConfirm] = useState(false);
  return <article className="card draft-card">
    <div className="section-top"><span className="eyebrow">{draft.variant}</span><button className="icon-button" aria-label="Supprimer ce brouillon" onClick={() => setConfirm(!confirm)}><Trash2 size={16} /></button></div>
    {confirm && <div className="banner"><span>Supprimer ce brouillon ?</span><button className="text-link" onClick={onDelete}>Confirmer</button></div>}
    <h3>{draft.prospectName}</h3><p className="muted">{date(draft.createdAt)} · {email || "Email à trouver · utilisable en DM"}</p>
    <label>OBJET<input value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
    <label>VOTRE MESSAGE<textarea rows={16} value={body} onChange={(e) => setBody(e.target.value)} /></label>
    <div className="draft-actions"><button className="button primary small" onClick={() => onSave(subject, body)}><Check size={14} /> Enregistrer</button><button className="button ghost small" onClick={() => onCopy(subject + "\n\n" + body)}><Copy size={14} /> Copier</button></div>
    <small className="source-note">Brouillon à relire ou à confier à Hermès. ProspectAI n’accède à aucune messagerie et n’envoie aucun message.</small>
  </article>;
}
function SettingsPage({
  settings,
  busy,
  onSave,
  onRead,
  onError,
  onVerify,
  onDelete,
}: {
  settings: Settings;
  busy: boolean;
  onSave: (s: any) => void;
  onRead: (url: string) => Promise<any>;
  onError: (e: string) => void;
  onVerify: () => void;
  onDelete: () => void;
}) {
  const [business, setBusiness] = useState(settings.business),
    [limits, setLimits] = useState(settings.limits),
    [apifyKey, setApifyKey] = useState(""),
    [reading, setReading] = useState(false),
    [deleteText, setDeleteText] = useState("");
  const field = (
    key: keyof Business,
    label: string,
    placeholder = "",
    multi = false,
  ) => (
    <label>
      {label}
      {multi ? (
        <textarea
          rows={3}
          value={business[key] || ""}
          placeholder={placeholder}
          onChange={(e) => setBusiness({ ...business, [key]: e.target.value })}
        />
      ) : (
        <input
          value={business[key] || ""}
          placeholder={placeholder}
          onChange={(e) => setBusiness({ ...business, [key]: e.target.value })}
        />
      )}
    </label>
  );
  return (
    <>
      <PageHero
        eyebrow="TOUT COMMENCE PAR VOUS"
        title="Un espace à votre"
        accent="image."
        text="Vos services, votre ton, vos outils. Les clés restent protégées côté serveur."
      />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            business,
            limits,
            ...(apifyKey ? { apifyKey } : {}),
          });
          setApifyKey("");
        }}
      >
        <div className="settings-layout">
          <section className="card settings-card">
            <div className="section-title">
              <span className="setting-icon">
                <Store size={20} />
              </span>
              <div>
                <h2>Mon business</h2>
                <p>Pour des propositions qui vous ressemblent.</p>
              </div>
              <span className="pill">
                {settings.onboarded ? "Configuré" : "Première étape"}
              </span>
            </div>
            <div className="read-site">
              <label>
                VOTRE SITE WEB
                <input
                  type="url"
                  value={business.website}
                  placeholder="https://mon-agence.fr"
                  onChange={(e) =>
                    setBusiness({ ...business, website: e.target.value })
                  }
                />
              </label>
              <button
                type="button"
                className="button ghost"
                disabled={reading || !business.website}
                onClick={async () => {
                  setReading(true);
                  try {
                    const data = await onRead(business.website);
                    setBusiness((b) => ({
                      ...b,
                      ...data,
                      name: data.name || b.name,
                      services: data.services || b.services,
                    }));
                  } catch (e) {
                    onError((e as Error).message);
                  } finally {
                    setReading(false);
                  }
                }}
              >
                {reading ? (
                  <LoaderCircle className="spin" size={15} />
                ) : (
                  <Sparkles size={15} />
                )}
                Préremplir depuis mon site
              </button>
            </div>
            <p className="source-note">
              Extraction des textes publics du site, à relire avant
              d’enregistrer.
            </p>
            <div className="form-grid">
              {field("name", "NOM DU BUSINESS")}
              {field("userName", "VOTRE NOM")}
              {field(
                "services",
                "SERVICES PROPOSÉS",
                "Création de sites, agents personnels…",
                true,
              )}
              {field("prices", "TARIFS INDICATIFS", "Sur devis", true)}
              {field("zone", "VOTRE ZONE")}
              {field("tone", "TON DE COMMUNICATION")}
              {field("instagram", "INSTAGRAM", "https://instagram.com/…")}
              {field("facebook", "FACEBOOK", "https://facebook.com/…")}
              {field("hermesInstructions", "VOS CONSIGNES COMPLÉMENTAIRES POUR HERMÈS", "Préférences de style, exemples, mode de livraison…", true)}
            </div>
          </section>
          <section className="card settings-card">
            <div className="section-title">
              <span className="setting-icon">
                <Settings2 size={20} />
              </span>
              <div>
                <h2>Vos outils, vos limites</h2>
                <p>Des connexions activées en toute connaissance de cause.</p>
              </div>
            </div>
            <label>
              CLÉ API APIFY{" "}
              <span className="configured">
                {settings.apifyConfigured ? "Configurée" : "Non configurée"}
              </span>
              <input
                type="password"
                autoComplete="new-password"
                value={apifyKey}
                onChange={(e) => setApifyKey(e.target.value)}
                placeholder="Laisser vide pour conserver la clé actuelle"
              />
            </label>
            <div className="form-grid">
              <label>
                ENTREPRISES PAR LOT · MAXIMUM 25
                <input
                  type="number"
                  min="1"
                  max="25"
                  value={limits.max}
                  onChange={(e) =>
                    setLimits({ ...limits, max: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                BUDGET APIFY (USD)
                <input
                  type="number"
                  min="0.05"
                  max="10"
                  step="0.05"
                  value={limits.budget}
                  onChange={(e) =>
                    setLimits({ ...limits, budget: Number(e.target.value) })
                  }
                />
              </label>
            </div>
            <div className="banner">
              <ShieldCheck size={19} />
              <p>
                Les recherches par mot-clé sont gratuites. Apify exige un lot
                d’identifiants inédits vérifiés avant paiement, puis votre clic.
                Le budget est transmis comme seuil d’arrêt à
                Apify ; un événement facturable peut dépasser ce seuil. La
                collecte est verrouillée si le schéma ou la tarification n’est
                pas vérifiable.
              </p>
            </div>
            <button
              type="button"
              className="button ghost full"
              disabled={busy || !settings.apifyConfigured}
              onClick={onVerify}
            >
              <RefreshCw size={15} />
              Vérifier Apify sans lancer de collecte
            </button>
            <hr />
            <h3>Hermès IA · transfert manuel</h3>
            <p className="muted">Les prompts de projet et les dossiers sont préparés localement, sans API de rédaction. Copiez le prompt dans votre échange avec Hermès et joignez le dossier JSON.</p>
            <p className="source-note">Les consignes reprennent votre fonctionnement : travail par étapes avec votre « OK », aucun frais, compte, accès, publication ou message sans votre accord, protection des secrets et vérifications réelles avant livraison.</p>
            <p className="source-note">Votre abonnement ChatGPT peut servir dans votre interface de conversation habituelle ; il ne constitue pas une clé API. Aucun identifiant ChatGPT, Gmail ou Vercel n’est demandé ici.</p>
          </section>
        </div>
        <div className="settings-save">
          <span>
            <ShieldCheck size={15} />
            Interface en français · {settings.storage}
          </span>
          <button className="button primary" disabled={busy || reading}>
            <Check size={16} />
            Enregistrer mon espace
          </button>
        </div>
      </form>
      <section className="card settings-card data-card">
        <div>
          <h3>Vos données vous appartiennent.</h3>
          <p>
            Exportez vos recherches, brouillons et dossiers Hermès. Les clés API sont
            exclues de l’export.
          </p>
        </div>
        <a className="button ghost" href="/api/export">
          <Download size={16} />
          Exporter mes données
        </a>
        <details>
          <summary className="danger">Supprimer les données locales</summary>
          <p>
            Cette action efface prospects, recherches, brouillons, livrables et
            paramètres. Tapez SUPPRIMER pour confirmer.
          </p>
          <input
            value={deleteText}
            onChange={(e) => setDeleteText(e.target.value)}
            placeholder="SUPPRIMER"
            aria-label="Confirmation de suppression"
          />
          <button
            className="button danger-button"
            disabled={deleteText !== "SUPPRIMER" || busy}
            onClick={onDelete}
          >
            <Trash2 size={15} />
            Supprimer définitivement
          </button>
        </details>
      </section>
    </>
  );
}
