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

export default function AuditLogPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    trpc.adminConsole.auditLog.list.query({})
      .then((data) => setRows((data as AuditRow[]) ?? []))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Accès réservé aux super-administrateurs."));
  }, []);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Journal d'audit</h1>
          <p className="page-sub">Historique immuable de toutes les actions d'administration (200 dernières entrées)</p>
        </div>
      </div>

      {error ? <div className="banner-error">{error}</div> : null}

      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Toutes les actions</div>
            <div className="card-sub">{rows.length} entrée(s)</div>
          </div>
        </div>
        {rows.length === 0 ? (
          <div className="empty-state">Aucune action enregistrée pour le moment.</div>
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
