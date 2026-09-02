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

const STATUS_PILL: Record<string, string> = {
  open: "pill-primary", pending_confirmation: "pill-info", active: "pill-success",
  completed: "pill-success", cancelled: "pill-neutral", expired: "pill-error", disabled: "pill-warning",
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
  const [searched, setSearched] = useState(false);

  async function search() {
    setError("");
    setLoading(true);
    setSearched(true);
    try {
      const rows = await trpc.adminConsole.core.disputes.searchDeliveries.query({ query: query.trim() || undefined });
      setResults((rows as Delivery[]) ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Recherche impossible.");
    } finally {
      setLoading(false);
    }
  }

  async function openTimeline(deliveryId: string) {
    setError("");
    try {
      const data = await trpc.adminConsole.core.disputes.timeline.query({ deliveryId });
      setTimeline(data as Timeline);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Chronologie indisponible.");
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Litiges</h1>
          <p className="page-sub">Recherchez une livraison pour consulter sa chronologie complète (candidatures, finance, notifications, signalements)</p>
        </div>
      </div>

      {error ? <div className="banner-error">{error}</div> : null}

      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Recherche de livraison</div>
            <div className="card-sub">ID, titre, téléphone expéditeur ou livreur</div>
          </div>
        </div>
        <div className="filters-row">
          <input className="input" placeholder="Ex. DLV-1234, +237 6XX…" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void search()} style={{ minWidth: 320 }} />
          <button className="btn btn-primary" onClick={() => void search()} disabled={loading}>{loading ? "Recherche…" : "Rechercher"}</button>
        </div>

        {searched && results.length === 0 && !loading ? <div className="empty-state">Aucune livraison ne correspond.</div> : null}

        {results.length > 0 ? (
          <table className="table">
            <thead><tr><th>Titre</th><th>Statut</th><th>Expéditeur</th><th>Livreur</th><th>Prix</th></tr></thead>
            <tbody>
              {results.map((delivery) => (
                <tr key={delivery.id} className="clickable" onClick={() => void openTimeline(delivery.id)}>
                  <td>
                    <div className="user-name">{delivery.title}</div>
                    <div className="user-meta" style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{delivery.id.slice(0, 16)}</div>
                  </td>
                  <td><span className={`pill ${STATUS_PILL[delivery.status] ?? "pill-neutral"}`}><span className="dot" />{delivery.status}</span></td>
                  <td style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11.5 }}>{delivery.senderPhone}</td>
                  <td style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11.5 }}>{delivery.driverPhone ?? <span className="muted">—</span>}</td>
                  <td className="price">{formatMoney(delivery.offeredPrice ?? delivery.estimatedPrice)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>

      {timeline ? (
        <>
          <div className="card">
            <div className="card-head">
              <div>
                <div className="card-title">{timeline.delivery.title}</div>
                <div className="card-sub">
                  <span className={`pill ${STATUS_PILL[timeline.delivery.status] ?? "pill-neutral"}`}><span className="dot" />{timeline.delivery.status}</span>
                  {" · "}Prix {formatMoney(timeline.delivery.offeredPrice ?? timeline.delivery.estimatedPrice)}
                  {" · "}Expéditeur {timeline.delivery.senderPhone}
                  {" · "}Livreur {timeline.delivery.driverPhone ?? "—"}
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setTimeline(null)}>Fermer</button>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <div>
                <div className="card-title">Candidatures</div>
                <div className="card-sub">{timeline.candidates.length} candidature(s) reçue(s)</div>
              </div>
            </div>
            <div className="card-body tight">
              {timeline.candidates.length === 0 ? <div className="empty-state">Aucune candidature.</div> : (
                <table className="table">
                  <thead><tr><th>Livreur</th><th>Statut</th><th>Commission</th><th>Offre</th><th>Mis à jour</th></tr></thead>
                  <tbody>
                    {timeline.candidates.map((c) => (
                      <tr key={c.id}>
                        <td style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11.5 }}>{c.driverPhone}</td>
                        <td><span className="pill pill-neutral" style={{ background: "var(--surface-2)", color: "var(--muted-strong)" }}>{c.status}</span></td>
                        <td className="price">{formatMoney(c.commissionBlocked)}</td>
                        <td>{c.offerPrice ? formatMoney(c.offerPrice) : <span className="muted">—</span>}</td>
                        <td style={{ fontVariantNumeric: "tabular-nums", color: "var(--muted)", fontSize: 11.5 }}>{new Date(c.updatedAt).toLocaleString("fr-FR")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <div>
                <div className="card-title">Mouvements financiers</div>
                <div className="card-sub">{timeline.ledgerEntries.length} écriture(s)</div>
              </div>
            </div>
            <div className="card-body tight">
              {timeline.ledgerEntries.length === 0 ? <div className="empty-state">Aucun mouvement.</div> : (
                <table className="table">
                  <thead><tr><th>Date</th><th>Profil</th><th>Opération</th><th>Montant</th><th>Motif</th></tr></thead>
                  <tbody>
                    {timeline.ledgerEntries.map((entry) => (
                      <tr key={entry.id}>
                        <td style={{ fontVariantNumeric: "tabular-nums", color: "var(--muted)", fontSize: 11.5 }}>{new Date(entry.createdAt).toLocaleString("fr-FR")}</td>
                        <td style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11.5 }}>{entry.profilePhone}</td>
                        <td><span className="pill pill-neutral" style={{ background: "var(--surface-2)", color: "var(--muted-strong)" }}>{entry.operation}</span></td>
                        <td className="price">{formatMoney(entry.amount)}</td>
                        <td>{entry.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <div>
                <div className="card-title">Notifications & événements</div>
                <div className="card-sub">{timeline.events.length} événement(s)</div>
              </div>
            </div>
            <div className="card-body">
              {timeline.events.length === 0 ? <div className="empty-state">Aucun événement.</div> : (
                timeline.events.map((event) => (
                  <div className="timeline-item" key={event.id}>
                    <div className="timeline-time">{new Date(event.createdAt).toLocaleString("fr-FR")}</div>
                    <div className="timeline-body">
                      <div><strong>{event.title}</strong> → <span className="muted" style={{ fontSize: 11.5 }}>{event.recipientPhone}</span></div>
                      <div className="timeline-meta">{event.body}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {timeline.reports.length > 0 ? (
            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-title">Signalements liés</div>
                  <div className="card-sub">{timeline.reports.length} rapport(s)</div>
                </div>
              </div>
              <div className="card-body">
                {timeline.reports.map((report) => (
                  <div className="timeline-item" key={report.id}>
                    <div className="timeline-time">{new Date(report.createdAt).toLocaleString("fr-FR")}</div>
                    <div className="timeline-body">
                      <span className={`pill ${report.status === "open" ? "pill-error" : "pill-success"}`}><span className="dot" />{report.status}</span> {report.reason}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
