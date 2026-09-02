import { useState } from "react";
import { trpc } from "../lib/trpc";

type Profile = { phone: string; fullName: string; accountType: "sender" | "driver"; email: string | null; phoneVerified: boolean; emailVerified: boolean };
type Detail = {
  profile: Profile;
  wallet: { availableBalance: number; heldBalance: number } | null;
  ledger: Array<{ id: string; operation: string; amount: number; reason: string; createdAt: Date }>;
  deliveriesAsSenderCount: number;
  deliveriesAsDriverCount: number;
};

function formatMoney(amount: number) {
  return `${new Intl.NumberFormat("fr-FR").format(amount)} FCFA`;
}

export default function UsersPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Profile[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function search() {
    if (query.trim().length < 2) { setError("Saisissez au moins 2 caractères."); return; }
    setError("");
    setLoading(true);
    try {
      const rows = await trpc.adminConsole.users.search.query({ query: query.trim() });
      setResults(rows as Profile[]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Recherche impossible.");
    } finally {
      setLoading(false);
    }
  }

  async function openDetail(phone: string) {
    setError("");
    try {
      const data = await trpc.adminConsole.users.detail.query({ phone });
      setDetail(data as Detail);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Profil indisponible.");
    }
  }

  return (
    <div>
      <h1 className="page-title">Utilisateurs</h1>
      <p className="page-subtitle">Recherchez un profil par téléphone, nom ou e-mail pour consulter son Wallet et son journal financier.</p>
      {error ? <div className="error-banner">{error}</div> : null}
      <div className="card">
        <div style={{ display: "flex", gap: 8 }}>
          <input className="input" placeholder="Téléphone, nom, e-mail…" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void search()} />
          <button className="btn btn-primary" onClick={() => void search()} disabled={loading}>{loading ? "Recherche…" : "Rechercher"}</button>
        </div>
      </div>

      {results.length > 0 ? (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead><tr><th>Nom</th><th>Téléphone</th><th>Rôle</th><th>E-mail</th></tr></thead>
            <tbody>
              {results.map((profile) => (
                <tr key={profile.phone} className="clickable" onClick={() => void openDetail(profile.phone)}>
                  <td>{profile.fullName}</td><td>{profile.phone}</td><td>{profile.accountType === "sender" ? "Expéditeur" : "Livreur"}</td><td>{profile.email ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {detail ? (
        <>
          <div className="card">
            <p className="card-title">{detail.profile.fullName} — {detail.profile.phone}</p>
            <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
              {detail.profile.accountType === "sender" ? "Expéditeur" : "Livreur"} · {detail.deliveriesAsSenderCount} livraison(s) en tant qu’expéditeur · {detail.deliveriesAsDriverCount} en tant que livreur
            </p>
            {detail.wallet ? (
              <div className="kpi-grid" style={{ marginTop: 14 }}>
                <div className="kpi-card"><div className="kpi-label">Solde disponible</div><div className="kpi-value">{formatMoney(detail.wallet.availableBalance)}</div></div>
                <div className="kpi-card"><div className="kpi-label">Solde bloqué</div><div className="kpi-value">{formatMoney(detail.wallet.heldBalance)}</div></div>
              </div>
            ) : <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Aucun Wallet initialisé.</p>}
          </div>
          <div className="card">
            <p className="card-title">Journal financier (100 dernières écritures)</p>
            <table>
              <thead><tr><th>Date</th><th>Opération</th><th>Montant</th><th>Motif</th></tr></thead>
              <tbody>
                {detail.ledger.map((entry) => (
                  <tr key={entry.id}><td>{new Date(entry.createdAt).toLocaleString("fr-FR")}</td><td>{entry.operation}</td><td>{formatMoney(entry.amount)}</td><td>{entry.reason}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
