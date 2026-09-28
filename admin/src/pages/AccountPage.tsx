import { useState } from "react";
import { useAdminAuth } from "../lib/auth";
import { trpc } from "../lib/trpc";

const ROLE_LABEL: Record<string, string> = { super_admin: "Super admin", support: "Support", finance: "Finance" };

type Enrollment = { secret: string; otpauthUri: string; qrSvg: string };

/**
 * Compte de l'admin connecté : activation de la double authentification (QR code, premier code, codes de
 * secours montrés une seule fois) et désactivation quand le rôle l'autorise.
 */
export default function AccountPage() {
  const { admin, refresh } = useAdminAuth();
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [disableCode, setDisableCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  if (!admin) return null;

  async function begin() {
    setBusy(true); setError("");
    try {
      setEnrollment(await trpc.adminConsole.auth.totp.begin.mutate());
      setCode("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Activation impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true); setError("");
    try {
      const result = await trpc.adminConsole.auth.totp.confirm.mutate({ code: code.trim() });
      setRecoveryCodes(result.recoveryCodes);
      setEnrollment(null);
      // Pas de `refresh()` ici : l'identité passerait à « activée » et masquerait les codes de secours,
      // qui ne seront plus jamais affichés. On relit l'identité quand l'admin confirme les avoir notés.
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Code refusé.");
    } finally {
      setBusy(false);
    }
  }

  async function acknowledgeRecoveryCodes() {
    setRecoveryCodes(null);
    await refresh();
  }

  async function disable() {
    setBusy(true); setError("");
    try {
      await trpc.adminConsole.auth.totp.disable.mutate({ code: disableCode.trim() });
      setDisableCode("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Désactivation impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function copyCodes() {
    if (!recoveryCodes) return;
    try {
      await navigator.clipboard.writeText(recoveryCodes.join("\n"));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Mon compte</h1>
          <p className="page-sub">{admin.email} · {ROLE_LABEL[admin.role] ?? admin.role}</p>
        </div>
      </div>

      {admin.mustEnrollTotp ? (
        <div className="banner-error">La double authentification est obligatoire pour votre rôle. Activez-la ci-dessous pour accéder au reste de la console.</div>
      ) : null}
      {error ? <div className="banner-error">{error}</div> : null}

      <div className="card" style={{ maxWidth: 640 }}>
        <div className="card-head">
          <div>
            <div className="card-title">Double authentification</div>
            <div className="card-sub">Un code à 6 chiffres, généré par une application sur votre téléphone, en plus du mot de passe</div>
          </div>
          {recoveryCodes ? null : admin.totpEnabled
            ? <span className="pill pill-success"><span className="dot" />Activée</span>
            : <span className="pill pill-warning"><span className="dot" />Désactivée</span>}
        </div>
        <div className="card-body" style={{ display: "grid", gap: 14 }}>
          {recoveryCodes ? (
            <>
              <div className="banner-ok" style={{ marginBottom: 0 }}>Double authentification activée.</div>
              <p style={{ margin: 0, fontSize: 13 }}>
                Voici vos <strong>codes de secours</strong>. Chacun remplace une seule fois le code de l’application si vous perdez votre téléphone.
                Notez-les dans un endroit sûr : <strong>ils ne seront plus jamais affichés</strong>.
              </p>
              <ol style={{ margin: 0, paddingLeft: 22, columns: 2, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 14, lineHeight: 1.9 }}>
                {recoveryCodes.map((recoveryCode) => <li key={recoveryCode}>{recoveryCode}</li>)}
              </ol>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="btn" onClick={() => void copyCodes()}>{copied ? "Copiés" : "Copier les codes"}</button>
                <button className="btn btn-primary" onClick={() => void acknowledgeRecoveryCodes()}>J’ai noté mes codes</button>
              </div>
            </>
          ) : admin.totpEnabled ? (
            <>
              <p style={{ margin: 0, fontSize: 13 }}>Chaque connexion vous demande le code de votre application d’authentification. En cas de téléphone perdu : un code de secours, ou un autre super-admin peut réinitialiser votre double authentification depuis « Équipe admin ».</p>
              <div>
                <label className="field-label" htmlFor="disable-code">Désactiver : code actuel ou code de secours</label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input id="disable-code" className="input" style={{ maxWidth: 200 }} autoComplete="one-time-code" value={disableCode} onChange={(e) => setDisableCode(e.target.value)} placeholder="123 456" />
                  <button className="btn btn-danger" disabled={busy || disableCode.trim().length < 6} onClick={() => void disable()}>Désactiver</button>
                </div>
              </div>
            </>
          ) : enrollment ? (
            <>
              <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
                <li>Ouvrez votre application d’authentification (Google Authenticator, Microsoft Authenticator, 1Password…).</li>
                <li>Scannez ce QR code, ou saisissez la clé à la main.</li>
                <li>Entrez le code à 6 chiffres qu’elle affiche.</li>
              </ol>
              <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center" }}>
                <img
                  src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(enrollment.qrSvg)}`}
                  alt="QR code d’enrôlement"
                  width={176}
                  height={176}
                  style={{ background: "#fff", padding: 8, borderRadius: 8, border: "1px solid var(--border)" }}
                />
                <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
                  <div className="field-label">Clé (saisie manuelle)</div>
                  <code style={{ fontSize: 13, wordBreak: "break-all" }}>{enrollment.secret.replace(/(.{4})/g, "$1 ").trim()}</code>
                </div>
              </div>
              <div>
                <label className="field-label" htmlFor="enroll-code">Code affiché par l’application</label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input id="enroll-code" className="input" style={{ maxWidth: 200 }} autoFocus autoComplete="one-time-code" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123 456" />
                  <button className="btn btn-primary" disabled={busy || code.replace(/\s/g, "").length !== 6} onClick={() => void confirm()}>Activer</button>
                </div>
              </div>
            </>
          ) : (
            <>
              <p style={{ margin: 0, fontSize: 13 }}>Avec la double authentification, un mot de passe volé ne suffit plus pour entrer dans la console.</p>
              <div><button className="btn btn-primary" disabled={busy} onClick={() => void begin()}>Activer la double authentification</button></div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
