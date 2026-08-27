import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";

export type DeliveryPosition = {
  latitude: number;
  longitude: number;
  heading: number;
  recordedAt: string;
};

type RealtimeListener = (position: DeliveryPosition) => void;
export type DeliveryStatusEvent = {
  deliveryId: string;
  status: "draft" | "open" | "pending_confirmation" | "active" | "completed" | "disabled" | "cancelled";
  title: string;
  body: string;
  occurredAt: string;
};
type DeliveryStatusListener = (event: DeliveryStatusEvent) => void;

let client: SupabaseClient | null = null;

function supabaseClient() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  if (!client) client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

export function normalizeDeliveryPosition(input: unknown): DeliveryPosition | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  const latitude = value.latitude;
  const longitude = value.longitude;
  const heading = value.heading;
  const recordedAt = value.recordedAt;
  if (typeof latitude !== "number" || typeof longitude !== "number" || typeof heading !== "number" || typeof recordedAt !== "string") return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(heading)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude, heading: Math.max(0, Math.min(360, heading)), recordedAt };
}

export function normalizeDeliveryStatusEvent(input: unknown): DeliveryStatusEvent | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  const allowed = ["draft", "open", "pending_confirmation", "active", "completed", "disabled", "cancelled"] as const;
  if (typeof value.deliveryId !== "string" || !allowed.includes(value.status as typeof allowed[number])) return null;
  if (typeof value.title !== "string" || typeof value.body !== "string" || typeof value.occurredAt !== "string") return null;
  if (value.deliveryId.length > 96 || value.title.length > 120 || value.body.length > 300 || !Number.isFinite(new Date(value.occurredAt).getTime())) return null;
  return { deliveryId: value.deliveryId, status: value.status as DeliveryStatusEvent["status"], title: value.title, body: value.body, occurredAt: value.occurredAt };
}

export function deliveryChannelName(deliveryId: string) {
  const safeId = deliveryId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 96);
  return safeId ? `delivery:${safeId}` : null;
}

export function createDeliveryTrackingChannel(deliveryId: string, onPosition: RealtimeListener) {
  const supabase = supabaseClient();
  const name = deliveryChannelName(deliveryId);
  if (!supabase || !name) return null;
  const channel = supabase.channel(name, { config: { private: true } })
    .on("broadcast", { event: "position" }, ({ payload }) => {
      const position = normalizeDeliveryPosition(payload);
      if (position) onPosition(position);
    })
    .subscribe();
  return channel;
}

export function createDeliveryStatusChannel(deliveryId: string, onStatus: DeliveryStatusListener) {
  const supabase = supabaseClient();
  const name = deliveryChannelName(deliveryId);
  if (!supabase || !name) return null;
  return supabase.channel(name, { config: { private: true } })
    .on("broadcast", { event: "status" }, ({ payload }) => {
      const event = normalizeDeliveryStatusEvent(payload);
      if (event && event.deliveryId === deliveryId) onStatus(event);
    })
    .subscribe();
}

export async function broadcastDeliveryPosition(channel: RealtimeChannel | null, position: DeliveryPosition) {
  if (!channel) return;
  await channel.send({ type: "broadcast", event: "position", payload: position });
}

export async function closeDeliveryTrackingChannel(channel: RealtimeChannel | null) {
  if (!channel) return;
  await channel.unsubscribe();
}
