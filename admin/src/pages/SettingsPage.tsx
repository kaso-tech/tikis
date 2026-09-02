import { useEffect, useState } from "react";
import { trpc } from "../lib/trpc";
import { useAdminAuth } from "../lib/auth";

export default function SettingsPage() {
  const { admin } = useAdminAuth();
  const canEdit = admin?.role === "super_admin";
  const [rate, setRate] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    trpc.adminConsole.core.commission.get.query()
      .then((r: number) => setRate((r * 100).toString()))
      .catch(() => {});
  }, []);

  async function save() {
    setError(""); setSuccess("");
    const percent = Number(rate.replace(",", "."));
    if (!Number.isFinite(percent) || percent <= 0 || percent >= 90) { setError("Indiquez un pourcentage valide, entre 0 et 90."); return; }
    setSaving(true);
    try {
      await trpc.adminConsole.core.commission.update.mutate({ rate: percent / 100 });
      setSuccess("Taux enregistré.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "La mise à jour a échoué.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Paramètres plateforme</h1>
          <p className="page-sub">Configuration globale Tikis · réservée aux super-administrateurs</p>
        </div>
      </div>

      {error ? <div className="banner-error">{error}</div> : null}
      {success ? <div className="banner-ok">{success}</div> : null}

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Commission</div>
              <div className="card-sub">Taux appliqué à chaque nouvelle candidature</div>
            </div>
          </div>
          <div className="card-body">
            {!canEdit ? (
              <div className="banner-error" style={{ marginTop: 0 }}>Réservé aux super-administrateurs.</div>
            ) : (
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                <div style={{ flex: 1 }}>
                  <label className="field-label" htmlFor="rate">Taux (%)</label>
                  <input id="rate" className="input" type="text" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
                </div>
                <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>{saving ? "…" : "Enregistrer"}</button>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Sécurité session admin</div>
              <div className="card-sub">Tokens JWT signés HS256 · expiration 8 h</div>
            </div>
          </div>
          <div className="card-body">
            <div className="metric-row">
              <span className="metric-name">Algorithme de signature</span>
              <span className="metric-value">HS256 (scrypt)</span>
            </div>
            <div className="metric-row">
              <span className="metric-name">Durée de session</span>
              <span className="metric-value">8 heures</span>
            </div>
            <div className="metric-row">
              <span className="metric-name">Stockage côté client</span>
              <span className="metric-value">localStorage</span>
            </div>
            <div className="metric-row">
              <span className="metric-name">Tentatives max (par IP+email)</span>
              <span className="metric-value">5 / 5 min</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
