import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useMemo } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useThemeColors } from "@/lib/use-theme-colors";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";
import { formatMoney } from "@/shared/tikis-domain";
import { trendBarValue } from "@/server/_test-helpers/analytics-format";

type SenderStats = {
  month: { year: number; month: number; label: string; deliveriesCount: number; totalSpent: number };
  allTime: { deliveriesCount: number; totalSpent: number; averagePrice: number };
  trend: Array<{ year: number; month: number; label: string; deliveriesCount: number; totalSpent: number }>;
  preferredDrivers: Array<{ driverPhone: string; driverName: string; deliveriesCount: number; totalSpent: number; averageRating: number }>;
};

const FRENCH_MONTHS_SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

export default function AnalyticsTabScreen() {
  const { colors: theme } = useThemeColors();
  const styles = makeStyles(theme);
  const profile = useTikisStore((state) => state.profile);
  const query = trpc.analytics.mySenderStats.useQuery(undefined, {
    enabled: Boolean(profile?.phone) && profile?.role === "sender",
    refetchInterval: 60_000,
  });

  const trendMax = useMemo(() => {
    const stats = query.data as SenderStats | null | undefined;
    if (!stats) return { deliveriesCount: 0, totalSpent: 0 };
    return stats.trend.reduce(
      (acc, row) => ({
        deliveriesCount: Math.max(acc.deliveriesCount, row.deliveriesCount),
        totalSpent: Math.max(acc.totalSpent, row.totalSpent),
      }),
      { deliveriesCount: 0, totalSpent: 0 },
    );
  }, [query.data]);

  if (profile?.role !== "sender") {
    return (
      <SafeAreaView style={styles.safe} edges={["bottom"]}>
        <View style={styles.empty}>
          <MaterialIcons name="bar-chart" size={36} color={theme.muted} />
          <Text style={styles.emptyTitle}>Vue analytics réservée aux expéditeurs</Text>
          <Text style={styles.emptyText}>Cette page récapitule vos dépenses de livraison. Bascule sur un compte expéditeur pour y accéder.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (query.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={["bottom"]}>
        <View style={styles.loadingWrap}><ActivityIndicator size="large" color={theme.primary} /></View>
      </SafeAreaView>
    );
  }

  const stats = query.data as SenderStats | null;
  if (!stats) {
    return (
      <SafeAreaView style={styles.safe} edges={["bottom"]}>
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Aucune donnée à afficher</Text>
          <Text style={styles.emptyText}>Vos premières livraisons apparaîtront ici dès qu'elles seront terminées.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Mes dépenses</Text>
        <Text style={styles.subtitle}>Aperçu de vos livraisons terminées et de vos livreurs préférés.</Text>

        <View style={styles.kpiGrid}>
          <View style={styles.kpi}>
            <Text style={styles.kpiLabel}>{stats.month.label}</Text>
            <Text style={styles.kpiValue}>{formatMoney(stats.month.totalSpent)}</Text>
            <Text style={styles.kpiFoot}>{stats.month.deliveriesCount} livraison{stats.month.deliveriesCount > 1 ? "s" : ""} ce mois-ci</Text>
          </View>
          <View style={styles.kpi}>
            <Text style={styles.kpiLabel}>Total dépensé</Text>
            <Text style={styles.kpiValue}>{formatMoney(stats.allTime.totalSpent)}</Text>
            <Text style={styles.kpiFoot}>{stats.allTime.deliveriesCount} livraison{stats.allTime.deliveriesCount > 1 ? "s" : ""} depuis l'ouverture</Text>
          </View>
          <View style={styles.kpi}>
            <Text style={styles.kpiLabel}>Panier moyen</Text>
            <Text style={styles.kpiValue}>{formatMoney(Math.round(stats.allTime.averagePrice))}</Text>
            <Text style={styles.kpiFoot}>sur l’ensemble de vos courses</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Tendance 6 mois</Text>
          <View style={styles.trendChart}>
            {stats.trend.map((row) => {
              const height = trendBarValue(row, trendMax);
              return (
                <View key={`${row.year}-${row.month}`} style={styles.trendCol}>
                  <View style={styles.trendBarWrap}>
                    <View style={[styles.trendBar, { height: `${Math.max(2, height)}%`, backgroundColor: height > 0 ? theme.primary : theme.border }]} />
                  </View>
                  <Text style={styles.trendCount}>{row.deliveriesCount || "·"}</Text>
                  <Text style={styles.trendLabel}>{FRENCH_MONTHS_SHORT[(row.month - 1) % 12] ?? ""}</Text>
                </View>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Vos livreurs préférés</Text>
          {stats.preferredDrivers.length === 0 ? (
            <Text style={styles.emptyHint}>Aucune livraison avec un livreur attitré pour l’instant.</Text>
          ) : (
            stats.preferredDrivers.map((driver) => (
              <View key={driver.driverPhone} style={styles.driverRow}>
                <View style={[styles.driverAvatar, { backgroundColor: theme.background }]}>
                  <Text style={styles.driverInitials}>{driver.driverName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</Text>
                </View>
                <View style={styles.driverInfo}>
                  <Text style={styles.driverName} numberOfLines={1}>{driver.driverName}</Text>
                  <Text style={styles.driverMeta}>{driver.deliveriesCount} course{driver.deliveriesCount > 1 ? "s" : ""} · {formatMoney(driver.totalSpent)}</Text>
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(theme: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: theme.background },
    content: { padding: 16, paddingBottom: 32, gap: 16 },
    title: { fontSize: 22, fontWeight: "600", color: theme.foreground },
    subtitle: { fontSize: 13, color: theme.muted, lineHeight: 19, marginTop: 4 },
    loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
    empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 8 },
    emptyTitle: { fontSize: 16, fontWeight: "600", color: theme.foreground, textAlign: "center" },
    emptyText: { fontSize: 13, color: theme.muted, textAlign: "center", lineHeight: 19 },
    emptyHint: { fontSize: 12, color: theme.muted },
    kpiGrid: { gap: 10 },
    kpi: { backgroundColor: theme.surface, borderRadius: 10, padding: 14, borderWidth: 0, gap: 4 },
    kpiLabel: { fontSize: 11, fontWeight: "600", color: theme.muted, textTransform: "uppercase", letterSpacing: 0.5 },
    kpiValue: { fontSize: 22, fontWeight: "600", color: theme.foreground, fontVariantNumeric: "tabular-nums" },
    kpiFoot: { fontSize: 12, color: theme.muted },
    section: { backgroundColor: theme.surface, borderRadius: 10, padding: 14, borderWidth: 0, gap: 12 },
    sectionTitle: { fontSize: 14, fontWeight: "600", color: theme.foreground },
    trendChart: { flexDirection: "row", alignItems: "flex-end", gap: 6, height: 130 },
    trendCol: { flex: 1, alignItems: "center", gap: 4 },
    trendBarWrap: { flex: 1, width: "100%", justifyContent: "flex-end" },
    trendBar: { width: "100%", borderTopLeftRadius: 4, borderTopRightRadius: 4 },
    trendCount: { fontSize: 11, fontWeight: "600", color: theme.foreground, fontVariantNumeric: "tabular-nums" },
    trendLabel: { fontSize: 10, color: theme.muted },
    driverRow: { flexDirection: "row", alignItems: "center", gap: 12 },
    driverAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
    driverInitials: { fontSize: 13, fontWeight: "600", color: theme.primary },
    driverInfo: { flex: 1, minWidth: 0 },
    driverName: { fontSize: 14, fontWeight: "600", color: theme.foreground },
    driverMeta: { fontSize: 11.5, color: theme.muted, marginTop: 2 },
  });
}
