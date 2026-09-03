import { useEffect, useState } from "react";
import { trpc } from "../lib/trpc";
import { useAdminAuth } from "../lib/auth";
import { ConfirmDialog } from "../lib/confirm-dialog";

type Transaction = { id: string; profilePhone: string; type: "deposit" | "withdrawal"; provider: string; amount: number; status: "pending" | "succeeded" | "failed" | "cancelled"; providerReference: string; createdAt: Date | string };

const STATUS_LABEL: Record<string, string> = { pending: "En attente", succeeded: "Validée", failed: "Échouée", cancelled: "Annulée" };
const STATUS_PILL: Record<string, string> = { pending: "pill-warning", succeeded: "pill-success", failed: "pill-error", cancelled: "pill-neutral" };

function formatMoney(amount: number) {
  return `${new Intl.NumberFormat("fr-FR").format(amount)} FCFA`;
}

export default function FinancePage() {
  const { admin } = useAdminAuth();
  const canEdit = admin?.role === "super_admin" || admin?.role === "finance";
  const [tab, setTab] = useState<"withdrawals" | "deposits" | "settings" | "bonus">("withdrawals");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [settings, setSettings] = useState<{ commissionRate: number; minWithdrawal: number; maxWithdrawal: number } | null>(null);
  const [settingsDraft, setSettingsDraft] = useState({ min: "", max: "" });
  const [savingSettings, setSavingSettings] = useState(false);

  const [bonusDraft, setBonusDraft] = useState({ phone: "", amount: "", reason: "" });
  const [sendingBonus, setSendingBonus] = useState(false);
  const [pendingBonus, setPendingBonus] = useState<{ phone: string; amount: number; reason: string } | null>(null);

  function loadTransactions(type: "deposit" | "withdrawal") {
    trpc.adminConsole.finance.transactions.query({ type, status: "pending" })
      .then((data) => setTransactions(data as Transaction[]))
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Chargement impossible."));
  }
  useEffect(() => { if (tab === "withdrawals") loadTransactions("withdrawal"); if (tab === "deposits") loadTransactions("deposit"); }, [tab]);

  useEffect(() => {
    trpc.adminConsole.finance.settings.get.query()
      .then((data) => { setSettings(data); setSettingsDraft({ min: String(data.minWithdrawal), max: String(data.maxWithdrawal) }); })
      .catch(() => {});
  }, []);

  async function settle(paymentId: string, outcome: "succeeded" | "failed") {
    setBusyId(paymentId);
    setError(""); setSuccess("");
    try {
      await trpc.adminConsole.finance.settleTransaction.mutate({ paymentId, outcome });
      setSuccess(outcome === "succeeded" ? "Transaction validée." : "Transaction rejetée.");
      loadTransactions(tab === "deposits" ? "deposit" : "withdrawal");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Action impossible.");
    } finally {
      setBusyId(null);
    }
  }

  async function saveSettings() {
    setError(""); setSuccess("");
    const min = Number(settingsDraft.min);
    const max = Number(settingsDraft.max);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) { setError("Plage de retrait invalide."); return; }
    setSavingSettings(true);
    try {
      const result = await trpc.adminConsole.finance.settings.update.mutate({ minWithdrawal: min, maxWithdrawal: max });
      setSettings((s) => s ? { ...s, ...result } : s);
      setSuccess("Réglages financiers enregistrés.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Enregistrement impossible.");
    } finally {
      setSavingSettings(false);
    }
  }

  function requestSendBonus() {
    setError(""); setSuccess("");
    const amount = Number(bonusDraft.amount);
    if (!bonusDraft.phone.trim()) { setError("Renseignez le téléphone du bénéficiaire."); return; }
    if (!Number.isFinite(amount) || amount <= 0) { setError("Montant invalide."); return; }
    setPendingBonus({ phone: bonusDraft.phone.trim(), amount, reason: bonusDraft.reason.trim() || "Crédit bonus" });
  }

  async function confirmSendBonus() {
    if (!pendingBonus) return;
    setSendingBonus(true);
    try {
      await trpc.adminConsole.finance.sendBonus.mutate({ phone: pendingBonus.phone, amount: pendingBonus.amount, reason: pendingBonus.reason });
      setSuccess(`${formatMoney(pendingBonus.amount)} envoyés à ${pendingBonus.phone}.`);
      setBonusDraft({ phone: "", amount: "", reason: "" });
      setPendingBonus(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Envoi impossible.");
    } finally {
      setSendingBonus(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Finance</h1>
          <p className="page-sub">Retraits, dépôts, crédits bonus et seuils de la plateforme</p>
        </div>
      </div>

      {error ? <div className="banner-error">{error}</div> : null}
      {success ? <div className="banner-ok">{success}</div> : null}

      <div className="card" style={{ paddingBottom: 0 }}>
        <div className="tabs">
          <button className={`tab ${tab === "withdrawals" ? "active" : ""}`} onClick={() => setTab("withdrawals")}>Retraits en attente</button>
          <button className={`tab ${tab === "deposits" ? "active" : ""}`} onClick={() => setTab("deposits")}>Dépôts en attente</button>
          <button className={`tab ${tab === "bonus" ? "active" : ""}`} onClick={() => setTab("bonus")}>Envoyer un bonus</button>
          <button className={`tab ${tab === "settings" ? "active" : ""}`} onClick={() => setTab("settings")}>Réglages</button>
        </div>
      </div>

      {(tab === "withdrawals" || tab === "deposits") ? (
        <div className="card">
          {transactions.length === 0 ? <div className="empty-state">Aucune demande en attente.</div> : (
            <table className="table">
              <thead><tr><th>Profil</th><th>Montant</th><th>Fournisseur</th><th>Référence</th><th>Demandée le</th><th></th></tr></thead>
              <tbody>
                {transactions.map((t) => (
                  <tr key={t.id}>
                    <td style={{ fontSize: 12 }}>{t.profilePhone}</td>
                    <td className="price">{formatMoney(t.amount)}</td>
                    <td style={{ fontSize: 12 }}>{t.provider}</td>
                    <td style={{ fontSize: 11, fontFamily: "ui-monospace, monospace" }}>{t.providerReference}</td>
                    <td style={{ fontSize: 11.5, color: "var(--muted)" }}>{new Date(t.createdAt).toLocaleString("fr-FR")}</td>
                    <td style={{ textAlign: "right", display: "flex", gap: 6, justifyContent: "flex-end" }}>
                      {canEdit ? <>
                        <button className="btn btn-sm btn-primary" disabled={busyId === t.id} onClick={() => void settle(t.id, "succeeded")}>Valider</button>
                        <button className="btn btn-sm btn-danger" disabled={busyId === t.id} onClick={() => void settle(t.id, "failed")}>Rejeter</button>
                      </> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}

      {tab === "bonus" ? (
        <div className="card" style={{ maxWidth: 480 }}>
          <div className="card-head"><div><div className="card-title">Créditer un utilisateur</div><div className="card-sub">Bonus, geste commercial ou correction manuelle</div></div></div>
          {!canEdit ? <div style={{ fontSize: 13, color: "var(--muted)" }}>Réservé aux rôles Super-admin et Finance.</div> : (
            <>
              <label className="field-label">Téléphone du bénéficiaire</label>
              <input className="input" value={bonusDraft.phone} onChange={(e) => setBonusDraft((s) => ({ ...s, phone: e.target.value }))} style={{ marginBottom: 10 }} />
              <label className="field-label">Montant (FCFA)</label>
              <input className="input" inputMode="numeric" value={bonusDraft.amount} onChange={(e) => setBonusDraft((s) => ({ ...s, amount: e.target.value.replace(/[^0-9]/g, "") }))} style={{ marginBottom: 10 }} />
              <label className="field-label">Motif</label>
              <input className="input" value={bonusDraft.reason} onChange={(e) => setBonusDraft((s) => ({ ...s, reason: e.target.value }))} style={{ marginBottom: 14 }} />
              <button className="btn btn-primary" disabled={sendingBonus} onClick={requestSendBonus}>{sendingBonus ? "…" : "Envoyer le bonus"}</button>
            </>
          )}
        </div>
      ) : null}

      {tab === "settings" ? (
        <div className="card" style={{ maxWidth: 480 }}>
          <div className="card-head"><div><div className="card-title">Seuils de retrait</div><div className="card-sub">Commission actuelle : {settings ? `${(settings.commissionRate * 100).toFixed(2)} %` : "…"} (réglable depuis la page Commission)</div></div></div>
          {!canEdit ? <div style={{ fontSize: 13, color: "var(--muted)" }}>Réservé aux rôles Super-admin et Finance.</div> : (
            <>
              <label className="field-label">Retrait minimum (FCFA)</label>
              <input className="input" inputMode="numeric" value={settingsDraft.min} onChange={(e) => setSettingsDraft((s) => ({ ...s, min: e.target.value.replace(/[^0-9]/g, "") }))} style={{ marginBottom: 10 }} />
              <label className="field-label">Retrait maximum (FCFA)</label>
              <input className="input" inputMode="numeric" value={settingsDraft.max} onChange={(e) => setSettingsDraft((s) => ({ ...s, max: e.target.value.replace(/[^0-9]/g, "") }))} style={{ marginBottom: 14 }} />
              <button className="btn btn-primary" disabled={savingSettings} onClick={() => void saveSettings()}>{savingSettings ? "…" : "Enregistrer"}</button>
            </>
          )}
        </div>
      ) : null}
      <ConfirmDialog
        open={pendingBonus !== null}
        title={pendingBonus && pendingBonus.amount >= 50_000 ? "Confirmer l'envoi d'un montant élevé" : "Confirmer l'envoi du bonus"}
        tone={pendingBonus && pendingBonus.amount >= 50_000 ? "danger" : "primary"}
        confirmLabel={pendingBonus && pendingBonus.amount >= 50_000 ? "Envoyer" : "Confirmer"}
        busy={sendingBonus}
        description={pendingBonus ? (
          <div style={{ display: "grid", gap: 8 }}>
            <p>Vous allez créditer le wallet d'un profil :</p>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
              <li><strong>Bénéficiaire :</strong> {pendingBonus.phone}</li>
              <li><strong>Montant :</strong> {formatMoney(pendingBonus.amount)}</li>
              <li><strong>Motif :</strong> {pendingBonus.reason}</li>
            </ul>
            <p className="muted" style={{ fontSize: 11.5 }}>Cette action est irréversible : le wallet sera crédité et tracé dans l'audit log.</p>
          </div>
        ) : null}
        {...(pendingBonus && pendingBonus.amount >= 50_000 ? { doubleCheckValue: formatMoney(pendingBonus.amount) } : {})}
        onConfirm={confirmSendBonus}
        onCancel={() => !sendingBonus && setPendingBonus(null)}
      />
    </div>
  );
}
