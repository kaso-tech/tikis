import { useEffect, useState } from "react";
import { trpc } from "../lib/trpc";

type Delivery = { id: string; title: string; status: string; senderPhone: string; driverPhone: string | null; estimatedPrice: number; offeredPrice: number | null; createdAt: Date | string };

const STATUS_LABEL: Record<string, string> = {
  draft: "Brouillon", open: "Ouverte", pending_confirmation: "En attente", active: "En cours",
  completed: "Terminée", disabled: "Désactivée", cancelled: "Annulée", expired: "Expirée",
};
const STATUS_PILL: Record<string, string> = {
  open: "pill-primary", pending_confirmation: "pill-info", active: "pill-success",
  completed: "pill-success", cancelled: "pill-neutral", expired: "pill-error", disabled: "pill-warning", draft: "pill-neutral",
};

function formatMoney(amount: number) {
  return `${new Intl.NumberFormat("fr-FR").format(amount)} FCFA`;
}

export default function DeliveriesPage() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<Delivery[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Delivery | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setError("");
    setLoading(true);
    try {
      const data = await trpc.adminConsole.deliveriesOps.list.query({ query: query.trim() || undefined, status: status || undefined });
      setRows(data as Delivery[]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [status]);

  async function forceCancel() {
    if (!selected) return;
    if (!cancelReason.trim()) { setError("Indiquez un motif pour l’annulation forcée."); return; }
    setBusy(true);
    setError("");
    try {
      await trpc.adminConsole.deliveriesOps.forceCancel.mutate({ deliveryId: selected.id, reason: cancelReason.trim() });
      setSelected(null);
      setCancelReason("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Annulation impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Livraisons</h1>
          <p className="page-sub">{rows.length} résultat(s) · gestion complète, hors litige (voir « Litiges » pour la chronologie détaillée)</p>
        </div>
      </div>

      {error ? <div className="banner-error">{error}</div> : null}

      <div className="card">
        <div className="filters-row">
          <input className="input" placeholder="ID, titre, téléphone…" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void load()} style={{ minWidth: 260 }} />
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} style={{ maxWidth: 200 }}>
            <option value="">Tous les statuts</option>
            {Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <button className="btn btn-primary" onClick={() => void load()} disabled={loading}>{loading ? "…" : "Rechercher"}</button>
        </div>

        {rows.length === 0 && !loading ? <div className="empty-state">Aucune livraison ne correspond.</div> : null}
        {rows.length > 0 ? (
          <table className="table">
            <thead><tr><th>Titre</th><th>Statut</th><th>Expéditeur</th><th>Livreur</th><th>Prix</th><th>Créée le</th><th></th></tr></thead>
            <tbody>
              {rows.map((delivery) => (
                <tr key={delivery.id}>
                  <td>{delivery.title}</td>
                  <td><span className={`pill ${STATUS_PILL[delivery.status] ?? "pill-neutral"}`}><span className="dot" />{STATUS_LABEL[delivery.status] ?? delivery.status}</span></td>
                  <td style={{ fontSize: 12 }}>{delivery.senderPhone}</td>
                  <td style={{ fontSize: 12 }}>{delivery.driverPhone ?? "—"}</td>
                  <td className="price">{formatMoney(delivery.offeredPrice ?? delivery.estimatedPrice)}</td>
                  <td style={{ fontSize: 11.5, color: "var(--muted)" }}>{new Date(delivery.createdAt).toLocaleString("fr-FR")}</td>
                  <td style={{ textAlign: "right" }}>
                    {["open", "pending_confirmation", "active", "disabled"].includes(delivery.status) ? (
                      <button className="btn btn-sm btn-danger" onClick={() => setSelected(delivery)}>Annuler</button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>

      {selected ? (
        <div className="card">
          <div className="card-head"><div><div className="card-title">Annulation forcée — {selected.title}</div><div className="card-sub">Libère toute commission bloquée/prélevée pour les candidats concernés. Action irréversible, tracée en audit.</div></div></div>
          <textarea className="input" rows={3} placeholder="Motif de l’annulation (obligatoire, visible par les parties)" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} style={{ marginBottom: 12 }} />
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-danger" disabled={busy} onClick={() => void forceCancel()}>{busy ? "…" : "Confirmer l’annulation"}</button>
            <button className="btn btn-ghost" disabled={busy} onClick={() => { setSelected(null); setCancelReason(""); }}>Annuler</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
