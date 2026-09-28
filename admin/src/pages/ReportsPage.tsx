import { useEffect, useState } from "react";
import { useAdminAuth } from "../lib/auth";
import { trpc } from "../lib/trpc";
import { downloadCsv, rowsToCsv } from "../lib/csv";

type ReportRow = {
  report: {
    id: string; deliveryId: string; reporterPhone: string; reporterRole: "sender" | "driver";
    reason: string; description: string; status: "open" | "reviewing" | "resolved" | "dismissed";
    resolutionNotes: string | null; attachmentKey: string | null; createdAt: Date;
  };
  delivery: { id: string; title: string; status: string; senderPhone: string; driverPhone: string | null };
};

const STATUS_LABEL: Record<string, string> = { open: "Ouvert", reviewing: "En cours", resolved: "Résolu", dismissed: "Classé" };
const STATUS_PILL: Record<string, string> = { open: "pill-error", reviewing: "pill-warning", resolved: "pill-success", dismissed: "pill-neutral" };

export default function ReportsPage() {
  const { admin } = useAdminAuth();
  // Même règle que le serveur (reports.resolve) : trancher un signalement relève du support.
  const canResolve = admin?.role === "super_admin" || admin?.role === "support";
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "reviewing" | "resolved" | "dismissed">("open");
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [selected, setSelected] = useState<ReportRow | null>(null);
  const [notes, setNotes] = useState("");
  const [reply, setReply] = useState("");
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
      await trpc.adminConsole.reports.resolve.mutate({ reportId: selected.report.id, status, resolutionNotes: notes.trim() || undefined, replyToReporter: reply.trim() || undefined });
      setSelected(null);
      setNotes("");
      setReply("");
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Action impossible.");
    } finally {
      setBusy(false);
    }
  }

  // ———— Vue détail : page dédiée, remplace la liste ————
  if (selected) {
    const isClosed = selected.report.status === "resolved" || selected.report.status === "dismissed";
    return (
      <div>
        <div className="page-head">
          <div>
            <button className="btn btn-secondary btn-sm" onClick={() => { setSelected(null); setNotes(""); setReply(""); }} style={{ marginBottom: 10 }}>← Retour à la liste</button>
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
              {selected.report.attachmentKey ? (
                canResolve ? (
                  // Servie par la route admin authentifiée, jamais par le proxy public (server/admin-documents.ts).
                  <a href={`/api/admin/documents/report/${encodeURIComponent(selected.report.id)}`} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 10 }}>
                    <img src={`/api/admin/documents/report/${encodeURIComponent(selected.report.id)}`} alt="Pièce jointe du signalement" style={{ maxWidth: 320, maxHeight: 240, borderRadius: 8, border: "1px solid var(--border)" }} />
                  </a>
                ) : <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>Une photo est jointe (visible par le support).</p>
              ) : null}
            </div>
            <div>
              <label className="field-label" htmlFor="notes">Notes internes</label>
              <textarea id="notes" className="textarea" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Décision prise, actions menées (visible par l’équipe seulement)" />
            </div>
            {canResolve && !isClosed ? (
              <div>
                <label className="field-label" htmlFor="reply">Message à l’auteur (facultatif)</label>
                <textarea id="reply" className="textarea" rows={2} maxLength={500} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Joint à la notification envoyée quand vous résolvez ou classez le signalement" />
              </div>
            ) : null}
            {!canResolve ? <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>Lecture seule : le traitement des signalements est réservé au support.</p>
              : isClosed ? (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <span className="muted" style={{ fontSize: 12.5 }}>Signalement clos. Pour rendre une autre décision, rouvrez-le d’abord.</span>
                  <button className="btn btn-secondary" disabled={busy} onClick={() => void resolve("reviewing")}>Rouvrir</button>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="btn btn-secondary" disabled={busy} onClick={() => void resolve("reviewing")}>Marquer « en cours »</button>
                  <button className="btn btn-primary" disabled={busy} onClick={() => void resolve("resolved")}>Résoudre et prévenir l’auteur</button>
                  <button className="btn btn-danger" disabled={busy} onClick={() => void resolve("dismissed")}>Classer et prévenir l’auteur</button>
                </div>
              )}
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
            downloadCsv(`tikisse-reports-${statusFilter}-${new Date().toISOString().slice(0, 10)}`, csv);
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
