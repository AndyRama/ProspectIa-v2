import { useEffect, useRef, useState } from "react";
import type { Business, Prospect } from "../../server/types";
import type { AIQualification, QualificationPreview, QualificationRun } from "../../server/qualificationTypes";
import { api } from "./api";

export const gemmaModel = "google/gemma-4-26b-a4b-it:free";
const recoveryKey = "prospectia.gemma.pending.v1";
type Recovery = { id: string; receipt?: QualificationRun };
// Only the operation token/acknowledgement, never CRM records or credentials.
function readRecovery(): Recovery | null {
  const raw = localStorage.getItem(recoveryKey);
  if (!raw) return null;
  const value = JSON.parse(raw) as Recovery;
  if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.id)) throw Error("Récupération locale invalide. Ne relancez pas la qualification.");
  return value;
}
export function hasGemmaRecovery() {
  try { return !!localStorage.getItem(recoveryKey); } catch { return false; }
}
export const gemmaEligible = (p: Prospect) => !p.demo && !p.archived && !p.doNotContact && !p.duplicateOf;
export function GemmaBadge({ qualification: q }: { qualification?: AIQualification }) {
  if (!q) return <small className="source-note">Gemma · Non qualifié</small>;
  const label = { qualified: "Qualifié", review: "À revoir", rejected: "Non retenu" }[q.decision];
  return <div className="source-note" aria-label="Seconde qualification Gemma" style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>
    <strong>Gemma · {label} · {q.score}/100</strong><div>{new Date(q.evaluatedAt).toLocaleDateString("fr-FR")} · {q.reason}</div>
    {!!q.missingData.length && <div>Données manquantes : {q.missingData.join(" · ")}</div>}
  </div>;
}
export default function GemmaQualificationDialog({ prospects, business, configured, onClose, onRefresh, onReceipt }: {
  prospects: Prospect[]; business: Business; configured: boolean; onClose: () => void;
  onRefresh: () => Promise<unknown>; onReceipt: (run: QualificationRun) => void;
}) {
  const eligible = prospects.filter(gemmaEligible);
  const selected = eligible.filter(p => p.selected);
  const [ids, setIds] = useState(() => (selected.length ? selected : eligible.slice(0, 10)).map(p => p.id));
  const [criteria, setCriteria] = useState("");
  const [preview, setPreview] = useState<QualificationPreview | null>(null);
  const [run, setRun] = useState<QualificationRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [locked, setLocked] = useState(hasGemmaRecovery);
  const [done, setDone] = useState(false);
  const [expired, setExpired] = useState(false);
  const previewRef = useRef<QualificationPreview | null>(null);
  const revision = useRef(0);
  const busyRef = useRef(false);
  const operationRef = useRef<Recovery | null>(null);
  const mountedRef = useRef(true);
  const scopeKey = JSON.stringify([business, prospects.map(p => [p.id, p.selected, p.archived, p.demo, p.doNotContact, p.duplicateOf])]);
  const scopeRef = useRef(scopeKey);
  if (scopeRef.current !== scopeKey) { scopeRef.current = scopeKey; revision.current++; previewRef.current = null; }
  const renderedRevision = revision.current;
  const invalidate = () => { revision.current++; previewRef.current = null; setPreview(null); setError(""); };
  useEffect(() => {
    if (!preview) { setExpired(false); return; }
    const delay = Date.parse(preview.expiresAt) - Date.now();
    setExpired(!Number.isFinite(delay) || delay <= 0);
    if (!Number.isFinite(delay) || delay <= 0) return;
    const timer = setTimeout(() => setExpired(true), delay);
    return () => clearTimeout(timer);
  }, [preview]);
  const close = () => { if (!busyRef.current && !operationRef.current && !locked) { invalidate(); onClose(); } };
  const finishReadback = async (result: QualificationRun) => {
    if (operationRef.current?.id !== result.id) throw Error("Réponse d’une autre opération.");
    if (operationRef.current.receipt?.status === "completed" && result.status !== "completed") {
      previewRef.current = null;
      setRun(operationRef.current.receipt);
      onReceipt(operationRef.current.receipt);
      setError("Qualification enregistrée ; lecture incohérente. Actualisez le résultat uniquement, sans relancer.");
      return;
    }
    setRun(result);
    if (result.status === "completed") {
      // Acknowledge in memory and durably before awaiting collection refresh.
      operationRef.current = { id: result.id, receipt: result };
      onReceipt(result);
      try { localStorage.setItem(recoveryKey, JSON.stringify(operationRef.current)); }
      catch { setError("Qualification enregistrée ; reçu local indisponible. Actualisez le résultat, sans relancer."); return; }
      try {
        await onRefresh();
        if (readRecovery()?.id === result.id) localStorage.removeItem(recoveryKey);
        operationRef.current = null; setLocked(false); setDone(true); setError("");
      } catch { setError("Qualification enregistrée, mais actualisation impossible. Actualisez le résultat uniquement, sans relancer."); }
    } else if (result.status === "failed") {
      setError("Qualification échouée (clé, modèle gratuit, quota ou réponse indisponible). Les qualifications précédentes sont conservées. Un nouvel aperçu nécessite votre action explicite.");
    } else if (result.status === "prepared") {
      if (result.preview) { previewRef.current = result.preview; setPreview(result.preview); setCriteria(result.preview.criteria); }
      setError("Opération préparée, non lancée. Vérifiez l’aperçu puis reprenez explicitement la confirmation du même lot.");
    } else {
      setError(result.status === "running" ? "Qualification en cours. Actualisez le résultat ; aucun second lancement." : "Réponse incertaine. Qualification verrouillée : actualisation uniquement, aucun second lancement.");
    }
  };
  const recover = async () => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(""); setLocked(true);
    try {
      const token = operationRef.current || readRecovery();
      if (!token) throw Error("Token de récupération indisponible.");
      operationRef.current = token;
      await finishReadback(await api<QualificationRun>(`/qualification/${token.id}`));
    } catch { setError(operationRef.current?.receipt ? "Qualification enregistrée, mais actualisation impossible. Actualisez le résultat uniquement." : "Résultat indisponible. Gardez cette opération et actualisez le résultat, sans relancer."); }
    finally { busyRef.current = false; setBusy(false); }
  };
  useEffect(() => {
    mountedRef.current = true;
    if (hasGemmaRecovery()) void recover();
    return () => { mountedRef.current = false; revision.current++; previewRef.current = null; };
  }, []);
  const prepare = async () => {
    if (!mountedRef.current || renderedRevision !== revision.current || busyRef.current || operationRef.current || locked || !ids.length || ids.length > 10 || criteria.trim().length < 20 || criteria.trim().length > 2000 || ids.some(id => !eligible.some(p => p.id === id))) return;
    busyRef.current = true; setBusy(true); setError("");
    const version = revision.current;
    try {
      if (readRecovery()) { setLocked(true); setError("Une opération reste à récupérer. Actualisez son résultat avant un nouvel aperçu."); return; }
      const result = await api<QualificationPreview>("/qualification/preview", "POST", { ids, criteria: criteria.trim() });
      if (mountedRef.current && version === revision.current) { previewRef.current = result; setPreview(result); }
    } catch { setError("Aperçu indisponible. Vérifiez votre profil enregistré et réessayez."); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const confirm = async (plan: QualificationPreview, resume = false) => {
    if (busyRef.current || done || !configured || previewRef.current !== plan || !Number.isFinite(Date.parse(plan.expiresAt)) || Date.parse(plan.expiresAt) <= Date.now() || !plan.leads.length || plan.leads.length > 10 || (operationRef.current && !resume)) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      const existing = readRecovery();
      if (existing && (!resume || existing.id !== plan.id || existing.receipt || operationRef.current?.receipt || run?.status !== "prepared")) { setLocked(true); setError("Une opération reste à récupérer. Actualisez son résultat, sans relancer."); return; }
      // Storage failure blocks POST. The server-issued UUID is persisted first.
      localStorage.setItem(recoveryKey, JSON.stringify({ id: plan.id }));
      operationRef.current = { id: plan.id };
      setLocked(true); previewRef.current = null;
      let result: QualificationRun;
      try { result = await api<QualificationRun>(`/qualification/${plan.id}/run`, "POST", { confirmed: true }); }
      catch { setError("Réponse perdue ou refusée. Actualisez le résultat pour récupérer cette opération ; aucun second lancement automatique."); return; }
      await finishReadback(result);
    } catch { setError("Stockage local indisponible : aucun lancement. Autorisez le stockage puis réessayez."); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const frozen = busy || locked || done;
  const releaseKnownOperation = () => {
    if (busyRef.current || operationRef.current?.receipt || !run || !(run.status === "failed" || (run.status === "prepared" && expired))) return;
    try {
      const stored = readRecovery();
      if (stored && stored.id !== run.id) throw Error("Autre opération en cours.");
      if (stored) localStorage.removeItem(recoveryKey);
      operationRef.current = null; setLocked(false); setRun(null); invalidate();
    } catch { setError("Stockage local indisponible ou autre opération en cours. Gardez l’opération et actualisez."); }
  };
  return <div className="modal-backdrop" onClick={close}>
    <section className="modal wide" role="dialog" aria-modal="true" aria-labelledby="gemma-title" onClick={e => e.stopPropagation()}>
      <div className="modal-header"><h2 id="gemma-title">Requalifier avec Gemma</h2><button className="icon-button" aria-label="Fermer la qualification" disabled={busy || locked} onClick={close}>×</button></div>
      <p>Seconde qualification commerciale · {gemmaModel} · modèle gratuit, sans repli payant.</p>
      <p>Profil enregistré : <strong>{business.name}</strong> · {business.services} · {business.zone}</p>
      <p>{configured ? "Clé OpenRouter configurée (présence uniquement, connexion non testée)." : "Clé OpenRouter manquante : renseignez-la dans les Paramètres avant confirmation."}</p>
      <p>{selected.length ? `Sélection éligible affichée : ${selected.length} lead(s).` : "Par défaut : les 10 premiers leads éligibles affichés (ou moins)."} Maximum 10 par qualification.</p>
      <p>Exclus : {prospects.filter(p => !gemmaEligible(p)).map(p => `${p.name} (${p.demo ? "démo" : p.archived ? "archivé" : p.duplicateOf ? "alias" : "opposition au contact"})`).join(", ") || "aucun dans le périmètre affiché"}.</p>
      {ids.length > 10 && !locked && <p role="alert">Plus de 10 leads sélectionnés : réduisez le lot ou choisissez explicitement les 10 premiers affichés.</p>}
      <button className="button ghost small" disabled={frozen} onClick={() => { invalidate(); setIds(eligible.slice(0, 10).map(p => p.id)); }}>Choisir les 10 premiers éligibles affichés</button>
      <fieldset className="table-scroll" style={{ minWidth: 0, maxHeight: 220, overflowY: "auto", margin: "12px 0" }} disabled={frozen}><legend>Leads à qualifier · {ids.length}/10</legend>{eligible.map(p => <label className="flex items-center gap-2" style={{ padding: "5px 0" }} key={p.id}><input type="checkbox" checked={ids.includes(p.id)} onChange={e => { invalidate(); setIds(e.target.checked ? [...ids, p.id] : ids.filter(id => id !== p.id)); }} />{p.name} · {p.city}</label>)}</fieldset>
      <label>Critères de qualification<textarea rows={3} minLength={20} maxLength={2000} value={criteria} disabled={frozen} onChange={e => { invalidate(); setCriteria(e.target.value); }} /></label>
      <p className="source-note">Seuls le profil public, les faits publics et la présence de coordonnées sont utilisés. Aucun email, téléphone, notes, brouillons ou consignes privées transmis. Aucun site visité. Aucun statut commercial, audit ou choix de sélection modifié.</p>
      <p>Seuils : ≥60 Qualifié · 40–59 À revoir · &lt;40 Non retenu.</p>
      {error && <p role="alert">{error}</p>}
      {preview && (!locked || (run?.status === "prepared" && expired)) && <button className="button ghost small" disabled={busy} onClick={locked ? releaseKnownOperation : invalidate}>Préparer un nouvel aperçu</button>}
      {preview && previewRef.current === preview && <section aria-label="Aperçu Gemma"><h3>Aperçu · {preview.leads.length} lead(s)</h3><p>{preview.business.name} · {preview.business.services} · {preview.business.zone}</p><p>{preview.criteria}</p><p>Expire le {new Date(preview.expiresAt).toLocaleString("fr-FR")}</p><ul>{preview.leads.map(p => <li key={p.id}>{p.name} · {p.city} · {p.engine}</li>)}</ul>{preview.excluded.map(p => <p key={p.id}>Exclu : {p.id} · {p.reason}</p>)}{!locked && <button className="button primary" disabled={busy || !configured || expired || Date.parse(preview.expiresAt) <= Date.now()} onClick={() => confirm(preview)}>Confirmer la qualification ({preview.leads.length})</button>}{locked && run?.status === "prepared" && <button className="button primary" disabled={busy || !configured || expired || Date.parse(preview.expiresAt) <= Date.now()} onClick={() => confirm(preview, true)}>Reprendre la confirmation ({preview.leads.length})</button>}</section>}
      {!preview && !locked && !done && <button className="button primary" disabled={busy || !ids.length || ids.length > 10 || criteria.trim().length < 20} onClick={prepare}>{busy ? "Préparation…" : "Préparer l’aperçu"}</button>}
      {locked && <button className="button ghost" disabled={busy} onClick={recover}>Actualiser le résultat</button>}
      {run?.status === "failed" && <button className="button ghost" disabled={busy} onClick={releaseKnownOperation}>Préparer un nouveau lot</button>}
      {done && run && <p role="status">Qualification terminée : {run.updated} mis à jour, {run.skipped} ignoré.</p>}
      <button className="button ghost" disabled={busy || locked} onClick={close}>{done ? "Fermer" : "Annuler"}</button>
    </section>
  </div>;
}
