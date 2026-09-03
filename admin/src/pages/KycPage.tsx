import { useEffect, useState } from "react";
import { trpc } from "../lib/trpc";
import { useAdminAuth } from "../lib/auth";
import { downloadCsv, rowsToCsv } from "../lib/csv";

type Submission = {
  id: string; driverPhone: string; idFrontKey: string; idBackKey: string; selfieKey: string;
  status: "submitted" | "approved" | "rejected"; rejectionReason: string | null; submittedAt: Date | string;
};
type Row = { submission: Submission; driverName: string };

const STATUS_LABEL: Record<string, string> = { submitted: "À examiner", approved: "Approuvé", rejected: "Refusé" };
const STATUS_PILL: Record<string, string> = { submitted: "pill-warning", approved: "pill-success", rejected: "pill-error" };

function assetUrl(key: string) {
  return `/manus-storage/${key}`;
}

export default function KycPage() {
  const { admin } = useAdminAuth();
  const canReview = admin?.role === "super_admin" || admin?.role === "support";
  const [statusFilter, setStatusFilter] = useState<"submitted" | "approved" | "rejected">("submitted");
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Row | null>(null);
  const [error, setError] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);

  function load() {
    trpc.adminConsole.kyc.list.query({ status: statusFilter })
      .then((data) => setRows(data as Row[]))
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Chargement impossible."));
  }
  useEffect(load, [statusFilter]);

  async function decide(decision: "approved" | "rejected") {
    if (!selected) return;
    if (decision === "rejected" && !rejectReason.trim()) { setError("Indiquez un motif de refus."); return; }
    setBusy(true);
    setError("");
    try {
      await trpc.adminConsole.kyc.review.mutate({ submissionId: selected.submission.id, decision, rejectionReason: decision === "rejected" ? rejectReason.trim() : undefined });
      setSelected(null);
      setRejectReason("");
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Action impossible.");
    } finally {
      setBusy(false);
    }
  }

  if (selected) {
    return (
      <div>
        <div className="page-head">
          <div>
            <button className="btn btn-secondary btn-sm" onClick={() => { setSelected(null); setRejectReason(""); setError(""); }} style={{ marginBottom: 10 }}>← Retour à la liste</button>
            <h1 className="page-title">{selected.driverName}</h1>
            <p className="page-sub">{selected.submission.driverPhone} · Envoyé le {new Date(selected.submission.submittedAt).toLocaleString("fr-FR")}</p>
          </div>
        </div>
        {error ? <div className="banner-error">{error}</div> : null}
        <div className="card">
          <div className="grid grid-3">
            <div>
              <div className="field-label">Recto pièce d’identité</div>
              <img src={assetUrl(selected.submission.idFrontKey)} alt="Recto" style={{ width: "100%", borderRadius: 10, border: "1px solid var(--border)" }} />
            </div>
            <div>
              <div className="field-label">Verso pièce d’identité</div>
              <img src={assetUrl(selected.submission.idBackKey)} alt="Verso" style={{ width: "100%", borderRadius: 10, border: "1px solid var(--border)" }} />
            </div>
            <div>
              <div className="field-label">Selfie</div>
              <img src={assetUrl(selected.submission.selfieKey)} alt="Selfie" style={{ width: "100%", borderRadius: 10, border: "1px solid var(--border)" }} />
            </div>
          </div>
        </div>
        {canReview && selected.submission.status === "submitted" ? (
          <div className="card" style={{ maxWidth: 480 }}>
            <div className="card-title" style={{ marginBottom: 10 }}>Décision</div>
            <textarea className="input" rows={2} placeholder="Motif du refus (requis si refusé)" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} style={{ marginBottom: 12 }} />
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-primary" disabled={busy} onClick={() => void decide("approved")}>Approuver</button>
              <button className="btn btn-danger" disabled={busy} onClick={() => void decide("rejected")}>Refuser</button>
            </div>
          </div>
        ) : selected.submission.status !== "submitted" ? (
          <div className="card" style={{ maxWidth: 480 }}>
            <span className={`pill ${STATUS_PILL[selected.submission.status]}`}><span className="dot" />{STATUS_LABEL[selected.submission.status]}</span>
            {selected.submission.rejectionReason ? <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 10 }}>Motif : {selected.submission.rejectionReason}</p> : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Validations KYC</h1>
          <p className="page-sub">File d’attente des livreurs en cours de vérification d’identité</p>
        </div>
        <button
          className="btn btn-outline btn-sm"
          disabled={rows.length === 0}
          onClick={() => {
            const csv = rowsToCsv(rows.map((row) => ({
              driverName: row.driverName,
              phone: row.submission.driverPhone,
              submittedAt: new Date(row.submission.submittedAt).toISOString(),
              status: STATUS_LABEL[row.submission.status] ?? row.submission.status,
              rejectionReason: row.submission.rejectionReason ?? "",
            })));
            downloadCsv(`tikis-kyc-${statusFilter}-${new Date().toISOString().slice(0, 10)}`, csv);
          }}
        >
          Exporter CSV
        </button>
      </div>
      {error ? <div className="banner-error">{error}</div> : null}
      <div className="card" style={{ paddingBottom: 0 }}>
        <div className="tabs">
          {(["submitted", "approved", "rejected"] as const).map((s) => (
            <button key={s} className={`tab ${statusFilter === s ? "active" : ""}`} onClick={() => setStatusFilter(s)}>{STATUS_LABEL[s]}</button>
          ))}
        </div>
      </div>
      <div className="card" style={{ padding: 0 }}>
        {rows.length === 0 ? <div className="empty-state">Aucun dossier dans cette catégorie.</div> : (
          <table className="table">
            <thead><tr><th>Livreur</th><th>Téléphone</th><th>Envoyé le</th><th>Statut</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.submission.id} className="clickable" onClick={() => setSelected(row)}>
                  <td style={{ fontWeight: 600 }}>{row.driverName}</td>
                  <td style={{ fontSize: 12 }}>{row.submission.driverPhone}</td>
                  <td style={{ fontSize: 11.5, color: "var(--muted)" }}>{new Date(row.submission.submittedAt).toLocaleString("fr-FR")}</td>
                  <td><span className={`pill ${STATUS_PILL[row.submission.status]}`}><span className="dot" />{STATUS_LABEL[row.submission.status]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
