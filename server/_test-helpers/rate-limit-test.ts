type PerPhoneCounter = { count: number; windowStart: number; blockedUntil: number };
const perPhoneBuckets = new Map<string, PerPhoneCounter>();
const PER_PHONE_WINDOW_MS = 10 * 60_000;
const PER_PHONE_MAX = 5;
const PER_PHONE_BLOCK_MS = 30 * 60_000;

export function enforcePerPhoneRateLimit(scope: string, phone: string) {
  const key = `${scope}:${phone}`;
  const now = Date.now();
  const entry = perPhoneBuckets.get(key);
  if (entry?.blockedUntil && entry.blockedUntil > now) {
    const minutes = Math.ceil((entry.blockedUntil - now) / 60_000);
    throw new Error(`Trop de tentatives pour ce numéro. Réessayez dans ${minutes} minute(s).`);
  }
  if (!entry || now - entry.windowStart > PER_PHONE_WINDOW_MS) {
    perPhoneBuckets.set(key, { count: 1, windowStart: now, blockedUntil: 0 });
    return;
  }
  entry.count += 1;
  if (entry.count > PER_PHONE_MAX) {
    entry.blockedUntil = now + PER_PHONE_BLOCK_MS;
    const minutes = Math.ceil(PER_PHONE_BLOCK_MS / 60_000);
    throw new Error(`Trop de tentatives pour ce numéro. Réessayez dans ${minutes} minute(s).`);
  }
}

export function _resetForTests() {
  perPhoneBuckets.clear();
}
