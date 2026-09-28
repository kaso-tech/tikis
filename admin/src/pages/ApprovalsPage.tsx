import { useEffect, useState } from "react";
import { useAdminAuth } from "../lib/auth";
import { ConfirmDialog } from "../lib/confirm-dialog";
import { trpc } from "../lib/trpc";

type ApprovalStatus = "pending" | "approved" | "executed" | "failed" | "rejected" | "cancelled";
type Approval = {
  id: string; action: "wallet_bonus" | "wallet_penalty" | "withdrawal_settle"; amount: number; targetPhone: string; payload: Record<string, unknown>;
  status: ApprovalStatus; requestedByAdminId: number; requestedByEmail: string; decidedByEmail: string | null; decisionNote: string | null; failureReason: string | null;
  createdAt: Date | string; decidedAt: Date | string | null;
};

const ACTION_LABEL: Record<Approval["action"], string> = { wallet_bonus: "Bonus", wallet_penalty: "Pénalité", withdrawal_settle: "Validation de retrait" };
const STATUS_LABEL: Record<ApprovalStatus, string> = { pending: "En attente", approved: "En cours d’exécution", executed: "Exécutée", failed: "Échec", rejected: "Refusée", cancelled: "Retirée" };
const STATUS_PILL: Record<ApprovalStatus, string> = { pending: "pill-warning", approved: "pill-info", executed: "pill-success", failed: "pill-error", rejected: "pill-neutral", cancelled: "pill-neutral" };

function formatMoney(amount: number) {
  return `${new Intl.NumberFormat("fr-FR").format(amount)} FCFA`;
}

function detail(approval: Approval) {
  const payload = approval.payload;
  if (approval.action === "withdrawal_settle") return `Versement ${String(payload.payoutReference ?? "")} — ${String(payload.notes ?? "")}`;
  return String(payload.reason ?? "");
}

/**
 * Double validation : les bonus, pénalités et validations de retrait au-delà du seuil attendent ici
 * qu'un second admin les valide. Le demandeur ne peut que retirer sa propre demande.
 */
export default function ApprovalsPage() {
  const { admin } = useAdminAuth();
  const [tab, setTab] = useState<"open" | "closed">("open");
  const [rows, setRows] = useState<Approval[]>([]);
  const [total, setTotal] = useState(0);
  const [threshold, setThreshold] = useState<number | null>(null);
  const [thresholdDraft, setThresholdDraft] = useState("");
  const [pending, setPending] = useState<{ approval: Approval; decision: "approve" | "close" } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  function load() {
    trpc.adminConsole.approvals.list.query({ status: tab, limit: 100 })
      .then((data) => { setRows(data.rows as Approval[]); setTotal(data.total); })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Chargement impossible."));
  }
  useEffect(load, [tab]);
  useEffect(() => {
    trpc.adminConsole.approvals.threshold.get.query()
      .then((data) => { setThreshold(data.threshold); setThresholdDraft(String(data.threshold)); })
      .catch(() => setThreshold(null));
  }, []);

  async function decide() {
    if (!pending) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      if (pending.decision === "approve") {
        const result = await trpc.adminConsole.approvals.approve.mutate({ approvalId: pending.approval.id });
        if (result.status === "executed") setSuccess("Demande validée et exécutée.");
        else setError(`Validée, mais l’exécution a échoué : ${result.failureReason}. Rien n’a été débité ni crédité.`);
      } else {
        const result = await trpc.adminConsole.approvals.close.mutate({ approvalId: pending.approval.id, note: note.trim() || undefined });
        setSuccess(result.status === "cancelled" ? "Demande retirée." : "Demande refusée.");
      }
      setPending(null);
      setNote("");
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Action impossible.");
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  async function saveThreshold() {
    const value = Number(thresholdDraft);
    setError(""); setSuccess("");
    try {
      const result = await trpc.adminConsole.approvals.threshold.set.mutate({ threshold: value });
      setThreshold(result.threshold);
      setSuccess(`Seuil de double validation : ${formatMoney(result.threshold)}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Seuil non enregistré.");
    }
  }

  const own = (approval: Approval) => approval.requestedByAdminId === admin?.adminId;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Validations</h1>
          <p className="page-sub">
            Bonus, pénalités et retraits à partir de {threshold === null ? "…" : formatMoney(threshold)} : un second admin valide avant exécution
          </p>
        </div>
      </div>

      {error ? <div className="banner-error">{error}</div> : null}
      {success ? <div className="banner-ok">{success}</div> : null}

      {admin?.role === "super_admin" ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-head"><div><div className="card-title">Seuil de double validation</div><div className="card-sub">Au-delà de ce montant, l’admin qui demande ne peut pas exécuter seul</div></div></div>
          <div className="card-body" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input id="approval-threshold" className="input" inputMode="numeric" style={{ maxWidth: 180 }} value={thresholdDraft} onChange={(e) => setThresholdDraft(e.target.value.replace(/[^0-9]/g, ""))} />
            <span className="muted" style={{ fontSize: 12.5 }}>FCFA</span>
            <button className="btn btn-primary" disabled={!thresholdDraft || Number(thresholdDraft) === threshold} onClick={() => void saveThreshold()}>Enregistrer</button>
          </div>
        </div>
      ) : null}

      <div className="card" style={{ paddingBottom: 0 }}>
        <div className="tabs">
          <button className={`tab ${tab === "open" ? "active" : ""}`} onClick={() => setTab("open")}>En attente{tab === "open" && total > 0 ? ` (${total})` : ""}</button>
          <button className={`tab ${tab === "closed" ? "active" : ""}`} onClick={() => setTab("closed")}>Historique</button>
        </div>
      </div>

      <div className="card">
        {rows.length === 0 ? <div className="empty-state">{tab === "open" ? "Aucune demande en attente." : "Aucune demande traitée."}</div> : (
          <div className="table-scroll">
            <table className="table">
              <thead><tr><th>Demandée le</th><th>Action</th><th>Montant</th><th>Profil</th><th>Motif / détail</th><th>Demandeur</th><th>Statut</th><th></th></tr></thead>
              <tbody>
                {rows.map((approval) => (
                  <tr key={approval.id}>
                    <td style={{ fontSize: 11.5, whiteSpace: "nowrap" }}>{new Date(approval.createdAt).toLocaleString("fr-FR")}</td>
                    <td style={{ fontSize: 12.5 }}>{ACTION_LABEL[approval.action]}</td>
                    <td className="price">{formatMoney(approval.amount)}</td>
                    <td style={{ fontSize: 12 }}>{approval.targetPhone}</td>
                    <td style={{ fontSize: 12, maxWidth: 260 }}>{detail(approval)}</td>
                    <td style={{ fontSize: 12 }}>{approval.requestedByEmail}</td>
                    <td>
                      <span className={`pill ${STATUS_PILL[approval.status]}`}><span className="dot" />{STATUS_LABEL[approval.status]}</span>
                      {approval.decidedByEmail ? <div className="muted" style={{ fontSize: 11 }}>par {approval.decidedByEmail}</div> : null}
                      {approval.failureReason ? <div style={{ fontSize: 11, color: "var(--error)" }}>{approval.failureReason}</div> : null}
                      {approval.decisionNote ? <div className="muted" style={{ fontSize: 11 }}>{approval.decisionNote}</div> : null}
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {approval.status === "pending" ? (own(approval)
                        ? <button className="btn btn-sm" disabled={busy} onClick={() => setPending({ approval, decision: "close" })}>Retirer</button>
                        : <span style={{ display: "inline-flex", gap: 6 }}>
                            <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => setPending({ approval, decision: "approve" })}>Valider</button>
                            <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => setPending({ approval, decision: "close" })}>Refuser</button>
                          </span>) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={pending !== null}
        title={!pending ? "" : pending.decision === "approve" ? "Valider et exécuter" : own(pending.approval) ? "Retirer ma demande" : "Refuser la demande"}
        tone={pending?.decision === "approve" ? "primary" : "danger"}
        confirmLabel={!pending ? "" : pending.decision === "approve" ? "Valider" : own(pending.approval) ? "Retirer" : "Refuser"}
        busy={busy}
        description={pending ? (
          <div style={{ display: "grid", gap: 8, fontSize: 13 }}>
            <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
              <li><strong>{ACTION_LABEL[pending.approval.action]} :</strong> {formatMoney(pending.approval.amount)}</li>
              <li><strong>Profil :</strong> {pending.approval.targetPhone}</li>
              <li><strong>Demandé par :</strong> {pending.approval.requestedByEmail}</li>
              <li><strong>Motif :</strong> {detail(pending.approval)}</li>
            </ul>
            {pending.decision === "approve"
              ? <p className="muted" style={{ margin: 0 }}>L’opération est exécutée dès votre validation, à votre nom.</p>
              : <>
                  <label className="field-label" htmlFor="approval-note">Motif (facultatif)</label>
                  <input id="approval-note" className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
                </>}
          </div>
        ) : null}
        onConfirm={() => void decide()}
        onCancel={() => { if (!busy) { setPending(null); setNote(""); } }}
      />
    </div>
  );
}
