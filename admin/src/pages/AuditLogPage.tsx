import { useEffect, useState } from "react";
import { trpc } from "../lib/trpc";

type AuditRow = { id: string; adminEmail: string; action: string; targetType: string; targetId: string; details: string | null; createdAt: Date };

export default function AuditLogPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    trpc.adminConsole.auditLog.list.query({})
      .then((data) => setRows(data as AuditRow[]))
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Accès réservé aux super-administrateurs."));
  }, []);

  return (
    <div>
      <h1 className="page-title">Journal d’audit</h1>
      <p className="page-subtitle">Historique immuable de toutes les actions d’administration (200 dernières entrées).</p>
      {error ? <div className="error-banner">{error}</div> : null}
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Date</th><th>Administrateur</th><th>Action</th><th>Cible</th><th>Détails</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{new Date(row.createdAt).toLocaleString("fr-FR")}</td>
                <td>{row.adminEmail}</td>
                <td>{row.action}</td>
                <td>{row.targetType} · {row.targetId}</td>
                <td style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.details ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
