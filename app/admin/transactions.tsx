import { Stack } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useThemeColors } from "@/lib/use-theme-colors";
import { trpc } from "@/lib/trpc";
import { formatMoney } from "@/shared/tikis-domain";

const TYPES = ["all", "commission", "deposit", "withdrawal", "payout", "refund"] as const;
const TYPE_LABELS: Record<(typeof TYPES)[number], string> = {
  all: "Toutes",
  commission: "Commissions",
  deposit: "Dépôts",
  withdrawal: "Retraits",
  payout: "Paiements",
  refund: "Remboursements",
};

export default function AdminTransactions() {
  const { colors: theme } = useThemeColors();
  const [type, setType] = useState<(typeof TYPES)[number]>("all");
  const [page, setPage] = useState(1);
  const query = trpc.adminConsole.ui.ledger.useQuery({ type, page, pageSize: 50 });

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 60 }}>
        <Text style={[styles.title, { color: theme.foreground }]}>Transactions</Text>
        <Text style={[styles.sub, { color: theme.muted }]}>Journal financier consolidé · {query.data?.total ?? 0} écritures</Text>

        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border, marginTop: 16 }]}>
          <View style={[styles.tabsRow, { borderBottomColor: theme.border }]}>
            {TYPES.map((t) => (
              <Pressable key={t} onPress={() => { setType(t); setPage(1); }} style={[styles.tab, type === t && { backgroundColor: theme.primary + "1F" }]}>
                <Text style={{ fontSize: 12, fontWeight: "600", color: type === t ? theme.primary : theme.muted }}>{TYPE_LABELS[t]}</Text>
              </Pressable>
            ))}
          </View>
          {query.isLoading ? (
            <View style={{ padding: 32, alignItems: "center" }}><ActivityIndicator color={theme.primary} /></View>
          ) : (
            <View>
              {query.data?.items.map((r: { id: string; description: string; profilePhone: string; operation: string; amount: number; createdAt: string }) => (
                <View key={r.id} style={[styles.row, { borderBottomColor: theme.border }]}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontSize: 12.5, fontWeight: "500", color: theme.foreground }} numberOfLines={1}>{r.description}</Text>
                    <Text style={{ fontSize: 11, color: theme.muted, marginTop: 2 }}>{r.profilePhone} · {r.operation}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: r.amount >= 0 ? theme.foreground : theme.error }}>
                      {r.amount >= 0 ? "+" : ""}{formatMoney(Math.abs(r.amount))}
                    </Text>
                    <Text style={{ fontSize: 11, color: theme.muted, marginTop: 2 }}>{new Date(r.createdAt).toISOString().slice(0, 10)}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 20, fontWeight: "600", letterSpacing: -0.4 },
  sub: { fontSize: 12.5, marginTop: 4 },
  card: { borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  tabsRow: { flexDirection: "row", padding: 8, gap: 4, borderBottomWidth: StyleSheet.hairlineWidth, flexWrap: "wrap" },
  tab: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  row: { flexDirection: "row", padding: 12, borderBottomWidth: StyleSheet.hairlineWidth, gap: 10, alignItems: "center" },
});
