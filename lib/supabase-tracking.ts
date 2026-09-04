import { createClient } from "@supabase/supabase-js";
import type { RealtimeChannel, Session, SupabaseClient } from "@supabase/supabase-js";

export type DeliveryPosition = {
  latitude: number;
  longitude: number;
  heading: number;
  recordedAt: string;
};

type RealtimeListener = (position: DeliveryPosition) => void;
export type DeliveryStatusEvent = {
  deliveryId: string;
  status: "draft" | "open" | "pending_confirmation" | "active" | "completed" | "disabled" | "cancelled" | "expired";
  title: string;
  body: string;
  occurredAt: string;
};
type DeliveryStatusListener = (event: DeliveryStatusEvent) => void;

let client: SupabaseClient | null = null;

/**
 * Supabase Phone reste volontairement désactivé en développement. La simple
 * présence des clés Realtime ne doit jamais détourner le parcours OTP simulé.
 */
export function isSupabasePhoneAuthEnabled() {
  return process.env.EXPO_PUBLIC_ENABLE_SUPABASE_PHONE_AUTH === "true";
}

const supabaseSessionStorage = {
  async getItem(key: string) { if (typeof window !== "undefined") return window.sessionStorage?.getItem(key) ?? null; return (await import("expo-secure-store")).getItemAsync(key); },
  async setItem(key: string, value: string) { if (typeof window !== "undefined") window.sessionStorage?.setItem(key, value); else await (await import("expo-secure-store")).setItemAsync(key, value); },
  async removeItem(key: string) { if (typeof window !== "undefined") window.sessionStorage?.removeItem(key); else await (await import("expo-secure-store")).deleteItemAsync(key); },
};

export function supabaseClient() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  if (!client) client = createClient(url, key, { auth: { storage: supabaseSessionStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  return client;
}

export async function requestSupabasePhoneOtp(phone: string) {
  const supabase = supabaseClient();
  if (!supabase) throw new Error("Supabase Auth n’est pas configuré.");
  const { error } = await supabase.auth.signInWithOtp({ phone });
  if (error) throw new Error("Le code SMS Supabase n’a pas pu être envoyé.");
}

export async function verifySupabasePhoneOtp(phone: string, token: string): Promise<Session> {
  const supabase = supabaseClient();
  if (!supabase) throw new Error("Supabase Auth n’est pas configuré.");
  const { data, error } = await supabase.auth.verifyOtp({ phone, token, type: "sms" });
  if (error || !data.session) throw new Error("Le code SMS Supabase est invalide ou a expiré.");
  return data.session;
}

export async function clearSupabaseSession() { await supabaseClient()?.auth.signOut(); }

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
  const allowed = ["draft", "open", "pending_confirmation", "active", "completed", "disabled", "cancelled", "expired"] as const;
  if (typeof value.deliveryId !== "string" || !allowed.includes(value.status as typeof allowed[number])) return null;
  if (typeof value.title !== "string" || typeof value.body !== "string" || typeof value.occurredAt !== "string") return null;
  if (value.deliveryId.length > 96 || value.title.length > 120 || value.body.length > 300 || !Number.isFinite(new Date(value.occurredAt).getTime())) return null;
  return { deliveryId: value.deliveryId, status: value.status as DeliveryStatusEvent["status"], title: value.title, body: value.body, occurredAt: value.occurredAt };
}

export function deliveryChannelName(deliveryId: string) {
  const safeId = deliveryId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 96);
  return safeId ? `delivery:${safeId}` : null;
}

export async function broadcastDeliveryPosition(channel: RealtimeChannel | null, position: DeliveryPosition) {
  if (!channel) return;
  await channel.send({ type: "broadcast", event: "position", payload: position });
}

type DeliveryChannelEntry = {
  channel: RealtimeChannel;
  statusListeners: Set<DeliveryStatusListener>;
  positionListeners: Set<RealtimeListener>;
};

// Un seul channel Supabase par livraison, partagé entre tous les abonnés (statut ET position) : avant ce
// correctif, `createDeliveryStatusChannel` et `createDeliveryTrackingChannel` ouvraient chacun leur propre
// souscription sur le même topic `delivery:<id>` — deux connexions Realtime indépendantes pour la même
// livraison dès que l'écran de suivi live était ouvert en même temps que le fournisseur global.
const deliveryChannels = new Map<string, DeliveryChannelEntry>();

function getOrCreateDeliveryChannelEntry(deliveryId: string): DeliveryChannelEntry | null {
  const existing = deliveryChannels.get(deliveryId);
  if (existing) return existing;
  const supabase = supabaseClient();
  const name = deliveryChannelName(deliveryId);
  if (!supabase || !name) return null;
  const statusListeners = new Set<DeliveryStatusListener>();
  const positionListeners = new Set<RealtimeListener>();
  const channel = supabase.channel(name, { config: { private: true } })
    .on("broadcast", { event: "status" }, ({ payload }) => {
      const event = normalizeDeliveryStatusEvent(payload);
      if (event && event.deliveryId === deliveryId) statusListeners.forEach((listener) => listener(event));
    })
    .on("broadcast", { event: "position" }, ({ payload }) => {
      const position = normalizeDeliveryPosition(payload);
      if (position) positionListeners.forEach((listener) => listener(position));
    })
    .subscribe();
  const entry: DeliveryChannelEntry = { channel, statusListeners, positionListeners };
  deliveryChannels.set(deliveryId, entry);
  return entry;
}

/** S'abonne au statut et/ou à la position d'une livraison. Réutilise le channel existant si un autre
 *  consommateur y est déjà abonné ; ne ferme la souscription Realtime que lorsque plus personne n'écoute
 *  ce `deliveryId`. Retourne une fonction de désabonnement à appeler au démontage. */
export function subscribeToDeliveryChannel(deliveryId: string, handlers: { onStatus?: DeliveryStatusListener; onPosition?: RealtimeListener }): () => void {
  const entry = getOrCreateDeliveryChannelEntry(deliveryId);
  if (!entry) return () => {};
  if (handlers.onStatus) entry.statusListeners.add(handlers.onStatus);
  if (handlers.onPosition) entry.positionListeners.add(handlers.onPosition);
  return () => {
    if (handlers.onStatus) entry.statusListeners.delete(handlers.onStatus);
    if (handlers.onPosition) entry.positionListeners.delete(handlers.onPosition);
    if (entry.statusListeners.size === 0 && entry.positionListeners.size === 0) {
      deliveryChannels.delete(deliveryId);
      void entry.channel.unsubscribe();
    }
  };
}
