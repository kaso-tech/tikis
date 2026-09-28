import { useEffect, useState } from "react";
import { trpc } from "../lib/trpc";
import { downloadCsv, rowsToCsv } from "../lib/csv";

type AuditRow = { id: string; adminEmail: string; action: string; targetType: string; targetId: string; details: string | null; createdAt: Date; ipAddress?: string | null };

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
  // Filtres appliqués (et brouillon en cours de saisie) : admin, action (préfixe), période en jours calendaires.
  const [filterDraft, setFilterDraft] = useState({ adminEmail: "", action: "", from: "", to: "" });
  const [filters, setFilters] = useState(filterDraft);
  const [exporting, setExporting] = useState(false);

  function queryFilters() {
    return {
      includeRequests,
      adminEmail: filters.adminEmail.trim() || undefined,
      action: filters.action.trim() || undefined,
      from: filters.from ? new Date(`${filters.from}T00:00:00`).toISOString() : undefined,
      // Jour de fin inclus : la borne est le lendemain à minuit.
      to: filters.to ? new Date(new Date(`${filters.to}T00:00:00`).getTime() + 86_400_000).toISOString() : undefined,
    };
  }

  async function exportLog() {
    setExporting(true); setError("");
    try {
      const result = await trpc.adminConsole.auditLog.export.query(queryFilters());
      const csv = rowsToCsv([
        { key: "createdAt", label: "Date (UTC)" }, { key: "adminEmail", label: "Administrateur" }, { key: "action", label: "Action" },
        { key: "targetType", label: "Type de cible" }, { key: "targetId", label: "Cible" }, { key: "details", label: "Détails" }, { key: "ipAddress", label: "Adresse IP" },
      ], result.rows.map((row) => ({ ...row, createdAt: new Date(row.createdAt).toISOString() })));
      downloadCsv(`tikis-journal-audit-${new Date().toISOString().slice(0, 10)}.csv`, csv);
      if (result.truncated) setError(`Export limité aux ${result.rows.length} entrées les plus récentes sur ${result.total} : resserrez les filtres pour le reste.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Export impossible.");
    } finally {
      setExporting(false);
    }
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await trpc.adminConsole.auditLog.list.query({ ...queryFilters(), limit: PAGE_SIZE, offset: page * PAGE_SIZE }) as { rows: AuditRow[]; total: number };
      setRows(response.rows);
      setTotal(response.total);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Accès réservé aux super-administrateurs.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [page, includeRequests, filters]);

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

      <form className="card" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", padding: 14, marginBottom: 16 }} onSubmit={(event) => { event.preventDefault(); setPage(0); setFilters(filterDraft); }}>
        <div style={{ flex: "1 1 200px" }}>
          <label className="field-label" htmlFor="audit-admin">Administrateur (email)</label>
          <input id="audit-admin" className="input" value={filterDraft.adminEmail} onChange={(e) => setFilterDraft((f) => ({ ...f, adminEmail: e.target.value }))} placeholder="prenom@tikis.app" />
        </div>
        <div style={{ flex: "1 1 160px" }}>
          <label className="field-label" htmlFor="audit-action">Action (début du nom)</label>
          <input id="audit-action" className="input" value={filterDraft.action} onChange={(e) => setFilterDraft((f) => ({ ...f, action: e.target.value }))} placeholder="wallet, kyc, login…" />
        </div>
        <div>
          <label className="field-label" htmlFor="audit-from">Du</label>
          <input id="audit-from" className="input" type="date" value={filterDraft.from} onChange={(e) => setFilterDraft((f) => ({ ...f, from: e.target.value }))} />
        </div>
        <div>
          <label className="field-label" htmlFor="audit-to">Au</label>
          <input id="audit-to" className="input" type="date" value={filterDraft.to} onChange={(e) => setFilterDraft((f) => ({ ...f, to: e.target.value }))} />
        </div>
        <button className="btn btn-primary" type="submit">Filtrer</button>
        <button className="btn" type="button" onClick={() => { const empty = { adminEmail: "", action: "", from: "", to: "" }; setFilterDraft(empty); setPage(0); setFilters(empty); }}>Effacer</button>
        <button className="btn" type="button" disabled={exporting} onClick={() => void exportLog()}>{exporting ? "Export…" : "Exporter (CSV)"}</button>
      </form>

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
