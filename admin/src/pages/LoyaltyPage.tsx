import { useEffect, useState } from "react";
import { trpc } from "../lib/trpc";
import { useAdminAuth } from "../lib/auth";

type Program = { id: string; name: string; description: string | null; role: "sender" | "driver"; requiredDeliveries: number; bonusAmount: number; windowDays: number; enabled: boolean; createdAt: Date | string; updatedAt: Date | string };

const ROLE_LABEL: Record<string, string> = { sender: "Expéditeur", driver: "Livreur" };
const ROLE_PILL: Record<string, string> = { sender: "pill-primary", driver: "pill-info" };

function formatMoney(amount: number) {
  return `${new Intl.NumberFormat("fr-FR").format(amount)} FCFA`;
}

function emptyDraft() {
  return { name: "", description: "", role: "driver" as "sender" | "driver", requiredDeliveries: "50", bonusAmount: "5000", windowDays: "90", enabled: true };
}

export default function LoyaltyPage() {
  const { admin } = useAdminAuth();
  const canEdit = admin?.role === "super_admin" || admin?.role === "finance";
  const [programs, setPrograms] = useState<Program[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Program | null>(null);
  const [draft, setDraft] = useState(emptyDraft());
  const [showForm, setShowForm] = useState(false);

  function load() {
    setLoading(true);
    setError("");
    trpc.adminConsole.loyalty.listPrograms.query()
      .then((data) => setPrograms((data as Program[])))
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Chargement impossible."))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  function startCreate() {
    setEditing(null);
    setDraft(emptyDraft());
    setShowForm(true);
  }

  function startEdit(program: Program) {
    setEditing(program);
    setDraft({
      name: program.name,
      description: program.description ?? "",
      role: program.role,
      requiredDeliveries: String(program.requiredDeliveries),
      bonusAmount: String(program.bonusAmount),
      windowDays: String(program.windowDays),
      enabled: program.enabled,
    });
    setShowForm(true);
  }

  async function save() {
    setError(""); setSuccess("");
    const name = draft.name.trim();
    if (name.length < 3) { setError("Le nom doit contenir au moins 3 caractères."); return; }
    const requiredDeliveries = Number(draft.requiredDeliveries);
    const bonusAmount = Number(draft.bonusAmount);
    const windowDays = Number(draft.windowDays);
    if (!Number.isInteger(requiredDeliveries) || requiredDeliveries < 1) { setError("Seuil de livraisons invalide."); return; }
    if (!Number.isInteger(bonusAmount) || bonusAmount < 100) { setError("Le bonus minimum est de 100 FCFA."); return; }
    if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 365) { setError("La fenêtre doit être entre 1 et 365 jours."); return; }
    setSaving(true);
    try {
      const payload = { id: editing?.id, name, description: draft.description.trim() || undefined, role: draft.role, requiredDeliveries, bonusAmount, windowDays, enabled: draft.enabled };
      await trpc.adminConsole.loyalty.upsertProgram.mutate(payload);
      setSuccess(editing ? `Programme « ${name} » mis à jour.` : `Programme « ${name} » créé.`);
      setShowForm(false);
      setEditing(null);
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Action impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function toggle(program: Program) {
    setError(""); setSuccess("");
    try {
      await trpc.adminConsole.loyalty.setProgramEnabled.mutate({ id: program.id, enabled: !program.enabled });
      setSuccess(program.enabled ? `Programme « ${program.name} » désactivé.` : `Programme « ${program.name} » activé.`);
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Action impossible.");
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Programme de fidélité</h1>
          <p className="page-sub">Récompense les livreurs et expéditeurs actifs sur des paliers de courses terminées</p>
        </div>
        <div className="page-actions">
          {canEdit ? <button type="button" className="btn btn-primary" onClick={startCreate}>Nouveau programme</button> : null}
          <button type="button" className="btn" onClick={() => {
            const event = new CustomEvent("tikis:navigate", { detail: { page: "loyaltyGrants" } });
            window.dispatchEvent(event);
          }}>Octrois en attente</button>
        </div>
      </div>

      {error ? <div className="banner-error">{error}</div> : null}
      {success ? <div className="banner-ok">{success}</div> : null}

      {showForm ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-head">
            <div>
              <div className="card-title">{editing ? "Modifier le programme" : "Nouveau programme"}</div>
              <div className="card-sub">{editing ? `ID : ${editing.id}` : "Crée un palier de récompense. Devient actif dès l'enregistrement."}</div>
            </div>
            <button type="button" className="btn btn-sm" onClick={() => { setShowForm(false); setEditing(null); }}>Annuler</button>
          </div>
          <div className="form-grid">
            <label className="field"><span className="field-label">Nom du programme</span><input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Ex. Fidélité livreur 100 courses" maxLength={80} /></label>
            <label className="field"><span className="field-label">Description (optionnel)</span><input className="input" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Ex. 10 000 FCFA tous les 100 courses terminées en 90j" maxLength={300} /></label>
            <label className="field"><span className="field-label">Rôle ciblé</span><select className="input" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as "sender" | "driver" })}><option value="driver">Livreur</option><option value="sender">Expéditeur</option></select></label>
            <label className="field"><span className="field-label">Seuil de livraisons</span><input className="input" type="number" min="1" max="10000" value={draft.requiredDeliveries} onChange={(e) => setDraft({ ...draft, requiredDeliveries: e.target.value })} /></label>
            <label className="field"><span className="field-label">Bonus (FCFA)</span><input className="input" type="number" min="100" max="1000000" step="100" value={draft.bonusAmount} onChange={(e) => setDraft({ ...draft, bonusAmount: e.target.value })} /></label>
            <label className="field"><span className="field-label">Fenêtre (jours)</span><input className="input" type="number" min="1" max="365" value={draft.windowDays} onChange={(e) => setDraft({ ...draft, windowDays: e.target.value })} /></label>
            <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
              <span className="field-label" style={{ marginBottom: 0 }}>Programme actif</span>
            </label>
          </div>
          <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
            <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save()}>{saving ? "Enregistrement…" : editing ? "Mettre à jour" : "Créer le programme"}</button>
            <button type="button" className="btn" onClick={() => { setShowForm(false); setEditing(null); }}>Annuler</button>
          </div>
        </div>
      ) : null}

      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Programmes configurés</div>
            <div className="card-sub">{programs.length} programme(s) — les modifications sont auditées</div>
          </div>
        </div>
        {loading ? <div className="empty-state" style={{ padding: 16 }}>Chargement…</div> : programs.length === 0 ? (
          <div className="empty-state" style={{ padding: 16 }}>Aucun programme configuré. Clique sur « Nouveau programme » pour commencer.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Rôle</th>
                <th>Seuil</th>
                <th>Bonus</th>
                <th>Fenêtre</th>
                <th>Statut</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {programs.map((program) => (
                <tr key={program.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{program.name}</div>
                    {program.description ? <div style={{ fontSize: 11, color: "var(--muted)" }}>{program.description}</div> : null}
                  </td>
                  <td><span className={`pill ${ROLE_PILL[program.role] ?? "pill-neutral"}`}><span className="dot" />{ROLE_LABEL[program.role] ?? program.role}</span></td>
                  <td style={{ fontVariantNumeric: "tabular-nums" }}>{program.requiredDeliveries} courses</td>
                  <td style={{ fontVariantNumeric: "tabular-nums", color: "var(--primary)", fontWeight: 600 }}>{formatMoney(program.bonusAmount)}</td>
                  <td>{program.windowDays} jours</td>
                  <td>{program.enabled ? <span className="pill pill-success"><span className="dot" />Actif</span> : <span className="pill pill-neutral"><span className="dot" />Inactif</span>}</td>
                  <td style={{ textAlign: "right" }}>
                    {canEdit ? (
                      <>
                        <button type="button" className="btn btn-sm" onClick={() => startEdit(program)} style={{ marginRight: 6 }}>Éditer</button>
                        <button type="button" className="btn btn-sm" onClick={() => void toggle(program)}>{program.enabled ? "Désactiver" : "Activer"}</button>
                      </>
                    ) : <span style={{ fontSize: 12, color: "var(--muted)" }}>Lecture seule</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
