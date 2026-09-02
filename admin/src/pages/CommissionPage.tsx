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
    setError(""); setSuccess("");
    trpc.adminConsole.core.commission.get.query()
      .then((rate: number) => { setCurrentRate(rate); setDraft((rate * 100).toString()); })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Impossible de charger le taux de commission."));
  }

  useEffect(load, []);

  async function save() {
    setError(""); setSuccess("");
    const percent = Number(draft.replace(",", "."));
    if (!Number.isFinite(percent) || percent <= 0 || percent >= 90) { setError("Indiquez un pourcentage valide, entre 0 et 90."); return; }
    setSaving(true);
    try {
      await trpc.adminConsole.core.commission.update.mutate({ rate: percent / 100 });
      setSuccess("Taux de commission mis à jour. Il s'applique immédiatement à toute nouvelle candidature.");
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "La mise à jour a échoué.");
    } finally {
      setSaving(false);
    }
  }

  const percent = Number(draft.replace(",", "."));
  const isValid = Number.isFinite(percent) && percent > 0 && percent < 90;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Commission plateforme</h1>
          <p className="page-sub">Taux appliqué à chaque candidature de livreur (commission = prix × taux)</p>
        </div>
      </div>

      {error ? <div className="banner-error">{error}</div> : null}
      {success ? <div className="banner-ok">{success}</div> : null}

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Taux actuel</div>
              <div className="card-sub">Applique aux nouvelles candidatures à partir de maintenant</div>
            </div>
          </div>
          <div className="card-body">
            <div className="kpi" style={{ marginBottom: 16 }}>
              <div className="kpi-label">Commission</div>
              <div className="kpi-value">{currentRate !== null ? `${(currentRate * 100).toFixed(2)} %` : "…"}</div>
              <div className="kpi-foot">{(currentRate ?? 0) * 1000} FCFA par tranche de 10 000 FCFA</div>
              <div className="kpi-bar" style={{ background: "var(--border)" }}>
                <div style={{ width: `${Math.min(100, (currentRate ?? 0) * 1000)}%`, height: "100%", background: "var(--primary)", borderRadius: 99 }} />
              </div>
            </div>
            {!canEdit ? (
              <div className="banner-error" style={{ marginTop: 0 }}>
                Votre rôle ({admin?.role}) ne permet pas de modifier le taux. Seuls super-administrateurs et finance le peuvent.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div>
                  <label className="field-label" htmlFor="rate">Nouveau taux (%)</label>
                  <input id="rate" className="input" type="text" inputMode="decimal" value={draft} onChange={(e) => setDraft(e.target.value)} style={{ maxWidth: 160 }} />
                </div>
                <div>
                  <button className="btn btn-primary" onClick={() => void save()} disabled={saving || !isValid}>
                    {saving ? "Enregistrement…" : "Mettre à jour le taux"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Exemples d'application</div>
              <div className="card-sub">À titre indicatif, sur la base du taux actuel</div>
            </div>
          </div>
          <div className="card-body">
            {[1000, 2500, 5000, 10000, 25000].map((price) => {
              const commission = Math.round(price * (currentRate ?? 0));
              const driver = price - commission;
              return (
                <div key={price} className="metric-row">
                  <span className="metric-name">Course à {new Intl.NumberFormat("fr-FR").format(price)} FCFA</span>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>comm. {new Intl.NumberFormat("fr-FR").format(commission)}</span>
                  <span className="metric-value">livreur {new Intl.NumberFormat("fr-FR").format(driver)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
