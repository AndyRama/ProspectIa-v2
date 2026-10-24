import { useState } from "react";
import { Check, Copy, Download, FileText } from "lucide-react";
import type { HermesHandoff } from "../../server/types";

export default function HermesPrompt({ handoff }: { handoff: Omit<HermesHandoff, "dossier"> }) {
  const [copied, setCopied] = useState(false), [error, setError] = useState("");
  return <div className="hermes-prompt">
    <p className="hermes-intro">Téléchargez le dossier, puis donnez-le à Hermès avec le prompt ci-dessous. Aucun compte, aucune clé et aucun accès à votre messagerie ne sont transmis.</p>
    <ol className="hermes-steps"><li><strong>Joignez le dossier JSON</strong> : toutes les données collectées, les contenus disponibles, leurs sources et leurs dates.</li><li><strong>Copiez le prompt</strong> et collez-le dans votre échange avec Hermès IA.</li><li><strong>Validez son étape 1</strong> : Hermès doit reformuler le besoin et attendre votre « OK » avant de construire.</li></ol>
    {!!handoff.warnings.length && <div className="banner"><FileText size={18} /><span>{handoff.warnings.join(" · ")}</span></div>}
    <div className="button-group hermes-actions">
      <a className="button primary" href={`/api/handoffs/${handoff.id}/export?format=dossier`}><Download size={16} /> Dossier complet · JSON</a>
      <button className="button ghost" onClick={async () => {
        try { await navigator.clipboard.writeText(handoff.prompt); setCopied(true); setError(""); }
        catch { setError("La copie n’est pas disponible dans ce navigateur. Sélectionnez le texte ci-dessous et copiez-le manuellement."); }
      }}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "Prompt copié" : "Copier le prompt"}</button>
      <a className="button ghost" href={`/api/handoffs/${handoff.id}/export`}><Download size={16} /> Prompt · Markdown</a>
    </div>
    {error && <p role="alert" className="danger">{error}</p>}
    <label className="hermes-text-label">PROMPT À TRANSMETTRE À HERMÈS<textarea readOnly rows={22} value={handoff.prompt} /></label>
    <p className="source-note">Le résumé inclus dans le prompt ne remplace pas le dossier joint. Les données manquantes et les limites de collecte sont signalées. Hermès travaille dans son propre environnement ; ProspectAI ne pilote pas ses actions.</p>
  </div>;
}
