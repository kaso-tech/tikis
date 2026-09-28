import { useEffect, useState } from "react";
import { trpc } from "../lib/trpc";
import { ConfirmDialog } from "../lib/confirm-dialog";
import type { AdminRole } from "../lib/auth";

type Devices = {
  sessionsRevokedAt: Date | string | null;
  sessions: { id: string; deviceName: string | null; platform: string; appVersion: string | null; ipAddress: string | null; tokenLast4: string; createdAt: Date | string; lastSeenAt: Date | string; revokedAt: Date | string | null; active: boolean }[];
  pushTokens: { id: string; platform: string; deviceName: string | null; appVersion: string | null; lastSeenAt: Date | string }[];
};
type Limit = { key: string; kind: "block" | "counter"; scope: string; label: string; blockedForMinutes: number | null; attempts: number | null; updatedAt: Date | string };
type Note = { id: string; body: string; adminEmail: string; createdAt: Date | string };
type HistoryRow = { id: string; action: string; adminEmail: string; details: string | null; createdAt: Date | string };
type Pending = { kind: "logout"; reason: string } | { kind: "device"; sessionId: string; deviceName: string } | { kind: "unblock"; reason: string };

const PLATFORM_LABEL: Record<string, string> = { android: "Android", ios: "iPhone", web: "Navigateur", unknown: "Appareil" };

const ACTION_LABEL: Record<string, string> = {
  profile_status_changed: "Statut modifié", profile_role_changed: "Rôle modifié", wallet_bonus_credited: "Bonus crédité", wallet_penalty_applied: "Pénalité appliquée",
  user_force_logout: "Déconnecté de tous ses appareils", user_session_revoked: "Appareil déconnecté", user_rate_limits_cleared: "Blocages levés",
  account_deletion_cancelled: "Suppression annulée", account_closure_payout: "Solde versé avant suppression",
};

function when(value: Date | string) {
  return new Date(value).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

/** Détail lisible d'une entrée d'historique : avant → après, et le motif s'il y en a un. */
function describe(details: string | null) {
  if (!details) return "";
  try {
    const parsed = JSON.parse(details) as Record<string, unknown>;
    const parts: string[] = [];
    if ("before" in parsed || "after" in parsed) parts.push(`${String(parsed.before ?? "—")} → ${String(parsed.after ?? "—")}`);
    if (parsed.amount) parts.push(`${Number(parsed.amount).toLocaleString("fr-FR")} FCFA`);
    if (parsed.reason) parts.push(String(parsed.reason));
    return parts.join(" · ");
  } catch {
    return details;
  }
}

async function loadAll(phone: string, canOperate: boolean) {
  const [devices, limits, notes, history] = await Promise.all([
    canOperate ? trpc.adminConsole.users.devices.query({ phone }) : Promise.resolve(null),
    canOperate ? trpc.adminConsole.users.rateLimits.query({ phone }) : Promise.resolve([]),
    trpc.adminConsole.users.notes.query({ phone }),
    trpc.adminConsole.users.history.query({ phone }),
  ]);
  return { devices: devices as Devices | null, limits: limits as Limit[], notes: notes as Note[], history: history as HistoryRow[] };
}

/**
 * Support sur une fiche : appareils connectés et déconnexion forcée, blocages anti-abus, notes internes
 * et historique des décisions de l'équipe.
 */
export default function UserSupportPanel({ phone, role }: { phone: string; role: AdminRole }) {
  const canOperate = role === "super_admin" || role === "support";
  const canReadNotes = canOperate || role === "finance";
  const [data, setData] = useState<Awaited<ReturnType<typeof loadAll>> | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [logoutReason, setLogoutReason] = useState("");
  const [unblockReason, setUnblockReason] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!canReadNotes) return;
    let cancelled = false;
    loadAll(phone, canOperate)
      .then((result) => { if (!cancelled) setData(result); })
      .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Informations de support indisponibles."); });
    return () => { cancelled = true; };
  }, [phone, canOperate, canReadNotes, reloadKey]);

  if (!canReadNotes) return null;

  async function run(action: () => Promise<string>) {
    setBusy(true); setError(""); setNotice("");
    try {
      setNotice(await action());
      setPending(null);
      setReloadKey((key) => key + 1);
    } catch (cause) {
      setPending(null);
      setError(cause instanceof Error ? cause.message : "Action impossible.");
    } finally {
      setBusy(false);
    }
  }

  function confirm() {
    if (!pending) return;
    if (pending.kind === "logout") {
      void run(async () => {
        const result = await trpc.adminConsole.users.forceLogout.mutate({ phone, reason: pending.reason.trim() });
        setLogoutReason("");
        return `Déconnecté de tous ses appareils (${result.revokedSessions} session(s) enregistrée(s), ${result.removedPushTokens} appareil(s) ne recevront plus ses notifications).`;
      });
    } else if (pending.kind === "device") {
      void run(async () => { await trpc.adminConsole.users.revokeSession.mutate({ phone, sessionId: pending.sessionId }); return `${pending.deviceName} est déconnecté.`; });
    } else {
      void run(async () => {
        const result = await trpc.adminConsole.users.clearRateLimits.mutate({ phone, reason: pending.reason.trim() });
        setUnblockReason("");
        return result.cleared ? "Blocages levés : l’utilisateur peut réessayer tout de suite." : "Aucun blocage à lever.";
      });
    }
  }

  function ask(next: Pending) {
    if ("reason" in next && next.reason.trim().length < 3) { setError("Indiquez un motif (3 caractères au moins) : il est gardé au journal d’audit."); return; }
    setError(""); setPending(next);
  }

  const activeSessions = data?.devices?.sessions.filter((session) => session.active) ?? [];
  const blocks = data?.limits.filter((limit) => limit.kind === "block") ?? [];

  return (
    <>
      {error ? <div className="banner-error">{error}</div> : null}
      {notice ? <div className="banner-ok">{notice}</div> : null}
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", alignItems: "start", marginBottom: 16 }}>
        {canOperate ? (
          <div className="card" style={{ marginBottom: 0 }}>
            <div className="card-head"><div><div className="card-title">Appareils connectés</div><div className="card-sub">{activeSessions.length} session(s) active(s){data?.devices?.sessionsRevokedAt ? ` · dernière déconnexion forcée le ${when(data.devices.sessionsRevokedAt)}` : ""}</div></div></div>
            <div className="card-body">
              {!data ? <div className="muted">Chargement…</div> : data.devices && data.devices.sessions.length === 0 ? (
                <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>Aucun appareil enregistré. « Déconnecter partout » coupe quand même toutes les sessions, y compris sur navigateur.</p>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {data.devices?.sessions.map((session) => (
                    <div key={session.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <div>
                        <div className="user-name">{session.deviceName ?? PLATFORM_LABEL[session.platform] ?? "Appareil"} <span className="muted" style={{ fontWeight: 400 }}>…{session.tokenLast4}</span></div>
                        <div className="user-meta">{PLATFORM_LABEL[session.platform] ?? session.platform}{session.appVersion ? ` · v${session.appVersion}` : ""}{session.ipAddress ? ` · ${session.ipAddress}` : ""} · vu le {when(session.lastSeenAt)}</div>
                      </div>
                      {session.active
                        ? <button className="btn btn-sm" type="button" onClick={() => ask({ kind: "device", sessionId: session.id, deviceName: session.deviceName ?? "Cet appareil" })}>Déconnecter</button>
                        : <span className="pill pill-neutral"><span className="dot" />Déconnecté</span>}
                    </div>
                  ))}
                </div>
              )}
              <label className="field-label" htmlFor="logout-reason" style={{ marginTop: 12 }}>Déconnecter de tous les appareils</label>
              <div style={{ display: "flex", gap: 6 }}>
                <input id="logout-reason" className="input" maxLength={300} value={logoutReason} onChange={(e) => setLogoutReason(e.target.value)} placeholder="Motif : téléphone perdu, compte partagé…" />
                <button className="btn btn-sm btn-danger" type="button" onClick={() => ask({ kind: "logout", reason: logoutReason })}>Déconnecter partout…</button>
              </div>
            </div>
          </div>
        ) : null}

        {canOperate ? (
          <div className="card" style={{ marginBottom: 0 }}>
            <div className="card-head"><div><div className="card-title">Blocages anti-abus</div><div className="card-sub">Trop de tentatives de connexion, de codes ou de paiements</div></div></div>
            <div className="card-body">
              {!data ? <div className="muted">Chargement…</div> : data.limits.length === 0 ? (
                <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>Aucun blocage ni tentative récente.</p>
              ) : (
                <div style={{ display: "grid", gap: 6 }}>
                  {data.limits.map((limit) => (
                    <div key={limit.key} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                      <span>{limit.label}</span>
                      {limit.kind === "block"
                        ? <span className="pill pill-error"><span className="dot" />Bloqué encore {limit.blockedForMinutes} min</span>
                        : <span className="muted">{limit.attempts} tentative(s) récente(s)</span>}
                    </div>
                  ))}
                </div>
              )}
              {data && data.limits.length > 0 ? (
                <>
                  <label className="field-label" htmlFor="unblock-reason" style={{ marginTop: 12 }}>{blocks.length > 0 ? "Lever les blocages" : "Remettre les compteurs à zéro"}</label>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input id="unblock-reason" className="input" maxLength={300} value={unblockReason} onChange={(e) => setUnblockReason(e.target.value)} placeholder="Motif : utilisateur identifié au téléphone…" />
                    <button className="btn btn-sm btn-primary" type="button" onClick={() => ask({ kind: "unblock", reason: unblockReason })}>Débloquer…</button>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="card" style={{ marginBottom: 0 }}>
          <div className="card-head"><div><div className="card-title">Notes internes</div><div className="card-sub">Visibles par l’équipe uniquement, jamais par l’utilisateur</div></div></div>
          <div className="card-body">
            <form onSubmit={(event) => { event.preventDefault(); if (noteDraft.trim().length < 2) return; void run(async () => { await trpc.adminConsole.users.addNote.mutate({ phone, body: noteDraft.trim() }); setNoteDraft(""); return "Note ajoutée."; }); }}>
              <label className="field-label" htmlFor="note-body">Nouvelle note</label>
              <textarea id="note-body" className="input" rows={2} maxLength={1000} value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder="Appel du 12/09 : colis perdu, dossier transmis à la finance." style={{ resize: "vertical" }} />
              <button className="btn btn-sm btn-primary" type="submit" disabled={busy || noteDraft.trim().length < 2} style={{ marginTop: 6 }}>Ajouter la note</button>
            </form>
            <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
              {data?.notes.map((note) => (
                <div key={note.id}>
                  <div style={{ fontSize: 13, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{note.body}</div>
                  <div className="user-meta">{note.adminEmail} · {when(note.createdAt)}</div>
                </div>
              ))}
              {data && data.notes.length === 0 ? <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>Aucune note.</p> : null}
            </div>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 0 }}>
          <div className="card-head"><div><div className="card-title">Historique du compte</div><div className="card-sub">Décisions de l’équipe : statut, rôle, argent, sessions</div></div></div>
          <div className="card-body">
            {!data ? <div className="muted">Chargement…</div> : data.history.length === 0 ? <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>Aucune décision de l’équipe sur ce compte.</p> : (
              data.history.map((row) => (
                <div className="timeline-item" key={row.id}>
                  <div className="timeline-time">{when(row.createdAt)}</div>
                  <div className="timeline-body">
                    <div><strong>{ACTION_LABEL[row.action] ?? row.action}</strong> <span className="muted" style={{ fontSize: 11.5 }}>par {row.adminEmail}</span></div>
                    {describe(row.details) ? <div className="timeline-meta">{describe(row.details)}</div> : null}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={!!pending}
        title={pending?.kind === "logout" ? "Déconnecter de tous les appareils ?" : pending?.kind === "device" ? "Déconnecter cet appareil ?" : "Lever les blocages ?"}
        description={pending?.kind === "logout"
          ? "Toutes les sessions de ce compte sont coupées, sur téléphone comme sur navigateur. L’utilisateur devra se reconnecter avec un code SMS."
          : pending?.kind === "device" ? `${pending.deviceName} devra se reconnecter.` : "L’utilisateur peut réessayer tout de suite : connexion, codes et paiements."}
        confirmLabel={pending?.kind === "unblock" ? "Débloquer" : "Déconnecter"}
        tone={pending?.kind === "unblock" ? "primary" : "danger"}
        busy={busy}
        onConfirm={confirm}
        onCancel={() => setPending(null)}
      />
    </>
  );
}
