import { useEffect, useState } from "react";
import { trpc } from "../lib/trpc";
import { downloadCsv, rowsToCsv } from "../lib/csv";
import { useAdminAuth } from "../lib/auth";

type AuditEntry = { id: string; action: string; targetType: string; targetId: string; adminEmail: string; createdAt: string | Date; metadata: string | null };

function formatDate(iso: string | Date) {
  const date = new Date(iso);
  return date.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function describeAction(action: string) {
  switch (action) {
    case "maintenance_mode_changed": return "Bascule du mode maintenance";
    case "profile_status_changed": return "Statut de profil modifié";
    case "profile_role_changed": return "Rôle de profil modifié";
    case "delivery_force_cancelled": return "Livraison annulée (admin)";
    case "report_resolved": return "Signalement traité";
    case "kyc_reviewed": return "KYC examiné";
    case "referral_rewarded": return "Parrainage récompensé";
    case "wallet_bonus_sent": return "Bonus envoyé";
    case "wallet_penalty_sent": return "Pénalité appliquée";
    case "wallet_settled": return "Transaction soldée";
    case "commission_rate_changed": return "Taux de commission modifié";
    case "pricing_updated": return "Tarification mise à jour";
    case "country_set_enabled": return "Pays activé/désactivé";
    case "country_upserted": return "Pays ajouté/édité";
    case "profile_viewed": return "Profil consulté";
    default: return action;
  }
}

export default function MaintenancePage() {
  const { admin } = useAdminAuth();
  const canEdit = admin?.role === "super_admin";
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<AuditEntry[]>([]);
  const [showPreview, setShowPreview] = useState(false);

  function load() {
    trpc.adminConsole.maintenance.get.query()
      .then((data) => { setEnabled(data.enabled); setMessage(data.message ?? ""); })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Chargement impossible."));
  }
  function loadHistory() {
    trpc.adminConsole.auditLog.list.query({ limit: 50 })
      .then(({ rows }) => setHistory(rows.filter((row) => row.action === "maintenance_mode_changed").map((row) => ({
        id: row.id,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        adminEmail: row.adminEmail,
        createdAt: row.createdAt,
        metadata: row.details,
      }))))
      .catch(() => undefined);
  }
  useEffect(load, []);
  useEffect(loadHistory, []);

  async function apply(next: boolean) {
    setError(""); setSuccess("");
    setSaving(true);
    try {
      const result = await trpc.adminConsole.maintenance.set.mutate({ enabled: next, message: message.trim() || undefined });
      setEnabled(result.enabled);
      setSuccess(next ? "Mode maintenance activé — l’application est désormais bloquée pour tous les utilisateurs." : "Mode maintenance désactivé — l’application est de nouveau accessible.");
      loadHistory();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Action impossible.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Mode maintenance</h1>
          <p className="page-sub">Bloque l’accès à l’application mobile pour tous les Senders et Livreurs</p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-secondary" onClick={() => setShowPreview((v) => !v)}>{showPreview ? "Masquer la preview" : "Voir la preview mobile"}</button>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={history.length === 0}
            onClick={() => {
              const csv = rowsToCsv(history.map((entry) => ({
                id: entry.id,
                adminEmail: entry.adminEmail,
                action: entry.action,
                targetType: entry.targetType,
                targetId: entry.targetId,
                createdAt: new Date(entry.createdAt).toISOString(),
                metadata: entry.metadata ?? "",
              })));
              downloadCsv(`tikis-maintenance-history-${new Date().toISOString().slice(0, 10)}`, csv);
            }}
          >
            Exporter l’historique
          </button>
        </div>
      </div>

      {error ? <div className="banner-error">{error}</div> : null}
      {success ? <div className="banner-ok">{success}</div> : null}

      <div className="grid grid-2" style={{ alignItems: "flex-start" }}>
        <div className="card" style={{ maxWidth: 520 }}>
          <div className="card-head">
            <div>
              <div className="card-title">Statut actuel</div>
              <div className="card-sub">{enabled ? "🔴 Maintenance active" : "🟢 Application accessible"}</div>
            </div>
          </div>
          {!canEdit ? <div style={{ fontSize: 13, color: "var(--muted)" }}>Réservé aux super-administrateurs.</div> : (
            <>
              <label className="field-label">Message affiché aux utilisateurs (optionnel)</label>
              <textarea className="input" rows={3} placeholder="Ex. Tikis est en maintenance pour une amélioration du service. Merci de votre patience, nous serons de retour très vite." value={message} onChange={(e) => setMessage(e.target.value)} style={{ marginBottom: 14 }} />
              <div style={{ display: "flex", gap: 8 }}>
                {!enabled ? (
                  <button className="btn btn-danger" disabled={saving} onClick={() => void apply(true)}>{saving ? "…" : "Activer la maintenance"}</button>
                ) : (
                  <button className="btn btn-primary" disabled={saving} onClick={() => void apply(false)}>{saving ? "…" : "Désactiver la maintenance"}</button>
                )}
              </div>
            </>
          )}
        </div>

        {showPreview ? (
          <div className="card" style={{ maxWidth: 360, margin: "0 auto" }}>
            <div className="card-head">
              <div>
                <div className="card-title">Aperçu mobile</div>
                <div className="card-sub">Tel que l’utilisateur voit l’app pendant la maintenance</div>
              </div>
            </div>
            <div className="phone-mockup">
              <div className="phone-status"><span>9:41</span><span>•••</span></div>
              <div className="phone-screen">
                <div className="phone-icon">🛠</div>
                <div className="phone-title">Tikis en maintenance</div>
                <div className="phone-text">{message.trim() || "L’application est momentanément indisponible. L’équipe technique travaille pour la rétablir très bientôt."}</div>
                <div className="phone-foot">Merci de votre patience.</div>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <div className="card-head">
          <div>
            <div className="card-title">Historique des activations</div>
            <div className="card-sub">50 dernières entrées — alimenté par l’audit log admin</div>
          </div>
        </div>
        {history.length === 0 ? (
          <div className="empty-state" style={{ padding: 16 }}>Aucune activation enregistrée pour le moment.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>Date</th><th>Action</th><th>Admin</th><th>Métadonnées</th></tr>
            </thead>
            <tbody>
              {history.map((row) => (
                <tr key={row.id}>
                  <td>{formatDate(row.createdAt)}</td>
                  <td>{describeAction(row.action)}</td>
                  <td>{row.adminEmail}</td>
                  <td><code style={{ fontSize: 11, color: "var(--muted)" }}>{row.metadata ?? "—"}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
