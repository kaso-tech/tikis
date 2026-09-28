import { useState, type FormEvent } from "react";
import { useAdminAuth } from "../lib/auth";

export default function LoginPage() {
  const { login, verifyTotp } = useAdminAuth();
  const [step, setStep] = useState<"password" | "code">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handlePassword(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const outcome = await login(email.trim(), password);
      if (outcome === "totp_required") {
        setPassword("");
        setStep("code");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Connexion impossible.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCode(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { remainingRecoveryCodes } = await verifyTotp(code.trim());
      if (remainingRecoveryCodes !== undefined && remainingRecoveryCodes <= 3) {
        // L'écran de connexion disparaît aussitôt : l'alerte doit passer par le navigateur.
        window.alert(`Code de secours utilisé. Il vous en reste ${remainingRecoveryCodes}. Pensez à reconfigurer votre application d’authentification depuis « Mon compte ».`);
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Code refusé.";
      setError(message);
      setCode("");
      // Tentative révoquée (délai dépassé, trop d'essais) : retour au mot de passe.
      if (/expirée|Trop de codes/.test(message)) setStep("password");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      {step === "password" ? (
        <form className="login-card" onSubmit={handlePassword}>
          <div className="login-icon">⚙</div>
          <p className="login-title">Console opérateur</p>
          <p className="login-subtitle">Accès réservé aux administrateurs Tikis.</p>
          {error ? <div className="banner-error">{error}</div> : null}
          <div className="login-form">
            <div>
              <label className="field-label" htmlFor="email">Email</label>
              <input id="email" className="input" type="email" required autoFocus autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@tikis.app" />
            </div>
            <div>
              <label className="field-label" htmlFor="password">Mot de passe</label>
              <input id="password" className="input" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mot de passe" />
            </div>
            <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: "100%", justifyContent: "center", padding: "10px" }}>
              {loading ? "Connexion…" : "Se connecter"}
            </button>
          </div>
          <div className="login-hint">
            Première utilisation ? Le premier compte se crée via la CLI :<br />
            <code style={{ background: "var(--surface-2)", padding: "1px 6px", borderRadius: 4 }}>node --import tsx scripts/create-admin-user.ts</code>
          </div>
        </form>
      ) : (
        <form className="login-card" onSubmit={handleCode}>
          <div className="login-icon">✱</div>
          <p className="login-title">Double authentification</p>
          <p className="login-subtitle">Saisissez le code à 6 chiffres affiché par votre application d’authentification. Téléphone indisponible ? Un code de secours fonctionne aussi.</p>
          {error ? <div className="banner-error">{error}</div> : null}
          <div className="login-form">
            <div>
              <label className="field-label" htmlFor="totp-code">Code</label>
              <input id="totp-code" className="input" required autoFocus autoComplete="one-time-code" inputMode="text" maxLength={20} value={code} onChange={(e) => setCode(e.target.value)} placeholder="123 456" style={{ fontSize: 18, letterSpacing: "0.12em", textAlign: "center" }} />
            </div>
            <button className="btn btn-primary" type="submit" disabled={loading || code.trim().length < 6} style={{ width: "100%", justifyContent: "center", padding: "10px" }}>
              {loading ? "Vérification…" : "Valider"}
            </button>
            <button className="btn" type="button" disabled={loading} onClick={() => { setStep("password"); setError(""); setCode(""); }} style={{ width: "100%", justifyContent: "center" }}>
              Revenir au mot de passe
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
