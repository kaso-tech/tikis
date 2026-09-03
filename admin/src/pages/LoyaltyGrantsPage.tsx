import { useEffect, useState } from "react";
import { trpc } from "../lib/trpc";
import { useAdminAuth } from "../lib/auth";

type Grant = { id: string; programId: string; profilePhone: string; deliveryId: string | null; bonusAmount: number; status: "pending" | "credited" | "cancelled"; grantedAt: Date | string; creditedAt: Date | string | null };

function formatMoney(amount: number) {
  return `${new Intl.NumberFormat("fr-FR").format(amount)} FCFA`;
}

function formatDate(iso: Date | string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function LoyaltyGrantsPage() {
  const { admin } = useAdminAuth();
  const canCredit = admin?.role === "super_admin" || admin?.role === "finance";
  const [grants, setGrants] = useState<Grant[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    setError("");
    trpc.adminConsole.loyalty.listPendingGrants.query({ limit: 100 })
      .then((data) => setGrants(data as Grant[]))
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Chargement impossible."));
  }
  useEffect(load, []);

  async function credit(grant: Grant) {
    setError(""); setSuccess("");
    setBusyId(grant.id);
    try {
      const result = await trpc.adminConsole.loyalty.creditGrant.mutate({ grantId: grant.id });
      const formatted = result.bonusAmount ? formatMoney(result.bonusAmount) : "";
      setSuccess(`Bonus de ${formatted} crédité au wallet de ${result.profilePhone}.`);
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Crédit impossible.");
    } finally {
      setBusyId(null);
    }
  }

  async function cancel(grant: Grant) {
    setError(""); setSuccess("");
    const reason = window.prompt("Motif de l'annulation (sera tracé dans l'audit) :", "");
    if (!reason || !reason.trim()) return;
    setBusyId(grant.id);
    try {
      await trpc.adminConsole.loyalty.cancelGrant.mutate({ grantId: grant.id, reason: reason.trim() });
      setSuccess(`Octroi ${grant.id.slice(0, 8)}… annulé.`);
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Annulation impossible.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Octrois de fidélité en attente</h1>
          <p className="page-sub">Bonus de fidélité déclenchés automatiquement. Validez pour créditer le wallet du bénéficiaire.</p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn" onClick={() => {
            const event = new CustomEvent("tikis:navigate", { detail: { page: "loyalty" } });
            window.dispatchEvent(event);
          }}>← Programmes</button>
        </div>
      </div>

      {error ? <div className="banner-error">{error}</div> : null}
      {success ? <div className="banner-ok">{success}</div> : null}

      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Octrois en attente</div>
            <div className="card-sub">{grants.length} octroi(s) à traiter</div>
          </div>
        </div>
        {grants.length === 0 ? (
          <div className="empty-state" style={{ padding: 16 }}>Aucun octroi en attente. Les bonus se déclenchent automatiquement quand un profil atteint le seuil d’un programme actif.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Octroi</th>
                <th>Programme</th>
                <th>Bénéficiaire</th>
                <th>Course</th>
                <th>Bonus</th>
                <th>Déclenché le</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {grants.map((grant) => (
                <tr key={grant.id}>
                  <td style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11.5 }}>{grant.id.slice(0, 12)}…</td>
                  <td style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11.5 }}>{grant.programId}</td>
                  <td style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11.5 }}>{grant.profilePhone}</td>
                  <td style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11.5, color: "var(--muted)" }}>{grant.deliveryId ? `${grant.deliveryId.slice(0, 8)}…` : "—"}</td>
                  <td style={{ fontWeight: 600, color: "var(--primary)" }}>{formatMoney(grant.bonusAmount)}</td>
                  <td style={{ fontSize: 11.5 }}>{formatDate(grant.grantedAt)}</td>
                  <td style={{ textAlign: "right" }}>
                    {canCredit ? (
                      <>
                        <button type="button" className="btn btn-sm btn-primary" disabled={busyId === grant.id} onClick={() => void credit(grant)} style={{ marginRight: 6 }}>{busyId === grant.id ? "…" : "Créditer"}</button>
                        <button type="button" className="btn btn-sm" disabled={busyId === grant.id} onClick={() => void cancel(grant)}>Annuler</button>
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
