import { useMemo, useState } from "react";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useThemeColors } from "@/lib/use-theme-colors";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";
import { deliveryMetricsForDay, isDeliveryEarning } from "@/lib/wallet-metrics";
import { formatMoney, formatRelativeDate, type FinancialRecord } from "@/shared/tikis-domain";
import { DriverEarningsProjection } from "@/components/tikis/driver-earnings-projection";

type Period = "day" | "week" | "month";
type FlowFilter = "earnings" | "bonus" | "all";

const PERIOD_META: Record<Period, { label: string; icon: React.ComponentProps<typeof MaterialIcons>["name"]; description: string }> = {
  day: { label: "Aujourd'hui", icon: "wb-sunny", description: "Gains et courses sur la journée en cours." },
  week: { label: "7 derniers jours", icon: "date-range", description: "Vue d'ensemble hebdomadaire de votre activité." },
  month: { label: "Ce mois", icon: "calendar-month", description: "Bilan mensuel de vos performances livreur." },
};

const FLOW_META: Record<FlowFilter, { label: string; icon: React.ComponentProps<typeof MaterialIcons>["name"] }> = {
  earnings: { label: "Gains", icon: "paid" },
  bonus: { label: "Bonus", icon: "card-giftcard" },
  all: { label: "Tout", icon: "all-inclusive" },
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
  const [flow, setFlow] = useState<FlowFilter>("earnings");
  const walletQuery = trpc.wallet.snapshot.useQuery(undefined, {
    enabled: Boolean(profile?.phone),
    refetchInterval: 5_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  // Les gains de courses sont informatifs (le paiement se fait hors application) : ils sont calculés depuis les
  // livraisons terminées, jamais depuis le Wallet, qui n'est jamais crédité par une livraison.
  const earningsHistoryQuery = trpc.wallet.driverEarningsHistory.useQuery(undefined, { enabled: Boolean(profile?.phone) });
  const wallet = walletQuery.data?.wallet;
  const journal = walletQuery.data?.journal ?? [];
  const earningsHistory = earningsHistoryQuery.data ?? [];
  const isLoading = walletQuery.isLoading || earningsHistoryQuery.isLoading;
  const hasError = walletQuery.error || earningsHistoryQuery.error;

  const { earningsEntries, bonusEntries, totalEarnings, totalBonus, courseCount, averagePerCourse, dailyBreakdown, bestDay, comparison, history } = useMemo(() => {
    const start = periodStart(period, new Date());
    const inPeriod = (entry: FinancialRecord) => new Date(entry.createdAt).getTime() >= start.getTime();
    const earnings = earningsHistory.filter((entry) => inPeriod(entry) && isDeliveryEarning(entry));
    const bonus = journal.filter((entry) => inPeriod(entry) && entry.operation === "bonus");
    const visible = flow === "earnings" ? earnings : flow === "bonus" ? bonus : [...earnings, ...bonus];
    const earningsTotal = earnings.reduce((sum, entry) => sum + entry.amount, 0);
    const bonusTotal = bonus.reduce((sum, entry) => sum + entry.amount, 0);
    const coursesIds = new Set(earnings.map((entry) => entry.deliveryId).filter(Boolean) as string[]);

    const dayMap = new Map<string, number>();
    for (const entry of visible) {
      const key = new Date(entry.createdAt).toISOString().slice(0, 10);
      dayMap.set(key, (dayMap.get(key) ?? 0) + entry.amount);
    }
    const dayList = Array.from(dayMap.entries())
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .map(([dateKey, amount]) => ({ dateKey, amount }));

    const best = dayList.length === 0 ? null : dayList.reduce((acc, cur) => (cur.amount > acc.amount ? cur : acc), dayList[0]);

    const totalLast7 = earningsHistory
      .filter((entry) => {
        const date = new Date(entry.createdAt);
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        return date.getTime() >= sevenDaysAgo && isDeliveryEarning(entry);
      })
      .reduce((sum, entry) => sum + entry.amount, 0);

    const totalPrev7 = earningsHistory
      .filter((entry) => {
        const date = new Date(entry.createdAt);
        const now = Date.now();
        return date.getTime() >= now - 14 * 24 * 60 * 60 * 1000 && date.getTime() < now - 7 * 24 * 60 * 60 * 1000 && isDeliveryEarning(entry);
      })
      .reduce((sum, entry) => sum + entry.amount, 0);

    const trend = totalPrev7 === 0 ? null : Math.round(((totalLast7 - totalPrev7) / totalPrev7) * 100);

    return {
      earningsEntries: earnings,
      bonusEntries: bonus,
      totalEarnings: earningsTotal,
      totalBonus: bonusTotal,
      courseCount: coursesIds.size,
      averagePerCourse: coursesIds.size === 0 ? 0 : Math.round(earningsTotal / coursesIds.size),
      dailyBreakdown: dayList,
      bestDay: best,
      comparison: { last7: totalLast7, prev7: totalPrev7, trend },
      history: visible.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    };
  }, [journal, earningsHistory, period, flow]);

  const todayEarnings = useMemo(() => deliveryMetricsForDay(earningsHistory).earnings, [earningsHistory]);
  const lastEarningDate = history[0] ? new Date(history[0].createdAt) : null;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.balanceCard}>
          <View style={styles.balanceGradient} pointerEvents="none" />
          <Text style={styles.balanceEyebrow}>GAINS · {PERIOD_META[period].label.toUpperCase()}</Text>
          <View style={styles.balanceValueRow}>
            <Text style={styles.balanceValue}>{isLoading ? "Chargement…" : formatMoney(totalEarnings)}</Text>
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

        <Text style={[styles.periodDescription, { color: theme.muted }]}>{PERIOD_META[period].description}</Text>

        <View style={styles.flowTabs}>
          {(Object.keys(FLOW_META) as FlowFilter[]).map((key) => {
            const active = flow === key;
            return (
              <Pressable
                key={key}
                onPress={() => setFlow(key)}
                style={({ pressed }) => [styles.flowTab, active && styles.flowTabActive, pressed && styles.pressed]}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={FLOW_META[key].label}
              >
                <MaterialIcons name={FLOW_META[key].icon} size={13} color={active ? "#FFFFFF" : theme.muted} />
                <Text style={[styles.flowTabText, active && styles.flowTabTextActive]}>{FLOW_META[key].label}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.statsRow}>
          <StatCard icon="paid" tone="primary" label={flow === "bonus" ? "Bonus" : "Gains"} value={formatMoney(flow === "bonus" ? totalBonus : totalEarnings)} />
          <StatCard icon="local-shipping" tone="amber" label="Courses" value={String(courseCount)} />
          <StatCard icon="savings" tone="success" label="Moyenne" value={formatMoney(averagePerCourse)} />
        </View>

        {totalBonus > 0 && flow !== "bonus" ? (
          <View style={[styles.bonusBanner, { backgroundColor: theme.primary + "14" }]}>
            <MaterialIcons name="card-giftcard" size={14} color={theme.primary} />
            <Text style={[styles.bonusBannerText, { color: theme.primary }]}>
              {formatMoney(totalBonus)} de bonus de fidélité crédité{bonusEntries.length > 1 ? "s" : ""} sur cette période
            </Text>
          </View>
        ) : null}

        {dailyBreakdown.length > 0 ? (
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <View style={styles.cardHeader}>
              <Text style={[styles.cardTitle, { color: theme.foreground }]}>Répartition par jour</Text>
              {bestDay ? (
                <Text style={[styles.cardSubtitle, { color: theme.muted }]}>
                  Pic : {formatMoney(bestDay.amount)} · {new Date(bestDay.dateKey).toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "short" })}
                </Text>
              ) : null}
            </View>
            {dailyBreakdown.slice(0, 7).map((day, idx) => {
              const max = Math.max(...dailyBreakdown.map((entry) => entry.amount));
              const widthPct = max === 0 ? 0 : Math.max(8, Math.round((day.amount / max) * 100));
              const isLast = idx === dailyBreakdown.length - 1;
              return (
                <View key={day.dateKey} style={[styles.barRow, !isLast && { borderBottomColor: theme.border }]}>
                  <View style={styles.barLabel}>
                    <Text style={[styles.barDate, { color: theme.foreground }]}>{new Date(day.dateKey).toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "short" })}</Text>
                    <Text style={[styles.barValue, { color: theme.primary }]}>{formatMoney(day.amount)}</Text>
                  </View>
                  <View style={[styles.barTrack, { backgroundColor: theme.background }]}>
                    <View style={[styles.barFill, { width: `${widthPct}%`, backgroundColor: theme.primary }]} />
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}

        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: theme.foreground }]}>{flow === "bonus" ? "Historique des bonus" : flow === "all" ? "Historique complet" : "Historique des gains"}</Text>
          <Text style={[styles.sectionAction, { color: theme.muted }]}>{history.length} mouvement{history.length > 1 ? "s" : ""}</Text>
        </View>

        {isLoading ? (
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}><Text style={[styles.emptyText, { color: theme.muted }]}>Chargement sécurisé de vos gains…</Text></View>
        ) : hasError ? (
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}><Text style={[styles.emptyText, { color: theme.muted }]}>L'historique des gains est momentanément indisponible.</Text></View>
        ) : (
          <>
            <DriverEarningsProjection phone={profile?.phone ?? null} />
          </>
        )}

        {isLoading ? null : hasError ? null : history.length === 0 ? (
          <View style={[styles.empty, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <View style={[styles.emptyIcon, { backgroundColor: theme.background }]}><MaterialIcons name="savings" size={26} color={theme.muted} /></View>
            <Text style={[styles.emptyTitle, { color: theme.foreground }]}>Aucun gain sur cette période</Text>
            <Text style={[styles.emptySub, { color: theme.muted }]}>Vos crédits de course apparaîtront ici dès que vous terminez une livraison.</Text>
          </View>
        ) : (
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            {history.map((entry, idx) => {
              const isLast = idx === history.length - 1;
              const isBonus = entry.operation === "bonus";
              const tint = isBonus ? theme.primary : theme.success;
              const iconName = isBonus ? "card-giftcard" : "south-west";
              const label = isBonus ? "Bonus fidélité" : "Gain de course";
              return (
                <View key={entry.id} style={[styles.historyRow, !isLast && { borderBottomColor: theme.border }]}>
                  <View style={[styles.historyIcon, { backgroundColor: tint + "22" }]}>
                    <MaterialIcons name={iconName} size={15} color={tint} />
                  </View>
                  <View style={styles.historyBody}>
                    <View style={styles.historyLine1}>
                      <Text style={[styles.historyLabel, { color: theme.foreground }]} numberOfLines={1}>{label}</Text>
                      <Text style={[styles.historyTime, { color: theme.muted }]}>{formatRelativeDate(entry.createdAt)}</Text>
                    </View>
                    <Text style={[styles.historyMeta, { color: theme.muted }]} numberOfLines={1}>{entry.reason}</Text>
                  </View>
                  <Text style={[styles.historyAmount, { color: tint }]}>+{formatMoney(entry.amount)}</Text>
                </View>
              );
            })}
          </View>
        )}

        <View style={styles.disclaimer}>
          <MaterialIcons name="verified-user" size={14} color={theme.muted} />
          <Text style={[styles.disclaimerText, { color: theme.muted }]}>Les montants affichés correspondent aux crédits de course après commission Tikis.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatCard({ icon, value, label, tone }: { icon: React.ComponentProps<typeof MaterialIcons>["name"]; value: string; label: string; tone: "primary" | "amber" | "success" }) {
  const { colors: theme } = useThemeColors();
  const iconBg = tone === "primary" ? theme.primary + "22" : tone === "amber" ? theme.warning + "22" : theme.success + "22";
  return (
    <View style={[styles.statCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={[styles.statIcon, { backgroundColor: iconBg }]}>
        <MaterialIcons name={icon} size={15} color={theme.primary} />
      </View>
      <Text style={[styles.statValue, { color: theme.foreground }]} numberOfLines={1}>{value}</Text>
      <Text style={[styles.statLabel, { color: theme.muted }]}>{label}</Text>
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
  periodTab: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 9, borderRadius: 9, borderWidth: 1 },
  periodTabActive: { backgroundColor: "#9A6201", borderColor: "#9A6201" },
  periodTabText: { fontSize: 11, fontWeight: "600" },
  periodTabTextActive: { color: "#FFFFFF" },

  periodDescription: { fontSize: 11, lineHeight: 16, paddingHorizontal: 4 },

  flowTabs: { flexDirection: "row", gap: 6, paddingHorizontal: 2 },
  flowTab: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 8, borderRadius: 9, borderWidth: 1, borderColor: "#D7D5DE", backgroundColor: "#FFFFFF" },
  flowTabActive: { backgroundColor: "#9A6201", borderColor: "#9A6201" },
  flowTabText: { fontSize: 11, fontWeight: "600", color: "#747474" },
  flowTabTextActive: { color: "#FFFFFF" },

  bonusBanner: { flexDirection: "row", alignItems: "center", gap: 6, padding: 10, borderRadius: 9 },

  bonusBannerText: { fontSize: 11, fontWeight: "600", flex: 1 },

  statsRow: { flexDirection: "row", gap: 8 },
  statCard: { flex: 1, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 10, alignItems: "center", gap: 4, borderWidth: 1 },
  statIcon: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  statIconPrimary: {},
  statIconAmber: {},
  statIconSuccess: {},
  statValue: { fontSize: 13, fontWeight: "700" },
  statLabel: { fontSize: 9, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase" },

  card: { backgroundColor: "#FFFFFF", borderRadius: 12, padding: 14, gap: 10 },
  cardHeader: { gap: 2 },
  cardTitle: { color: "#111111", fontSize: 13, fontWeight: "700" },
  cardSubtitle: { color: "#747474", fontSize: 11, lineHeight: 16 },

  barRow: { gap: 6 },
  barRowDivider: { paddingBottom: 8, borderBottomWidth: 1, marginBottom: 8 },
  barLabel: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  barDate: { fontSize: 11, fontWeight: "600" },
  barValue: { fontSize: 11, fontWeight: "700", fontVariant: ["tabular-nums"] },
  barTrack: { height: 6, borderRadius: 3, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 3 },

  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 4, marginTop: 4 },
  sectionTitle: { fontSize: 13, fontWeight: "700" },
  sectionAction: { fontSize: 11, fontWeight: "600" },

  historyRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  historyRowDivider: { paddingBottom: 10, borderBottomWidth: 1, marginBottom: 10 },
  historyIcon: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  historyBody: { flex: 1, minWidth: 0 },
  historyLine1: { flexDirection: "row", alignItems: "center", gap: 6 },
  historyLabel: { fontSize: 12, fontWeight: "600", flex: 1 },
  historyTime: { fontSize: 10, flexShrink: 0 },
  historyMeta: { fontSize: 11, marginTop: 2 },
  historyAmount: { fontSize: 13, fontWeight: "700", flexShrink: 0, fontVariant: ["tabular-nums"] },

  empty: { alignItems: "center", paddingVertical: 30, paddingHorizontal: 24, gap: 8, borderRadius: 12 },
  emptyIcon: { width: 56, height: 56, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 14, fontWeight: "600" },
  emptySub: { fontSize: 12, textAlign: "center", lineHeight: 18, maxWidth: 260 },
  emptyText: { fontSize: 12, textAlign: "center", padding: 8 },

  disclaimer: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 6, marginTop: 4 },
  disclaimerText: { fontSize: 10, lineHeight: 14, flex: 1 },
});
