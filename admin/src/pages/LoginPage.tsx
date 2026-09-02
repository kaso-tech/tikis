import { useState, type FormEvent } from "react";
import { useAdminAuth } from "../lib/auth";

export default function LoginPage() {
  const { login } = useAdminAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email.trim(), password);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Connexion impossible.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-icon">⚙</div>
        <p className="login-title">Console opérateur</p>
        <p className="login-subtitle">Accès réservé aux administrateurs Tikis. Authentification par email et mot de passe.</p>
        {error ? <div className="banner-error">{error}</div> : null}
        <div className="login-form">
          <div>
            <label className="field-label" htmlFor="email">Email</label>
            <input id="email" className="input" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@tikis.app" />
          </div>
          <div>
            <label className="field-label" htmlFor="password">Mot de passe</label>
            <input id="password" className="input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mot de passe" />
          </div>
          <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: "100%", justifyContent: "center", padding: "10px" }}>
            {loading ? "Connexion…" : "Se connecter"}
          </button>
        </div>
        <div className="login-hint">
          Première utilisation ? Le bootstrap admin se fait via la CLI :<br />
          <code style={{ background: "var(--surface-2)", padding: "1px 6px", borderRadius: 4 }}>pnpm admin:bootstrap email@tikis.app</code>
        </div>
      </form>
    </div>
  );
}
