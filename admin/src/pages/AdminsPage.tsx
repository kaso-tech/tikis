import { useEffect, useState } from "react";
import { trpc } from "../lib/trpc";

type AdminRow = { id: number; email: string; fullName: string; role: string; active: boolean; lastLoginAt: Date | null; createdAt: Date };

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

export default function AdminsPage() {
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [error, setError] = useState("");

  function load() {
    setError("");
    trpc.adminConsole.admins.list.query()
      .then((data: AdminRow[]) => setRows((data as AdminRow[]) ?? []))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Accès réservé aux super-administrateurs."));
  }
  useEffect(load, []);

  async function toggle(adminId: number, active: boolean) {
    try {
      await trpc.adminConsole.admins.setActive.mutate({ adminId, active: !active });
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Action impossible.");
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Équipe d'administration</h1>
          <p className="page-sub">Comptes ayant accès à cette console · création via script serveur (voir README)</p>
        </div>
      </div>

      {error ? <div className="banner-error">{error}</div> : null}

      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Comptes administrateurs</div>
            <div className="card-sub">{rows.length} compte(s)</div>
          </div>
        </div>
        {rows.length === 0 ? (
          <div className="empty-state">Aucun administrateur trouvé.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Email</th>
                <th>Rôle</th>
                <th>Statut</th>
                <th>Dernière connexion</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div className="user-cell">
                      <div className="user-avatar d">{initials(row.fullName)}</div>
                      <div className="user-name">{row.fullName}</div>
                    </div>
                  </td>
                  <td style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11.5 }}>{row.email}</td>
                  <td>
                    <span className={`pill ${row.role === "super_admin" ? "pill-primary" : row.role === "finance" ? "pill-info" : "pill-neutral"}`}>
                      <span className="dot" />{row.role.replace("_", " ")}
                    </span>
                  </td>
                  <td>
                    {row.active ? <span className="pill pill-success"><span className="dot" />Actif</span> : <span className="pill pill-error"><span className="dot" />Suspendu</span>}
                  </td>
                  <td style={{ fontVariantNumeric: "tabular-nums", color: "var(--muted)", fontSize: 11.5 }}>
                    {row.lastLoginAt ? new Date(row.lastLoginAt).toLocaleString("fr-FR") : <span className="muted">Jamais</span>}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button className={`btn btn-sm ${row.active ? "btn-danger" : "btn-primary"}`} onClick={() => void toggle(row.id, row.active)}>
                      {row.active ? "Suspendre" : "Réactiver"}
                    </button>
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
