import { useEffect, useState } from "react";
import { trpc } from "../lib/trpc";
import { ConfirmDialog } from "../lib/confirm-dialog";

type Filter = "all" | "low" | "commented" | "hidden";
type Review = {
  id: string; deliveryId: string; reviewerPhone: string; driverPhone: string; driverName: string | null; rating: number; comment: string | null;
  hiddenAt: Date | string | null; hiddenReason: string | null; createdAt: Date | string;
};

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "Tous" },
  { key: "low", label: "1 ou 2 étoiles" },
  { key: "commented", label: "Avec commentaire" },
  { key: "hidden", label: "Masqués" },
];
const PAGE_SIZE = 50;

function stars(rating: number) {
  return "★".repeat(rating) + "☆".repeat(Math.max(0, 5 - rating));
}

/**
 * Modération des avis laissés sur les livreurs. Un avis masqué (injurieux, hors sujet, frauduleux)
 * n'est plus affiché dans l'application et ne compte plus dans la note du livreur ; il reste consultable ici.
 */
export default function ReviewsPage() {
  const [filter, setFilter] = useState<Filter>("low");
  const [queryDraft, setQueryDraft] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<Review[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<{ review: Review; hide: boolean } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    trpc.adminConsole.reviews.list.query({ filter, query: query || undefined, limit: PAGE_SIZE, offset: page * PAGE_SIZE })
      .then((result) => { if (!cancelled) { setRows(result.rows as Review[]); setTotal(result.total); setError(""); } })
      .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Avis indisponibles."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [filter, query, page, reloadKey]);

  /** Change un critère de la liste ; le chargement suit. */
  function refine(apply: () => void) {
    setLoading(true);
    apply();
  }

  async function confirm() {
    if (!pending) return;
    if (pending.hide && reason.trim().length < 3) { setError("Indiquez pourquoi cet avis est masqué."); return; }
    setBusy(true); setError("");
    try {
      await trpc.adminConsole.reviews.setHidden.mutate({ reviewId: pending.review.id, hidden: pending.hide, reason: pending.hide ? reason.trim() : undefined });
      setNotice(pending.hide ? "Avis masqué : il ne compte plus dans la note du livreur." : "Avis rétabli.");
      setPending(null); setReason("");
      refine(() => setReloadKey((key) => key + 1));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Action impossible.");
    } finally {
      setBusy(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Avis</h1>
          <p className="page-sub">Masquez les avis injurieux, hors sujet ou frauduleux : ils ne comptent plus dans la note du livreur.</p>
        </div>
      </div>

      {error ? <div className="banner-error">{error}</div> : null}
      {notice ? <div className="banner-ok">{notice}</div> : null}

      <form className="card" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", padding: 14, marginBottom: 16 }} onSubmit={(event) => { event.preventDefault(); refine(() => { setPage(0); setQuery(queryDraft.trim()); }); }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {FILTERS.map((entry) => (
            <button key={entry.key} type="button" className={`btn btn-sm ${filter === entry.key ? "btn-primary" : ""}`} aria-pressed={filter === entry.key} onClick={() => refine(() => { setPage(0); setFilter(entry.key); })}>{entry.label}</button>
          ))}
        </div>
        <div style={{ flex: "1 1 200px" }}>
          <label className="field-label" htmlFor="reviews-query">Téléphone du livreur ou de l’auteur</label>
          <input id="reviews-query" className="input" inputMode="tel" value={queryDraft} onChange={(e) => setQueryDraft(e.target.value)} placeholder="70 00 00 00" />
        </div>
        <button className="btn btn-primary" type="submit">Rechercher</button>
      </form>

      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">{FILTERS.find((entry) => entry.key === filter)?.label}</div>
            <div className="card-sub">{total} avis</div>
          </div>
          <div className="pagination">
            <button type="button" className="btn btn-sm" disabled={page === 0 || loading} onClick={() => refine(() => setPage((p) => Math.max(0, p - 1)))}>← Précédent</button>
            <span className="muted">{page + 1} / {totalPages}</span>
            <button type="button" className="btn btn-sm" disabled={page + 1 >= totalPages || loading} onClick={() => refine(() => setPage((p) => p + 1))}>Suivant →</button>
          </div>
        </div>
        {rows.length === 0 ? (
          <div className="empty-state">{loading ? "Chargement…" : "Aucun avis pour ce filtre."}</div>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead><tr><th>Date</th><th>Livreur</th><th>Note</th><th>Commentaire</th><th>Auteur</th><th /></tr></thead>
              <tbody>
                {rows.map((review) => (
                  <tr key={review.id}>
                    <td style={{ fontVariantNumeric: "tabular-nums", color: "var(--muted)", fontSize: 11.5 }}>{new Date(review.createdAt).toLocaleString("fr-FR")}</td>
                    <td>
                      <div className="user-name">{review.driverName ?? "—"}</div>
                      <div className="user-meta">{review.driverPhone}</div>
                    </td>
                    <td aria-label={`${review.rating} sur 5`} style={{ whiteSpace: "nowrap", color: review.rating <= 2 ? "var(--error)" : "var(--muted-strong)" }}>{stars(review.rating)}</td>
                    <td style={{ maxWidth: 360, fontSize: 12.5, wordBreak: "break-word" }}>
                      {review.comment ? review.comment : <span className="muted">—</span>}
                      {review.hiddenAt ? <div className="muted" style={{ fontSize: 11 }}>Masqué le {new Date(review.hiddenAt).toLocaleDateString("fr-FR")} : {review.hiddenReason}</div> : null}
                    </td>
                    <td style={{ fontSize: 11.5 }}>{review.reviewerPhone}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {review.hiddenAt
                        ? <button className="btn btn-sm" type="button" onClick={() => { setNotice(""); setPending({ review, hide: false }); }}>Rétablir</button>
                        : <button className="btn btn-sm btn-danger" type="button" onClick={() => { setNotice(""); setReason(""); setPending({ review, hide: true }); }}>Masquer…</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!pending}
        title={pending?.hide ? "Masquer cet avis ?" : "Rétablir cet avis ?"}
        description={pending?.hide ? (
          <div style={{ display: "grid", gap: 6 }}>
            {error ? <div className="banner-error">{error}</div> : null}
            <p style={{ margin: 0 }}>L’avis ne sera plus affiché et ne comptera plus dans la note de {pending.review.driverName ?? pending.review.driverPhone}.</p>
            <label className="field-label" htmlFor="review-hide-reason">Motif</label>
            <input id="review-hide-reason" className="input" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Propos injurieux, avis sans rapport avec la course…" />
          </div>
        ) : "L’avis sera de nouveau affiché et comptera dans la note du livreur."}
        confirmLabel={pending?.hide ? "Masquer" : "Rétablir"}
        tone={pending?.hide ? "danger" : "primary"}
        busy={busy}
        onConfirm={() => void confirm()}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
