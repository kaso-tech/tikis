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

function compact(value: unknown) {
  return value === null || value === undefined ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value);
}

/** Les modifications de réglages portent leur valeur avant et après : on les montre côte à côte, en entier. */
function AuditDetails({ details }: { details: string | null }) {
  if (!details) return <span className="muted">—</span>;
  let parsed: unknown;
  try {
    parsed = JSON.parse(details);
  } catch {
    return <span style={{ wordBreak: "break-word" }}>{details}</span>;
  }
  if (parsed && typeof parsed === "object" && "before" in parsed && "after" in parsed) {
    const { before, after, ...rest } = parsed as Record<string, unknown>;
    return (
      <div style={{ display: "grid", gap: 2, wordBreak: "break-word" }}>
        <div><strong>Avant :</strong> {compact(before)}</div>
        <div><strong>Après :</strong> {compact(after)}</div>
        {Object.keys(rest).length > 0 ? <div>{compact(rest)}</div> : null}
      </div>
    );
  }
  return <span style={{ wordBreak: "break-word" }}>{compact(parsed)}</span>;
}

export default function AuditLogPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  // Chaque modification est tracée deux fois : la demande, avant exécution, puis le détail de l'action.
  // Les demandes ne s'affichent qu'à la demande.
  const [includeRequests, setIncludeRequests] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await trpc.adminConsole.auditLog.list.query({ includeRequests, limit: PAGE_SIZE, offset: page * PAGE_SIZE }) as { rows: AuditRow[]; total: number };
      setRows(response.rows);
      setTotal(response.total);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Accès réservé aux super-administrateurs.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [page, includeRequests]);

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
            <label htmlFor="include-requests" style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12, marginRight: 8 }}>
              <input id="include-requests" type="checkbox" checked={includeRequests} onChange={(e) => { setPage(0); setIncludeRequests(e.target.checked); }} />
              Afficher les demandes brutes
            </label>
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
                  <td style={{ maxWidth: 420, fontSize: 12, color: "var(--muted)" }}>
                    <AuditDetails details={row.details} />
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
