import { getTikisProfileByPhone } from "../db";

/**
 * Profils relus au plus toutes les 10 s par instance : une décision de l'administration (suspension,
 * bannissement, déconnexion forcée) prend effet en 10 s au plus, immédiatement sur l'instance qui l'a
 * prise (`invalidateTikisProfileCache`).
 */
const PROFILE_CACHE_TTL_MS = 10_000;
const PROFILE_CACHE_MAX_ENTRIES = 5_000;
const profileCache = new Map<string, { profile: NonNullable<Awaited<ReturnType<typeof getTikisProfileByPhone>>>; expiresAt: number }>();

export async function getCachedTikisProfile(phone: string) {
  const cached = profileCache.get(phone);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.profile;
  const fresh = await getTikisProfileByPhone(phone);
  if (!fresh) {
    profileCache.delete(phone);
    return undefined;
  }
  if (profileCache.size >= PROFILE_CACHE_MAX_ENTRIES) {
    const firstKey = profileCache.keys().next().value;
    if (firstKey) profileCache.delete(firstKey);
  }
  profileCache.set(phone, { profile: fresh, expiresAt: now + PROFILE_CACHE_TTL_MS });
  return fresh;
}

export function invalidateTikisProfileCache(phone?: string) {
  if (phone) profileCache.delete(phone);
  else profileCache.clear();
}
