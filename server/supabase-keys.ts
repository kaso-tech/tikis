/**
 * Clés d'API Supabase : deux formats coexistent.
 *  - Historiques (« Legacy API keys » : anon, service_role) : des JWT. Envoyées dans `apikey` ET dans
 *    `Authorization: Bearer`, comme Supabase l'a toujours demandé.
 *  - Nouvelles (`sb_publishable_…`, `sb_secret_…`) : pas des JWT. Seulement dans `apikey` — Supabase les
 *    convertit lui-même en accès du bon rôle ; `Authorization` est réservé aux jetons de session des
 *    utilisateurs, et une clé `sb_…` y serait refusée.
 */
export function isLegacyJwtKey(key: string) {
  return key.split(".").length === 3;
}

/** En-têtes d'un appel serveur à Supabase avec la clé de service, quel que soit son format. */
export function supabaseKeyHeaders(key: string, extra: Record<string, string> = {}): Record<string, string> {
  return { apikey: key, ...(isLegacyJwtKey(key) ? { Authorization: `Bearer ${key}` } : {}), ...extra };
}
