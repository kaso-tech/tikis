import { useState } from "react";
import { trpc } from "../lib/trpc";

type Delivery = { id: string; title: string; status: string; senderPhone: string; driverPhone: string | null; estimatedPrice: number; offeredPrice: number | null };
type Timeline = {
  delivery: Delivery;
  candidates: Array<{ id: string; driverPhone: string; status: string; commissionBlocked: number; offerPrice: number | null; createdAt: Date; updatedAt: Date }>;
  events: Array<{ id: string; eventType: string; title: string; body: string; recipientPhone: string; createdAt: Date }>;
  ledgerEntries: Array<{ id: string; profilePhone: string; operation: string; amount: number; availableBefore: number; availableAfter: number; heldBefore: number; heldAfter: number; reason: string; createdAt: Date }>;
  reports: Array<{ id: string; reason: string; status: string; createdAt: Date }>;
};

function formatMoney(amount: number) {
  return `${new Intl.NumberFormat("fr-FR").format(amount)} FCFA`;
}

export default function DisputesPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Delivery[]>([]);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function search() {
    setError("");
    setLoading(true);
    try {
      const rows = await trpc.adminConsole.disputes.searchDeliveries.query({ query: query.trim() || undefined });
      setResults(rows as Delivery[]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Recherche impossible.");
    } finally {
      setLoading(false);
    }
  }

  async function openTimeline(deliveryId: string) {
    setError("");
    try {
      const data = await trpc.adminConsole.disputes.timeline.query({ deliveryId });
      setTimeline(data as Timeline);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Chronologie indisponible.");
    }
  }

  return (
    <div>
      <h1 className="page-title">Litiges</h1>
      <p className="page-subtitle">Recherchez une livraison par identifiant, titre ou numéro de téléphone pour consulter sa chronologie complète (CAS N°10).</p>
      {error ? <div className="error-banner">{error}</div> : null}
      <div className="card">
        <div style={{ display: "flex", gap: 8 }}>
          <input className="input" placeholder="ID livraison, titre, téléphone…" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void search()} />
          <button className="btn btn-primary" onClick={() => void search()} disabled={loading}>{loading ? "Recherche…" : "Rechercher"}</button>
        </div>
      </div>

      {results.length > 0 ? (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead><tr><th>Titre</th><th>Statut</th><th>Expéditeur</th><th>Livreur</th></tr></thead>
            <tbody>
              {results.map((delivery) => (
                <tr key={delivery.id} className="clickable" onClick={() => void openTimeline(delivery.id)}>
                  <td>{delivery.title}</td>
                  <td><span className="badge badge-neutral">{delivery.status}</span></td>
                  <td>{delivery.senderPhone}</td>
                  <td>{delivery.driverPhone ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {timeline ? (
        <>
          <div className="card">
            <p className="card-title">{timeline.delivery.title} — {timeline.delivery.status}</p>
            <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
              Prix : {formatMoney(timeline.delivery.offeredPrice ?? timeline.delivery.estimatedPrice)} · Expéditeur {timeline.delivery.senderPhone} · Livreur {timeline.delivery.driverPhone ?? "—"}
            </p>
          </div>

          <div className="card">
            <p className="card-title">Candidatures ({timeline.candidates.length})</p>
            <table>
              <thead><tr><th>Livreur</th><th>Statut</th><th>Commission</th><th>Offre</th><th>Mis à jour</th></tr></thead>
              <tbody>
                {timeline.candidates.map((c) => (
                  <tr key={c.id}><td>{c.driverPhone}</td><td>{c.status}</td><td>{formatMoney(c.commissionBlocked)}</td><td>{c.offerPrice ? formatMoney(c.offerPrice) : "—"}</td><td>{new Date(c.updatedAt).toLocaleString("fr-FR")}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <p className="card-title">Mouvements financiers ({timeline.ledgerEntries.length})</p>
            <table>
              <thead><tr><th>Date</th><th>Profil</th><th>Opération</th><th>Montant</th><th>Motif</th></tr></thead>
              <tbody>
                {timeline.ledgerEntries.map((entry) => (
                  <tr key={entry.id}><td>{new Date(entry.createdAt).toLocaleString("fr-FR")}</td><td>{entry.profilePhone}</td><td>{entry.operation}</td><td>{formatMoney(entry.amount)}</td><td>{entry.reason}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <p className="card-title">Notifications / événements ({timeline.events.length})</p>
            {timeline.events.map((event) => (
              <div className="timeline-item" key={event.id}>
                <div className="timeline-time">{new Date(event.createdAt).toLocaleString("fr-FR")}</div>
                <div className="timeline-body">
                  <div className="timeline-title">{event.title} <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>→ {event.recipientPhone}</span></div>
                  <div className="timeline-desc">{event.body}</div>
                </div>
              </div>
            ))}
          </div>

          {timeline.reports.length > 0 ? (
            <div className="card">
              <p className="card-title">Signalements liés ({timeline.reports.length})</p>
              {timeline.reports.map((report) => (
                <div className="timeline-item" key={report.id}>
                  <div className="timeline-time">{new Date(report.createdAt).toLocaleString("fr-FR")}</div>
                  <div className="timeline-body"><span className={`badge badge-${report.status}`}>{report.status}</span> — {report.reason}</div>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
