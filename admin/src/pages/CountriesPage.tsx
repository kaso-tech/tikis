import { useEffect, useState } from "react";
import { trpc } from "../lib/trpc";
import { useAdminAuth } from "../lib/auth";

type Country = { id: string; name: string; dialCode: string; digits: number; groups: string; timeZones: string; enabled: boolean; sortOrder: number };

const emptyDraft = { id: "", name: "", dialCode: "+", digits: "8", groups: "2,2,2,2", timeZones: "", sortOrder: "0" };

export default function CountriesPage() {
  const { admin } = useAdminAuth();
  const canEdit = admin?.role === "super_admin";
  const [rows, setRows] = useState<Country[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [saving, setSaving] = useState(false);

  function load() {
    trpc.adminConsole.countries.list.query()
      .then((data) => setRows(data as Country[]))
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Chargement impossible."));
  }
  useEffect(load, []);

  async function toggle(country: Country) {
    setBusyId(country.id);
    setError("");
    try {
      await trpc.adminConsole.countries.setEnabled.mutate({ id: country.id, enabled: !country.enabled });
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Action impossible.");
    } finally {
      setBusyId(null);
    }
  }

  function editCountry(country: Country) {
    setDraft({ id: country.id, name: country.name, dialCode: country.dialCode, digits: String(country.digits), groups: country.groups, timeZones: country.timeZones, sortOrder: String(country.sortOrder) });
    setFormOpen(true);
  }

  async function save() {
    setError(""); setSuccess("");
    const groups = draft.groups.split(",").map((g) => Number(g.trim())).filter((n) => Number.isFinite(n) && n > 0);
    const timeZones = draft.timeZones.split(",").map((tz) => tz.trim()).filter(Boolean);
    const digits = Number(draft.digits);
    const sortOrder = Number(draft.sortOrder) || 0;
    if (!/^[A-Z]{2}$/.test(draft.id.toUpperCase())) { setError("Code pays ISO à 2 lettres requis (ex. BF)."); return; }
    if (!draft.name.trim()) { setError("Nom du pays requis."); return; }
    if (groups.length === 0 || timeZones.length === 0) { setError("Groupes d’affichage et fuseau horaire requis."); return; }
    setSaving(true);
    try {
      const existing = rows.find((r) => r.id === draft.id.toUpperCase());
      await trpc.adminConsole.countries.upsert.mutate({ id: draft.id.toUpperCase(), name: draft.name.trim(), dialCode: draft.dialCode.trim(), digits, groups, timeZones, enabled: existing?.enabled ?? true, sortOrder });
      setSuccess(`Pays ${draft.name.trim()} enregistré.`);
      setFormOpen(false);
      setDraft(emptyDraft);
      load();
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
          <h1 className="page-title">Pays</h1>
          <p className="page-sub">Pays actifs pour l’inscription et le format des numéros de téléphone</p>
        </div>
        {canEdit ? <div className="page-actions"><button className="btn btn-primary" onClick={() => { setDraft(emptyDraft); setFormOpen(true); }}>Ajouter un pays</button></div> : null}
      </div>

      {error ? <div className="banner-error">{error}</div> : null}
      {success ? <div className="banner-ok">{success}</div> : null}

      <div className="card" style={{ padding: 0 }}>
        <table className="table">
          <thead><tr><th>Pays</th><th>Indicatif</th><th>Format</th><th>Statut</th><th></th></tr></thead>
          <tbody>
            {rows.map((country) => (
              <tr key={country.id}>
                <td style={{ fontWeight: 600 }}>{country.name} <span style={{ color: "var(--muted)", fontWeight: 400 }}>({country.id})</span></td>
                <td>{country.dialCode}</td>
                <td style={{ fontSize: 12, color: "var(--muted)" }}>{country.digits} chiffres · {country.groups}</td>
                <td><span className={`pill ${country.enabled ? "pill-success" : "pill-neutral"}`}><span className="dot" />{country.enabled ? "Actif" : "Inactif"}</span></td>
                <td style={{ textAlign: "right", display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  {canEdit ? <>
                    <button className="btn btn-sm" onClick={() => editCountry(country)}>Modifier</button>
                    <button className="btn btn-sm btn-danger" disabled={busyId === country.id} onClick={() => void toggle(country)}>{country.enabled ? "Désactiver" : "Activer"}</button>
                  </> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {formOpen ? (
        <div className="card" style={{ maxWidth: 480 }}>
          <div className="card-head"><div><div className="card-title">{rows.some((r) => r.id === draft.id.toUpperCase()) ? "Modifier le pays" : "Ajouter un pays"}</div></div></div>
          <div className="grid grid-2" style={{ marginBottom: 10 }}>
            <div><label className="field-label">Code ISO (2 lettres)</label><input className="input" maxLength={2} value={draft.id} onChange={(e) => setDraft((s) => ({ ...s, id: e.target.value.toUpperCase() }))} /></div>
            <div><label className="field-label">Indicatif</label><input className="input" value={draft.dialCode} onChange={(e) => setDraft((s) => ({ ...s, dialCode: e.target.value }))} /></div>
          </div>
          <label className="field-label">Nom du pays</label>
          <input className="input" value={draft.name} onChange={(e) => setDraft((s) => ({ ...s, name: e.target.value }))} style={{ marginBottom: 10 }} />
          <div className="grid grid-2" style={{ marginBottom: 10 }}>
            <div><label className="field-label">Nombre de chiffres</label><input className="input" inputMode="numeric" value={draft.digits} onChange={(e) => setDraft((s) => ({ ...s, digits: e.target.value.replace(/[^0-9]/g, "") }))} /></div>
            <div><label className="field-label">Groupes d’affichage (ex. 2,2,2,2)</label><input className="input" value={draft.groups} onChange={(e) => setDraft((s) => ({ ...s, groups: e.target.value }))} /></div>
          </div>
          <label className="field-label">Fuseaux horaires (séparés par virgule, ex. Africa/Ouagadougou)</label>
          <input className="input" value={draft.timeZones} onChange={(e) => setDraft((s) => ({ ...s, timeZones: e.target.value }))} style={{ marginBottom: 14 }} />
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary" disabled={saving} onClick={() => void save()}>{saving ? "…" : "Enregistrer"}</button>
            <button className="btn btn-ghost" disabled={saving} onClick={() => { setFormOpen(false); setDraft(emptyDraft); }}>Annuler</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
