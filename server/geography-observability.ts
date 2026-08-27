export type GeographicOperation = "search" | "resolve" | "reverse" | "forward" | "route";
export type GeographicOutcome = "success" | "failure" | "cache_hit" | "rate_limited";

type Metric = { calls: number; failures: number; cacheHits: number; totalDurationMs: number };
const metrics = new Map<GeographicOperation, Metric>();

function metricFor(operation: GeographicOperation) {
  const current = metrics.get(operation) ?? { calls: 0, failures: 0, cacheHits: 0, totalDurationMs: 0 };
  metrics.set(operation, current);
  return current;
}

/** Métriques mémoire non sensibles, remises à zéro au redémarrage du serveur. */
export function recordGeographicMetric(operation: GeographicOperation, outcome: GeographicOutcome, durationMs = 0) {
  const metric = metricFor(operation);
  metric.calls += 1;
  metric.totalDurationMs += Math.max(0, durationMs);
  if (outcome === "failure") metric.failures += 1;
  if (outcome === "cache_hit") metric.cacheHits += 1;
}

export function geographicMetricsSnapshot() {
  return Object.fromEntries([...metrics.entries()].map(([operation, metric]) => [operation, {
    calls: metric.calls,
    failures: metric.failures,
    cacheHits: metric.cacheHits,
    averageDurationMs: metric.calls ? Math.round(metric.totalDurationMs / metric.calls) : 0,
  }]));
}

export function resetGeographicMetricsForTests() {
  metrics.clear();
}
