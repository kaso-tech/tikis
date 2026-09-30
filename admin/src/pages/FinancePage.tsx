import { useEffect, useState } from "react";
import { trpc } from "../lib/trpc";
import { useAdminAuth } from "../lib/auth";
import { ConfirmDialog } from "../lib/confirm-dialog";

type TransactionStatus = "pending" | "succeeded" | "failed" | "cancelled" | "expired";
type Transaction = { id: string; profilePhone: string; type: "deposit" | "withdrawal"; provider: string; amount: number; status: TransactionStatus; providerReference: string; payoutReference?: string | null; adminNotes?: string | null; createdAt: Date | string; settledAt?: Date | string | null };

const STATUS_LABEL: Record<TransactionStatus, string> = { pending: "En attente", succeeded: "Validée", failed: "Échouée", cancelled: "Annulée", expired: "Expirée" };
const STATUS_PILL: Record<TransactionStatus, string> = { pending: "pill-warning", succeeded: "pill-success", failed: "pill-error", cancelled: "pill-neutral", expired: "pill-neutral" };
const HISTORY_PAGE_SIZE = 50;

// Même liste que YENGAPAY_TEST_PROVIDERS (server/yengapay.ts) : tout autre fournisseur est un vrai
// paiement YengaPay, que seul YengaPay peut confirmer — le serveur refuse de le valider à la main.
const SIMULATED_PROVIDERS = ["yengapay_test", "yengapay_direct_test", "ligdi_simulated"];
const isRealYengapayDeposit = (t: Transaction) => t.type === "deposit" && !SIMULATED_PROVIDERS.includes(t.provider);

function formatMoney(amount: number) {
  return `${new Intl.NumberFormat("fr-FR").format(amount)} FCFA`;
}

export default function FinancePage() {
  const { admin } = useAdminAuth();
  const canEdit = admin?.role === "super_admin" || admin?.role === "finance";
  const [tab, setTab] = useState<"withdrawals" | "deposits" | "history" | "settings" | "bonus">("withdrawals");
  // Historique : toutes les transactions, filtrables, avec recherche par téléphone ou référence.
  const [historyFilter, setHistoryFilter] = useState<{ type: "" | "deposit" | "withdrawal"; status: "" | TransactionStatus; query: string }>({ type: "", status: "", query: "" });
  const [historySearch, setHistorySearch] = useState("");
  const [historyPage, setHistoryPage] = useState(0);
  const [history, setHistory] = useState<{ rows: Transaction[]; total: number }>({ rows: [], total: 0 });
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  // Décision en attente de confirmation. Valider un retrait atteste qu'il a été versé hors application :
  // la référence Mobile Money et une note sont exigées (le serveur les exige aussi).
  const [pendingSettle, setPendingSettle] = useState<{ transaction: Transaction; outcome: "succeeded" | "failed" } | null>(null);
  const [settleDraft, setSettleDraft] = useState({ payoutReference: "", notes: "" });
  const [settleError, setSettleError] = useState("");

  const [settings, setSettings] = useState<{ commissionRate: number; minWithdrawal: number; maxWithdrawal: number } | null>(null);
  const [settingsDraft, setSettingsDraft] = useState({ min: "", max: "" });
  const [savingSettings, setSavingSettings] = useState(false);

  const [bonusDraft, setBonusDraft] = useState({ phone: "", amount: "", reason: "" });
  const [sendingBonus, setSendingBonus] = useState(false);
  const [pendingBonus, setPendingBonus] = useState<{ phone: string; amount: number; reason: string; requestId: string } | null>(null);

  function loadTransactions(type: "deposit" | "withdrawal") {
    trpc.adminConsole.finance.transactions.query({ type, status: "pending", limit: 200 })
      .then((data) => setTransactions(data.rows as Transaction[]))
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Chargement impossible."));
  }
  useEffect(() => { if (tab === "withdrawals") loadTransactions("withdrawal"); if (tab === "deposits") loadTransactions("deposit"); }, [tab]);

  useEffect(() => {
    if (tab !== "history") return;
    trpc.adminConsole.finance.transactions.query({
      type: historyFilter.type || undefined,
      status: historyFilter.status || undefined,
      query: historyFilter.query || undefined,
      limit: HISTORY_PAGE_SIZE,
      offset: historyPage * HISTORY_PAGE_SIZE,
    })
      .then((data) => setHistory({ rows: data.rows as Transaction[], total: data.total }))
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Chargement impossible."));
  }, [tab, historyFilter, historyPage]);

  const historyPages = Math.max(1, Math.ceil(history.total / HISTORY_PAGE_SIZE));

  useEffect(() => {
    trpc.adminConsole.finance.settings.get.query()
      .then((data) => { setSettings(data); setSettingsDraft({ min: String(data.minWithdrawal), max: String(data.maxWithdrawal) }); })
      .catch(() => {});
  }, []);

  function askSettle(transaction: Transaction, outcome: "succeeded" | "failed") {
    setSettleDraft({ payoutReference: "", notes: "" });
    setSettleError("");
    setPendingSettle({ transaction, outcome });
  }

  const needsPayoutProof = pendingSettle?.transaction.type === "withdrawal" && pendingSettle.outcome === "succeeded";

  async function confirmSettle() {
    if (!pendingSettle || busyId) return;
    const { transaction, outcome } = pendingSettle;
    const payoutReference = settleDraft.payoutReference.trim();
    const notes = settleDraft.notes.trim();
    if (needsPayoutProof && payoutReference.length < 4) { setSettleError("Indiquez la référence du versement Mobile Money."); return; }
    if (needsPayoutProof && !notes) { setSettleError("Ajoutez une note sur le versement (opérateur, numéro crédité…)."); return; }
    setBusyId(transaction.id);
    setError(""); setSuccess(""); setSettleError("");
    try {
      const result = await trpc.adminConsole.finance.settleTransaction.mutate({ paymentId: transaction.id, outcome, notes: notes || undefined, payoutReference: needsPayoutProof ? payoutReference : undefined });
      setSuccess("approvalRequired" in result ? "Montant au-delà du seuil : demande envoyée pour validation par un second admin (Finance → Validations)." : outcome === "succeeded" ? "Transaction validée." : "Transaction rejetée.");
      setPendingSettle(null);
      loadTransactions(transaction.type);
    } catch (cause) {
      // L'erreur reste dans la boîte de dialogue : l'admin corrige la référence sans tout ressaisir.
      setSettleError(cause instanceof Error ? cause.message : "Action impossible.");
    } finally {
      setBusyId(null);
    }
  }

  async function reconcile(t: Transaction) {
    setBusyId(t.id);
    setError(""); setSuccess("");
    try {
      const result = await trpc.adminConsole.finance.reconcileYengapayPayment.mutate({ providerReference: t.providerReference });
      setSuccess("pending" in result ? "YengaPay indique que ce paiement est toujours en attente : rien n'a été crédité." : "Transaction mise à jour selon la réponse de YengaPay.");
      loadTransactions("deposit");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Vérification impossible.");
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
    // Généré une seule fois ici, réutilisé même si la confirmation est déclenchée deux fois : un
    // double-clic sur "Confirmer" ne peut donc jamais créditer deux fois le même bonus.
    setPendingBonus({ phone: bonusDraft.phone.trim(), amount, reason: bonusDraft.reason.trim() || "Crédit bonus", requestId: crypto.randomUUID() });
  }

  async function confirmSendBonus() {
    if (!pendingBonus) return;
    setSendingBonus(true);
    try {
      const result = await trpc.adminConsole.finance.sendBonus.mutate({ phone: pendingBonus.phone, amount: pendingBonus.amount, reason: pendingBonus.reason, requestId: pendingBonus.requestId });
      setSuccess("approvalRequired" in result ? "Montant au-delà du seuil : demande envoyée pour validation par un second admin (Finance → Validations)." : `${formatMoney(pendingBonus.amount)} envoyés à ${pendingBonus.phone}.`);
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
          <button className={`tab ${tab === "history" ? "active" : ""}`} onClick={() => setTab("history")}>Historique</button>
          <button className={`tab ${tab === "bonus" ? "active" : ""}`} onClick={() => setTab("bonus")}>Envoyer un bonus</button>
          <button className={`tab ${tab === "settings" ? "active" : ""}`} onClick={() => setTab("settings")}>Réglages</button>
        </div>
      </div>

      {tab === "history" ? (
        <div className="card">
          <form
            style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}
            onSubmit={(event) => { event.preventDefault(); setHistoryPage(0); setHistoryFilter((f) => ({ ...f, query: historySearch.trim() })); }}
          >
            <input id="history-search" className="input" style={{ flex: "1 1 220px" }} value={historySearch} onChange={(e) => setHistorySearch(e.target.value)} placeholder="Téléphone, référence YengaPay ou de versement" />
            <select id="history-type" className="input" style={{ width: "auto" }} value={historyFilter.type} onChange={(e) => { setHistoryPage(0); setHistoryFilter((f) => ({ ...f, type: e.target.value as "" | "deposit" | "withdrawal" })); }}>
              <option value="">Dépôts et retraits</option>
              <option value="deposit">Dépôts</option>
              <option value="withdrawal">Retraits</option>
            </select>
            <select id="history-status" className="input" style={{ width: "auto" }} value={historyFilter.status} onChange={(e) => { setHistoryPage(0); setHistoryFilter((f) => ({ ...f, status: e.target.value as "" | TransactionStatus })); }}>
              <option value="">Tous les statuts</option>
              {(Object.keys(STATUS_LABEL) as TransactionStatus[]).map((status) => <option key={status} value={status}>{STATUS_LABEL[status]}</option>)}
            </select>
            <button className="btn btn-primary" type="submit">Rechercher</button>
          </form>
          {history.rows.length === 0 ? <div className="empty-state">Aucune transaction ne correspond.</div> : (
            <div className="table-scroll">
              <table className="table">
                <thead><tr><th>Date</th><th>Profil</th><th>Type</th><th>Montant</th><th>Statut</th><th>Fournisseur</th><th>Référence</th><th>Décision manuelle</th></tr></thead>
                <tbody>
                  {history.rows.map((t) => (
                    <tr key={t.id}>
                      <td style={{ fontSize: 11.5, color: "var(--muted)", whiteSpace: "nowrap" }}>{new Date(t.createdAt).toLocaleString("fr-FR")}</td>
                      <td style={{ fontSize: 12 }}>{t.profilePhone}</td>
                      <td style={{ fontSize: 12 }}>{t.type === "deposit" ? "Dépôt" : "Retrait"}</td>
                      <td className="price">{formatMoney(t.amount)}</td>
                      <td><span className={`pill ${STATUS_PILL[t.status]}`}><span className="dot" />{STATUS_LABEL[t.status]}</span></td>
                      <td style={{ fontSize: 12 }}>{t.provider}</td>
                      <td style={{ fontSize: 11, fontFamily: "ui-monospace, monospace" }}>{t.providerReference}{t.payoutReference ? <div className="muted">versement : {t.payoutReference}</div> : null}</td>
                      <td style={{ fontSize: 12 }}>{t.adminNotes ?? <span className="muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end", marginTop: 12, fontSize: 12.5 }}>
            <span className="muted">{history.total} transaction(s) · page {historyPage + 1} / {historyPages}</span>
            <button type="button" className="btn btn-sm" disabled={historyPage === 0} onClick={() => setHistoryPage((p) => p - 1)}>← Précédent</button>
            <button type="button" className="btn btn-sm" disabled={historyPage + 1 >= historyPages} onClick={() => setHistoryPage((p) => p + 1)}>Suivant →</button>
          </div>
        </div>
      ) : null}

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
                    <td style={{ textAlign: "right" }}>
                      {canEdit ? <div className="row-actions">
                        {isRealYengapayDeposit(t)
                          ? <button className="btn btn-sm btn-primary" disabled={busyId === t.id} onClick={() => void reconcile(t)}>Vérifier auprès de YengaPay</button>
                          : <button className="btn btn-sm btn-primary" disabled={busyId === t.id} onClick={() => askSettle(t, "succeeded")}>Valider</button>}
                        <button className="btn btn-sm btn-danger" disabled={busyId === t.id} onClick={() => askSettle(t, "failed")}>Rejeter</button>
                      </div> : null}
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
              <label className="field-label" htmlFor="bonus-phone">Téléphone du bénéficiaire</label>
              <input id="bonus-phone" className="input" value={bonusDraft.phone} onChange={(e) => setBonusDraft((s) => ({ ...s, phone: e.target.value }))} style={{ marginBottom: 10 }} />
              <label className="field-label" htmlFor="bonus-amount">Montant (FCFA)</label>
              <input id="bonus-amount" className="input" inputMode="numeric" value={bonusDraft.amount} onChange={(e) => setBonusDraft((s) => ({ ...s, amount: e.target.value.replace(/[^0-9]/g, "") }))} style={{ marginBottom: 10 }} />
              <label className="field-label" htmlFor="bonus-reason">Motif</label>
              <input id="bonus-reason" className="input" value={bonusDraft.reason} onChange={(e) => setBonusDraft((s) => ({ ...s, reason: e.target.value }))} style={{ marginBottom: 14 }} />
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
        open={pendingSettle !== null}
        title={!pendingSettle ? "" : pendingSettle.outcome === "failed" ? (pendingSettle.transaction.type === "withdrawal" ? "Rejeter ce retrait" : "Rejeter ce dépôt") : (pendingSettle.transaction.type === "withdrawal" ? "Valider un retrait versé" : "Valider ce dépôt")}
        tone={pendingSettle?.outcome === "failed" ? "danger" : "primary"}
        confirmLabel={pendingSettle?.outcome === "failed" ? "Rejeter" : "Valider"}
        busy={busyId !== null}
        description={pendingSettle ? (
          <div style={{ display: "grid", gap: 8 }}>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
              <li><strong>Profil :</strong> {pendingSettle.transaction.profilePhone}</li>
              <li><strong>Montant :</strong> {formatMoney(pendingSettle.transaction.amount)}</li>
              <li><strong>Fournisseur :</strong> {pendingSettle.transaction.provider}</li>
            </ul>
            {needsPayoutProof ? (
              <>
                <p style={{ fontSize: 12.5 }}>Validez seulement après avoir versé l’argent. Le Wallet sera débité de ce montant.</p>
                <label className="field-label" htmlFor="payout-reference">Référence du versement Mobile Money</label>
                <input id="payout-reference" className="input" value={settleDraft.payoutReference} maxLength={80} onChange={(e) => setSettleDraft((s) => ({ ...s, payoutReference: e.target.value }))} placeholder="ex. CI240928.1532.A12345" />
              </>
            ) : null}
            <label className="field-label" htmlFor="settle-notes">{needsPayoutProof ? "Note sur le versement" : "Motif (facultatif)"}</label>
            <input id="settle-notes" className="input" value={settleDraft.notes} maxLength={300} onChange={(e) => setSettleDraft((s) => ({ ...s, notes: e.target.value }))} placeholder={needsPayoutProof ? "Opérateur, numéro crédité…" : ""} />
            {settleError ? <div className="banner-error" style={{ marginBottom: 0 }}>{settleError}</div> : null}
          </div>
        ) : null}
        onConfirm={() => void confirmSettle()}
        onCancel={() => { if (!busyId) setPendingSettle(null); }}
      />
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
