import { useMemo, useState } from "react";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useThemeColors } from "@/lib/use-theme-colors";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";
import { deliveryMetricsForDay, isDeliveryEarning } from "@/lib/wallet-metrics";
import { formatMoney, formatRelativeDate, type FinancialRecord } from "@/shared/tikis-domain";

type Period = "day" | "week" | "month";

const PERIOD_META: Record<Period, { label: string; icon: React.ComponentProps<typeof MaterialIcons>["name"]; description: string }> = {
  day: { label: "Aujourd'hui", icon: "wb-sunny", description: "Gains et courses sur la journée en cours." },
  week: { label: "7 derniers jours", icon: "date-range", description: "Vue d'ensemble hebdomadaire de votre activité." },
  month: { label: "Ce mois", icon: "calendar-month", description: "Bilan mensuel de vos performances livreur." },
};

function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function startOfWeek(date: Date): Date {
  const day = date.getDay();
  const diff = (day + 6) % 7; // Lundi = début de semaine
  const next = startOfDay(date);
  next.setDate(next.getDate() - diff);
  return next;
}

function startOfMonth(date: Date): Date {
  const next = startOfDay(date);
  next.setDate(1);
  return next;
}

function periodStart(period: Period, now: Date): Date {
  if (period === "day") return startOfDay(now);
  if (period === "week") return startOfWeek(now);
  return startOfMonth(now);
}

export default function EarningsScreen() {
  const { colors: theme } = useThemeColors();
  const { profile } = useTikisStore();
  const [period, setPeriod] = useState<Period>("day");
  const walletQuery = trpc.wallet.snapshot.useQuery(undefined, {
    enabled: Boolean(profile?.phone),
    refetchInterval: 5_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const wallet = walletQuery.data?.wallet;
  const journal = walletQuery.data?.journal ?? [];

  const { earningsEntries, totalEarnings, courseCount, averagePerCourse, dailyBreakdown, bestDay, comparison, history } = useMemo(() => {
    const start = periodStart(period, new Date());
    const inPeriod = (entry: FinancialRecord) => new Date(entry.createdAt).getTime() >= start.getTime();
    const earnings = journal.filter((entry) => inPeriod(entry) && isDeliveryEarning(entry));
    const earningsTotal = earnings.reduce((sum, entry) => sum + entry.amount, 0);
    const coursesIds = new Set(earnings.map((entry) => entry.deliveryId).filter(Boolean) as string[]);

    const dayMap = new Map<string, number>();
    for (const entry of earnings) {
      const key = new Date(entry.createdAt).toISOString().slice(0, 10);
      dayMap.set(key, (dayMap.get(key) ?? 0) + entry.amount);
    }
    const dayList = Array.from(dayMap.entries())
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .map(([dateKey, amount]) => ({ dateKey, amount }));

    const dayMetrics = deliveryMetricsForDay(journal);
    const best = dayList.length === 0 ? null : dayList.reduce((acc, cur) => (cur.amount > acc.amount ? cur : acc), dayList[0]);

    const totalLast7 = journal
      .filter((entry) => {
        const date = new Date(entry.createdAt);
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        return date.getTime() >= sevenDaysAgo && isDeliveryEarning(entry);
      })
      .reduce((sum, entry) => sum + entry.amount, 0);

    const totalPrev7 = journal
      .filter((entry) => {
        const date = new Date(entry.createdAt);
        const now = Date.now();
        return date.getTime() >= now - 14 * 24 * 60 * 60 * 1000 && date.getTime() < now - 7 * 24 * 60 * 60 * 1000 && isDeliveryEarning(entry);
      })
      .reduce((sum, entry) => sum + entry.amount, 0);

    const trend = totalPrev7 === 0 ? null : Math.round(((totalLast7 - totalPrev7) / totalPrev7) * 100);

    return {
      earningsEntries: earnings,
      totalEarnings: earningsTotal,
      courseCount: coursesIds.size,
      averagePerCourse: coursesIds.size === 0 ? 0 : Math.round(earningsTotal / coursesIds.size),
      dailyBreakdown: dayList,
      bestDay: best,
      comparison: { last7: totalLast7, prev7: totalPrev7, trend },
      history: earnings.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    };
  }, [journal, period]);

  const todayEarnings = useMemo(() => deliveryMetricsForDay(journal).earnings, [journal]);
  const lastEarningDate = history[0] ? new Date(history[0].createdAt) : null;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.balanceCard}>
          <View style={styles.balanceGradient} pointerEvents="none" />
          <Text style={styles.balanceEyebrow}>GAINS · {PERIOD_META[period].label.toUpperCase()}</Text>
          <View style={styles.balanceValueRow}>
            <Text style={styles.balanceValue}>{walletQuery.isLoading ? "Chargement…" : formatMoney(totalEarnings)}</Text>
            {comparison.trend !== null ? (
              <View style={[styles.trendPill, comparison.trend < 0 && styles.trendPillDown]}>
                <MaterialIcons name={comparison.trend >= 0 ? "trending-up" : "trending-down"} size={11} color={comparison.trend >= 0 ? "#48B889" : "#FBBF24"} />
                <Text style={[styles.trendText, comparison.trend < 0 && styles.trendTextDown]}>
                  {comparison.trend >= 0 ? "+" : ""}{comparison.trend}% vs 7 j
                </Text>
              </View>
            ) : (
              <View style={styles.trendPill}>
                <MaterialIcons name="schedule" size={11} color="#48B889" />
                <Text style={styles.trendText}>Comparaison 7 j</Text>
              </View>
            )}
          </View>
          <View style={styles.balanceDivider} />
          <View style={styles.balanceRows}>
            <View style={styles.balanceCol}>
              <Text style={styles.balanceLabel}>Courses</Text>
              <Text style={styles.balanceSub}>{courseCount}</Text>
            </View>
            <View style={styles.balanceCol}>
              <Text style={styles.balanceLabel}>Moyenne</Text>
              <Text style={styles.balanceSub}>{formatMoney(averagePerCourse)}</Text>
            </View>
            <View style={styles.balanceCol}>
              <Text style={styles.balanceLabel}>Aujourd'hui</Text>
              <Text style={styles.balanceSub}>{formatMoney(todayEarnings)}</Text>
            </View>
            <View style={styles.balanceCol}>
              <Text style={styles.balanceLabel}>Dernière course</Text>
              <Text style={styles.balanceSub}>{lastEarningDate ? formatRelativeDate(lastEarningDate.toISOString()) : "—"}</Text>
            </View>
          </View>
        </View>

        <View style={styles.periodTabs}>
          {(Object.keys(PERIOD_META) as Period[]).map((key) => {
            const active = period === key;
            return (
              <Pressable
                key={key}
                onPress={() => setPeriod(key)}
                style={({ pressed }) => [styles.periodTab, active && styles.periodTabActive, pressed && styles.pressed]}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={PERIOD_META[key].label}
              >
                <MaterialIcons name={PERIOD_META[key].icon} size={14} color={active ? "#FFFFFF" : "#747474"} />
                <Text style={[styles.periodTabText, active && styles.periodTabTextActive]}>{PERIOD_META[key].label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.periodDescription}>{PERIOD_META[period].description}</Text>

        <View style={styles.statsRow}>
          <StatCard icon="paid" tone="primary" label="Total" value={formatMoney(totalEarnings)} />
          <StatCard icon="local-shipping" tone="amber" label="Courses" value={String(courseCount)} />
          <StatCard icon="savings" tone="success" label="Moyenne" value={formatMoney(averagePerCourse)} />
        </View>

        {dailyBreakdown.length > 0 ? (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Répartition par jour</Text>
              {bestDay ? (
                <Text style={styles.cardSubtitle}>
                  Pic : {formatMoney(bestDay.amount)} · {new Date(bestDay.dateKey).toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "short" })}
                </Text>
              ) : null}
            </View>
            {dailyBreakdown.slice(0, 7).map((day, idx) => {
              const max = Math.max(...dailyBreakdown.map((entry) => entry.amount));
              const widthPct = max === 0 ? 0 : Math.max(8, Math.round((day.amount / max) * 100));
              const isLast = idx === dailyBreakdown.length - 1;
              return (
                <View key={day.dateKey} style={[styles.barRow, !isLast && styles.barRowDivider]}>
                  <View style={styles.barLabel}>
                    <Text style={styles.barDate}>{new Date(day.dateKey).toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "short" })}</Text>
                    <Text style={styles.barValue}>{formatMoney(day.amount)}</Text>
                  </View>
                  <View style={styles.barTrack}>
                    <View style={[styles.barFill, { width: `${widthPct}%` }]} />
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Historique des gains</Text>
          <Text style={styles.sectionAction}>{history.length} crédit{history.length > 1 ? "s" : ""}</Text>
        </View>

        {walletQuery.isLoading ? (
          <View style={styles.card}><Text style={styles.emptyText}>Chargement sécurisé de vos gains…</Text></View>
        ) : walletQuery.error ? (
          <View style={styles.card}><Text style={styles.emptyText}>L'historique des gains est momentanément indisponible.</Text></View>
        ) : history.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}><MaterialIcons name="savings" size={26} color="#747474" /></View>
            <Text style={styles.emptyTitle}>Aucun gain sur cette période</Text>
            <Text style={styles.emptySub}>Vos crédits de course apparaîtront ici dès que vous terminez une livraison.</Text>
          </View>
        ) : (
          <View style={styles.card}>
            {history.map((entry, idx) => {
              const isLast = idx === history.length - 1;
              return (
                <View key={entry.id} style={[styles.historyRow, !isLast && styles.historyRowDivider]}>
                  <View style={styles.historyIcon}>
                    <MaterialIcons name="south-west" size={15} color="#167A55" />
                  </View>
                  <View style={styles.historyBody}>
                    <View style={styles.historyLine1}>
                      <Text style={styles.historyLabel} numberOfLines={1}>Gain de course</Text>
                      <Text style={styles.historyTime}>{formatRelativeDate(entry.createdAt)}</Text>
                    </View>
                    <Text style={styles.historyMeta} numberOfLines={1}>{entry.reason}</Text>
                  </View>
                  <Text style={styles.historyAmount}>+{formatMoney(entry.amount)}</Text>
                </View>
              );
            })}
          </View>
        )}

        <View style={styles.disclaimer}>
          <MaterialIcons name="verified-user" size={14} color="#747474" />
          <Text style={styles.disclaimerText}>Les montants affichés correspondent aux crédits de course après commission Tikis.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatCard({ icon, value, label, tone }: { icon: React.ComponentProps<typeof MaterialIcons>["name"]; value: string; label: string; tone: "primary" | "amber" | "success" }) {
  return (
    <View style={styles.statCard}>
      <View style={[styles.statIcon, tone === "primary" ? styles.statIconPrimary : tone === "amber" ? styles.statIconAmber : styles.statIconSuccess]}>
        <MaterialIcons name={icon} size={15} color="#9A6201" />
      </View>
      <Text style={styles.statValue} numberOfLines={1}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#EEEDF3" },
  pressed: { opacity: 0.7 },
  scroll: { padding: 12, paddingBottom: 32, gap: 14 },

  balanceCard: { padding: 18, borderRadius: 14, gap: 10, backgroundColor: "#9A6201", position: "relative", overflow: "hidden" },
  balanceGradient: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#D7A447", opacity: 0.25, borderRadius: 14 },
  balanceEyebrow: { color: "rgba(255,255,255,0.7)", fontSize: 10, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase" },
  balanceValueRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  balanceValue: { color: "#FFFFFF", fontSize: 28, fontWeight: "700", lineHeight: 34, includeFontPadding: false },
  trendPill: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: "rgba(22,122,85,0.25)", borderRadius: 99 },
  trendPillDown: { backgroundColor: "rgba(180,35,45,0.25)" },
  trendText: { color: "#48B889", fontSize: 10, fontWeight: "700" },
  trendTextDown: { color: "#FBBF24" },
  balanceDivider: { height: 1, backgroundColor: "rgba(255,255,255,0.18)" },
  balanceRows: { flexDirection: "row", gap: 12 },
  balanceCol: { flex: 1 },
  balanceLabel: { color: "rgba(255,255,255,0.7)", fontSize: 10, fontWeight: "600" },
  balanceSub: { color: "#FFFFFF", fontSize: 12, fontWeight: "700", marginTop: 2 },

  periodTabs: { flexDirection: "row", gap: 6, paddingHorizontal: 2 },
  periodTab: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 9, borderRadius: 9, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#D7D5DE" },
  periodTabActive: { backgroundColor: "#9A6201", borderColor: "#9A6201" },
  periodTabText: { color: "#666666", fontSize: 11, fontWeight: "600" },
  periodTabTextActive: { color: "#FFFFFF" },

  periodDescription: { color: "#747474", fontSize: 11, lineHeight: 16, paddingHorizontal: 4 },

  statsRow: { flexDirection: "row", gap: 8 },
  statCard: { flex: 1, backgroundColor: "#FFFFFF", borderRadius: 10, paddingVertical: 12, paddingHorizontal: 10, alignItems: "center", gap: 4 },
  statIcon: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  statIconPrimary: { backgroundColor: "#F8F0E5" },
  statIconAmber: { backgroundColor: "#FEF6E2" },
  statIconSuccess: { backgroundColor: "#E2F3F4" },
  statValue: { color: "#111111", fontSize: 13, fontWeight: "700" },
  statLabel: { color: "#747474", fontSize: 9, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase" },

  card: { backgroundColor: "#FFFFFF", borderRadius: 12, padding: 14, gap: 10 },
  cardHeader: { gap: 2 },
  cardTitle: { color: "#111111", fontSize: 13, fontWeight: "700" },
  cardSubtitle: { color: "#747474", fontSize: 11, lineHeight: 16 },

  barRow: { gap: 6 },
  barRowDivider: { paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: "#ECECEC", marginBottom: 8 },
  barLabel: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  barDate: { color: "#111111", fontSize: 11, fontWeight: "600" },
  barValue: { color: "#9A6201", fontSize: 11, fontWeight: "700", fontVariant: ["tabular-nums"] },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: "#F7EFE5", overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 3, backgroundColor: "#9A6201" },

  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 4, marginTop: 4 },
  sectionTitle: { color: "#111111", fontSize: 13, fontWeight: "700" },
  sectionAction: { color: "#9A6201", fontSize: 11, fontWeight: "600" },

  historyRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  historyRowDivider: { paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: "#ECECEC", marginBottom: 10 },
  historyIcon: { width: 30, height: 30, borderRadius: 8, backgroundColor: "#E2F3F4", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  historyBody: { flex: 1, minWidth: 0 },
  historyLine1: { flexDirection: "row", alignItems: "center", gap: 6 },
  historyLabel: { color: "#111111", fontSize: 12, fontWeight: "600", flex: 1 },
  historyTime: { color: "#747474", fontSize: 10, flexShrink: 0 },
  historyMeta: { color: "#666666", fontSize: 11, marginTop: 2 },
  historyAmount: { color: "#167A55", fontSize: 13, fontWeight: "700", flexShrink: 0, fontVariant: ["tabular-nums"] },

  empty: { alignItems: "center", paddingVertical: 30, paddingHorizontal: 24, gap: 8, backgroundColor: "#FFFFFF", borderRadius: 12 },
  emptyIcon: { width: 56, height: 56, borderRadius: 14, backgroundColor: "#F7EFE5", alignItems: "center", justifyContent: "center" },
  emptyTitle: { color: "#111111", fontSize: 14, fontWeight: "600" },
  emptySub: { color: "#666666", fontSize: 12, textAlign: "center", lineHeight: 18, maxWidth: 260 },
  emptyText: { color: "#666666", fontSize: 12, textAlign: "center", padding: 8 },

  disclaimer: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 6, marginTop: 4 },
  disclaimerText: { color: "#747474", fontSize: 10, lineHeight: 14, flex: 1 },
});
