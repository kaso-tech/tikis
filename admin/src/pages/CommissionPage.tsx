import { useEffect, useState } from "react";
import { trpc } from "../lib/trpc";
import { useAdminAuth } from "../lib/auth";

export default function CommissionPage() {
  const { admin } = useAdminAuth();
  const canEdit = admin?.role === "super_admin" || admin?.role === "finance";
  const [currentRate, setCurrentRate] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);

  function load() {
    trpc.adminConsole.commission.get.query()
      .then((rate) => { setCurrentRate(rate); setDraft((rate * 100).toString()); })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Impossible de charger le taux de commission."));
  }

  useEffect(load, []);

  async function save() {
    setError(""); setSuccess("");
    const percent = Number(draft.replace(",", "."));
    if (!Number.isFinite(percent) || percent <= 0 || percent >= 90) { setError("Indiquez un pourcentage valide, entre 0 et 90."); return; }
    setSaving(true);
    try {
      await trpc.adminConsole.commission.update.mutate({ rate: percent / 100 });
      setSuccess("Taux de commission mis à jour. Il s’applique immédiatement à toute nouvelle candidature.");
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "La mise à jour a échoué.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h1 className="page-title">Commission</h1>
      <p className="page-subtitle">Taux appliqué à chaque candidature de livreur (Commission = Prix × Taux).</p>
      {error ? <div className="error-banner">{error}</div> : null}
      {success ? <div className="success-banner">{success}</div> : null}
      <div className="card" style={{ maxWidth: 420 }}>
        <p className="card-title">Taux actuel : {currentRate !== null ? `${(currentRate * 100).toFixed(2)} %` : "…"}</p>
        {!canEdit ? (
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Votre rôle ({admin?.role}) ne permet pas de modifier le taux de commission. Seuls Super-admin et Finance le peuvent.</p>
        ) : (
          <>
            <label className="field-label" htmlFor="rate">Nouveau taux (%)</label>
            <input id="rate" className="input" type="text" inputMode="decimal" value={draft} onChange={(e) => setDraft(e.target.value)} style={{ marginBottom: 14, maxWidth: 160 }} />
            <div>
              <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>{saving ? "Enregistrement…" : "Mettre à jour le taux"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
