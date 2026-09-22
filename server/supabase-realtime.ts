export type DeliveryStatusBroadcast = {
  deliveryId: string;
  status: "draft" | "open" | "pending_confirmation" | "active" | "completed" | "disabled" | "cancelled" | "expired";
  title: string;
  body: string;
  occurredAt: string;
};

export type DeliveryRealtimeMember = { userId: string; role: "sender" | "driver" };

export type DeliveryPositionBroadcast = {
  deliveryId: string;
  latitude: number;
  longitude: number;
  heading: number;
  recordedAt: string;
};

function deliveryTopic(deliveryId: string) {
  const safeId = deliveryId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 96);
  return safeId ? `delivery:${safeId}` : null;
}

/** Replaces channel membership through the server key; no client can join itself to a delivery topic. */
export async function syncDeliveryRealtimeMembers(deliveryId: string, members: DeliveryRealtimeMember[]) {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const safeId = deliveryId.replace(/[^a-zA-Z0-9-]/g, "");
  if (!url || !secret || !/^[0-9a-fA-F-]{36}$/.test(safeId)) return false;
  const base = url.replace(/\/$/, "");
  const headers = { apikey: secret, Authorization: `Bearer ${secret}`, "Content-Type": "application/json" };
  try {
    const removed = await fetch(`${base}/rest/v1/tikis_delivery_channel_members?delivery_id=eq.${encodeURIComponent(safeId)}`, { method: "DELETE", headers, signal: AbortSignal.timeout(4_000) });
    if (!removed.ok) return false;
    const rows = members.filter((member) => /^[0-9a-fA-F-]{36}$/.test(member.userId)).map((member) => ({ delivery_id: safeId, user_id: member.userId, participant_role: member.role }));
    if (!rows.length) return true;
    const response = await fetch(`${base}/rest/v1/tikis_delivery_channel_members`, { method: "POST", headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows), signal: AbortSignal.timeout(4_000) });
    return response.ok;
  } catch { return false; }
}

/** Publishes a non-sensitive status signal after the database transaction has committed. */
export async function publishDeliveryStatusBroadcast(event: DeliveryStatusBroadcast) {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const topic = deliveryTopic(event.deliveryId);
  if (!url || !secret || !topic) return false;
  try {
    const endpoint = `${url.replace(/\/$/, "")}/realtime/v1/api/broadcast/${encodeURIComponent(topic)}/events/status?private=true`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { apikey: secret, Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(4_000),
    });
    return response.ok;
  } catch { return false; }
}

/** Publishes only the latest validated driver position to the private delivery channel. */
export async function publishDeliveryPositionBroadcast(event: DeliveryPositionBroadcast) {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const topic = deliveryTopic(event.deliveryId);
  if (!url || !secret || !topic) return false;
  try {
    const endpoint = `${url.replace(/\/$/, "")}/realtime/v1/api/broadcast/${encodeURIComponent(topic)}/events/position?private=true`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { apikey: secret, Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(4_000),
    });
    return response.ok;
  } catch { return false; }
}

function walletTopic(supabaseUserId: string) {
  const safeId = supabaseUserId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 96);
  return safeId ? `wallet:${safeId}` : null;
}

/**
 * Signale un mouvement du Wallet d'un profil sur son canal privé, propre à cet utilisateur — pas
 * de table d'adhésion à tenir à jour (contrairement aux livraisons) : c'est toujours exactement le
 * même utilisateur des deux côtés. Voir supabase/realtime_wallet_rls.sql pour l'autorisation RLS.
 *
 * Aucune donnée financière dans la charge utile : juste un signal « quelque chose a changé », que
 * le client traduit en invalidation de wallet.snapshot / wallet.driverEarningsHistory — le solde
 * réel reste à récupérer par la requête tRPC habituelle, jamais transmis sur ce canal.
 */
export async function publishWalletBroadcast(supabaseUserId: string) {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const topic = walletTopic(supabaseUserId);
  if (!url || !secret || !topic) return false;
  try {
    const endpoint = `${url.replace(/\/$/, "")}/realtime/v1/api/broadcast/${encodeURIComponent(topic)}/events/changed?private=true`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { apikey: secret, Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ at: new Date().toISOString() }),
      signal: AbortSignal.timeout(4_000),
    });
    return response.ok;
  } catch { return false; }
}
