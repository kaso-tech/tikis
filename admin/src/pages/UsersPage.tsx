import { useEffect, useState } from "react";
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

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

export default function UsersPage({ search: topSearch = "" }: { search?: string }) {
  const [query, setQuery] = useState(topSearch);
  const [filter, setFilter] = useState<"all" | "sender" | "driver">("all");
  const [results, setResults] = useState<Profile[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  async function loadUsers(searchQuery?: string) {
    setError("");
    setLoading(true);
    try {
      const rows = await trpc.adminConsole.core.users.search.query(searchQuery ? { query: searchQuery } : {});
      setResults((rows as Profile[]).filter((p) => filter === "all" || p.accountType === filter));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Recherche impossible.");
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }

  useEffect(() => { void loadUsers(); }, []);
  useEffect(() => { if (loaded) void loadUsers(query || undefined); }, [filter, query]);

  async function openDetail(phone: string) {
    setError("");
    try {
      const data = await trpc.adminConsole.core.users.detail.query({ phone });
      setDetail(data as Detail);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Profil indisponible.");
    }
  }

  const total = results.length;
  const senderCount = results.filter((p) => p.accountType === "sender").length;
  const driverCount = results.filter((p) => p.accountType === "driver").length;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Utilisateurs</h1>
          <p className="page-sub">{total} profils · {senderCount} expéditeurs · {driverCount} livreurs</p>
        </div>
        <div className="page-actions">
          <button className="btn">Exporter CSV</button>
        </div>
      </div>

      {error ? <div className="banner-error">{error}</div> : null}

      <div className="card">
        <div className="card-head">
          <div className="tabs">
            <button className={`tab ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>Tous <span className="count">{total}</span></button>
            <button className={`tab ${filter === "sender" ? "active" : ""}`} onClick={() => setFilter("sender")}>Expéditeurs <span className="count">{senderCount}</span></button>
            <button className={`tab ${filter === "driver" ? "active" : ""}`} onClick={() => setFilter("driver")}>Livreurs <span className="count">{driverCount}</span></button>
          </div>
        </div>
        <div className="filters-row">
          <input className="input" placeholder="Rechercher par téléphone, nom ou email…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ minWidth: 280 }} />
        </div>

        {loading && !loaded ? <div className="empty-state">Chargement des utilisateurs…</div> : null}
        {loaded && results.length === 0 && !error ? <div className="empty-state">Aucun utilisateur ne correspond à cette recherche.</div> : null}
        {results.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Téléphone</th>
                <th>Rôle</th>
                <th>E-mail</th>
                <th>Vérification</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {results.map((profile) => (
                <tr key={profile.phone} className="clickable" onClick={() => void openDetail(profile.phone)}>
                  <td>
                    <div className="user-cell">
                      <div className={`user-avatar ${profile.accountType === "driver" ? "b" : "c"}`}>{initials(profile.fullName)}</div>
                      <div>
                        <div className="user-name">{profile.fullName}</div>
                        <div className="user-meta">{profile.phone}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11.5, color: "var(--muted)" }}>{profile.phone}</td>
                  <td>
                    <span className={`pill ${profile.accountType === "driver" ? "pill-info" : "pill-primary"}`}>
                      <span className="dot" />{profile.accountType === "sender" ? "Expéditeur" : "Livreur"}
                    </span>
                  </td>
                  <td>{profile.email ?? <span className="muted">—</span>}</td>
                  <td>
                    {profile.phoneVerified ? <span className="pill pill-success"><span className="dot" />Tel OK</span> : <span className="pill pill-warning"><span className="dot" />Tel</span>}
                    {" "}
                    {profile.emailVerified ? <span className="pill pill-success"><span className="dot" />Email OK</span> : null}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button className="btn btn-sm">Détail</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>

      {detail ? (
        <>
          <div className="card">
            <div className="card-head">
              <div>
                <div className="card-title">{detail.profile.fullName}</div>
                <div className="card-sub">
                  {detail.profile.accountType === "sender" ? "Expéditeur" : "Livreur"} ·
                  {" "}{detail.deliveriesAsSenderCount} livraison(s) en tant qu’expéditeur ·
                  {" "}{detail.deliveriesAsDriverCount} en tant que livreur
                </div>
              </div>
              <div className="row-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => setDetail(null)}>Fermer</button>
              </div>
            </div>
            {detail.wallet ? (
              <div className="kpi-grid" style={{ marginBottom: 0 }}>
                <div className="kpi"><div className="kpi-label">Solde disponible</div><div className="kpi-value">{formatMoney(detail.wallet.availableBalance)}</div></div>
                <div className="kpi"><div className="kpi-label">Solde bloqué</div><div className="kpi-value">{formatMoney(detail.wallet.heldBalance)}</div></div>
                <div className="kpi"><div className="kpi-label">Téléphone</div><div className="kpi-value" style={{ fontSize: 14 }}>{detail.profile.phone}</div></div>
                <div className="kpi"><div className="kpi-label">E-mail</div><div className="kpi-value" style={{ fontSize: 14 }}>{detail.profile.email ?? "—"}</div></div>
              </div>
            ) : <div className="empty-state">Aucun Wallet initialisé.</div>}
          </div>
          <div className="card">
            <div className="card-head">
              <div>
                <div className="card-title">Journal financier</div>
                <div className="card-sub">100 dernières écritures</div>
              </div>
            </div>
            <div className="card-body tight">
              {detail.ledger.length === 0 ? (
                <div className="empty-state">Aucune écriture pour ce profil.</div>
              ) : (
                <table className="table">
                  <thead><tr><th>Date</th><th>Opération</th><th>Montant</th><th>Motif</th></tr></thead>
                  <tbody>
                    {detail.ledger.map((entry) => (
                      <tr key={entry.id}>
                        <td style={{ fontVariantNumeric: "tabular-nums", color: "var(--muted)", fontSize: 11.5 }}>{new Date(entry.createdAt).toLocaleString("fr-FR")}</td>
                        <td><span className="pill pill-neutral" style={{ background: "var(--surface-2)", color: "var(--muted-strong)" }}>{entry.operation}</span></td>
                        <td className="price">{formatMoney(entry.amount)}</td>
                        <td>{entry.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
