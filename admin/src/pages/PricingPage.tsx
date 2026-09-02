import { useEffect, useState } from "react";
import { trpc } from "../lib/trpc";
import { useAdminAuth } from "../lib/auth";

type PricingConfig = {
  vehicles: Record<string, { minimum: number; perKm: number }>;
  typeAdjustment: { plis: number; personnePerPassenger: number };
};

export default function PricingPage() {
  const { admin } = useAdminAuth();
  const canEdit = admin?.role === "super_admin" || admin?.role === "finance";
  const [config, setConfig] = useState<PricingConfig | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);

  function load() {
    trpc.adminConsole.pricing.get.query()
      .then((data) => setConfig(data as PricingConfig))
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Chargement impossible."));
  }
  useEffect(load, []);

  function updateVehicle(vehicle: string, field: "minimum" | "perKm", value: string) {
    const num = Number(value.replace(/[^0-9]/g, ""));
    setConfig((prev) => prev ? { ...prev, vehicles: { ...prev.vehicles, [vehicle]: { ...prev.vehicles[vehicle], [field]: num } } } : prev);
  }

  async function save() {
    if (!config) return;
    setError(""); setSuccess("");
    setSaving(true);
    try {
      const result = await trpc.adminConsole.pricing.update.mutate(config);
      setConfig(result as PricingConfig);
      setSuccess("Grille tarifaire mise à jour. Elle s’applique aux prochaines estimations.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Estimation intelligente</h1>
          <p className="page-sub">Paramètres du calcul automatique du prix (base + tarif au kilomètre par engin, ajustements par type de course)</p>
        </div>
      </div>

      {error ? <div className="banner-error">{error}</div> : null}
      {success ? <div className="banner-ok">{success}</div> : null}

      {!canEdit ? <div className="banner-error">Réservé aux rôles Super-admin et Finance — lecture seule ci-dessous.</div> : null}

      {config ? (
        <>
          <div className="card">
            <div className="card-head"><div><div className="card-title">Tarifs par engin</div><div className="card-sub">Prix = base minimum + (distance × tarif/km), puis ajustements</div></div></div>
            <table className="table">
              <thead><tr><th>Engin</th><th>Base minimum (FCFA)</th><th>Tarif au km (FCFA)</th></tr></thead>
              <tbody>
                {Object.entries(config.vehicles).map(([vehicle, rate]) => (
                  <tr key={vehicle}>
                    <td style={{ fontWeight: 600 }}>{vehicle}</td>
                    <td><input className="input" disabled={!canEdit} inputMode="numeric" value={rate.minimum} onChange={(e) => updateVehicle(vehicle, "minimum", e.target.value)} style={{ maxWidth: 140 }} /></td>
                    <td><input className="input" disabled={!canEdit} inputMode="numeric" value={rate.perKm} onChange={(e) => updateVehicle(vehicle, "perKm", e.target.value)} style={{ maxWidth: 140 }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <div className="card-head"><div><div className="card-title">Ajustements par type de course</div></div></div>
            <div className="grid grid-2">
              <div>
                <label className="field-label">Supplément « Plis » (FCFA)</label>
                <input className="input" disabled={!canEdit} inputMode="numeric" value={config.typeAdjustment.plis} onChange={(e) => setConfig((prev) => prev ? { ...prev, typeAdjustment: { ...prev.typeAdjustment, plis: Number(e.target.value.replace(/[^0-9]/g, "")) } } : prev)} />
              </div>
              <div>
                <label className="field-label">Supplément par passager « Personne » (FCFA)</label>
                <input className="input" disabled={!canEdit} inputMode="numeric" value={config.typeAdjustment.personnePerPassenger} onChange={(e) => setConfig((prev) => prev ? { ...prev, typeAdjustment: { ...prev.typeAdjustment, personnePerPassenger: Number(e.target.value.replace(/[^0-9]/g, "")) } } : prev)} />
              </div>
            </div>
          </div>

          {canEdit ? (
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-primary" disabled={saving} onClick={() => void save()}>{saving ? "Enregistrement…" : "Enregistrer la grille"}</button>
              <button className="btn btn-ghost" disabled={saving} onClick={load}>Annuler les modifications</button>
            </div>
          ) : null}
        </>
      ) : !error ? <div className="empty-state">Chargement…</div> : null}
    </div>
  );
}
