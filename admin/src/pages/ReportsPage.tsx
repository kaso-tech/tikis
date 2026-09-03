import { useEffect, useState } from "react";
import { trpc } from "../lib/trpc";
import { downloadCsv, rowsToCsv } from "../lib/csv";

type ReportRow = {
  report: {
    id: string; deliveryId: string; reporterPhone: string; reporterRole: "sender" | "driver";
    reason: string; description: string; status: "open" | "reviewing" | "resolved" | "dismissed";
    resolutionNotes: string | null; createdAt: Date;
  };
  delivery: { id: string; title: string; status: string; senderPhone: string; driverPhone: string | null };
};

const STATUS_LABEL: Record<string, string> = { open: "Ouvert", reviewing: "En cours", resolved: "Résolu", dismissed: "Classé" };
const STATUS_PILL: Record<string, string> = { open: "pill-error", reviewing: "pill-warning", resolved: "pill-success", dismissed: "pill-neutral" };

export default function ReportsPage() {
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "reviewing" | "resolved" | "dismissed">("open");
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [selected, setSelected] = useState<ReportRow | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function load() {
    setError("");
    trpc.adminConsole.reports.list.query(statusFilter === "all" ? {} : { status: statusFilter })
      .then((data) => setRows((data as ReportRow[]) ?? []))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Impossible de charger les signalements."));
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

  // ———— Vue détail : page dédiée, remplace la liste ————
  if (selected) {
    return (
      <div>
        <div className="page-head">
          <div>
            <button className="btn btn-secondary btn-sm" onClick={() => { setSelected(null); setNotes(""); }} style={{ marginBottom: 10 }}>← Retour à la liste</button>
            <h1 className="page-title">{selected.delivery.title}</h1>
            <p className="page-sub" style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>Livraison {selected.report.deliveryId}</p>
          </div>
        </div>
        {error ? <div className="banner-error">{error}</div> : null}
        <div className="card">
          <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <span className="field-label">Signalé par</span>
              <p style={{ fontSize: 13, margin: 0 }}>{selected.report.reporterPhone} ({selected.report.reporterRole === "sender" ? "Expéditeur" : "Livreur"}) — motif : {selected.report.reason}</p>
            </div>
            <div>
              <span className="field-label">Description</span>
              <p style={{ fontSize: 13, lineHeight: 1.5, margin: 0 }}>{selected.report.description}</p>
            </div>
            <div>
              <label className="field-label" htmlFor="notes">Notes de résolution</label>
              <textarea id="notes" className="textarea" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Décision prise, actions menées, communication à l'utilisateur…" />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn btn-secondary" disabled={busy} onClick={() => void resolve("reviewing")}>Marquer « en cours »</button>
              <button className="btn btn-primary" disabled={busy} onClick={() => void resolve("resolved")}>Résoudre</button>
              <button className="btn btn-danger" disabled={busy} onClick={() => void resolve("dismissed")}>Classer sans suite</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Signalements</h1>
          <p className="page-sub">Cas envoyés par les expéditeurs et livreurs · décisions tracées dans le journal d'audit</p>
        </div>
        <button
          className="btn btn-outline btn-sm"
          disabled={rows.length === 0}
          onClick={() => {
            const csv = rowsToCsv(rows.map((row) => ({
              id: row.report.id,
              deliveryId: row.report.deliveryId,
              deliveryTitle: row.delivery.title,
              reporterPhone: row.report.reporterPhone,
              reporterRole: row.report.reporterRole === "sender" ? "Expéditeur" : "Livreur",
              reason: row.report.reason,
              status: STATUS_LABEL[row.report.status] ?? row.report.status,
              createdAt: new Date(row.report.createdAt).toISOString(),
              resolutionNotes: row.report.resolutionNotes ?? "",
            })));
            downloadCsv(`tikis-reports-${statusFilter}-${new Date().toISOString().slice(0, 10)}`, csv);
          }}
        >
          Exporter CSV
        </button>
      </div>

      {error ? <div className="banner-error">{error}</div> : null}

      <div className="card">
        <div className="card-head">
          <div className="tabs">
            {(["open", "reviewing", "resolved", "dismissed"] as const).map((status) => (
              <button key={status} className={`tab ${statusFilter === status ? "active" : ""}`} onClick={() => setStatusFilter(status)}>
                {STATUS_LABEL[status]}
              </button>
            ))}
          </div>
        </div>
        {rows.length === 0 ? (
          <div className="empty-state">Aucun signalement dans cette catégorie.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Livraison</th>
                <th>Signalé par</th>
                <th>Motif</th>
                <th>Statut</th>
                <th style={{ textAlign: "right" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.report.id} className="clickable" onClick={() => { setSelected(row); setNotes(row.report.resolutionNotes ?? ""); }}>
                  <td style={{ fontVariantNumeric: "tabular-nums", color: "var(--muted)", fontSize: 11.5 }}>
                    {new Date(row.report.createdAt).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td>
                    <div className="user-name">{row.delivery.title}</div>
                    <div className="user-meta" style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{row.report.deliveryId.slice(0, 12)}</div>
                  </td>
                  <td>
                    <div>{row.report.reporterPhone}</div>
                    <div className="user-meta">{row.report.reporterRole === "sender" ? "Expéditeur" : "Livreur"}</div>
                  </td>
                  <td>
                    <div className="user-name">{row.report.reason}</div>
                    <div className="user-meta">{row.report.description.slice(0, 80)}{row.report.description.length > 80 ? "…" : ""}</div>
                  </td>
                  <td>
                    <span className={`pill ${STATUS_PILL[row.report.status]}`}>
                      <span className="dot" />{STATUS_LABEL[row.report.status]}
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button className="btn btn-sm">Examiner</button>
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
