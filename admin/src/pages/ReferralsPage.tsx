import { useEffect, useState } from "react";
import { trpc } from "../lib/trpc";
import { useAdminAuth } from "../lib/auth";

type Referral = { id: string; referrerPhone: string; refereePhone: string; referralCode: string; status: "invited" | "qualified" | "rewarded" | "voided"; rewardAmount: number; createdAt: Date | string; qualifiedAt: Date | string | null; rewardedAt: Date | string | null };

const STATUS_LABEL: Record<string, string> = { invited: "Invité", qualified: "Qualifié", rewarded: "Récompensé", voided: "Annulé" };
const STATUS_PILL: Record<string, string> = { invited: "pill-neutral", qualified: "pill-info", rewarded: "pill-success", voided: "pill-error" };

function formatMoney(amount: number) {
  return `${new Intl.NumberFormat("fr-FR").format(amount)} FCFA`;
}

export default function ReferralsPage() {
  const { admin } = useAdminAuth();
  const canEdit = admin?.role === "super_admin" || admin?.role === "finance";
  const [statusFilter, setStatusFilter] = useState<"invited" | "qualified" | "rewarded" | "voided" | "">("");
  const [rows, setRows] = useState<Referral[]>([]);
  const [settings, setSettings] = useState<{ rewardAmount: number; enabled: boolean } | null>(null);
  const [draft, setDraft] = useState({ rewardAmount: "", enabled: true });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function load() {
    trpc.adminConsole.referrals.list.query({ status: statusFilter || undefined })
      .then((data) => setRows(data as Referral[]))
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Chargement impossible."));
  }
  useEffect(load, [statusFilter]);

  useEffect(() => {
    trpc.adminConsole.referrals.settings.get.query()
      .then((data) => { setSettings(data); setDraft({ rewardAmount: String(data.rewardAmount), enabled: data.enabled }); })
      .catch(() => {});
  }, []);

  async function saveSettings() {
    setError(""); setSuccess("");
    const amount = Number(draft.rewardAmount);
    if (!Number.isFinite(amount) || amount < 0) { setError("Montant de récompense invalide."); return; }
    setSaving(true);
    try {
      const result = await trpc.adminConsole.referrals.settings.update.mutate({ rewardAmount: amount, enabled: draft.enabled });
      setSettings(result);
      setSuccess("Réglages de parrainage enregistrés.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function reward(referralId: string) {
    setBusyId(referralId);
    setError("");
    try {
      await trpc.adminConsole.referrals.reward.mutate({ referralId });
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Récompense impossible.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Parrainage</h1>
          <p className="page-sub">Un filleul est qualifié automatiquement après sa première livraison terminée.</p>
        </div>
      </div>

      {error ? <div className="banner-error">{error}</div> : null}
      {success ? <div className="banner-ok">{success}</div> : null}

      <div className="card">
        <div className="card-head"><div><div className="card-title">Réglages</div><div className="card-sub">Montant de récompense et activation du programme</div></div></div>
        {!canEdit ? <div style={{ fontSize: 13, color: "var(--muted)" }}>Réservé aux rôles Super-admin et Finance. Valeur actuelle : {settings ? formatMoney(settings.rewardAmount) : "…"}, programme {settings?.enabled ? "activé" : "désactivé"}.</div> : (
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div>
              <label className="field-label">Récompense (FCFA)</label>
              <input className="input" inputMode="numeric" value={draft.rewardAmount} onChange={(e) => setDraft((s) => ({ ...s, rewardAmount: e.target.value.replace(/[^0-9]/g, "") }))} style={{ width: 160 }} />
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, marginBottom: 10 }}>
              <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft((s) => ({ ...s, enabled: e.target.checked }))} />
              Programme actif (nouveaux parrainages acceptés)
            </label>
            <button className="btn btn-primary" disabled={saving} onClick={() => void saveSettings()}>{saving ? "…" : "Enregistrer"}</button>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <div className="tabs">
            {(["", "invited", "qualified", "rewarded", "voided"] as const).map((s) => (
              <button key={s || "all"} className={`tab ${statusFilter === s ? "active" : ""}`} onClick={() => setStatusFilter(s)}>{s ? STATUS_LABEL[s] : "Tous"}</button>
            ))}
          </div>
        </div>
        {rows.length === 0 ? <div className="empty-state">Aucun parrainage dans cette catégorie.</div> : (
          <table className="table">
            <thead><tr><th>Parrain</th><th>Filleul</th><th>Code</th><th>Récompense</th><th>Statut</th><th>Créé le</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontSize: 12 }}>{r.referrerPhone}</td>
                  <td style={{ fontSize: 12 }}>{r.refereePhone}</td>
                  <td><code>{r.referralCode}</code></td>
                  <td className="price">{formatMoney(r.rewardAmount)}</td>
                  <td><span className={`pill ${STATUS_PILL[r.status]}`}><span className="dot" />{STATUS_LABEL[r.status]}</span></td>
                  <td style={{ fontSize: 11.5, color: "var(--muted)" }}>{new Date(r.createdAt).toLocaleDateString("fr-FR")}</td>
                  <td style={{ textAlign: "right" }}>
                    {r.status === "qualified" && canEdit ? <button className="btn btn-sm btn-primary" disabled={busyId === r.id} onClick={() => void reward(r.id)}>{busyId === r.id ? "…" : "Créditer"}</button> : null}
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
