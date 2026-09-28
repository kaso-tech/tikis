import { useEffect, useState } from "react";
import { ADMIN_ROLE_LABELS, useAdminAuth, type AdminRole } from "../lib/auth";
import { ConfirmDialog } from "../lib/confirm-dialog";
import { trpc } from "../lib/trpc";

type AdminRow = { id: number; email: string; fullName: string; role: AdminRole; active: boolean; lastLoginAt: Date | null; createdAt: Date; totpEnabled: boolean; mustChangePassword: boolean };
type AdminSession = { id: string; ipAddress: string | null; userAgent: string | null; createdAt: Date | string; lastSeenAt: Date | string };

const ROLE_OPTIONS = Object.keys(ADMIN_ROLE_LABELS) as AdminRole[];
const ROLE_HELP: Record<AdminRole, string> = {
  super_admin: "Tout, dont l’équipe et les réglages",
  support: "Utilisateurs, livraisons, litiges, KYC",
  finance: "Paiements, Wallets, commissions, fidélité",
  viewer: "Consulte sans rien modifier",
  kyc_reviewer: "Vérifications d’identité uniquement",
};

// Même liste que TOTP_REQUIRED_ROLES (server/admin-db.ts).
const TOTP_REQUIRED_ROLES = ["super_admin", "finance"];

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

export default function AdminsPage() {
  const { admin } = useAdminAuth();
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [totpRequired, setTotpRequired] = useState<boolean | null>(null);
  const [pendingReset, setPendingReset] = useState<AdminRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [createDraft, setCreateDraft] = useState<{ email: string; fullName: string; role: AdminRole }>({ email: "", fullName: "", role: "support" });
  // Mot de passe provisoire : affiché une seule fois, à transmettre par un canal sûr.
  const [revealed, setRevealed] = useState<{ email: string; password: string } | null>(null);
  const [pendingPasswordReset, setPendingPasswordReset] = useState<AdminRow | null>(null);
  const [sessionsFor, setSessionsFor] = useState<{ row: AdminRow; sessions: AdminSession[] } | null>(null);

  function load() {
    setError("");
    trpc.adminConsole.admins.list.query()
      .then((data: AdminRow[]) => setRows((data as AdminRow[]) ?? []))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Accès réservé aux super-administrateurs."));
    trpc.adminConsole.security.get.query()
      .then((data) => setTotpRequired(data.totpRequired))
      .catch(() => setTotpRequired(null));
  }
  useEffect(load, []);

  // Comptes qui bloquent l'activation de l'obligation : actifs, super-admin ou finance, non enrôlés.
  const notEnrolled = rows.filter((row) => row.active && TOTP_REQUIRED_ROLES.includes(row.role) && !row.totpEnabled);

  async function setPolicy(required: boolean) {
    setBusy(true); setError(""); setSuccess("");
    try {
      await trpc.adminConsole.security.setTotpRequired.mutate({ required });
      setSuccess(required ? "Double authentification désormais obligatoire pour les super-admins et la finance." : "Double authentification redevenue facultative.");
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Action impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function createAccount() {
    setBusy(true); setError(""); setSuccess(""); setRevealed(null);
    try {
      const result = await trpc.adminConsole.admins.create.mutate(createDraft);
      setRevealed({ email: result.email, password: result.temporaryPassword });
      setCreateDraft({ email: "", fullName: "", role: "support" });
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Création impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(row: AdminRow, role: AdminRole) {
    setError(""); setSuccess("");
    try {
      await trpc.adminConsole.admins.changeRole.mutate({ adminId: row.id, role });
      setSuccess(`${row.email} : ${ADMIN_ROLE_LABELS[role]}.`);
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Changement de rôle impossible.");
      load();
    }
  }

  async function confirmPasswordReset() {
    if (!pendingPasswordReset) return;
    setBusy(true); setError(""); setSuccess(""); setRevealed(null);
    try {
      const result = await trpc.adminConsole.admins.resetPassword.mutate({ adminId: pendingPasswordReset.id });
      setRevealed({ email: pendingPasswordReset.email, password: result.temporaryPassword });
      setPendingPasswordReset(null);
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Réinitialisation impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function openSessions(row: AdminRow) {
    setError("");
    try {
      setSessionsFor({ row, sessions: await trpc.adminConsole.admins.sessions.query({ adminId: row.id }) as AdminSession[] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sessions indisponibles.");
    }
  }

  async function revokeSession(sessionId: string) {
    if (!sessionsFor) return;
    try {
      await trpc.adminConsole.admins.revokeSession.mutate({ sessionId });
      await openSessions(sessionsFor.row);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Fermeture impossible.");
    }
  }

  async function confirmReset() {
    if (!pendingReset) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      await trpc.adminConsole.security.resetTotp.mutate({ adminId: pendingReset.id });
      setSuccess(`Double authentification réinitialisée pour ${pendingReset.email}. Ses sessions sont fermées ; il devra la réactiver à sa prochaine connexion.`);
      setPendingReset(null);
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Réinitialisation impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(adminId: number, active: boolean) {
    try {
      await trpc.adminConsole.admins.setActive.mutate({ adminId, active: !active });
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Action impossible.");
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Équipe d'administration</h1>
          <p className="page-sub">Comptes ayant accès à cette console, rôles, mots de passe et sessions</p>
        </div>
      </div>

      {error ? <div className="banner-error">{error}</div> : null}
      {success ? <div className="banner-ok">{success}</div> : null}
      {revealed ? (
        <div className="banner-ok" style={{ display: "grid", gap: 6 }}>
          <div>Mot de passe provisoire de <strong>{revealed.email}</strong> :</div>
          <code style={{ fontSize: 16, letterSpacing: "0.05em" }}>{revealed.password}</code>
          <div style={{ fontWeight: 400 }}>Transmettez-le par un canal sûr (de vive voix, par exemple). Il ne sera plus affiché ; la personne le remplacera à sa première connexion.</div>
          <div><button className="btn btn-sm" onClick={() => setRevealed(null)}>C’est transmis</button></div>
        </div>
      ) : null}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head"><div><div className="card-title">Nouveau compte</div><div className="card-sub">Un mot de passe provisoire est généré ; il devra être changé à la première connexion</div></div></div>
        <form className="card-body" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }} onSubmit={(event) => { event.preventDefault(); void createAccount(); }}>
          <div style={{ flex: "1 1 220px" }}>
            <label className="field-label" htmlFor="new-admin-email">Email</label>
            <input id="new-admin-email" className="input" type="email" required value={createDraft.email} onChange={(e) => setCreateDraft((d) => ({ ...d, email: e.target.value }))} />
          </div>
          <div style={{ flex: "1 1 180px" }}>
            <label className="field-label" htmlFor="new-admin-name">Nom</label>
            <input id="new-admin-name" className="input" required minLength={2} value={createDraft.fullName} onChange={(e) => setCreateDraft((d) => ({ ...d, fullName: e.target.value }))} />
          </div>
          <div style={{ flex: "0 1 220px" }}>
            <label className="field-label" htmlFor="new-admin-role">Rôle</label>
            <select id="new-admin-role" className="input" value={createDraft.role} onChange={(e) => setCreateDraft((d) => ({ ...d, role: e.target.value as AdminRole }))}>
              {ROLE_OPTIONS.map((role) => <option key={role} value={role}>{ADMIN_ROLE_LABELS[role]} — {ROLE_HELP[role]}</option>)}
            </select>
          </div>
          <button className="btn btn-primary" type="submit" disabled={busy}>Créer le compte</button>
        </form>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <div>
            <div className="card-title">Double authentification obligatoire</div>
            <div className="card-sub">Pour les rôles super-admin et finance. Le support reste libre de l’activer.</div>
          </div>
          {totpRequired === null ? null : totpRequired
            ? <span className="pill pill-success"><span className="dot" />Obligatoire</span>
            : <span className="pill pill-warning"><span className="dot" />Facultative</span>}
        </div>
        <div className="card-body" style={{ display: "grid", gap: 10, fontSize: 13 }}>
          {totpRequired ? (
            <>
              <p style={{ margin: 0 }}>Un compte super-admin ou finance sans double authentification n’accède plus qu’à « Mon compte » pour l’activer.</p>
              <div><button className="btn" disabled={busy} onClick={() => void setPolicy(false)}>Rendre facultative</button></div>
            </>
          ) : notEnrolled.length > 0 ? (
            <p style={{ margin: 0 }}>
              Activable quand tous les comptes concernés l’auront activée. Encore {notEnrolled.length} : {notEnrolled.map((row) => row.email).join(", ")}.
            </p>
          ) : (
            <>
              <p style={{ margin: 0 }}>Tous les comptes super-admin et finance actifs ont activé la double authentification.</p>
              <div><button className="btn btn-primary" disabled={busy || totpRequired === null} onClick={() => void setPolicy(true)}>Rendre obligatoire</button></div>
            </>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Comptes administrateurs</div>
            <div className="card-sub">{rows.length} compte(s)</div>
          </div>
        </div>
        {rows.length === 0 ? (
          <div className="empty-state">Aucun administrateur trouvé.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Email</th>
                <th>Rôle</th>
                <th>Statut</th>
                <th>2FA</th>
                <th>Dernière connexion</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div className="user-cell">
                      <div className="user-avatar d">{initials(row.fullName)}</div>
                      <div className="user-name">{row.fullName}</div>
                    </div>
                  </td>
                  <td style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11.5 }}>{row.email}</td>
                  <td>
                    {row.id === admin?.adminId ? (
                      <span className={`pill ${row.role === "super_admin" ? "pill-primary" : row.role === "finance" ? "pill-info" : "pill-neutral"}`}>
                        <span className="dot" />{ADMIN_ROLE_LABELS[row.role] ?? row.role}
                      </span>
                    ) : (
                      <select aria-label={`Rôle de ${row.email}`} className="input" style={{ width: "auto", padding: "4px 8px", fontSize: 12 }} value={row.role} onChange={(e) => void changeRole(row, e.target.value as AdminRole)}>
                        {ROLE_OPTIONS.map((role) => <option key={role} value={role}>{ADMIN_ROLE_LABELS[role]}</option>)}
                      </select>
                    )}
                    {row.mustChangePassword ? <div className="muted" style={{ fontSize: 11 }}>Mot de passe provisoire</div> : null}
                  </td>
                  <td>
                    {row.active ? <span className="pill pill-success"><span className="dot" />Actif</span> : <span className="pill pill-error"><span className="dot" />Suspendu</span>}
                  </td>
                  <td>
                    {row.totpEnabled ? <span className="pill pill-success"><span className="dot" />Activée</span> : <span className="pill pill-neutral"><span className="dot" />Non</span>}
                  </td>
                  <td style={{ fontVariantNumeric: "tabular-nums", color: "var(--muted)", fontSize: 11.5 }}>
                    {row.lastLoginAt ? new Date(row.lastLoginAt).toLocaleString("fr-FR") : <span className="muted">Jamais</span>}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {/* Le serveur refuse de toute façon l'auto-suspension : on n'offre pas le bouton. */}
                    {row.id === admin?.adminId ? <span className="muted" style={{ fontSize: 11.5 }}>Vous</span> : (
                      <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                        <button className="btn btn-sm" onClick={() => void openSessions(row)}>Sessions</button>
                        <button className="btn btn-sm" disabled={busy} onClick={() => setPendingPasswordReset(row)}>Mot de passe</button>
                        {row.totpEnabled ? <button className="btn btn-sm" disabled={busy} onClick={() => setPendingReset(row)}>Réinitialiser 2FA</button> : null}
                        <button className={`btn btn-sm ${row.active ? "btn-danger" : "btn-primary"}`} onClick={() => void toggle(row.id, row.active)}>
                          {row.active ? "Suspendre" : "Réactiver"}
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {sessionsFor ? (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-head">
            <div><div className="card-title">Sessions ouvertes — {sessionsFor.row.email}</div><div className="card-sub">Fermer une session déconnecte l’appareil concerné à sa prochaine action</div></div>
            <button className="btn btn-sm" onClick={() => setSessionsFor(null)}>Fermer</button>
          </div>
          {sessionsFor.sessions.length === 0 ? <div className="empty-state">Aucune session ouverte.</div> : (
            <div className="table-scroll">
              <table className="table">
                <thead><tr><th>Ouverte le</th><th>Dernière activité</th><th>Adresse IP</th><th>Appareil</th><th></th></tr></thead>
                <tbody>
                  {sessionsFor.sessions.map((session) => (
                    <tr key={session.id}>
                      <td style={{ fontSize: 11.5 }}>{new Date(session.createdAt).toLocaleString("fr-FR")}</td>
                      <td style={{ fontSize: 11.5 }}>{new Date(session.lastSeenAt).toLocaleString("fr-FR")}</td>
                      <td style={{ fontSize: 12, fontFamily: "ui-monospace, monospace" }}>{session.ipAddress ?? "—"}</td>
                      <td style={{ fontSize: 11.5, maxWidth: 320 }}>{session.userAgent ?? "—"}</td>
                      <td style={{ textAlign: "right" }}><button className="btn btn-sm btn-danger" onClick={() => void revokeSession(session.id)}>Fermer la session</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
      <ConfirmDialog
        open={pendingPasswordReset !== null}
        title="Réinitialiser le mot de passe"
        tone="danger"
        confirmLabel="Réinitialiser"
        busy={busy}
        description={pendingPasswordReset ? (
          <p style={{ margin: 0 }}>
            Un mot de passe provisoire va être généré pour <strong>{pendingPasswordReset.email}</strong>. Ses sessions ouvertes seront fermées,
            et il devra choisir un nouveau mot de passe à sa prochaine connexion. Vérifiez d’abord son identité par un autre canal.
          </p>
        ) : null}
        onConfirm={() => void confirmPasswordReset()}
        onCancel={() => { if (!busy) setPendingPasswordReset(null); }}
      />
      <ConfirmDialog
        open={pendingReset !== null}
        title="Réinitialiser la double authentification"
        tone="danger"
        confirmLabel="Réinitialiser"
        busy={busy}
        description={pendingReset ? (
          <p style={{ margin: 0 }}>
            À faire seulement si <strong>{pendingReset.email}</strong> a perdu son téléphone et ses codes de secours, après avoir vérifié son identité
            par un autre canal. Ses sessions ouvertes seront fermées et il devra réactiver la double authentification.
          </p>
        ) : null}
        onConfirm={() => void confirmReset()}
        onCancel={() => { if (!busy) setPendingReset(null); }}
      />
    </div>
  );
}
