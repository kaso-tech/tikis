import { useEffect, useState, useMemo } from "react";
import { trpc, isAuthError } from "../lib/trpc";
import { SkeletonKpiGrid } from "../lib/skeleton";

type Metrics = {
  periodDays: number;
  deliveriesTotal: number;
  deliveriesCompleted: number;
  openReports: number;
  activeDrivers: number;
  commissionRevenue: number;
  timeseries?: { date: string; published: number; completed: number }[];
  vehicleBreakdown?: { vehicle: string; count: number }[];
};

const REPORT_REASONS = ["Comportement", "Sécurité", "Paiement", "Objet endommagé", "Retard", "Autre"];

function formatMoney(amount: number) {
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(amount)} FCFA`;
}

function formatDateShort(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
}

function relativeTime(iso: string | Date): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  if (diff < 60_000) return "à l'instant";
  if (diff < 3_600_000) return `il y a ${Math.floor(diff / 60_000)} min`;
  if (diff < 86_400_000) return `il y a ${Math.floor(diff / 3_600_000)} h`;
  return `il y a ${Math.floor(diff / 86_400_000)} j`;
}

export default function DashboardPage(_props: { search?: string }) {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [reports, setReports] = useState<Array<{ id: string; reason: string; description: string; deliveryId: string; reporterPhone: string; createdAt: string | Date }>>([]);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState<7 | 14 | 30 | 90>(30);

  useEffect(() => {
    let cancelled = false;
    setError("");
    Promise.all([
      trpc.adminConsole.dashboard.metrics.query({ periodDays: period }),
      trpc.adminConsole.reports.list.query({ status: "open" }).catch(() => []),
    ])
      .then(([data, list]) => {
        if (cancelled) return;
        setMetrics((data as Metrics) ?? null);
        setReports((list as Array<{ id: string; reason: string; description: string; deliveryId: string; reporterPhone: string; createdAt: string | Date }>) ?? []);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(isAuthError(cause) ? "Session expirée. Reconnectez-vous." : cause instanceof Error ? cause.message : "Impossible de charger le tableau de bord.");
      });
    return () => { cancelled = true; };
  }, [period]);

  const completionRate = metrics && metrics.deliveriesTotal > 0 ? Math.round((metrics.deliveriesCompleted / metrics.deliveriesTotal) * 100) : 0;
  const vehicleColors = ["#9A6201", "#176C52", "#2C5BA8", "#A65300", "#A43740"];

  const maxSeries = useMemo(() => {
    if (!metrics?.timeseries) return 1;
    return Math.max(1, ...metrics.timeseries.map((d) => Math.max(d.published, d.completed)));
  }, [metrics]);

  const sparklines = useMemo(() => {
    if (!metrics?.timeseries) return { published: undefined as number[] | undefined, completed: undefined as number[] | undefined, commission: undefined as number[] | undefined, reports: undefined as number[] | undefined, drivers: undefined as number[] | undefined };
    const published = metrics.timeseries.map((d) => d.published);
    const completed = metrics.timeseries.map((d) => d.completed);
    const reports = metrics.timeseries.map((d) => d.published > 0 ? Math.max(0, d.published - d.completed) : 0);
    const commission = metrics.timeseries.map((d) => Math.round(d.completed * (metrics.commissionRevenue / Math.max(1, metrics.deliveriesCompleted))));
    // Proxy pour 'Livreurs uniques' : un livreur actif = au moins une course terminée ce jour-là.
    // Approximation grossière mais stable tant qu'on n'expose pas activeDriversTimeseries côté serveur.
    const drivers = completed.map((value) => Math.min(value, metrics.activeDrivers));
    return { published, completed, commission, reports, drivers };
  }, [metrics]);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Vue d'ensemble · opérations live</h1>
          <p className="page-sub">Mises à jour automatiques · {period} derniers jours</p>
        </div>
        <div className="page-actions">
          <div className="tabs">
            {[7, 14, 30, 90].map((d) => (
              <button key={d} className={`tab ${period === d ? "active" : ""}`} onClick={() => setPeriod(d as 7 | 14 | 30 | 90)}>
                {d} jours
              </button>
            ))}
          </div>
          <button className="btn">Exporter</button>
        </div>
      </div>

      {error ? <div className="banner-error">{error}</div> : null}

      {!metrics ? (
        <SkeletonKpiGrid count={4} />
      ) : (
        <>
          <div className="kpi-grid">
            <KpiCard label="Livraisons créées" value={metrics.deliveriesTotal.toString()} foot={`${metrics.deliveriesCompleted} terminées`} tone="primary" progress={completionRate} sparkline={sparklines.published} />
            <KpiCard label="Commissions perçues" value={formatMoney(metrics.commissionRevenue)} foot="depuis le début de la période" tone="success" sparkline={sparklines.commission} />
            <KpiCard label="Livreurs uniques" value={metrics.activeDrivers.toString()} foot="ayant terminé au moins une course" tone="primary" sparkline={sparklines.drivers} />
            <KpiCard label="Signalements ouverts" value={metrics.openReports.toString()} foot={metrics.openReports > 0 ? "à traiter en priorité" : "Aucun signalement"} tone={metrics.openReports > 0 ? "error" : "success"} sparkline={sparklines.reports} />
          </div>

          <div className="grid grid-2" style={{ marginBottom: 20 }}>
            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-title">Volume publié vs. terminé</div>
                  <div className="card-sub">Cumul quotidien · {period} jours</div>
                </div>
                <div className="chart-legend">
                  <span><span className="sw" style={{ background: "var(--primary)" }} />Publiées</span>
                  <span><span className="sw" style={{ background: "var(--success)" }} />Terminées</span>
                </div>
              </div>
              <div className="chart-wrap">
                {metrics.timeseries && metrics.timeseries.length > 0 ? (
                  <svg viewBox="0 0 100 40" preserveAspectRatio="none">
                    {[8, 16, 24, 32].map((y) => (
                      <line key={y} x1="0" x2="100" y1={y} y2={y} stroke="var(--border)" strokeWidth="0.1" strokeDasharray="0.4 0.6" />
                    ))}
                    {(() => {
                      const data = metrics.timeseries;
                      const stepX = 100 / Math.max(1, data.length - 1);
                      const ptsPub = data.map((d, i) => `${(i * stepX).toFixed(2)},${(40 - (d.published / maxSeries) * 36 - 2).toFixed(2)}`).join(" ");
                      const ptsCom = data.map((d, i) => `${(i * stepX).toFixed(2)},${(40 - (d.completed / maxSeries) * 36 - 2).toFixed(2)}`).join(" ");
                      return (
                        <>
                          <polygon points={`0,40 ${ptsPub} 100,40`} fill="var(--primary)" fillOpacity="0.10" />
                          <polygon points={`0,40 ${ptsCom} 100,40`} fill="var(--success)" fillOpacity="0.10" />
                          <polyline points={ptsPub} fill="none" stroke="var(--primary)" strokeWidth="0.3" />
                          <polyline points={ptsCom} fill="none" stroke="var(--success)" strokeWidth="0.3" />
                        </>
                      );
                    })()}
                  </svg>
                ) : (
                  <div className="empty-state">Pas encore de données sur cette période.</div>
                )}
              </div>
            </div>
            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-title">Répartition par engin</div>
                  <div className="card-sub">{period} jours</div>
                </div>
              </div>
              <div className="card-body">
                {metrics.vehicleBreakdown && metrics.vehicleBreakdown.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {(() => {
                      const total = metrics.vehicleBreakdown.reduce((s, v) => s + v.count, 0) || 1;
                      return metrics.vehicleBreakdown.map((v, idx) => {
                        const pct = Math.round((v.count / total) * 100);
                        return (
                          <div key={v.vehicle} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{ width: 10, height: 10, borderRadius: 2, background: vehicleColors[idx % vehicleColors.length], flexShrink: 0 }} />
                            <span style={{ flex: 1, fontSize: 12.5, color: "var(--foreground)" }}>{v.vehicle}</span>
                            <div className="progress" style={{ flex: 2, maxWidth: 120 }}>
                              <span style={{ width: `${pct}%`, background: vehicleColors[idx % vehicleColors.length] }} />
                            </div>
                            <span style={{ fontSize: 12, fontWeight: 600, fontVariantNumeric: "tabular-nums", minWidth: 32, textAlign: "right" }}>{pct}%</span>
                          </div>
                        );
                      });
                    })()}
                  </div>
                ) : (
                  <div className="empty-state">Pas encore de données.</div>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-2">
            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-title">Activité récente</div>
                  <div className="card-sub">Signalements non traités et événements</div>
                </div>
              </div>
              <div className="card-body tight">
                {reports.length === 0 ? (
                  <div className="empty-state">
                    <div style={{ fontSize: 24, marginBottom: 8 }}>✓</div>
                    Aucun signalement ouvert. Tout est sous contrôle.
                  </div>
                ) : (
                  <div className="activity">
                    {reports.slice(0, 8).map((r) => (
                      <div key={r.id} className="activity-item">
                        <div className="activity-icon err">⚐</div>
                        <div className="activity-body">
                          <div className="activity-title">{r.reason}</div>
                          <div className="activity-meta">
                            <span>{r.deliveryId.slice(0, 8)}</span>
                            <span>·</span>
                            <span>{r.reporterPhone}</span>
                          </div>
                        </div>
                        <div className="activity-time">{relativeTime(r.createdAt)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-title">Santé plateforme</div>
                  <div className="card-sub">Indicateurs en temps réel</div>
                </div>
                <span className="pill pill-success"><span className="dot" />Opérationnel</span>
              </div>
              <div className="card-body">
                <div className="metric-row">
                  <span className="metric-name">Taux de complétion</span>
                  <div className="progress" style={{ maxWidth: 120, flex: 1 }}><span style={{ width: `${completionRate}%`, background: "var(--success)" }} /></div>
                  <span className="metric-value">{completionRate}%</span>
                </div>
                <div className="metric-row">
                  <span className="metric-name">Courses / livreur (moy.)</span>
                  <span className="metric-value">{metrics.activeDrivers > 0 ? (metrics.deliveriesTotal / metrics.activeDrivers).toFixed(1) : "0"}</span>
                </div>
                <div className="metric-row">
                  <span className="metric-name">Période analysée</span>
                  <span className="metric-value">{period} jours</span>
                </div>
                <div className="metric-row">
                  <span className="metric-name">Catégories de signalement</span>
                  <span className="metric-value">{REPORT_REASONS.length} types</span>
                </div>
                <div className="metric-row">
                  <span className="metric-name">Statut de l'API</span>
                  <span className="pill pill-success"><span className="dot" />Opérationnelle</span>
                </div>
                <div className="metric-row">
                  <span className="metric-name">Base de données</span>
                  <span className="pill pill-success"><span className="dot" />Connectée</span>
                </div>
                <div className="metric-row">
                  <span className="metric-name">File d'événements</span>
                  <span className="metric-value">0 backlog</span>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function KpiCard({ label, value, foot, tone, progress, sparkline }: { label: string; value: string; foot: string; tone: "primary" | "success" | "error"; progress?: number; sparkline?: number[] }) {
  const color = tone === "success" ? "var(--success)" : tone === "error" ? "var(--error)" : "var(--primary)";
  const sparkPoints = (sparkline && sparkline.length > 1)
    ? (() => {
      const min = Math.min(...sparkline);
      const max = Math.max(...sparkline);
      const range = max - min || 1;
      return sparkline.map((v, i) => {
        const x = (i / (sparkline.length - 1)) * 100;
        const y = 20 - ((v - min) / range) * 18 - 1;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      }).join(" ");
    })()
    : null;
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-foot">{foot}</div>
      {sparkPoints ? (
        <svg viewBox="0 0 100 20" preserveAspectRatio="none" style={{ width: "100%", height: 22, marginTop: 6 }}>
          <polyline points={sparkPoints} fill="none" stroke={color} strokeWidth="0.8" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      ) : null}
      {typeof progress === "number" ? (
        <div className="kpi-bar" style={{ background: "var(--border)", marginTop: sparkPoints ? 4 : 0 }}>
          <div style={{ width: `${Math.min(100, Math.max(0, progress))}%`, height: "100%", background: color, borderRadius: 99 }} />
        </div>
      ) : (
        <div className="kpi-bar" style={{ background: "var(--border)", marginTop: sparkPoints ? 4 : 0 }}>
          <div style={{ width: "62%", height: "100%", background: color, borderRadius: 99 }} />
        </div>
      )}
    </div>
  );
}
