import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router } from "expo-router";
import { useMemo } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { type ThemedColors, useThemeColors } from "@/lib/use-theme-colors";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";
import { formatMoney } from "@/shared/tikis-domain";
import { trendBarValue } from "@/server/_test-helpers/analytics-format";

type Stats = {
  month: { year: number; month: number; label: string; deliveriesCount: number; totalSpent: number };
  allTime: { deliveriesCount: number; totalSpent: number; averagePrice: number };
  trend: Array<{ year: number; month: number; label: string; deliveriesCount: number; totalSpent: number }>;
  preferredDrivers: Array<{ driverPhone: string; driverName: string; deliveriesCount: number; totalSpent: number; averageRating: number }>;
};

const TREND_BAR_HEIGHT = 38;

export function SenderHomeKpiCards() {
  const { colors: theme } = useThemeColors();
  const styles = makeStyles(theme);
  const { profile } = useTikisStore();
  const query = trpc.analytics.mySenderStats.useQuery(undefined, {
    enabled: Boolean(profile?.phone) && profile?.role === "sender",
    refetchInterval: 60_000,
  });

  const trendMax = useMemo(() => {
    const stats = query.data as Stats | null | undefined;
    if (!stats) return { deliveriesCount: 0, totalSpent: 0 };
    return stats.trend.reduce(
      (acc, row) => ({
        deliveriesCount: Math.max(acc.deliveriesCount, row.deliveriesCount),
        totalSpent: Math.max(acc.totalSpent, row.totalSpent),
      }),
      { deliveriesCount: 0, totalSpent: 0 },
    );
  }, [query.data]);

  if (profile?.role !== "sender") return null;
  if (query.isLoading) {
    return (
      <View style={styles.card}>
        <View style={styles.header}>
          <MaterialIcons name="insights" size={18} color={theme.primary} />
          <Text style={styles.title}>Mon activité</Text>
        </View>
        <View style={styles.loading}><ActivityIndicator size="small" color={theme.primary} /></View>
      </View>
    );
  }
  const stats = query.data as Stats | null;
  if (!stats) return null;
  const recentDriversCount = stats.preferredDrivers.length;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <MaterialIcons name="insights" size={18} color={theme.primary} />
          <Text style={styles.title}>Mon activité</Text>
        </View>
        <Pressable
          accessibilityRole="link"
          onPress={() => router.push("/(tabs)/analytics" as any)}
          style={({ pressed }) => [styles.headerLink, pressed && styles.pressed]}
        >
          <Text style={styles.headerLinkText}>Voir tout</Text>
          <MaterialIcons name="chevron-right" size={14} color={theme.primary} />
        </Pressable>
      </View>

      <View style={styles.kpiRow}>
        <View style={styles.kpiMain}>
          <Text style={styles.kpiMainLabel}>{stats.month.label}</Text>
          <Text style={styles.kpiMainValue}>{formatMoney(stats.month.totalSpent)}</Text>
          <Text style={styles.kpiMainFoot}>{stats.month.deliveriesCount} livraison{stats.month.deliveriesCount > 1 ? "s" : ""} ce mois-ci</Text>
        </View>
        <View style={styles.kpiSide}>
          <View style={styles.kpiSideItem}>
            <Text style={styles.kpiSideLabel}>Panier moyen</Text>
            <Text style={styles.kpiSideValue}>{formatMoney(Math.round(stats.allTime.averagePrice))}</Text>
          </View>
          <View style={[styles.kpiSideItem, styles.kpiSideDivider]}>
            <Text style={styles.kpiSideLabel}>Total</Text>
            <Text style={styles.kpiSideValue}>{formatMoney(stats.allTime.totalSpent)}</Text>
          </View>
        </View>
      </View>

      {stats.trend.length > 0 ? (
        <View style={styles.trendWrap}>
          <View style={styles.trendHeader}>
            <Text style={styles.trendTitle}>6 derniers mois</Text>
            <Text style={styles.trendMeta}>{stats.allTime.deliveriesCount} courses au total</Text>
          </View>
          <View style={styles.trendChart}>
            {stats.trend.map((row) => {
              const score = trendBarValue(row, trendMax);
              return (
                <View key={`${row.year}-${row.month}`} style={styles.trendCol}>
                  <View style={styles.trendBarWrap}>
                    <View style={[styles.trendBar, { height: `${Math.max(2, score)}%`, backgroundColor: score > 0 ? theme.primary : theme.border }]} />
                  </View>
                  <Text style={styles.trendCount}>{row.deliveriesCount > 0 ? row.deliveriesCount : "·"}</Text>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}

      <View style={styles.shortcutRow}>
        <Pressable
          accessibilityRole="link"
          onPress={() => router.push("/create-delivery" as any)}
          style={({ pressed }) => [styles.shortcut, pressed && styles.pressed]}
        >
          <MaterialIcons name="add-circle" size={20} color={theme.primary} />
          <Text style={styles.shortcutText}>Nouvelle livraison</Text>
        </Pressable>
        {recentDriversCount > 0 ? (
          <Pressable
            accessibilityRole="link"
            onPress={() => router.push("/(tabs)/addresses" as any)}
            style={({ pressed }) => [styles.shortcut, pressed && styles.pressed]}
          >
            <MaterialIcons name="place" size={20} color={theme.primary} />
            <Text style={styles.shortcutText}>Mes adresses</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function makeStyles(theme: ThemedColors) {
  return StyleSheet.create({
    card: { backgroundColor: theme.surface, borderRadius: 12, borderWidth: 0, padding: 14, gap: 12, marginHorizontal: 16, marginTop: 12, marginBottom: 4 },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    headerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
    title: { fontSize: 14, fontWeight: "600", color: theme.foreground },
    headerLink: { flexDirection: "row", alignItems: "center", gap: 2, paddingVertical: 4, paddingHorizontal: 6, borderRadius: 6 },
    headerLinkText: { fontSize: 12, fontWeight: "600", color: theme.primary },
    loading: { alignItems: "center", paddingVertical: 12 },
    kpiRow: { flexDirection: "row", gap: 10 },
    kpiMain: { flex: 1.4, backgroundColor: theme.background, borderRadius: 8, padding: 12, gap: 4 },
    kpiMainLabel: { fontSize: 10.5, color: theme.muted, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
    kpiMainValue: { fontSize: 22, fontWeight: "600", color: theme.foreground },
    kpiMainFoot: { fontSize: 11.5, color: theme.muted },
    kpiSide: { flex: 1, backgroundColor: theme.background, borderRadius: 8, padding: 12, justifyContent: "space-between" },
    kpiSideItem: { gap: 2 },
    kpiSideDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border, paddingTop: 8 },
    kpiSideLabel: { fontSize: 10.5, color: theme.muted, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
    kpiSideValue: { fontSize: 14, fontWeight: "600", color: theme.foreground },
    trendWrap: { gap: 8 },
    trendHeader: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
    trendTitle: { fontSize: 11, fontWeight: "600", color: theme.muted, textTransform: "uppercase", letterSpacing: 0.5 },
    trendMeta: { fontSize: 10.5, color: theme.muted },
    trendChart: { flexDirection: "row", alignItems: "flex-end", gap: 6, height: TREND_BAR_HEIGHT },
    trendCol: { flex: 1, alignItems: "center", gap: 4 },
    trendBarWrap: { flex: 1, width: "100%", justifyContent: "flex-end" },
    trendBar: { width: "100%", borderTopLeftRadius: 4, borderTopRightRadius: 4 },
    trendCount: { fontSize: 10, fontWeight: "600", color: theme.foreground },
    shortcutRow: { flexDirection: "row", gap: 8 },
    shortcut: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: theme.background, padding: 10, borderRadius: 8 },
    shortcutText: { fontSize: 12, fontWeight: "600", color: theme.foreground },
    pressed: { opacity: 0.7 },
  });
}
