import { useEffect, useState } from "react";
import { trpc } from "../lib/trpc";
import { ConfirmDialog } from "../lib/confirm-dialog";
import { downloadCsv, rowsToCsv } from "../lib/csv";

type Tab = "anomalies" | "webhooks" | "wallets" | "accounting";
type WebhookStatus = "received" | "processed" | "failed" | "ignored";
type WebhookRow = { id: string; provider: string; providerEventId: string; eventType: string; paymentTransactionId: string | null; status: WebhookStatus; failureReason: string | null; createdAt: Date | string; processedAt: Date | string | null; payloadPreview: string };
type PaymentRow = { id: string; profilePhone: string; type: "deposit" | "withdrawal"; provider: string; amount: number; providerReportedAmount?: number | null; providerReference: string; createdAt: Date | string; settledAt?: Date | string | null };
type Anomalies = { stalePendingDeposits: { rows: PaymentRow[]; total: number }; amountMismatches: { rows: PaymentRow[]; total: number }; webhookProblems: number };
type WalletCheck = { wallets: number; available: number; held: number; discrepancies: { profilePhone: string; availableBalance: number; heldBalance: number; ledgerAvailable: number; ledgerHeld: number }[]; checkedAt: string };
type Statement = {
  month: string;
  operations: { operation: string; movements: number; total: number }[];
  deposits: { transactions: number; total: number };
  withdrawals: { transactions: number; total: number };
  commissions: { gross: number; refunds: number; net: number };
  bonuses: number;
  penalties: number;
  rows: { createdAt: string; profilePhone: string; operation: string; amount: number; availableBefore: number; availableAfter: number; heldBefore: number; heldAfter: number; deliveryId: string | null; reason: string; id: string }[];
  truncated: boolean;
};

const WEBHOOK_LABEL: Record<WebhookStatus, string> = { received: "Reçu", processed: "Traité", failed: "En échec", ignored: "Ignoré" };
const WEBHOOK_PILL: Record<WebhookStatus, string> = { received: "pill-warning", processed: "pill-success", failed: "pill-error", ignored: "pill-neutral" };
const OPERATION_LABEL: Record<string, string> = {
  credit: "Crédits (dépôts, remboursements)", debit: "Débits (retraits)", commission_debit: "Commissions prélevées", compensation: "Commissions rendues",
  block: "Réserves de commission", unblock: "Réserves libérées", bonus: "Bonus", penalty: "Pénalités", refund: "Dédommagements (litiges)",
  deposit_request: "Demandes de dépôt", withdrawal_request: "Demandes de retrait",
};
// Même liste que YENGAPAY_TEST_PROVIDERS (server/yengapay.ts).
const SIMULATED_PROVIDERS = ["yengapay_test", "yengapay_direct_test", "ligdi_simulated"];
const PAGE_SIZE = 50;

function formatMoney(amount: number) {
  return `${new Intl.NumberFormat("fr-FR").format(amount)} FCFA`;
}

function formatDate(value: Date | string | null | undefined) {
  return value ? new Date(value).toLocaleString("fr-FR") : "—";
}

function previousMonth() {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Contrôle financier : ce qu'il faut regarder chaque jour pour que l'argent reste juste — anomalies de
 * paiement, webhooks YengaPay, cohérence des Wallets — et le relevé comptable du mois.
 */
export default function FinanceControlPage() {
  const [tab, setTab] = useState<Tab>("anomalies");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const [anomalies, setAnomalies] = useState<Anomalies | null>(null);
  const [webhookFilter, setWebhookFilter] = useState<{ status: "" | WebhookStatus; query: string }>({ status: "failed", query: "" });
  const [webhookSearch, setWebhookSearch] = useState("");
  const [webhookPage, setWebhookPage] = useState(0);
  const [webhooks, setWebhooks] = useState<{ rows: WebhookRow[]; total: number }>({ rows: [], total: 0 });
  const [pendingReplay, setPendingReplay] = useState<WebhookRow | null>(null);
  const [walletCheck, setWalletCheck] = useState<WalletCheck | null>(null);
  const [month, setMonth] = useState(previousMonth);
  const [statement, setStatement] = useState<Statement | null>(null);

  function fail(cause: unknown, fallback: string) {
    setError(cause instanceof Error ? cause.message : fallback);
  }

  function loadAnomalies() {
    trpc.adminConsole.finance.control.anomalies.query().then((data) => setAnomalies(data as Anomalies)).catch((cause) => fail(cause, "Chargement impossible."));
  }

  function loadWebhooks() {
    trpc.adminConsole.finance.control.webhooks.query({ status: webhookFilter.status || undefined, query: webhookFilter.query || undefined, limit: PAGE_SIZE, offset: webhookPage * PAGE_SIZE })
      .then((data) => setWebhooks(data as { rows: WebhookRow[]; total: number }))
      .catch((cause) => fail(cause, "Chargement impossible."));
  }

  useEffect(() => { if (tab === "anomalies") loadAnomalies(); }, [tab]);
  useEffect(() => { if (tab === "webhooks") loadWebhooks(); }, [tab, webhookFilter, webhookPage]);

  async function runWalletCheck() {
    setBusy("wallets"); setError("");
    try {
      setWalletCheck(await trpc.adminConsole.finance.control.walletCheck.query() as WalletCheck);
    } catch (cause) {
      fail(cause, "Contrôle impossible.");
    } finally {
      setBusy(null);
    }
  }

  async function loadStatement() {
    setBusy("accounting"); setError("");
    try {
      setStatement(await trpc.adminConsole.finance.control.accounting.query({ month }) as Statement);
    } catch (cause) {
      fail(cause, "Relevé indisponible.");
    } finally {
      setBusy(null);
    }
  }

  async function reconcile(row: PaymentRow) {
    setBusy(row.id); setError(""); setSuccess("");
    try {
      const result = await trpc.adminConsole.finance.reconcileYengapayPayment.mutate({ providerReference: row.providerReference });
      setSuccess("pending" in result ? "YengaPay indique que ce paiement est toujours en attente : rien n'a été crédité." : "Transaction mise à jour selon la réponse de YengaPay.");
      loadAnomalies();
    } catch (cause) {
      fail(cause, "Vérification impossible.");
    } finally {
      setBusy(null);
    }
  }

  async function confirmReplay() {
    if (!pendingReplay) return;
    setBusy(pendingReplay.id); setError(""); setSuccess("");
    try {
      const result = await trpc.adminConsole.finance.control.replayWebhook.mutate({ eventId: pendingReplay.id });
      if (result.status === "processed") setSuccess("Webhook relancé et traité.");
      else setError(`Relance effectuée, mais l'événement reste « ${WEBHOOK_LABEL[result.status as WebhookStatus] ?? result.status} »${result.failureReason ? ` : ${result.failureReason}` : "."}`);
      setPendingReplay(null);
      loadWebhooks();
    } catch (cause) {
      fail(cause, "Relance impossible.");
    } finally {
      setBusy(null);
    }
  }

  function exportStatement() {
    if (!statement) return;
    const csv = rowsToCsv([
      { key: "createdAt", label: "Date (UTC)" }, { key: "profilePhone", label: "Profil" }, { key: "operation", label: "Opération" }, { key: "amount", label: "Montant (FCFA)" },
      { key: "availableBefore", label: "Disponible avant" }, { key: "availableAfter", label: "Disponible après" }, { key: "heldBefore", label: "Bloqué avant" }, { key: "heldAfter", label: "Bloqué après" },
      { key: "deliveryId", label: "Livraison" }, { key: "reason", label: "Motif" }, { key: "id", label: "Identifiant du mouvement" },
    ], statement.rows);
    downloadCsv(`tikis-grand-livre-${statement.month}.csv`, csv);
  }

  const webhookPages = Math.max(1, Math.ceil(webhooks.total / PAGE_SIZE));

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Contrôle financier</h1>
          <p className="page-sub">Anomalies de paiement, webhooks YengaPay, cohérence des Wallets et relevé comptable</p>
        </div>
      </div>

      {error ? <div className="banner-error">{error}</div> : null}
      {success ? <div className="banner-ok">{success}</div> : null}

      <div className="card" style={{ paddingBottom: 0 }}>
        <div className="tabs">
          <button className={`tab ${tab === "anomalies" ? "active" : ""}`} onClick={() => setTab("anomalies")}>
            Anomalies{anomalies && anomalies.stalePendingDeposits.total + anomalies.amountMismatches.total + anomalies.webhookProblems > 0 ? ` (${anomalies.stalePendingDeposits.total + anomalies.amountMismatches.total + anomalies.webhookProblems})` : ""}
          </button>
          <button className={`tab ${tab === "webhooks" ? "active" : ""}`} onClick={() => setTab("webhooks")}>Webhooks YengaPay</button>
          <button className={`tab ${tab === "wallets" ? "active" : ""}`} onClick={() => setTab("wallets")}>Wallets</button>
          <button className={`tab ${tab === "accounting" ? "active" : ""}`} onClick={() => setTab("accounting")}>Export comptable</button>
        </div>
      </div>

      {tab === "anomalies" ? (
        <div style={{ display: "grid", gap: 16 }}>
          <div className="card">
            <div className="card-head"><div>
              <div className="card-title">Dépôts en attente depuis plus de 30 minutes</div>
              <div className="card-sub">Un paiement Mobile Money se confirme en quelques minutes : au-delà, vérifiez-le auprès de YengaPay</div>
            </div></div>
            {!anomalies ? <div className="empty-state">Chargement…</div> : anomalies.stalePendingDeposits.total === 0 ? <div className="empty-state">Aucun dépôt en attente anormalement long.</div> : (
              <div className="table-scroll">
                <table className="table">
                  <thead><tr><th>Créé le</th><th>Profil</th><th>Montant</th><th>Fournisseur</th><th>Référence</th><th></th></tr></thead>
                  <tbody>
                    {anomalies.stalePendingDeposits.rows.map((row) => (
                      <tr key={row.id}>
                        <td style={{ fontSize: 11.5, whiteSpace: "nowrap" }}>{formatDate(row.createdAt)}</td>
                        <td style={{ fontSize: 12 }}>{row.profilePhone}</td>
                        <td className="price">{formatMoney(row.amount)}</td>
                        <td style={{ fontSize: 12 }}>{row.provider}</td>
                        <td style={{ fontSize: 11, fontFamily: "ui-monospace, monospace" }}>{row.providerReference}</td>
                        <td style={{ textAlign: "right" }}>
                          {SIMULATED_PROVIDERS.includes(row.provider) ? <span className="muted" style={{ fontSize: 12 }}>Simulé : à traiter dans Finance</span> : (
                            <button className="btn btn-sm btn-primary" disabled={busy === row.id} onClick={() => void reconcile(row)}>Vérifier auprès de YengaPay</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {anomalies.stalePendingDeposits.total > anomalies.stalePendingDeposits.rows.length ? <p className="muted" style={{ fontSize: 12 }}>{anomalies.stalePendingDeposits.rows.length} affichés sur {anomalies.stalePendingDeposits.total}, les plus anciens d’abord.</p> : null}
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-head"><div>
              <div className="card-title">Écarts de montant</div>
              <div className="card-sub">YengaPay a confirmé un montant différent de celui attendu. Le Wallet a reçu le montant attendu : vérifiez auprès de YengaPay qui a raison</div>
            </div></div>
            {!anomalies ? <div className="empty-state">Chargement…</div> : anomalies.amountMismatches.total === 0 ? <div className="empty-state">Aucun écart.</div> : (
              <div className="table-scroll">
                <table className="table">
                  <thead><tr><th>Réglé le</th><th>Profil</th><th>Type</th><th>Attendu (crédité)</th><th>Annoncé par YengaPay</th><th>Écart</th><th>Référence</th></tr></thead>
                  <tbody>
                    {anomalies.amountMismatches.rows.map((row) => (
                      <tr key={row.id}>
                        <td style={{ fontSize: 11.5, whiteSpace: "nowrap" }}>{formatDate(row.settledAt)}</td>
                        <td style={{ fontSize: 12 }}>{row.profilePhone}</td>
                        <td style={{ fontSize: 12 }}>{row.type === "deposit" ? "Dépôt" : "Retrait"}</td>
                        <td className="price">{formatMoney(row.amount)}</td>
                        <td className="price">{formatMoney(row.providerReportedAmount ?? 0)}</td>
                        <td className="price">{formatMoney((row.providerReportedAmount ?? 0) - row.amount)}</td>
                        <td style={{ fontSize: 11, fontFamily: "ui-monospace, monospace" }}>{row.providerReference}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-head"><div>
              <div className="card-title">Webhooks à traiter</div>
              <div className="card-sub">En échec, ou reçus depuis plus de 10 minutes sans avoir été traités</div>
            </div></div>
            {!anomalies ? <div className="empty-state">Chargement…</div> : (
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
                <span>{anomalies.webhookProblems === 0 ? "Aucun webhook en souffrance." : `${anomalies.webhookProblems} webhook(s) en souffrance.`}</span>
                {anomalies.webhookProblems > 0 ? <button className="btn btn-sm" onClick={() => { setWebhookFilter({ status: "failed", query: "" }); setWebhookPage(0); setTab("webhooks"); }}>Voir les webhooks en échec</button> : null}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {tab === "webhooks" ? (
        <div className="card">
          <form style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }} onSubmit={(event) => { event.preventDefault(); setWebhookPage(0); setWebhookFilter((f) => ({ ...f, query: webhookSearch.trim() })); }}>
            <input id="webhook-search" className="input" style={{ flex: "1 1 240px" }} value={webhookSearch} onChange={(e) => setWebhookSearch(e.target.value)} placeholder="Référence de paiement, identifiant d’événement ou de transaction" />
            <select id="webhook-status" className="input" style={{ width: "auto" }} value={webhookFilter.status} onChange={(e) => { setWebhookPage(0); setWebhookFilter((f) => ({ ...f, status: e.target.value as "" | WebhookStatus })); }}>
              <option value="">Tous les statuts</option>
              {(Object.keys(WEBHOOK_LABEL) as WebhookStatus[]).map((status) => <option key={status} value={status}>{WEBHOOK_LABEL[status]}</option>)}
            </select>
            <button className="btn btn-primary" type="submit">Rechercher</button>
          </form>
          {webhooks.rows.length === 0 ? <div className="empty-state">Aucun webhook ne correspond.</div> : (
            <div className="table-scroll">
              <table className="table">
                <thead><tr><th>Reçu le</th><th>Type</th><th>Statut</th><th>Événement YengaPay</th><th>Raison de l’échec</th><th></th></tr></thead>
                <tbody>
                  {webhooks.rows.map((row) => (
                    <tr key={row.id}>
                      <td style={{ fontSize: 11.5, whiteSpace: "nowrap" }}>{formatDate(row.createdAt)}</td>
                      <td style={{ fontSize: 12 }}>{row.eventType}<div className="muted" style={{ fontSize: 11 }}>{row.provider}</div></td>
                      <td><span className={`pill ${WEBHOOK_PILL[row.status]}`}><span className="dot" />{WEBHOOK_LABEL[row.status]}</span></td>
                      <td style={{ fontSize: 11, fontFamily: "ui-monospace, monospace", maxWidth: 260, wordBreak: "break-all" }} title={row.payloadPreview}>{row.providerEventId}</td>
                      <td style={{ fontSize: 12, maxWidth: 280 }}>{row.failureReason ?? <span className="muted">—</span>}</td>
                      <td style={{ textAlign: "right" }}>
                        {row.status === "failed" || row.status === "received" ? <button className="btn btn-sm btn-primary" disabled={busy === row.id} onClick={() => setPendingReplay(row)}>Relancer</button> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end", marginTop: 12, fontSize: 12.5 }}>
            <span className="muted">{webhooks.total} webhook(s) · page {webhookPage + 1} / {webhookPages}</span>
            <button type="button" className="btn btn-sm" disabled={webhookPage === 0} onClick={() => setWebhookPage((p) => p - 1)}>← Précédent</button>
            <button type="button" className="btn btn-sm" disabled={webhookPage + 1 >= webhookPages} onClick={() => setWebhookPage((p) => p + 1)}>Suivant →</button>
          </div>
        </div>
      ) : null}

      {tab === "wallets" ? (
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Cohérence des Wallets</div>
              <div className="card-sub">Chaque solde doit être exactement la somme de ses mouvements. Un écart signale une modification faite hors du grand livre</div>
            </div>
            <button className="btn btn-primary" disabled={busy === "wallets"} onClick={() => void runWalletCheck()}>{busy === "wallets" ? "Contrôle…" : walletCheck ? "Relancer le contrôle" : "Lancer le contrôle"}</button>
          </div>
          {walletCheck ? (
            <div className="card-body" style={{ display: "grid", gap: 14 }}>
              <div className="grid grid-3">
                <div className="kpi"><div className="kpi-label">Wallets</div><div className="kpi-value">{walletCheck.wallets}</div></div>
                <div className="kpi"><div className="kpi-label">Total disponible</div><div className="kpi-value">{formatMoney(walletCheck.available)}</div></div>
                <div className="kpi"><div className="kpi-label">Total bloqué</div><div className="kpi-value">{formatMoney(walletCheck.held)}</div></div>
              </div>
              {walletCheck.discrepancies.length === 0 ? <div className="banner-ok" style={{ marginBottom: 0 }}>Tous les Wallets correspondent à leurs mouvements. Contrôlé le {formatDate(walletCheck.checkedAt)}.</div> : (
                <>
                  <div className="banner-error" style={{ marginBottom: 0 }}>{walletCheck.discrepancies.length} Wallet(s) ne correspondent pas à leurs mouvements, ou ont un solde négatif.</div>
                  <div className="table-scroll">
                    <table className="table">
                      <thead><tr><th>Profil</th><th>Disponible</th><th>Selon les mouvements</th><th>Bloqué</th><th>Selon les mouvements</th></tr></thead>
                      <tbody>
                        {walletCheck.discrepancies.map((row) => (
                          <tr key={row.profilePhone}>
                            <td style={{ fontSize: 12 }}>{row.profilePhone}</td>
                            <td className="price">{formatMoney(row.availableBalance)}</td>
                            <td className="price">{formatMoney(row.ledgerAvailable)}</td>
                            <td className="price">{formatMoney(row.heldBalance)}</td>
                            <td className="price">{formatMoney(row.ledgerHeld)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          ) : <div className="empty-state">Le contrôle parcourt tout le grand livre : lancez-le quand vous en avez besoin.</div>}
        </div>
      ) : null}

      {tab === "accounting" ? (
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Relevé comptable mensuel</div>
              <div className="card-sub">Mois calendaire en heure du Burkina Faso (UTC). Chaque consultation est inscrite au journal d’audit</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input id="accounting-month" className="input" type="month" value={month} onChange={(e) => { setMonth(e.target.value); setStatement(null); }} style={{ width: "auto" }} />
              <button className="btn btn-primary" disabled={busy === "accounting" || !month} onClick={() => void loadStatement()}>{busy === "accounting" ? "Calcul…" : "Afficher"}</button>
            </div>
          </div>
          {statement ? (
            <div className="card-body" style={{ display: "grid", gap: 14 }}>
              <div className="grid grid-3">
                <div className="kpi"><div className="kpi-label">Dépôts réglés</div><div className="kpi-value">{formatMoney(statement.deposits.total)}</div><div className="muted" style={{ fontSize: 12 }}>{statement.deposits.transactions} transaction(s)</div></div>
                <div className="kpi"><div className="kpi-label">Retraits réglés</div><div className="kpi-value">{formatMoney(statement.withdrawals.total)}</div><div className="muted" style={{ fontSize: 12 }}>{statement.withdrawals.transactions} transaction(s)</div></div>
                <div className="kpi"><div className="kpi-label">Commissions nettes</div><div className="kpi-value">{formatMoney(statement.commissions.net)}</div><div className="muted" style={{ fontSize: 12 }}>{formatMoney(statement.commissions.gross)} prélevées − {formatMoney(statement.commissions.refunds)} rendues</div></div>
              </div>
              <div className="table-scroll">
                <table className="table">
                  <thead><tr><th>Mouvement</th><th>Nombre</th><th>Total</th></tr></thead>
                  <tbody>
                    {statement.operations.length === 0 ? <tr><td colSpan={3} className="muted">Aucun mouvement ce mois-ci.</td></tr> : statement.operations.map((row) => (
                      <tr key={row.operation}>
                        <td style={{ fontSize: 12.5 }}>{OPERATION_LABEL[row.operation] ?? row.operation}</td>
                        <td style={{ fontVariantNumeric: "tabular-nums" }}>{row.movements}</td>
                        <td className="price">{formatMoney(row.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <button className="btn btn-primary" disabled={statement.rows.length === 0} onClick={exportStatement}>Exporter le grand livre (CSV)</button>
                <span className="muted" style={{ fontSize: 12 }}>{statement.rows.length} mouvement(s){statement.truncated ? " — export limité aux 50 000 premiers : contactez l’équipe technique pour un export complet" : ""}</span>
              </div>
            </div>
          ) : <div className="empty-state">Choisissez un mois, puis « Afficher ».</div>}
        </div>
      ) : null}

      <ConfirmDialog
        open={pendingReplay !== null}
        title="Relancer ce webhook"
        tone="primary"
        confirmLabel="Relancer"
        busy={busy !== null}
        description={pendingReplay ? (
          <div style={{ display: "grid", gap: 8, fontSize: 13 }}>
            <p style={{ margin: 0 }}>Le webhook reçu de YengaPay le {formatDate(pendingReplay.createdAt)} (« {pendingReplay.eventType} ») va être appliqué de nouveau, tel qu’il a été reçu et vérifié à l’époque.</p>
            <p className="muted" style={{ margin: 0 }}>Sans risque de double crédit : un paiement déjà réglé n’est jamais réglé deux fois.</p>
          </div>
        ) : null}
        onConfirm={() => void confirmReplay()}
        onCancel={() => { if (!busy) setPendingReplay(null); }}
      />
    </div>
  );
}
