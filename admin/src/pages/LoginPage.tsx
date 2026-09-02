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
        <p className="login-title">Tikis — Administration</p>
        <p className="login-subtitle">Accès réservé à l’équipe Tikis.</p>
        {error ? <div className="error-banner">{error}</div> : null}
        <label className="field-label" htmlFor="email">E-mail</label>
        <input id="email" className="input" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} style={{ marginBottom: 14 }} />
        <label className="field-label" htmlFor="password">Mot de passe</label>
        <input id="password" className="input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} style={{ marginBottom: 20 }} />
        <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: "100%" }}>
          {loading ? "Connexion…" : "Se connecter"}
        </button>
      </form>
    </div>
  );
}
