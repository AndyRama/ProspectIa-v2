import { useEffect, useState } from "react";
import { LockKeyhole, LoaderCircle, Target } from "lucide-react";
import { api } from "./api";
import App from "./App";

export default function AuthGate() {
  const [status, setStatus] = useState<{ required: boolean; authenticated: boolean } | null>(null);
  const [password, setPassword] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { api("/auth/status").then(setStatus).catch((e) => setError(e.message)); }, []);
  if (status?.authenticated) return <App onLogout={status.required ? async () => {
    try { await api("/auth/logout", "POST", {}); setStatus({ required: true, authenticated: false }); }
    catch (e) { setError((e as Error).message); }
  } : undefined} />;
  return <div className="auth-screen"><form className="card auth-card" onSubmit={async (e) => {
    e.preventDefault(); setBusy(true); setError("");
    try { await api("/auth/login", "POST", { password }); setPassword(""); setStatus(await api("/auth/status")); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }}><span className="auth-logo"><Target size={30} /> prospectai.</span>
    <h1>Votre espace <em>privé.</em></h1><p>Connectez-vous pour retrouver vos prospects et préparer vos prises de contact.</p>
    {status ? <><label>Mot de passe de l’espace<input type="password" autoFocus autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      <button className="button primary full" disabled={busy}>{busy ? <LoaderCircle size={17} className="spin" /> : <LockKeyhole size={17} />} Se connecter</button></> : !error ? <LoaderCircle className="spin" /> : <button type="button" className="button ghost" onClick={() => location.reload()}>Réessayer</button>}
    {error && <p className="danger" role="alert">{error}</p>}
    <small>Le mot de passe se configure dans APP_PASSWORD, côté serveur.</small>
  </form></div>;
}
