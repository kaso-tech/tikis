import { MaterialIcons } from "@expo/vector-icons";
import { Stack } from "expo-router";
import { useMemo } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useThemeColors } from "@/lib/use-theme-colors";
import { trpc } from "@/lib/trpc";
import { formatMoney } from "@/shared/tikis-domain";

export default function AdminOverview() {
  const { colors: theme, isDark } = useThemeColors();
  const overviewQuery = trpc.adminConsole.overview.useQuery({ rangeDays: 30 }, { refetchInterval: 15_000 });
  const healthQuery = trpc.adminConsole.health.useQuery(undefined, { refetchInterval: 30_000 });

  if (overviewQuery.isLoading) {
    return (
      <View style={[styles.loadingRoot, { backgroundColor: theme.background }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color={theme.primary} />
        <Text style={[styles.loadingText, { color: theme.muted }]}>Chargement de la console…</Text>
      </View>
    );
  }

  if (overviewQuery.error) {
    return (
      <View style={[styles.loadingRoot, { backgroundColor: theme.background }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <MaterialIcons name="cloud-off" size={36} color={theme.error} />
        <Text style={[styles.loadingText, { color: theme.error }]}>La console n'a pas pu charger les données.</Text>
        <Pressable onPress={() => overviewQuery.refetch()} style={[styles.retryBtn, { backgroundColor: theme.primary }]}>
          <Text style={styles.retryBtnText}>Réessayer</Text>
        </Pressable>
      </View>
    );
  }

  const data = overviewQuery.data!;
  const kpis = data.kpis;
  const health = healthQuery.data;
  const maxPublished = Math.max(1, ...data.timeseries.map((d) => d.published));
  const maxCompleted = Math.max(1, ...data.timeseries.map((d) => d.completed));

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: theme.foreground }]}>Vue d'ensemble · opérations live</Text>
            <Text style={[styles.sub, { color: theme.muted }]}>
              Mises à jour automatiques · dernière synchro il y a quelques secondes
            </Text>
          </View>
          <RangeTabs />
        </View>

        <View style={styles.kpiGrid}>
          <KpiCard label="Courses actives" value={String(kpis.activeCount)} unit="livraisons" delta={kpis.deltaPct} theme={theme} />
          <KpiCard label="Commission collectée" value={formatMoney(kpis.totalCommission)} delta={8} theme={theme} variant="success" />
          <KpiCard label="Délai moyen" value={`${kpis.avgCompletionMinutes}`} unit="min" delta={-4} theme={theme} variant="success" />
          <KpiCard label="KYC en attente" value={String(kpis.kycPending)} delta={null} theme={theme} variant="warning" />
        </View>

        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={[styles.cardHead, { borderBottomColor: theme.border }]}>
            <View>
              <Text style={[styles.cardTitle, { color: theme.foreground }]}>Volume & performance</Text>
              <Text style={[styles.cardSub, { color: theme.muted }]}>Courses publiées vs. terminées · {data.rangeDays} jours</Text>
            </View>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <Legend color={theme.primary} label="Publiées" />
              <Legend color={theme.success} label="Terminées" />
            </View>
          </View>
          <View style={styles.chartWrap}>
            <ChartSvg
              data={data.timeseries}
              maxPrimary={maxPublished}
              maxSecondary={maxCompleted}
              primary={theme.primary}
              secondary={theme.success}
              isDark={isDark}
            />
          </View>
        </View>

        <View style={[styles.row2, { marginTop: 12 }]}>
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border, flex: 2 }]}>
            <View style={[styles.cardHead, { borderBottomColor: theme.border }]}>
              <View>
                <Text style={[styles.cardTitle, { color: theme.foreground }]}>Activité récente</Text>
                <Text style={[styles.cardSub, { color: theme.muted }]}>Flux consolidé des événements plateforme</Text>
              </View>
            </View>
            <View>
              {data.recentDisputes.length === 0 ? (
                <View style={{ padding: 24, alignItems: "center" }}>
                  <Text style={{ color: theme.muted, fontSize: 12.5 }}>Aucun événement récent.</Text>
                </View>
              ) : (
                data.recentDisputes.map((d) => (
                  <View key={d.id} style={[styles.activityRow, { borderBottomColor: theme.border }]}>
                    <View style={[styles.activityIcon, { backgroundColor: theme.warning + "22" }]}>
                      <MaterialIcons name="gavel" size={14} color={theme.warning} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.activityTitle, { color: theme.foreground }]} numberOfLines={1}>{d.reason}</Text>
                      <Text style={[styles.activityMeta, { color: theme.muted }]} numberOfLines={1}>
                        {d.deliveryId} · {d.openedByPhone}
                      </Text>
                    </View>
                    <Text style={[styles.activityTime, { color: theme.muted }]}>{relativeTime(d.createdAt)}</Text>
                  </View>
                ))
              )}
            </View>
          </View>

          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border, flex: 1 }]}>
            <View style={[styles.cardHead, { borderBottomColor: theme.border }]}>
              <View>
                <Text style={[styles.cardTitle, { color: theme.foreground }]}>Répartition par engin</Text>
                <Text style={[styles.cardSub, { color: theme.muted }]}>{data.rangeDays} jours</Text>
              </View>
            </View>
            <View style={{ padding: 16, gap: 8 }}>
              {data.vehicleBreakdown.length === 0 ? (
                <Text style={{ color: theme.muted, fontSize: 12.5, textAlign: "center", padding: 16 }}>Pas encore de données.</Text>
              ) : (
                data.vehicleBreakdown.map((v, idx) => {
                  const total = data.vehicleBreakdown.reduce((s, x) => s + x.count, 0) || 1;
                  const pct = Math.round((v.count / total) * 100);
                  const colors = [theme.primary, theme.success, "#2C5BA8", theme.warning, theme.error];
                  return (
                    <View key={v.vehicle} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                      <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: colors[idx % colors.length] }} />
                      <Text style={{ flex: 1, fontSize: 12, color: theme.foreground }}>{v.vehicle}</Text>
                      <Text style={{ fontSize: 12, fontWeight: "600", color: theme.foreground }}>{pct}%</Text>
                    </View>
                  );
                })
              )}
            </View>
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border, marginTop: 12 }]}>
          <View style={[styles.cardHead, { borderBottomColor: theme.border }]}>
            <View>
              <Text style={[styles.cardTitle, { color: theme.foreground }]}>Santé plateforme</Text>
              <Text style={[styles.cardSub, { color: theme.muted }]}>Métriques en temps réel</Text>
            </View>
            <View style={[styles.statusPill, { backgroundColor: theme.success + "1F" }]}>
              <View style={[styles.statusDot, { backgroundColor: theme.success }]} />
              <Text style={[styles.statusPillText, { color: theme.success }]}>Opérationnel</Text>
            </View>
          </View>
          <View style={{ padding: 16, gap: 0 }}>
            <MetricRow label="Latence API (p95)" value={health ? `${health.apiLatencyMsP95} ms` : "—"} theme={theme} />
            <MetricRow label="Taux d'erreur" value={health ? `${(health.errorRateBp / 100).toFixed(2)} %` : "—"} theme={theme} />
            <MetricRow label="Taux d'acceptation candidats" value={health ? `${(health.acceptanceRateBp / 100).toFixed(0)} %` : "—"} theme={theme} progress={(health?.acceptanceRateBp ?? 8200) / 100} tone={theme.success} />
            <MetricRow label="Annonces annulées par expéditeur" value={health ? `${(health.cancellationRateBp / 100).toFixed(0)} %` : "—"} theme={theme} progress={(health?.cancellationRateBp ?? 1400) / 100} tone={theme.warning} />
            <MetricRow label="Litiges ouverts" value={`${health?.openDisputes ?? 0}`} theme={theme} />
            <MetricRow label="NPS livreurs (7 j)" value={health ? `+${health.npsDriver}` : "—"} theme={theme} />
            <MetricRow label="NPS expéditeurs (7 j)" value={health ? `+${health.npsSender}` : "—"} theme={theme} />
            <MetricRow label="File d'événements" value={`${health?.eventBacklog ?? 0} backlog`} theme={theme} last />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function RangeTabs() {
  const { colors: theme } = useThemeColors();
  return (
    <View style={[styles.tabs, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      {["Aujourd'hui", "7 jours", "30 jours", "Personnalisé"].map((t, i) => (
        <View key={t} style={[styles.tab, i === 2 && { backgroundColor: theme.background }]}>
          <Text style={[styles.tabText, { color: i === 2 ? theme.foreground : theme.muted }]}>{t}</Text>
        </View>
      ))}
    </View>
  );
}

function KpiCard({ label, value, unit, delta, theme, variant }: { label: string; value: string; unit?: string; delta: number | null; theme: any; variant?: "success" | "warning" }) {
  const tone = variant === "success" ? theme.success : variant === "warning" ? theme.warning : theme.primary;
  return (
    <View style={[styles.kpi, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Text style={[styles.kpiLabel, { color: theme.muted }]}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6, marginTop: 4 }}>
        <Text style={[styles.kpiValue, { color: theme.foreground }]}>{value}</Text>
        {unit ? <Text style={[styles.kpiUnit, { color: theme.muted }]}>{unit}</Text> : null}
      </View>
      {delta !== null ? (
        <View style={{ flexDirection: "row", gap: 6, marginTop: 6, alignItems: "center" }}>
          <Text style={{ fontSize: 11.5, fontWeight: "600", color: delta >= 0 ? theme.success : theme.error }}>{delta >= 0 ? "+" : ""}{delta}{typeof delta === "number" && Math.abs(delta) < 100 ? "%" : ""}</Text>
          <Text style={{ fontSize: 11.5, color: theme.muted }}>vs. période précédente</Text>
        </View>
      ) : null}
      <View style={[styles.kpiBar, { backgroundColor: tone + "1A" }]}>
        <View style={{ width: "62%", height: "100%", backgroundColor: tone, borderRadius: 99 }} />
      </View>
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  const { colors: theme } = useThemeColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: color }} />
      <Text style={{ fontSize: 11.5, color: theme.muted }}>{label}</Text>
    </View>
  );
}

function ChartSvg({ data, maxPrimary, maxSecondary, primary, secondary, isDark }: { data: { date: string; published: number; completed: number }[]; maxPrimary: number; maxSecondary: number; primary: string; secondary: string; isDark: boolean }) {
  const W = 100;
  const H = 40;
  const stepX = W / Math.max(1, data.length - 1);
  const pointsPub = data.map((d, i) => `${(i * stepX).toFixed(2)},${(H - (d.published / maxPrimary) * (H - 4) - 2).toFixed(2)}`).join(" ");
  const pointsCom = data.map((d, i) => `${(i * stepX).toFixed(2)},${(H - (d.completed / maxSecondary) * (H - 4) - 2).toFixed(2)}`).join(" ");
  const areaPub = `0,${H} ${pointsPub} ${W},${H}`;
  const areaCom = `0,${H} ${pointsCom} ${W},${H}`;
  if (Platform.OS !== "web") {
    return <Text style={{ color: "#999", fontSize: 12 }}>Graphique disponible sur le web.</Text>;
  }
  return (
    <View style={{ width: "100%", height: 200, alignItems: "stretch" }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: "100%" } as any}>
        {[8, 16, 24, 32].map((y) => (
          <line key={y} x1="0" x2={W} y1={y} y2={y} stroke={isDark ? "#333" : "#E3E3E3"} strokeWidth="0.1" strokeDasharray="0.5 1" />
        ))}
        <polygon points={areaPub} fill={primary} fillOpacity="0.10" />
        <polygon points={areaCom} fill={secondary} fillOpacity="0.10" />
        <polyline points={pointsPub} fill="none" stroke={primary} strokeWidth="0.2" />
        <polyline points={pointsCom} fill="none" stroke={secondary} strokeWidth="0.2" />
      </svg>
    </View>
  );
}

function MetricRow({ label, value, theme, progress, tone, last }: { label: string; value: string; theme: any; progress?: number; tone?: string; last?: boolean }) {
  return (
    <View style={[styles.metricRow, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border }]}>
      <Text style={[styles.metricLabel, { color: theme.muted }]}>{label}</Text>
      {typeof progress === "number" ? (
        <View style={[styles.progressBar, { backgroundColor: theme.border }]}>
          <View style={{ width: `${Math.min(100, progress)}%`, height: "100%", backgroundColor: tone ?? theme.primary, borderRadius: 99 }} />
        </View>
      ) : null}
      <Text style={[styles.metricValue, { color: theme.foreground }]}>{value}</Text>
    </View>
  );
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  if (diff < 60_000) return "à l'instant";
  if (diff < 3_600_000) return `il y a ${Math.floor(diff / 60_000)} min`;
  if (diff < 86_400_000) return `il y a ${Math.floor(diff / 3_600_000)} h`;
  return `il y a ${Math.floor(diff / 86_400_000)} j`;
}

const styles = StyleSheet.create({
  loadingRoot: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  loadingText: { fontSize: 13 },
  retryBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, marginTop: 8 },
  retryBtnText: { color: "#FFFFFF", fontSize: 12.5, fontWeight: "600" },
  head: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 18, gap: 12, flexWrap: "wrap" },
  title: { fontSize: 20, fontWeight: "600", letterSpacing: -0.4 },
  sub: { fontSize: 12.5, marginTop: 4 },
  kpiGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 12 },
  kpi: { flexBasis: "23.5%", minWidth: 200, padding: 14, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth },
  kpiLabel: { fontSize: 11.5, fontWeight: "500", textTransform: "uppercase", letterSpacing: 0.5 },
  kpiValue: { fontSize: 22, fontWeight: "600", letterSpacing: -0.5 },
  kpiUnit: { fontSize: 12, fontWeight: "500" },
  kpiBar: { height: 6, borderRadius: 99, marginTop: 8, overflow: "hidden" },
  card: { borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  cardTitle: { fontSize: 13.5, fontWeight: "600" },
  cardSub: { fontSize: 11.5, marginTop: 1 },
  chartWrap: { padding: 16, height: 200 },
  row2: { flexDirection: "row", gap: 12, flexWrap: "wrap" },
  activityRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  activityIcon: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  activityTitle: { fontSize: 12.5, fontWeight: "500" },
  activityMeta: { fontSize: 11, marginTop: 1 },
  activityTime: { fontSize: 11, marginLeft: 8 },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusPillText: { fontSize: 11, fontWeight: "600" },
  metricRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  metricLabel: { fontSize: 12, flex: 1 },
  metricValue: { fontSize: 13, fontWeight: "600", fontVariant: ["tabular-nums"] },
  progressBar: { flex: 1, maxWidth: 120, height: 6, borderRadius: 99, overflow: "hidden" },
  tabs: { flexDirection: "row", padding: 4, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, gap: 4 },
  tab: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  tabText: { fontSize: 12, fontWeight: "500" },
});
