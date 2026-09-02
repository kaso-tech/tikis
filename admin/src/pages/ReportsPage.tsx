import { useEffect, useState } from "react";
import { trpc } from "../lib/trpc";

type ReportRow = {
  report: {
    id: string; deliveryId: string; reporterPhone: string; reporterRole: "sender" | "driver";
    reason: string; description: string; status: "open" | "reviewing" | "resolved" | "dismissed";
    resolutionNotes: string | null; createdAt: Date;
  };
  delivery: { id: string; title: string; status: string; senderPhone: string; driverPhone: string | null };
};

const STATUS_LABEL: Record<string, string> = { open: "Ouvert", reviewing: "En cours", resolved: "Résolu", dismissed: "Classé sans suite" };

export default function ReportsPage() {
  const [statusFilter, setStatusFilter] = useState<"open" | "reviewing" | "resolved" | "dismissed" | undefined>("open");
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [selected, setSelected] = useState<ReportRow | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function load() {
    trpc.adminConsole.reports.list.query({ status: statusFilter })
      .then((data) => setRows(data as ReportRow[]))
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Impossible de charger les signalements."));
  }

  useEffect(load, [statusFilter]);

  async function resolve(status: "reviewing" | "resolved" | "dismissed") {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      await trpc.adminConsole.reports.resolve.mutate({ reportId: selected.report.id, status, resolutionNotes: notes.trim() || undefined });
      setSelected(null);
      setNotes("");
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Action impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="page-title">Signalements</h1>
      <p className="page-subtitle">Signalements envoyés par les Senders et Livreurs (CAS N°9).</p>
      {error ? <div className="error-banner">{error}</div> : null}
      <div style={{ marginBottom: 16, display: "flex", gap: 8 }}>
        {(["open", "reviewing", "resolved", "dismissed"] as const).map((status) => (
          <button key={status} className={statusFilter === status ? "btn btn-primary" : "btn btn-secondary"} onClick={() => setStatusFilter(status)}>{STATUS_LABEL[status]}</button>
        ))}
      </div>
      <div className="card" style={{ padding: 0 }}>
        {rows.length === 0 ? <div className="empty-state">Aucun signalement dans cette catégorie.</div> : (
          <table>
            <thead><tr><th>Date</th><th>Livraison</th><th>Signalé par</th><th>Motif</th><th>Statut</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.report.id} className="clickable" onClick={() => { setSelected(row); setNotes(row.report.resolutionNotes ?? ""); }}>
                  <td>{new Date(row.report.createdAt).toLocaleString("fr-FR")}</td>
                  <td>{row.delivery.title}</td>
                  <td>{row.report.reporterPhone} ({row.report.reporterRole === "sender" ? "Expéditeur" : "Livreur"})</td>
                  <td>{row.report.reason}</td>
                  <td><span className={`badge badge-${row.report.status}`}>{STATUS_LABEL[row.report.status]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selected ? (
        <div className="card" style={{ marginTop: 8 }}>
          <p className="card-title">Signalement — {selected.delivery.title}</p>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 4 }}>Livraison : <code>{selected.report.deliveryId}</code></p>
          <p style={{ fontSize: 13, marginBottom: 12 }}>{selected.report.description}</p>
          <label className="field-label" htmlFor="notes">Notes de résolution</label>
          <textarea id="notes" className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} style={{ marginBottom: 12 }} />
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-secondary" disabled={busy} onClick={() => void resolve("reviewing")}>Marquer « en cours »</button>
            <button className="btn btn-primary" disabled={busy} onClick={() => void resolve("resolved")}>Résoudre</button>
            <button className="btn btn-danger" disabled={busy} onClick={() => void resolve("dismissed")}>Classer sans suite</button>
            <button className="btn btn-secondary" disabled={busy} onClick={() => setSelected(null)}>Fermer</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
