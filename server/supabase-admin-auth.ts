/**
 * Établit une session Supabase Auth pour un profil Tikis authentifié par son propre système —
 * OTP de simulation compris — afin que les canaux Realtime privés (server/supabase-realtime.ts,
 * supabase/realtime_auth_phone_rls.sql) s'authentifient pour tout le monde, pas seulement les
 * profils passés par Supabase Phone Auth (profiles.lookupSupabase/registerSupabase).
 *
 * Sans ça, `auth.uid()` valait toujours NULL côté RLS pour le parcours par défaut de
 * l'application : l'abonnement Realtime échouait silencieusement à s'authentifier, et
 * l'application retombait entièrement sur le polling sans que rien ne le signale.
 *
 * Principe : l'API Admin Supabase n'offre pas de « générer une session pour ce numéro » directe
 * (contrairement à `generateLink`, réservé à l'email). On obtient une session par le chemin
 * officiellement supporté le plus proche : créer/retrouver l'utilisateur, lui poser un mot de
 * passe aléatoire à usage unique (jamais stocké, remplacé à chaque appel), puis se connecter avec
 * ce mot de passe via l'endpoint public `grant_type=password`. Aucune clé supplémentaire à
 * configurer : SUPABASE_SERVICE_ROLE_KEY (déjà utilisée ailleurs) pour créer/mettre à jour
 * l'utilisateur, EXPO_PUBLIC_SUPABASE_ANON_KEY (déjà publique) pour l'échange de session.
 *
 * Best-effort partout : un échec à n'importe quelle étape ne doit jamais bloquer la connexion
 * Tikis elle-même, qui ne dépend en rien de Supabase. Le client retombe sur le polling existant,
 * et retentera au prochain appel.
 */
import { randomBytes } from "node:crypto";
import * as db from "./db";

export type SupabaseRealtimeSession = { accessToken: string; refreshToken: string };

function supabaseConfig() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) return null;
  return { base: url.replace(/\/$/, ""), anonKey, serviceKey };
}

async function createSupabaseUser(base: string, serviceKey: string, phone: string): Promise<string | null> {
  const response = await fetch(`${base}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ phone, phone_confirm: true }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) return null;
  const created = await response.json() as { id?: unknown };
  return typeof created.id === "string" ? created.id : null;
}

async function setSupabasePassword(base: string, serviceKey: string, userId: string, password: string): Promise<boolean> {
  const response = await fetch(`${base}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "PUT",
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
    signal: AbortSignal.timeout(5_000),
  });
  return response.ok;
}

async function signInWithPassword(base: string, anonKey: string, phone: string, password: string): Promise<SupabaseRealtimeSession | null> {
  const response = await fetch(`${base}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ phone, password }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) return null;
  const session = await response.json() as { access_token?: unknown; refresh_token?: unknown };
  if (typeof session.access_token !== "string" || typeof session.refresh_token !== "string") return null;
  return { accessToken: session.access_token, refreshToken: session.refresh_token };
}

export async function ensureSupabaseRealtimeSession(phone: string): Promise<SupabaseRealtimeSession | null> {
  const config = supabaseConfig();
  if (!config) return null;
  const { base, anonKey, serviceKey } = config;
  try {
    const profile = await db.getTikisProfileByPhone(phone);
    if (!profile) return null;

    let userId = profile.supabaseUserId ?? null;
    if (!userId) {
      userId = await createSupabaseUser(base, serviceKey, phone);
      // Le numéro a déjà un utilisateur Supabase non lié à ce profil (créé par une tentative
      // précédente restée incomplète, par exemple) : sans point d'accès admin pour le retrouver
      // par numéro, on abandonne proprement plutôt que de risquer un état incohérent.
      if (!userId) return null;
      await db.linkTikisProfileToSupabaseUser(phone, userId);
    }

    const password = randomBytes(32).toString("hex");
    const passwordSet = await setSupabasePassword(base, serviceKey, userId, password);
    if (!passwordSet) return null;

    return await signInWithPassword(base, anonKey, phone, password);
  } catch (cause) {
    console.error("[supabase-admin-auth] session non établie", cause);
    return null;
  }
}
