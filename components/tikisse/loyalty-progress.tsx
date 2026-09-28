import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { type ThemedColors, useThemeColors } from "@/lib/use-theme-colors";
import { trpc } from "@/lib/trpc";
import { computeProgressPercent, formatRemainingMessage } from "@/server/_test-helpers/loyalty-progress-format";

type Progress = {
  programId: string;
  programName: string;
  programDescription: string | null;
  bonusAmount: number;
  requiredDeliveries: number;
  windowDays: number;
  completedCount: number;
  remaining: number;
  progressPct: number;
  justQualified: boolean;
  alreadyGranted: boolean;
};

function formatMoney(amount: number) {
  return `${new Intl.NumberFormat("fr-FR").format(amount)} FCFA`;
}

/**
 * `compact` retire l'en-tête « Programme de fidélité » et la description : sur
 * une page où chaque bloc se disputait la même attention, le programme tient
 * en une ligne de titre, une barre et un reste à parcourir.
 */
export function LoyaltyProgress({ phone, compact = false }: { phone: string | null; compact?: boolean }) {
  const { colors: theme } = useThemeColors();
  const styles = makeStyles(theme);
  const query = trpc.loyalty.myProgress.useQuery(undefined, { enabled: Boolean(phone) });
  if (!phone) return null;
  if (query.isLoading) {
    return (
      <View style={styles.card}>
        <View style={styles.row}><MaterialIcons name="card-giftcard" size={18} color={theme.primary} /><Text style={styles.title}>Programme de fidélité</Text></View>
        <View style={styles.loading}><ActivityIndicator size="small" color={theme.primary} /></View>
      </View>
    );
  }
  const programs = (query.data ?? []) as Progress[];
  if (programs.length === 0) return null;
  return (
    <View style={compact ? styles.cardCompact : styles.card}>
      {compact ? null : <View style={styles.row}><MaterialIcons name="card-giftcard" size={18} color={theme.primary} /><Text style={styles.title}>Programme de fidélité</Text></View>}
      {programs.map((program) => (
        <View key={program.programId} style={compact ? styles.itemCompact : styles.item}>
          <View style={styles.itemHeader}>
            <Text style={styles.itemName} numberOfLines={1}>{program.programName}</Text>
            <Text style={styles.bonus}>{formatMoney(program.bonusAmount)}</Text>
          </View>
          {program.programDescription && !compact ? <Text style={styles.itemDesc} numberOfLines={2}>{program.programDescription}</Text> : null}
          <View style={styles.bar}>
            <View style={[styles.barFill, { width: `${computeProgressPercent(program.completedCount, program.requiredDeliveries)}%`, backgroundColor: program.remaining === 0 ? theme.success : theme.primary }]} />
          </View>
          <View style={styles.footRow}>
            <Text style={styles.footText}>{formatRemainingMessage({ remaining: program.remaining, alreadyGranted: program.alreadyGranted, bonusAmount: program.bonusAmount })}</Text>
            <Text style={styles.footMeta}>{program.completedCount}/{program.requiredDeliveries}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function makeStyles(theme: ThemedColors) {
  return StyleSheet.create({
    card: { backgroundColor: theme.surface, borderRadius: 10, borderWidth: 0, padding: 14, gap: 10, marginBottom: 12 },
    cardCompact: { backgroundColor: theme.surface, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border, padding: 4, gap: 8 },
    itemCompact: { backgroundColor: theme.surface, borderRadius: 11, padding: 9, gap: 7 },
    row: { flexDirection: "row", alignItems: "center", gap: 8 },
    title: { fontSize: 14, fontWeight: "600", color: theme.foreground },
    loading: { alignItems: "center", paddingVertical: 6 },
    item: { backgroundColor: theme.background, borderRadius: 8, padding: 10, gap: 6 },
    itemHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
    itemName: { flex: 1, fontSize: 13, fontWeight: "600", color: theme.foreground },
    bonus: { fontSize: 13, fontWeight: "600", color: theme.primary },
    itemDesc: { fontSize: 11.5, color: theme.muted, lineHeight: 16 },
    bar: { height: 6, backgroundColor: theme.border, borderRadius: 3, overflow: "hidden" },
    barFill: { height: "100%", borderRadius: 3 },
    footRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
    footText: { flex: 1, fontSize: 11.5, color: theme.muted },
    footMeta: { fontSize: 11, fontWeight: "600", color: theme.muted },
  });
}
