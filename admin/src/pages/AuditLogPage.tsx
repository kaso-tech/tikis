import { useEffect, useState } from "react";
import { trpc } from "../lib/trpc";

type AuditRow = { id: string; adminEmail: string; action: string; targetType: string; targetId: string; details: string | null; createdAt: Date };

const ACTION_TONE: Record<string, string> = {
  login: "pill-info",
  report_resolved: "pill-success",
  commission_rate_updated: "pill-warning",
  profile: "pill-error",
};

function toneForAction(action: string): string {
  for (const key of Object.keys(ACTION_TONE)) {
    if (action.startsWith(key)) return ACTION_TONE[key];
  }
  return "pill-neutral";
}

const PAGE_SIZE = 50;

export default function AuditLogPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await trpc.adminConsole.auditLog.list.query({ limit: PAGE_SIZE, offset: page * PAGE_SIZE }) as { rows: AuditRow[]; total: number };
      setRows(response.rows);
      setTotal(response.total);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Accès réservé aux super-administrateurs.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [page]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasPrev = page > 0;
  const hasNext = page + 1 < totalPages;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Journal d'audit</h1>
          <p className="page-sub">Historique immuable de toutes les actions d'administration — page {page + 1} / {totalPages}</p>
        </div>
      </div>

      {error ? <div className="banner-error">{error}</div> : null}

      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Toutes les actions</div>
            <div className="card-sub">{total} entrée(s) au total</div>
          </div>
          <div className="pagination">
            <button type="button" className="btn btn-sm" disabled={!hasPrev || loading} onClick={() => setPage((p) => Math.max(0, p - 1))}>← Précédent</button>
            <span className="muted">{page + 1} / {totalPages}</span>
            <button type="button" className="btn btn-sm" disabled={!hasNext || loading} onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}>Suivant →</button>
          </div>
        </div>
        {rows.length === 0 ? (
          <div className="empty-state">{loading ? "Chargement…" : "Aucune action enregistrée pour le moment."}</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Administrateur</th>
                <th>Action</th>
                <th>Cible</th>
                <th>Détails</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td style={{ fontVariantNumeric: "tabular-nums", color: "var(--muted)", fontSize: 11.5 }}>
                    {new Date(row.createdAt).toLocaleString("fr-FR")}
                  </td>
                  <td style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11.5 }}>{row.adminEmail}</td>
                  <td>
                    <span className={`pill ${toneForAction(row.action)}`}>
                      <span className="dot" />{row.action}
                    </span>
                  </td>
                  <td>
                    <div className="user-name">{row.targetType}</div>
                    <div className="user-meta" style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{row.targetId}</div>
                  </td>
                  <td style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, color: "var(--muted)" }}>
                    {row.details ?? <span className="muted">—</span>}
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
