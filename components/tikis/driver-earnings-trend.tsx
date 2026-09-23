import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { type ThemedColors, useThemeColors } from "@/lib/use-theme-colors";
import { trpc } from "@/lib/trpc";
import { formatMoney } from "@/shared/tikis-domain";
import { formatTopDayDate } from "@/server/_test-helpers/driver-earnings-projection";

type Trend = {
  totalLast7Days: number;
  averagePerDay: number;
  trendPct: number | null;
  topDays: Array<{ date: string; amount: number }>;
};

const FRENCH_MONTHS_SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

/** Ce que la semaine écoulée a rapporté, comparé à la précédente. Aucune estimation de l'avenir : la carte
 *  montrait « 30 prochains jours = moyenne × 30 », un prolongement présenté comme un chiffre. */
export function DriverEarningsTrend({ phone }: { phone: string | null }) {
  const { colors: theme } = useThemeColors();
  const styles = makeStyles(theme);
  const query = trpc.analytics.myDriverEarningsTrend.useQuery(undefined, {
    enabled: Boolean(phone),
    refetchInterval: 60_000,
  });

  if (!phone) return null;
  if (query.isLoading) {
    return (
      <View style={styles.card}>
        <View style={styles.header}><MaterialIcons name="auto-graph" size={18} color={theme.primary} /><Text style={styles.title}>Tendance des gains</Text></View>
        <View style={styles.loading}><ActivityIndicator size="small" color={theme.primary} /></View>
      </View>
    );
  }
  const trend = query.data as Trend | null;
  if (!trend) return null;
  if (trend.totalLast7Days === 0) {
    return (
      <View style={styles.card}>
        <View style={styles.header}><MaterialIcons name="auto-graph" size={18} color={theme.primary} /><Text style={styles.title}>Tendance des gains</Text></View>
        <Text style={styles.empty}>Terminez des courses pour voir votre tendance : elle se calcule sur vos 7 derniers jours.</Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <MaterialIcons name="auto-graph" size={18} color={theme.primary} />
        <Text style={styles.title}>Tendance des gains</Text>
        {trend.trendPct !== null ? (
          <View style={[styles.trendPill, { backgroundColor: trend.trendPct >= 0 ? theme.success : theme.error }]}>
            <MaterialIcons name={trend.trendPct >= 0 ? "trending-up" : "trending-down"} size={12} color="#FFFFFF" />
            <Text style={styles.trendPillText}>{trend.trendPct >= 0 ? "+" : ""}{trend.trendPct}%</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.row}>
        <View style={styles.kpi}>
          <Text style={styles.kpiLabel}>7 derniers jours</Text>
          <Text style={styles.kpiValue}>{formatMoney(trend.totalLast7Days)}</Text>
        </View>
        <View style={styles.kpiDivider} />
        <View style={styles.kpi}>
          <Text style={styles.kpiLabel}>Moyenne / jour</Text>
          <Text style={styles.kpiValue}>{formatMoney(trend.averagePerDay)}</Text>
        </View>
      </View>

      {trend.topDays.length > 0 ? (
        <View style={styles.topDays}>
          <Text style={styles.topDaysTitle}>Top jours (30 derniers)</Text>
          {trend.topDays.map((row) => (
            <View key={row.date} style={styles.topDayRow}>
              <Text style={styles.topDayDate}>{formatTopDayDate(row.date)}</Text>
              <View style={styles.topDayBarWrap}>
                <View style={[styles.topDayBar, { width: `${Math.min(100, Math.round((row.amount / Math.max(...trend.topDays.map((d) => d.amount), 1)) * 100))}%`, backgroundColor: theme.primary }]} />
              </View>
              <Text style={styles.topDayAmount}>{formatMoney(row.amount)}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function makeStyles(theme: ThemedColors) {
  return StyleSheet.create({
    card: { backgroundColor: theme.surface, borderRadius: 10, borderWidth: 0, padding: 14, gap: 10, marginBottom: 12 },
    header: { flexDirection: "row", alignItems: "center", gap: 8 },
    title: { flex: 1, fontSize: 14, fontWeight: "600", color: theme.foreground },
    loading: { alignItems: "center", paddingVertical: 6 },
    empty: { fontSize: 12, color: theme.muted, lineHeight: 18 },
    trendPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
    trendPillText: { color: "#FFFFFF", fontSize: 11, fontWeight: "700" },
    row: { flexDirection: "row", alignItems: "center", backgroundColor: theme.background, borderRadius: 8, padding: 10 },
    kpi: { flex: 1, gap: 2 },
    kpiLabel: { fontSize: 10.5, color: theme.muted, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
    kpiValue: { fontSize: 16, fontWeight: "600", color: theme.foreground },
    kpiDivider: { width: 1, height: 28, backgroundColor: theme.border, marginHorizontal: 10 },
    topDays: { gap: 6 },
    topDaysTitle: { fontSize: 11.5, fontWeight: "600", color: theme.muted, textTransform: "uppercase", letterSpacing: 0.5 },
    topDayRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    topDayDate: { fontSize: 11.5, color: theme.muted, width: 56 },
    topDayBarWrap: { flex: 1, height: 6, backgroundColor: theme.border, borderRadius: 3, overflow: "hidden" },
    topDayBar: { height: "100%", borderRadius: 3 },
    topDayAmount: { fontSize: 11.5, fontWeight: "600", color: theme.foreground, minWidth: 70, textAlign: "right" },
  });
}
