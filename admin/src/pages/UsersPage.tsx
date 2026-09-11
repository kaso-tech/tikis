import { useEffect, useState } from "react";
import { trpc } from "../lib/trpc";
import { downloadCsv, rowsToCsv } from "../lib/csv";
import { SkeletonTable } from "../lib/skeleton";

type Profile = { phone: string; fullName: string; accountType: "sender" | "driver"; email: string | null; phoneVerified: boolean; emailVerified: boolean; status?: "active" | "suspended" | "banned"; statusReason?: string | null };
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
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const PAGE_SIZE = 25;

  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [statusReasonDraft, setStatusReasonDraft] = useState("");
  const [rewardDraft, setRewardDraft] = useState({ amount: "", reason: "" });
  const [penaltyDraft, setPenaltyDraft] = useState({ amount: "", reason: "" });

  async function loadUsers(searchQuery?: string) {
    setError("");
    setLoading(true);
    try {
      const response = await trpc.adminConsole.users.search.query({ query: searchQuery, limit: PAGE_SIZE, offset: page * PAGE_SIZE }) as { rows: Profile[]; total: number };
      setResults(response.rows.filter((p) => filter === "all" || p.accountType === filter));
      setTotal(response.total);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Recherche impossible.");
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }

  useEffect(() => { void loadUsers(); }, []);
  useEffect(() => { if (loaded) void loadUsers(query || undefined); }, [filter, query, page]);

  async function openDetail(phone: string) {
    setError("");
    setActionError("");
    try {
      const data = await trpc.adminConsole.users.detail.query({ phone });
      setDetail(data as Detail);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Profil indisponible.");
    }
  }

  async function setStatus(status: "active" | "suspended" | "banned") {
    if (!detail) return;
    setActionBusy(true);
    setActionError("");
    try {
      await trpc.adminConsole.users.setStatus.mutate({ phone: detail.profile.phone, status, reason: statusReasonDraft.trim() || undefined });
      setStatusReasonDraft("");
      await openDetail(detail.profile.phone);
      await loadUsers(query || undefined);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Action impossible.");
    } finally {
      setActionBusy(false);
    }
  }

  async function changeRole(role: "sender" | "driver") {
    if (!detail) return;
    setActionBusy(true);
    setActionError("");
    try {
      await trpc.adminConsole.users.changeRole.mutate({ phone: detail.profile.phone, role });
      await openDetail(detail.profile.phone);
      await loadUsers(query || undefined);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Changement de rôle impossible.");
    } finally {
      setActionBusy(false);
    }
  }

  async function sendReward() {
    if (!detail) return;
    const amount = Number(rewardDraft.amount);
    if (!Number.isFinite(amount) || amount <= 0) { setActionError("Montant de récompense invalide."); return; }
    setActionBusy(true);
    setActionError("");
    try {
      await trpc.adminConsole.users.reward.mutate({ phone: detail.profile.phone, amount, reason: rewardDraft.reason.trim() || "Bonus accordé par l’administration", requestId: crypto.randomUUID() });
      setRewardDraft({ amount: "", reason: "" });
      await openDetail(detail.profile.phone);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Envoi du bonus impossible.");
    } finally {
      setActionBusy(false);
    }
  }

  async function sendPenalty() {
    if (!detail) return;
    const amount = Number(penaltyDraft.amount);
    if (!Number.isFinite(amount) || amount <= 0) { setActionError("Montant de pénalité invalide."); return; }
    setActionBusy(true);
    setActionError("");
    try {
      await trpc.adminConsole.users.penalize.mutate({ phone: detail.profile.phone, amount, reason: penaltyDraft.reason.trim() || "Pénalité appliquée par l’administration", requestId: crypto.randomUUID() });
      setPenaltyDraft({ amount: "", reason: "" });
      await openDetail(detail.profile.phone);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Application de la pénalité impossible.");
    } finally {
      setActionBusy(false);
    }
  }

  // ———— Vue détail : page dédiée, remplace la liste ————
  if (detail) {
    return (
      <div>
        <div className="page-head">
          <div>
            <button className="btn btn-secondary btn-sm" onClick={() => { setDetail(null); setActionError(""); }} style={{ marginBottom: 10 }}>← Retour à la liste</button>
            <h1 className="page-title">{detail.profile.fullName}</h1>
            <p className="page-sub">
              {detail.profile.accountType === "sender" ? "Expéditeur" : "Livreur"} ·
              {" "}{detail.deliveriesAsSenderCount} livraison(s) en tant qu’expéditeur ·
              {" "}{detail.deliveriesAsDriverCount} en tant que livreur
              {detail.profile.status && detail.profile.status !== "active" ? <> · <span className={`pill ${detail.profile.status === "banned" ? "pill-error" : "pill-warning"}`}><span className="dot" />{detail.profile.status === "banned" ? "Banni" : "Suspendu"}{detail.profile.statusReason ? ` — ${detail.profile.statusReason}` : ""}</span></> : null}
            </p>
          </div>
        </div>

        <div className="card">
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
          <div className="card-head"><div><div className="card-title">Actions administrateur</div><div className="card-sub">Chaque action est tracée dans le journal d’audit</div></div></div>
          {actionError ? <div className="banner-error">{actionError}</div> : null}
          <div className="grid grid-4">
            <div className="action-block">
              <div className="action-block-title">Statut du compte</div>
              <input className="input" placeholder="Motif (optionnel)" value={statusReasonDraft} onChange={(e) => setStatusReasonDraft(e.target.value)} style={{ marginBottom: 8 }} />
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {detail.profile.status !== "active" ? <button className="btn btn-sm" disabled={actionBusy} onClick={() => void setStatus("active")}>Réactiver</button> : null}
                {detail.profile.status !== "suspended" ? <button className="btn btn-sm" disabled={actionBusy} onClick={() => void setStatus("suspended")}>Suspendre</button> : null}
                {detail.profile.status !== "banned" ? <button className="btn btn-sm btn-danger" disabled={actionBusy} onClick={() => void setStatus("banned")}>Bannir</button> : null}
              </div>
            </div>

            <div className="action-block">
              <div className="action-block-title">Rôle</div>
              <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 8 }}>Actuel : {detail.profile.accountType === "sender" ? "Expéditeur" : "Livreur"}. Impossible si une livraison est en cours.</div>
              <button className="btn btn-sm" disabled={actionBusy} onClick={() => void changeRole(detail.profile.accountType === "sender" ? "driver" : "sender")}>
                Basculer en {detail.profile.accountType === "sender" ? "Livreur" : "Expéditeur"}
              </button>
            </div>

            <div className="action-block">
              <div className="action-block-title">Bonus / récompense</div>
              <input className="input" placeholder="Montant FCFA" inputMode="numeric" value={rewardDraft.amount} onChange={(e) => setRewardDraft((s) => ({ ...s, amount: e.target.value.replace(/[^0-9]/g, "") }))} style={{ marginBottom: 6 }} />
              <input className="input" placeholder="Motif" value={rewardDraft.reason} onChange={(e) => setRewardDraft((s) => ({ ...s, reason: e.target.value }))} style={{ marginBottom: 8 }} />
              <button className="btn btn-sm btn-primary" disabled={actionBusy} onClick={() => void sendReward()}>Créditer</button>
            </div>

            <div className="action-block">
              <div className="action-block-title">Pénalité</div>
              <input className="input" placeholder="Montant FCFA" inputMode="numeric" value={penaltyDraft.amount} onChange={(e) => setPenaltyDraft((s) => ({ ...s, amount: e.target.value.replace(/[^0-9]/g, "") }))} style={{ marginBottom: 6 }} />
              <input className="input" placeholder="Motif" value={penaltyDraft.reason} onChange={(e) => setPenaltyDraft((s) => ({ ...s, reason: e.target.value }))} style={{ marginBottom: 8 }} />
              <button className="btn btn-sm btn-danger" disabled={actionBusy} onClick={() => void sendPenalty()}>Débiter</button>
            </div>
          </div>
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
      </div>
    );
  }

  const localTotal = results.length;
  const senderCount = results.filter((p) => p.accountType === "sender").length;
  const driverCount = results.filter((p) => p.accountType === "driver").length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasPrev = page > 0;
  const hasNext = page + 1 < totalPages;

  function goToPage(next: number) {
    setPage(Math.max(0, Math.min(next, totalPages - 1)));
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Utilisateurs</h1>
          <p className="page-sub">{total} profils · page {page + 1} / {totalPages} · {localTotal} résultat(s) affiché(s)</p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn" onClick={() => {
            const csv = rowsToCsv(
              [
                { key: "phone", label: "Téléphone" },
                { key: "fullName", label: "Nom" },
                { key: "accountType", label: "Rôle" },
                { key: "email", label: "Email" },
                { key: "phoneVerified", label: "Téléphone vérifié" },
                { key: "emailVerified", label: "Email vérifié" },
                { key: "status", label: "Statut" },
                { key: "statusReason", label: "Motif" },
              ],
              results.map((profile) => ({
                phone: profile.phone,
                fullName: profile.fullName,
                accountType: profile.accountType,
                email: profile.email ?? "",
                phoneVerified: profile.phoneVerified,
                emailVerified: profile.emailVerified,
                status: profile.status ?? "active",
                statusReason: profile.statusReason ?? "",
              })),
            );
            downloadCsv(`tikis-users-${new Date().toISOString().slice(0, 10)}`, csv);
          }} disabled={results.length === 0}>Exporter CSV</button>
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
          <div className="pagination">
            <button type="button" className="btn btn-sm" disabled={!hasPrev} onClick={() => goToPage(page - 1)}>← Précédent</button>
            <span className="muted">{page + 1} / {totalPages}</span>
            <button type="button" className="btn btn-sm" disabled={!hasNext} onClick={() => goToPage(page + 1)}>Suivant →</button>
          </div>
        </div>
        <div className="filters-row">
          <input className="input" placeholder="Rechercher par téléphone, nom ou email…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ minWidth: 280 }} />
        </div>

        {loading && !loaded ? <SkeletonTable rows={6} columns={4} /> : null}
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
                    {" "}
                    {profile.status === "banned" ? <span className="pill pill-error" title={profile.statusReason ?? undefined}><span className="dot" />Banni</span> : profile.status === "suspended" ? <span className="pill pill-warning" title={profile.statusReason ?? undefined}><span className="dot" />Suspendu</span> : null}
                    {profile.statusReason && (profile.status === "banned" || profile.status === "suspended") ? (
                      <div className="muted" style={{ fontSize: 10.5, marginTop: 4, maxWidth: 160 }} title={profile.statusReason}>
                        Motif : {profile.statusReason.length > 30 ? `${profile.statusReason.slice(0, 30)}…` : profile.statusReason}
                      </div>
                    ) : null}
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
    </div>
  );
}
