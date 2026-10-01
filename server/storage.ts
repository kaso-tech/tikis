/**
 * Stockage des fichiers : Supabase Storage, un seul bucket privé.
 *
 * Le serveur seul y accède, avec la clé `service_role` (jamais envoyée à l'application). Rien n'est public :
 *  - photos de profil : servies par la route `/api/files/*` (server/_core/storageProxy.ts), qui redirige vers
 *    un lien signé de courte durée ;
 *  - pièces d'identité KYC et pièces jointes de signalement : jamais par cette route (`isPrivateStorageKey`),
 *    seulement par la route admin authentifiée (server/admin-documents.ts), qui lit le fichier côté serveur.
 *
 * API REST de Supabase Storage appelée directement (pas de SDK) : quatre opérations, toutes côté serveur.
 */

const DEFAULT_BUCKET = "tikisse-files";
/** Durée de validité d'un lien signé servi au navigateur ou à l'application. */
export const SIGNED_URL_TTL_SECONDS = 300;
const REQUEST_TIMEOUT_MS = 15_000;

/** Seules des images sont déposées (photos de profil, pièces d'identité, pièces jointes de signalement). */
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE_BYTES = 8 * 1024 * 1024;

type StorageConfig = { baseUrl: string; serviceKey: string; bucket: string };

function storageConfig(): StorageConfig {
  const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Stockage non configuré : définissez SUPABASE_URL (ou EXPO_PUBLIC_SUPABASE_URL) et SUPABASE_SERVICE_ROLE_KEY.");
  }
  return { baseUrl: `${url.replace(/\/+$/, "")}/storage/v1`, serviceKey, bucket: process.env.SUPABASE_STORAGE_BUCKET || DEFAULT_BUCKET };
}

function headers(config: StorageConfig, extra: Record<string, string> = {}) {
  return { Authorization: `Bearer ${config.serviceKey}`, apikey: config.serviceKey, ...extra };
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/\\/g, "/").split("/").filter((segment) => segment !== "" && segment !== ".").join("/");
}

/** Chaque segment encodé : un « ? » ou un « # » dans un nom de fichier ne casse pas l'URL. */
function objectPath(key: string) {
  return key.split("/").map(encodeURIComponent).join("/");
}

function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

async function failure(response: Response, action: string) {
  const detail = (await response.text().catch(() => "")).slice(0, 200);
  return new Error(`Stockage : ${action} impossible (${response.status})${detail ? ` — ${detail}` : ""}`);
}

/** Adresse sous laquelle le serveur sert un fichier non privé (photo de profil). */
export function publicFileUrl(key: string) {
  return `/api/files/${objectPath(normalizeKey(key))}`;
}

let bucketReady: Promise<void> | null = null;

/** Crée le bucket privé au premier dépôt s'il n'existe pas encore. */
function ensureBucket(config: StorageConfig) {
  bucketReady ??= (async () => {
    const existing = await fetch(`${config.baseUrl}/bucket/${encodeURIComponent(config.bucket)}`, { headers: headers(config), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (existing.ok) {
      const bucket = (await existing.json()) as { public?: boolean };
      if (bucket.public) throw new Error(`Stockage : le bucket « ${config.bucket} » est public. Rendez-le privé dans Supabase avant tout dépôt.`);
      return;
    }
    const created = await fetch(`${config.baseUrl}/bucket`, {
      method: "POST",
      headers: headers(config, { "Content-Type": "application/json" }),
      body: JSON.stringify({ id: config.bucket, name: config.bucket, public: false, file_size_limit: MAX_FILE_BYTES, allowed_mime_types: ALLOWED_MIME_TYPES }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    // Deux serveurs qui démarrent ensemble : l'un crée, l'autre reçoit « existe déjà ».
    if (!created.ok && created.status !== 409 && !/already exists/i.test(await created.clone().text().catch(() => ""))) {
      throw await failure(created, "création du bucket");
    }
  })().catch((cause) => {
    bucketReady = null;
    throw cause;
  });
  return bucketReady;
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  const config = storageConfig();
  await ensureBucket(config);
  const key = appendHashSuffix(normalizeKey(relKey));
  const body = typeof data === "string" ? Buffer.from(data) : Buffer.from(data);
  const response = await fetch(`${config.baseUrl}/object/${encodeURIComponent(config.bucket)}/${objectPath(key)}`, {
    method: "POST",
    headers: headers(config, { "Content-Type": contentType, "x-upsert": "false", "cache-control": "3600" }),
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw await failure(response, "dépôt");
  return { key, url: publicFileUrl(key) };
}

/** Lien signé, valable `expiresIn` secondes. Ne jamais le donner pour une clé privée hors de la route admin. */
export async function storageGetSignedUrl(relKey: string, expiresIn = SIGNED_URL_TTL_SECONDS): Promise<string> {
  const config = storageConfig();
  const key = normalizeKey(relKey);
  const response = await fetch(`${config.baseUrl}/object/sign/${encodeURIComponent(config.bucket)}/${objectPath(key)}`, {
    method: "POST",
    headers: headers(config, { "Content-Type": "application/json" }),
    body: JSON.stringify({ expiresIn }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw await failure(response, "signature d’un lien");
  const { signedURL } = (await response.json()) as { signedURL?: string };
  if (!signedURL) throw new Error("Stockage : lien signé vide.");
  return `${config.baseUrl}${signedURL.startsWith("/") ? "" : "/"}${signedURL}`;
}

/**
 * Préfixes des fichiers qui ne doivent jamais être servis par la route publique `/api/files/*` :
 * pièces d'identité et selfies KYC, pièces jointes des signalements. Ils ne sortent que par la route
 * admin authentifiée (server/admin-documents.ts), qui retrouve la clé en base au lieu de la lire dans l'URL.
 */
// Renommage Tikis → Tikisse : les fichiers déjà déposés sous l'ancien préfixe (avant ce déploiement)
// restent protégés indéfiniment — ils ne sont jamais renommés dans le stockage lui-même (voir la note de
// migration). Les nouveaux dépôts utilisent le nouveau préfixe (server/routers.ts).
export const PRIVATE_STORAGE_PREFIXES = ["tikisse-kyc/", "tikisse-reports/", "tikis-kyc/", "tikis-reports/"] as const;

/**
 * Faut-il refuser cette clé à la route publique ? Normalise d'abord comme le ferait le stockage (barres initiales,
 * segments « . », barres doublées) : « //tikisse-kyc/… » ou « ./tikisse-kyc/… » ne doivent pas passer. Toute
 * remontée « .. » est refusée d'office.
 */
export function isPrivateStorageKey(rawKey: string): boolean {
  const segments = rawKey.replace(/\\/g, "/").split("/");
  if (segments.includes("..")) return true;
  const normalized = segments.filter((segment) => segment !== "" && segment !== ".").join("/").toLowerCase();
  return PRIVATE_STORAGE_PREFIXES.some((prefix) => normalized.startsWith(prefix) || normalized === prefix.slice(0, -1));
}

/** Lit un fichier du stockage côté serveur : rien ne quitte le serveur hormis le contenu. */
export async function storageReadObject(relKey: string): Promise<{ body: Buffer; contentType: string }> {
  const config = storageConfig();
  const response = await fetch(`${config.baseUrl}/object/${encodeURIComponent(config.bucket)}/${objectPath(normalizeKey(relKey))}`, {
    headers: headers(config),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw await failure(response, "lecture");
  return { body: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get("content-type") ?? "application/octet-stream" };
}

/**
 * Supprime un fichier (suppression de compte). Contrairement à l'ancien stockage, qui ne savait que réécrire
 * un fichier vide, Supabase Storage supprime vraiment l'objet. Un fichier déjà absent n'est pas une erreur.
 */
export async function storageErase(relKey: string): Promise<void> {
  const config = storageConfig();
  const response = await fetch(`${config.baseUrl}/object/${encodeURIComponent(config.bucket)}`, {
    method: "DELETE",
    headers: headers(config, { "Content-Type": "application/json" }),
    body: JSON.stringify({ prefixes: [normalizeKey(relKey)] }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok && response.status !== 404) throw await failure(response, "suppression");
}

/** Pour les tests : oublie l'état « bucket vérifié ». */
export function resetStorageStateForTests() {
  bucketReady = null;
}
