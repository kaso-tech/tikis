export function computeDaysRemaining(scheduledAt: string | undefined, now: number = Date.now()): number {
  if (!scheduledAt) return 0;
  const target = new Date(scheduledAt).getTime();
  if (Number.isNaN(target)) return 0;
  const diff = target - now;
  if (diff <= 0) return 0;
  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}
