import { MaterialIcons } from "@expo/vector-icons";
import { Stack } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useThemeColors } from "@/lib/use-theme-colors";
import { trpc } from "@/lib/trpc";
import { formatMoney } from "@/shared/tikis-domain";

type DeliveryItem = {
  id: string;
  status: string;
  pickupLabel: string;
  dropoffLabel: string;
  senderName: string | null;
  senderPhone: string;
  driverName: string | null;
  vehicle: string | null;
  candidatesCount: number;
  offeredPrice: number | null;
  createdAt: string;
};

const STATUSES = ["all", "open", "pending_confirmation", "active", "completed", "cancelled", "expired", "disabled"] as const;
const STATUS_LABELS: Record<(typeof STATUSES)[number], string> = {
  all: "Toutes",
  open: "Publiée",
  pending_confirmation: "Sélection",
  active: "Active",
  completed: "Terminée",
  cancelled: "Annulée",
  expired: "Expirée",
  disabled: "Désactivée",
};
const STATUS_TONES: Record<(typeof STATUSES)[number], "info" | "success" | "warning" | "error" | "default"> = {
  all: "default",
  open: "default",
  pending_confirmation: "info",
  active: "success",
  completed: "success",
  cancelled: "default",
  expired: "error",
  disabled: "warning",
};

export default function AdminDeliveries() {
  const { colors: theme } = useThemeColors();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("all");
  const [search, setSearch] = useState("");

  const query = trpc.adminConsole.ui.deliveries.useQuery(
    { page, pageSize: 25, status, search: search || undefined },
    { refetchInterval: 15_000 },
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 60 }}>
        <Text style={[styles.title, { color: theme.foreground }]}>Courses</Text>
        <Text style={[styles.sub, { color: theme.muted }]}>
          Vue opérationnelle de toutes les livraisons · {query.data?.total ?? 0} au total
        </Text>

        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border, marginTop: 16 }]}>
          <View style={[styles.tabsRow, { borderBottomColor: theme.border }]}>
            {STATUSES.map((s) => (
              <Pressable key={s} onPress={() => { setStatus(s); setPage(1); }} style={[styles.tab, status === s && { backgroundColor: theme.primary + "1F" }]}>
                <Text style={{ fontSize: 12, fontWeight: "600", color: status === s ? theme.primary : theme.muted }}>{STATUS_LABELS[s]}</Text>
              </Pressable>
            ))}
          </View>
          <View style={{ padding: 12, flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <TextInput
              value={search}
              onChangeText={(v) => { setSearch(v); setPage(1); }}
              placeholder="Rechercher ID, contact, adresse…"
              placeholderTextColor={theme.muted}
              style={[styles.input, { backgroundColor: theme.background, borderColor: theme.border, color: theme.foreground }]}
            />
          </View>

          {query.isLoading ? (
            <View style={{ padding: 32, alignItems: "center" }}><ActivityIndicator color={theme.primary} /></View>
          ) : (query.data?.items.length ?? 0) === 0 ? (
            <View style={{ padding: 40, alignItems: "center" }}>
              <Text style={{ color: theme.muted, fontSize: 12.5 }}>Aucun résultat.</Text>
            </View>
          ) : (
            <View>
              {query.data!.items.map((d: DeliveryItem) => {
                const tone = STATUS_TONES[d.status as (typeof STATUSES)[number]];
                return (
                  <View key={d.id} style={[styles.row, { borderBottomColor: theme.border }]}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <Text style={{ fontSize: 12.5, fontWeight: "600", color: theme.foreground }}>#{d.id.slice(0, 12)}</Text>
                        <StatusPill status={d.status} tone={tone} theme={theme} />
                      </View>
                      <Text style={{ fontSize: 12, color: theme.muted }} numberOfLines={1}>
                        {d.pickupLabel} → {d.dropoffLabel}
                      </Text>
                      <Text style={{ fontSize: 11, color: theme.muted, marginTop: 2 }}>
                        {d.senderName ?? d.senderPhone} {d.driverName ? `· ${d.driverName}` : ""} · {d.vehicle ?? "—"} · {d.candidatesCount} candidats
                      </Text>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={{ fontSize: 13, fontWeight: "600", color: theme.foreground }}>{d.offeredPrice ? formatMoney(d.offeredPrice) : "—"}</Text>
                      <Text style={{ fontSize: 11, color: theme.muted, marginTop: 2 }}>{formatTime(d.createdAt)}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          <View style={[styles.pagination, { borderTopColor: theme.border }]}>
            <Text style={{ fontSize: 11.5, color: theme.muted }}>
              Page {query.data?.page ?? 1} · {query.data?.total ?? 0} résultats
            </Text>
            <View style={{ flexDirection: "row", gap: 4 }}>
              <Pressable onPress={() => setPage((p) => Math.max(1, p - 1))} style={[styles.pageBtn, { borderColor: theme.border }]}>
                <MaterialIcons name="chevron-left" size={14} color={theme.foreground} />
              </Pressable>
              <Pressable onPress={() => setPage((p) => p + 1)} style={[styles.pageBtn, { borderColor: theme.border }]}>
                <MaterialIcons name="chevron-right" size={14} color={theme.foreground} />
              </Pressable>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function StatusPill({ status, tone, theme }: { status: string; tone: "info" | "success" | "warning" | "error" | "default"; theme: any }) {
  const colors: Record<typeof tone, { bg: string; fg: string }> = {
    info: { bg: "#2C5BA81A", fg: "#2C5BA8" },
    success: { bg: theme.success + "1A", fg: theme.success },
    warning: { bg: theme.warning + "1A", fg: theme.warning },
    error: { bg: theme.error + "1A", fg: theme.error },
    default: { bg: theme.border, fg: theme.muted },
  };
  const c = colors[tone];
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 99, backgroundColor: c.bg }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.fg }} />
      <Text style={{ fontSize: 11, fontWeight: "600", color: c.fg }}>{STATUS_LABELS[status as (typeof STATUSES)[number]] ?? status}</Text>
    </View>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  title: { fontSize: 20, fontWeight: "600", letterSpacing: -0.4 },
  sub: { fontSize: 12.5, marginTop: 4 },
  card: { borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  tabsRow: { flexDirection: "row", padding: 8, gap: 4, borderBottomWidth: StyleSheet.hairlineWidth, flexWrap: "wrap" },
  tab: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  input: { flex: 1, minWidth: 220, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, fontSize: 12.5, borderWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: "row", padding: 12, borderBottomWidth: StyleSheet.hairlineWidth, gap: 10, alignItems: "center" },
  pagination: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 12, borderTopWidth: StyleSheet.hairlineWidth },
  pageBtn: { width: 28, height: 28, borderRadius: 6, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth },
});
