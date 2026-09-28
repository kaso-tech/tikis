import { useEffect, useState } from "react";
import { trpc } from "../lib/trpc";
import { ConfirmDialog } from "../lib/confirm-dialog";
import { useAdminAuth } from "../lib/auth";

type State = "grace" | "grace_blocked" | "blocked" | "ready";
type Request = {
  phone: string; fullName: string; accountType: "sender" | "driver"; status: string;
  deletionRequestedAt: Date | string | null; deletionScheduledAt: Date | string | null;
  available: number; held: number; blockers: { code: string; label: string }[]; state: State;
};
type Deleted = { pseudonym: string; accountType: "sender" | "driver"; deletedAt: Date | string; purgeAfter: Date | string };
type Pending =
  | { kind: "payout"; request: Request; payoutReference: string; notes: string; requestId: string }
  | { kind: "finalize"; request: Request }
  | { kind: "cancel"; request: Request; reason: string };

const STATE_PILL: Record<State, { label: string; tone: string }> = {
  grace: { label: "Dans le délai", tone: "pill-info" },
  grace_blocked: { label: "Dans le délai, à régler", tone: "pill-warning" },
  blocked: { label: "À traiter", tone: "pill-error" },
  ready: { label: "Prête", tone: "pill-success" },
};

function formatMoney(amount: number) {
  return `${new Intl.NumberFormat("fr-FR").format(amount)} FCFA`;
}

function day(value: Date | string | null) {
  return value ? new Date(value).toLocaleDateString("fr-FR") : "—";
}

function daysLeft(value: Date | string | null) {
  if (!value) return 0;
  return Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000));
}

/**
 * Demandes de suppression de compte. 30 jours de délai, pendant lesquels l'utilisateur peut annuler ;
 * ensuite, la suppression se fait d'elle-même, sauf s'il reste de l'argent ou une course : l'équipe
 * règle d'abord (versement du solde, livraison), puis la suppression passe.
 */
export default function AccountDeletionsPage() {
  const { admin } = useAdminAuth();
  const canPay = admin?.role === "super_admin" || admin?.role === "finance";
  const canOperate = admin?.role === "super_admin" || admin?.role === "support";
  const [requests, setRequests] = useState<Request[]>([]);
  const [deleted, setDeleted] = useState<Deleted[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const [lookup, setLookup] = useState("");
  const [lookupResult, setLookupResult] = useState<Deleted[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    trpc.adminConsole.accountDeletions.list.query()
      .then((result) => { if (!cancelled) { setRequests(result.requests as Request[]); setDeleted(result.recentlyDeleted as Deleted[]); } })
      .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Demandes indisponibles."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [reloadKey]);

  async function confirm() {
    if (!pending) return;
    if (pending.kind === "payout" && (pending.payoutReference.trim().length < 4 || !pending.notes.trim())) { setDialogError("Indiquez la référence du versement (4 caractères au moins) et une note."); return; }
    if (pending.kind === "cancel" && pending.reason.trim().length < 3) { setDialogError("Indiquez le motif de l’annulation."); return; }
    setDialogError("");
    setBusy(true); setError(""); setNotice("");
    try {
      if (pending.kind === "payout") {
        const result = await trpc.adminConsole.accountDeletions.payoutBalance.mutate({ phone: pending.request.phone, payoutReference: pending.payoutReference.trim(), notes: pending.notes.trim(), requestId: pending.requestId });
        setNotice("approvalId" in result
          ? `Versement de ${formatMoney(result.amount)} au-delà du seuil : demande envoyée pour validation par un second admin (Validations).`
          : `Versement de ${formatMoney(result.amount)} enregistré. Le solde est à zéro.`);
      } else if (pending.kind === "finalize") {
        const result = await trpc.adminConsole.accountDeletions.finalize.mutate({ phone: pending.request.phone });
        setNotice(`Compte supprimé. Son historique est conservé sous le pseudonyme ${result.pseudonym} jusqu’au ${day(result.purgeAfter)}.`);
      } else {
        await trpc.adminConsole.accountDeletions.cancel.mutate({ phone: pending.request.phone, reason: pending.reason.trim() });
        setNotice(`Demande de suppression annulée pour ${pending.request.fullName}.`);
      }
      setPending(null);
      setLoading(true);
      setReloadKey((key) => key + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Action impossible.");
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  async function findByPhone(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      setLookupResult(await trpc.adminConsole.accountDeletions.findByPhone.query({ phone: lookup.trim() }) as Deleted[]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Recherche impossible.");
    }
  }

  const toHandle = requests.filter((request) => request.state === "blocked").length;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Suppressions de compte</h1>
          <p className="page-sub">30 jours pour changer d’avis, puis suppression. Elle attend tant qu’il reste un solde, une réservation ou une course en cours.</p>
        </div>
      </div>

      {error ? <div className="banner-error">{error}</div> : null}
      {notice ? <div className="banner-ok">{notice}</div> : null}

      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Demandes en cours</div>
            <div className="card-sub">{requests.length} demande(s){toHandle ? ` · ${toHandle} à traiter` : ""}</div>
          </div>
        </div>
        {requests.length === 0 ? (
          <div className="empty-state">{loading ? "Chargement…" : "Aucune demande de suppression en cours."}</div>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead><tr><th>Compte</th><th>Demandée le</th><th>Échéance</th><th>État</th><th>Reste à régler</th><th /></tr></thead>
              <tbody>
                {requests.map((request) => (
                  <tr key={request.phone}>
                    <td>
                      <div className="user-name">{request.fullName}</div>
                      <div className="user-meta">{request.phone} · {request.accountType === "driver" ? "Livreur" : "Expéditeur"}</div>
                    </td>
                    <td style={{ fontSize: 12 }}>{day(request.deletionRequestedAt)}</td>
                    <td style={{ fontSize: 12 }}>
                      {day(request.deletionScheduledAt)}
                      {request.state.startsWith("grace") ? <div className="muted" style={{ fontSize: 11 }}>dans {daysLeft(request.deletionScheduledAt)} j</div> : null}
                    </td>
                    <td><span className={`pill ${STATE_PILL[request.state].tone}`}><span className="dot" />{STATE_PILL[request.state].label}</span></td>
                    <td style={{ fontSize: 12 }}>
                      {request.blockers.length === 0 ? <span className="muted">Rien</span> : (
                        <ul style={{ margin: 0, paddingLeft: 16 }}>{request.blockers.map((blocker) => <li key={blocker.code}>{blocker.label}</li>)}</ul>
                      )}
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <div style={{ display: "inline-flex", gap: 6 }}>
                        {canPay && request.available > 0 && request.held === 0 ? (
                          <button className="btn btn-sm btn-primary" type="button" onClick={() => { setNotice(""); setPending({ kind: "payout", request, payoutReference: "", notes: "", requestId: crypto.randomUUID() }); }}>Verser le solde…</button>
                        ) : null}
                        {canOperate && request.state === "ready" ? (
                          <button className="btn btn-sm btn-danger" type="button" onClick={() => { setNotice(""); setPending({ kind: "finalize", request }); }}>Supprimer…</button>
                        ) : null}
                        {canOperate ? (
                          <button className="btn btn-sm" type="button" onClick={() => { setNotice(""); setPending({ kind: "cancel", request, reason: "" }); }}>Annuler la demande…</button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", alignItems: "start" }}>
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="card-head"><div><div className="card-title">Comptes supprimés récemment</div><div className="card-sub">Historique conservé 10 ans sous pseudonyme, puis détaché</div></div></div>
          <div className="card-body">
            {deleted.length === 0 ? <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>Aucun compte supprimé.</p> : (
              <div style={{ display: "grid", gap: 8 }}>
                {deleted.map((row) => (
                  <div key={row.pseudonym} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, gap: 8 }}>
                    <span><code>{row.pseudonym}</code> · {row.accountType === "driver" ? "Livreur" : "Expéditeur"}</span>
                    <span className="muted">supprimé le {day(row.deletedAt)} · conservé jusqu’au {day(row.purgeAfter)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <form className="card" style={{ marginBottom: 0 }} onSubmit={(event) => void findByPhone(event)}>
          <div className="card-head"><div><div className="card-title">Retrouver un compte supprimé</div><div className="card-sub">Par son ancien numéro, pour une question comptable ou un litige</div></div></div>
          <div className="card-body">
            <label className="field-label" htmlFor="deleted-lookup">Ancien numéro</label>
            <div style={{ display: "flex", gap: 6 }}>
              <input id="deleted-lookup" className="input" inputMode="tel" value={lookup} onChange={(e) => setLookup(e.target.value)} placeholder="+22670000000" />
              <button className="btn btn-primary" type="submit" disabled={lookup.trim().length < 8}>Rechercher</button>
            </div>
            {lookupResult ? (
              lookupResult.length === 0
                ? <p className="muted" style={{ margin: "10px 0 0", fontSize: 12.5 }}>Aucun compte supprimé avec ce numéro (ou conservation de 10 ans écoulée).</p>
                : lookupResult.map((row) => (
                  <p key={row.pseudonym} style={{ margin: "10px 0 0", fontSize: 12.5 }}>
                    Supprimé le {day(row.deletedAt)} : historique sous le pseudonyme <code>{row.pseudonym}</code> (recherchez-le dans Utilisateurs), conservé jusqu’au {day(row.purgeAfter)}.
                  </p>
                ))
            ) : null}
          </div>
        </form>
      </div>

      <ConfirmDialog
        open={!!pending}
        title={pending?.kind === "payout" ? "Verser le solde restant ?" : pending?.kind === "finalize" ? "Supprimer ce compte maintenant ?" : "Annuler la demande de suppression ?"}
        description={pending?.kind === "payout" ? (
          <div style={{ display: "grid", gap: 6 }}>
            {dialogError ? <div className="banner-error">{dialogError}</div> : null}
            <p style={{ margin: 0 }}>Versez d’abord <strong>{formatMoney(pending.request.available)}</strong> à {pending.request.fullName} par Mobile Money, puis indiquez la référence du versement.</p>
            <label className="field-label" htmlFor="closure-reference">Référence du versement</label>
            <input id="closure-reference" className="input" maxLength={80} value={pending.payoutReference} onChange={(e) => setPending({ ...pending, payoutReference: e.target.value })} placeholder="Référence Orange Money, Moov Money, Wave…" />
            <label className="field-label" htmlFor="closure-notes">Note</label>
            <input id="closure-notes" className="input" maxLength={300} value={pending.notes} onChange={(e) => setPending({ ...pending, notes: e.target.value })} placeholder="Opérateur et numéro crédité" />
          </div>
        ) : pending?.kind === "finalize" ? (
          <p style={{ margin: 0 }}>Nom, e-mail, photo, adresses et appareils de {pending.request.fullName} sont effacés, ainsi que les photos de sa pièce d’identité. Son historique financier est gardé 10 ans sous pseudonyme, et son numéro est libéré. <strong>C’est définitif.</strong></p>
        ) : pending?.kind === "cancel" ? (
          <div style={{ display: "grid", gap: 6 }}>
            {dialogError ? <div className="banner-error">{dialogError}</div> : null}
            <p style={{ margin: 0 }}>Le compte de {pending.request.fullName} redevient normal. À faire seulement à la demande de l’utilisateur.</p>
            <label className="field-label" htmlFor="cancel-reason">Motif</label>
            <input id="cancel-reason" className="input" maxLength={300} value={pending.reason} onChange={(e) => setPending({ ...pending, reason: e.target.value })} placeholder="Demande de l’utilisateur par téléphone le…" />
          </div>
        ) : ""}
        confirmLabel={pending?.kind === "payout" ? "Enregistrer le versement" : pending?.kind === "finalize" ? "Supprimer définitivement" : "Annuler la suppression"}
        tone={pending?.kind === "finalize" ? "danger" : "primary"}
        busy={busy}
        onConfirm={() => void confirm()}
        onCancel={() => { setPending(null); setDialogError(""); }}
      />
    </div>
  );
}
