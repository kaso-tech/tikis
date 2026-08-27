export type DeliveryStatusBroadcast = {
  deliveryId: string;
  status: "draft" | "open" | "pending_confirmation" | "active" | "completed" | "disabled" | "cancelled";
  title: string;
  body: string;
  occurredAt: string;
};

function deliveryTopic(deliveryId: string) {
  const safeId = deliveryId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 96);
  return safeId ? `delivery:${safeId}` : null;
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
  } catch {
    return false;
  }
}
