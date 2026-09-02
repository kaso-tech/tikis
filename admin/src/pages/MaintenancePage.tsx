import { useEffect, useState } from "react";
import { trpc } from "../lib/trpc";
import { useAdminAuth } from "../lib/auth";

export default function MaintenancePage() {
  const { admin } = useAdminAuth();
  const canEdit = admin?.role === "super_admin";
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);

  function load() {
    trpc.adminConsole.maintenance.get.query()
      .then((data) => { setEnabled(data.enabled); setMessage(data.message ?? ""); })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Chargement impossible."));
  }
  useEffect(load, []);

  async function apply(next: boolean) {
    setError(""); setSuccess("");
    setSaving(true);
    try {
      const result = await trpc.adminConsole.maintenance.set.mutate({ enabled: next, message: message.trim() || undefined });
      setEnabled(result.enabled);
      setSuccess(next ? "Mode maintenance activé — l’application est désormais bloquée pour tous les utilisateurs." : "Mode maintenance désactivé — l’application est de nouveau accessible.");
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
      </div>

      {error ? <div className="banner-error">{error}</div> : null}
      {success ? <div className="banner-ok">{success}</div> : null}

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
    </div>
  );
}
