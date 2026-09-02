import { useEffect, useState } from "react";
import { trpc } from "../lib/trpc";

type AdminRow = { id: number; email: string; fullName: string; role: string; active: boolean; lastLoginAt: Date | null; createdAt: Date };

export default function AdminsPage() {
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [error, setError] = useState("");

  function load() {
    trpc.adminConsole.core.admins.list.query()
      .then((data: AdminRow[]) => setRows(data as AdminRow[]))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Accès réservé aux super-administrateurs."));
  }
  useEffect(load, []);

  async function toggle(adminId: number, active: boolean) {
    try {
      await trpc.adminConsole.core.admins.setActive.mutate({ adminId, active: !active });
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Action impossible.");
    }
  }

  return (
    <div>
      <h1 className="page-title">Équipe d’administration</h1>
      <p className="page-subtitle">Comptes ayant accès à cette console. La création d’un nouveau compte se fait via script serveur (voir README).</p>
      {error ? <div className="error-banner">{error}</div> : null}
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Nom</th><th>E-mail</th><th>Rôle</th><th>Statut</th><th>Dernière connexion</th><th></th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.fullName}</td>
                <td>{row.email}</td>
                <td><span className={`tag-role-${row.role}`}>{row.role}</span></td>
                <td><span className={`badge ${row.active ? "badge-resolved" : "badge-dismissed"}`}>{row.active ? "Actif" : "Suspendu"}</span></td>
                <td>{row.lastLoginAt ? new Date(row.lastLoginAt).toLocaleString("fr-FR") : "Jamais"}</td>
                <td><button className="btn btn-secondary" onClick={() => void toggle(row.id, row.active)}>{row.active ? "Suspendre" : "Réactiver"}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
