const EXPO_TOKEN_PATTERN = /^ExponentPushToken\[[A-Za-z0-9_-]+\]$/;
const LEGACY_TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,200}$/;

export function isValidExpoPushTokenShape(token: string): boolean {
  if (typeof token !== "string" || token.length < 20 || token.length > 200) return false;
  return EXPO_TOKEN_PATTERN.test(token) || LEGACY_TOKEN_PATTERN.test(token);
}
