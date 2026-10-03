/** Adresse publique stable de l’API Tikisse. Elle protège Expo Go lorsqu’une variable de build n’est pas injectée. */
export const TIKISSE_PRODUCTION_API_URL = "https://api.tikisse.com";

export type WebLocationLike = {
  hostname: string;
  port: string;
  protocol: string;
};

function normalizedBaseUrl(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.replace(/\/$/, "") : "";
}

/**
 * Résout l’API de manière déterministe :
 * - l’URL injectée au build est prioritaire ;
 * - Expo Web local (Metro 8081) conserve son serveur local ;
 * - iOS/Android, Expo Go et le web publié retombent sur Render.
 */
export function resolveApiBaseUrl(
  configuredBaseUrl: string | undefined,
  platform: string,
  webLocation?: WebLocationLike,
): string {
  const configured = normalizedBaseUrl(configuredBaseUrl);
  if (configured) return configured;
  if (platform === "web" && webLocation?.port === "8081") {
    return `${webLocation.protocol}//${webLocation.hostname}:3000`;
  }
  return TIKISSE_PRODUCTION_API_URL;
}
