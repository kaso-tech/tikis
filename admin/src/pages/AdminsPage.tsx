import { useEffect, useState } from "react";
import { useAdminAuth } from "../lib/auth";
import { ConfirmDialog } from "../lib/confirm-dialog";
import { trpc } from "../lib/trpc";

type AdminRow = { id: number; email: string; fullName: string; role: string; active: boolean; lastLoginAt: Date | null; createdAt: Date; totpEnabled: boolean };

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
          <p className="page-sub">Comptes ayant accès à cette console · création via script serveur (voir README)</p>
        </div>
      </div>

      {error ? <div className="banner-error">{error}</div> : null}
      {success ? <div className="banner-ok">{success}</div> : null}

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
                    <span className={`pill ${row.role === "super_admin" ? "pill-primary" : row.role === "finance" ? "pill-info" : "pill-neutral"}`}>
                      <span className="dot" />{row.role.replace("_", " ")}
                    </span>
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
                      <span style={{ display: "inline-flex", gap: 6 }}>
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
