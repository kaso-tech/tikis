import { useState } from "react";
import { trpc } from "../lib/trpc";
import { ConfirmDialog } from "../lib/confirm-dialog";
import type { AdminRole } from "../lib/auth";

type Props = {
  role: AdminRole;
  delivery: { id: string; status: string; senderPhone: string; driverPhone: string | null; previousDriverPhone?: string | null };
  candidates: { driverPhone: string }[];
  refundableCommissions: { driverPhone: string; amount: number }[];
  onChanged: (notice: string) => Promise<void>;
};

type Pending =
  | { kind: "refund"; phone: string; amount: number; reason: string; requestId: string }
  | { kind: "commission"; driverPhone: string; amount: number; reason: string }
  | { kind: "remove"; driverPhone: string; reason: string }
  | { kind: "complete"; reason: string };

function formatMoney(amount: number) {
  return `${new Intl.NumberFormat("fr-FR").format(amount)} FCFA`;
}

/** Les profils qu'on peut dédommager : ceux qui ont pris part à la livraison. */
function participants(props: Props) {
  const list: { phone: string; label: string }[] = [{ phone: props.delivery.senderPhone, label: `Expéditeur · ${props.delivery.senderPhone}` }];
  if (props.delivery.driverPhone) list.push({ phone: props.delivery.driverPhone, label: `Livreur · ${props.delivery.driverPhone}` });
  if (props.delivery.previousDriverPhone) list.push({ phone: props.delivery.previousDriverPhone, label: `Ancien livreur · ${props.delivery.previousDriverPhone}` });
  for (const candidate of props.candidates) list.push({ phone: candidate.driverPhone, label: `Candidat · ${candidate.driverPhone}` });
  return list.filter((entry, index) => list.findIndex((other) => other.phone === entry.phone) === index);
}

/**
 * Actions de résolution d'un litige, rattachées à la livraison : dédommager, rendre sa commission au
 * livreur, retirer le livreur, clore la livraison. Chacune demande un motif, visible dans la chronologie.
 */
export default function DisputeActions(props: Props) {
  const { role, delivery } = props;
  const canPay = role === "super_admin" || role === "finance";
  const canOperate = role === "super_admin" || role === "support";
  const people = participants(props);
  const [refund, setRefund] = useState(() => ({ phone: delivery.senderPhone, amount: "", reason: "", requestId: crypto.randomUUID() }));
  const [commissionReason, setCommissionReason] = useState("");
  const [operateReason, setOperateReason] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const canRemove = !!delivery.driverPhone && (delivery.status === "pending_confirmation" || delivery.status === "active");
  const canComplete = delivery.status === "active" && !!delivery.driverPhone;
  if (!canPay && !canOperate) return null;

  function ask(next: Pending) {
    setError("");
    if (next.reason.trim().length < 3) { setError("Indiquez un motif (3 caractères au moins) : il est visible dans la chronologie et le journal."); return; }
    if (next.kind === "refund" && !(next.amount > 0)) { setError("Indiquez le montant du dédommagement."); return; }
    setPending(next);
  }

  async function run() {
    if (!pending) return;
    setBusy(true); setError("");
    try {
      let notice = "";
      if (pending.kind === "refund") {
        const result = await trpc.adminConsole.disputes.refund.mutate({ deliveryId: delivery.id, phone: pending.phone, amount: pending.amount, reason: pending.reason.trim(), requestId: pending.requestId });
        notice = result.approvalRequired ? "Montant au-delà du seuil : demande envoyée pour validation par un second admin (Validations)." : `${formatMoney(pending.amount)} crédités à ${pending.phone}.`;
        setRefund({ phone: delivery.senderPhone, amount: "", reason: "", requestId: crypto.randomUUID() });
      } else if (pending.kind === "commission") {
        const result = await trpc.adminConsole.disputes.refundCommission.mutate({ deliveryId: delivery.id, driverPhone: pending.driverPhone, reason: pending.reason.trim() });
        notice = `Commission de ${formatMoney(result.amount)} remboursée à ${pending.driverPhone}.`;
        setCommissionReason("");
      } else if (pending.kind === "remove") {
        const result = await trpc.adminConsole.disputes.removeDriver.mutate({ deliveryId: delivery.id, reason: pending.reason.trim() });
        notice = `Livreur retiré, livraison rouverte aux candidatures.${result.released ? ` Commission de ${formatMoney(result.released)} débloquée.` : ""}${result.refunded ? ` Commission de ${formatMoney(result.refunded)} remboursée.` : ""}`;
        setOperateReason("");
      } else {
        await trpc.adminConsole.disputes.complete.mutate({ deliveryId: delivery.id, reason: pending.reason.trim() });
        notice = "Livraison clôturée.";
        setOperateReason("");
      }
      setPending(null);
      await props.onChanged(notice);
    } catch (cause) {
      setPending(null);
      setError(cause instanceof Error ? cause.message : "Action impossible.");
    } finally {
      setBusy(false);
    }
  }

  const dialog = pending ? {
    refund: { title: "Dédommager ce profil ?", confirm: "Créditer", body: <>Créditer <strong>{pending.kind === "refund" ? formatMoney(pending.amount) : ""}</strong> sur le Wallet de <strong>{pending.kind === "refund" ? pending.phone : ""}</strong>. Le mouvement est rattaché à cette livraison.</> },
    commission: { title: "Rembourser la commission ?", confirm: "Rembourser", body: <>Rendre <strong>{pending.kind === "commission" ? formatMoney(pending.amount) : ""}</strong> de commission à <strong>{pending.kind === "commission" ? pending.driverPhone : ""}</strong>. La commission de cette livraison ne peut être rendue qu’une fois.</> },
    remove: { title: "Retirer le livreur ?", confirm: "Retirer le livreur", body: <>Le livreur <strong>{delivery.driverPhone}</strong> est retiré, sa commission lui est rendue, et la livraison est rouverte aux candidatures. L’expéditeur et le livreur sont prévenus.</> },
    complete: { title: "Clore la livraison ?", confirm: "Clore", body: <>La livraison passe à « terminée », comme si un participant l’avait déclarée livrée. L’expéditeur peut ensuite évaluer le livreur.</> },
  }[pending.kind] : null;

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Résoudre le litige</div>
          <div className="card-sub">Chaque action exige un motif, visible dans la chronologie et le journal d’audit.</div>
        </div>
      </div>
      <div className="card-body">
        {error ? <div className="banner-error">{error}</div> : null}
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", alignItems: "start" }}>
          {canPay ? (
            <form className="action-block" onSubmit={(event) => { event.preventDefault(); ask({ kind: "refund", phone: refund.phone, amount: Number(refund.amount), reason: refund.reason, requestId: refund.requestId }); }}>
              <div className="action-block-title">Dédommager</div>
              <label className="field-label" htmlFor="refund-phone">Bénéficiaire</label>
              <select id="refund-phone" className="select" value={refund.phone} onChange={(e) => setRefund((s) => ({ ...s, phone: e.target.value, requestId: crypto.randomUUID() }))}>
                {people.map((person) => <option key={person.phone} value={person.phone}>{person.label}</option>)}
              </select>
              <label className="field-label" htmlFor="refund-amount" style={{ marginTop: 8 }}>Montant (FCFA)</label>
              <input id="refund-amount" className="input" inputMode="numeric" value={refund.amount} onChange={(e) => setRefund((s) => ({ ...s, amount: e.target.value.replace(/[^0-9]/g, ""), requestId: crypto.randomUUID() }))} />
              <label className="field-label" htmlFor="refund-reason" style={{ marginTop: 8 }}>Motif</label>
              <input id="refund-reason" className="input" maxLength={300} value={refund.reason} onChange={(e) => setRefund((s) => ({ ...s, reason: e.target.value }))} placeholder="Colis abîmé, retard important…" />
              <button className="btn btn-primary btn-sm" type="submit" style={{ marginTop: 8 }}>Dédommager…</button>
            </form>
          ) : null}

          {canPay ? (
            <div className="action-block">
              <div className="action-block-title">Rendre la commission</div>
              {props.refundableCommissions.length === 0 ? (
                <p className="muted" style={{ fontSize: 12, margin: 0 }}>Aucune commission prélevée à rendre sur cette livraison.</p>
              ) : (
                <>
                  <label className="field-label" htmlFor="commission-reason">Motif</label>
                  <input id="commission-reason" className="input" maxLength={300} value={commissionReason} onChange={(e) => setCommissionReason(e.target.value)} placeholder="Livraison annulée par l’expéditeur sur place…" />
                  <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                    {props.refundableCommissions.map((row) => (
                      <div key={row.driverPhone} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 12 }}>{row.driverPhone} · <strong>{formatMoney(row.amount)}</strong></span>
                        <button className="btn btn-sm" type="button" onClick={() => ask({ kind: "commission", driverPhone: row.driverPhone, amount: row.amount, reason: commissionReason })}>Rembourser…</button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : null}

          {canOperate ? (
            <div className="action-block">
              <div className="action-block-title">Livreur et statut</div>
              {canRemove || canComplete ? (
                <>
                  <label className="field-label" htmlFor="operate-reason">Motif</label>
                  <input id="operate-reason" className="input" maxLength={300} value={operateReason} onChange={(e) => setOperateReason(e.target.value)} placeholder="Livreur injoignable, colis remis en main propre…" />
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                    {canRemove ? <button className="btn btn-danger btn-sm" type="button" onClick={() => ask({ kind: "remove", driverPhone: delivery.driverPhone ?? "", reason: operateReason })}>Retirer le livreur…</button> : null}
                    {canComplete ? <button className="btn btn-sm" type="button" onClick={() => ask({ kind: "complete", reason: operateReason })}>Clore la livraison…</button> : null}
                  </div>
                </>
              ) : (
                <p className="muted" style={{ fontSize: 12, margin: 0 }}>Aucun livreur à retirer ni livraison en cours à clore.</p>
              )}
            </div>
          ) : null}
        </div>
      </div>
      <ConfirmDialog open={!!pending} title={dialog?.title ?? ""} description={dialog?.body} confirmLabel={dialog?.confirm} tone={pending?.kind === "remove" ? "danger" : "primary"} busy={busy} onConfirm={() => void run()} onCancel={() => setPending(null)} />
    </div>
  );
}
