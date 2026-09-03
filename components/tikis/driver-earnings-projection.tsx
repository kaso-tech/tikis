import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useThemeColors } from "@/lib/use-theme-colors";
import { trpc } from "@/lib/trpc";
import { formatMoney } from "@/shared/tikis-domain";
import { computeProjection30Days, computeTrendPct, formatTopDayDate } from "@/server/_test-helpers/driver-earnings-projection";

type Projection = {
  totalLast7Days: number;
  averagePerDay: number;
  projection30Days: number;
  trendPct: number | null;
  topDays: Array<{ date: string; amount: number }>;
};

const FRENCH_MONTHS_SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

export function DriverEarningsProjection({ phone }: { phone: string | null }) {
  const { colors: theme } = useThemeColors();
  const styles = makeStyles(theme);
  const query = trpc.analytics.myDriverEarningsProjection.useQuery(undefined, {
    enabled: Boolean(phone),
    refetchInterval: 60_000,
  });

  if (!phone) return null;
  if (query.isLoading) {
    return (
      <View style={styles.card}>
        <View style={styles.header}><MaterialIcons name="auto-graph" size={18} color={theme.primary} /><Text style={styles.title}>Projection gains</Text></View>
        <View style={styles.loading}><ActivityIndicator size="small" color={theme.primary} /></View>
      </View>
    );
  }
  const projection = query.data as Projection | null;
  if (!projection) return null;
  if (projection.totalLast7Days === 0) {
    return (
      <View style={styles.card}>
        <View style={styles.header}><MaterialIcons name="auto-graph" size={18} color={theme.primary} /><Text style={styles.title}>Projection gains</Text></View>
        <Text style={styles.empty}>Termine des courses cette semaine pour activer la projection 30 jours.</Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <MaterialIcons name="auto-graph" size={18} color={theme.primary} />
        <Text style={styles.title}>Projection gains</Text>
        {projection.trendPct !== null ? (
          <View style={[styles.trendPill, { backgroundColor: projection.trendPct >= 0 ? theme.success : theme.error }]}>
            <MaterialIcons name={projection.trendPct >= 0 ? "trending-up" : "trending-down"} size={12} color="#FFFFFF" />
            <Text style={styles.trendPillText}>{projection.trendPct >= 0 ? "+" : ""}{projection.trendPct}%</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.row}>
        <View style={styles.kpi}>
          <Text style={styles.kpiLabel}>7 derniers jours</Text>
          <Text style={styles.kpiValue}>{formatMoney(projection.totalLast7Days)}</Text>
        </View>
        <View style={styles.kpiDivider} />
        <View style={styles.kpi}>
          <Text style={styles.kpiLabel}>Moyenne / jour</Text>
          <Text style={styles.kpiValue}>{formatMoney(projection.averagePerDay)}</Text>
        </View>
      </View>

      <View style={styles.projectionBox}>
        <Text style={styles.projectionLabel}>ESTIMATION 30 PROCHAINS JOURS</Text>
        <Text style={styles.projectionValue}>{formatMoney(projection.projection30Days)}</Text>
        <Text style={styles.projectionFoot}>Basée sur la moyenne de tes 7 derniers jours. Les variations saisonnières ne sont pas prises en compte.</Text>
      </View>

      {projection.topDays.length > 0 ? (
        <View style={styles.topDays}>
          <Text style={styles.topDaysTitle}>Top jours (30 derniers)</Text>
          {projection.topDays.map((row) => (
            <View key={row.date} style={styles.topDayRow}>
              <Text style={styles.topDayDate}>{formatTopDayDate(row.date)}</Text>
              <View style={styles.topDayBarWrap}>
                <View style={[styles.topDayBar, { width: `${Math.min(100, Math.round((row.amount / Math.max(...projection.topDays.map((d) => d.amount), 1)) * 100))}%`, backgroundColor: theme.primary }]} />
              </View>
              <Text style={styles.topDayAmount}>{formatMoney(row.amount)}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function makeStyles(theme: ReturnType<typeof useThemeColors>) {
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
    kpiValue: { fontSize: 16, fontWeight: "600", color: theme.foreground, fontVariantNumeric: "tabular-nums" },
    kpiDivider: { width: 1, height: 28, backgroundColor: theme.border, marginHorizontal: 10 },
    projectionBox: { backgroundColor: theme.background, borderRadius: 8, padding: 12, gap: 4 },
    projectionLabel: { fontSize: 10.5, color: theme.muted, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
    projectionValue: { fontSize: 24, fontWeight: "600", color: theme.primary, fontVariantNumeric: "tabular-nums" },
    projectionFoot: { fontSize: 11, color: theme.muted, lineHeight: 16 },
    topDays: { gap: 6 },
    topDaysTitle: { fontSize: 11.5, fontWeight: "600", color: theme.muted, textTransform: "uppercase", letterSpacing: 0.5 },
    topDayRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    topDayDate: { fontSize: 11.5, color: theme.muted, width: 56, fontVariantNumeric: "tabular-nums" },
    topDayBarWrap: { flex: 1, height: 6, backgroundColor: theme.border, borderRadius: 3, overflow: "hidden" },
    topDayBar: { height: "100%", borderRadius: 3 },
    topDayAmount: { fontSize: 11.5, fontWeight: "600", color: theme.foreground, fontVariantNumeric: "tabular-nums", minWidth: 70, textAlign: "right" },
  });
}
