import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useThemeColors } from "@/lib/use-theme-colors";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";
import { formatListRouteParts } from "@/lib/geo-rules";
import { deliveryStatusMeta, formatMoney, formatRelativeDate, type Delivery, type DeliveryStatus } from "@/shared/tikis-domain";

type FilterKey = "all" | "ongoing" | "done";

const STATUS_GROUP: Record<DeliveryStatus, "ongoing" | "done"> = {
  draft: "ongoing",
  open: "ongoing",
  pending_confirmation: "ongoing",
  active: "ongoing",
  completed: "done",
  cancelled: "done",
  expired: "done",
  disabled: "done",
};

function statusKey(delivery: Delivery): "ongoing" | "done" {
  return STATUS_GROUP[delivery.status] ?? "done";
}

function groupMonthLabel(value: string): string {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "—";
  const months = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  const month = months[d.getMonth()] ?? "—";
  return `${month.charAt(0).toUpperCase()}${month.slice(1)} ${d.getFullYear()}`;
}

function shortDate(value: string): string {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "—";
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "à l’instant";
  if (diffMin < 60) return `il y a ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `il y a ${diffH} h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `il y a ${diffD} j`;
  return `${d.getDate()} ${["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."][d.getMonth()] ?? ""}`;
}

function statusLabel(status: DeliveryStatus): string {
  if (status === "completed") return "Terminée";
  if (status === "cancelled") return "Annulée";
  if (status === "expired") return "Expirée";
  if (status === "disabled") return "Désactivée";
  if (status === "active") return "En cours";
  if (status === "pending_confirmation") return "À confirmer";
  if (status === "open") return "Publiée";
  return "Brouillon";
}

export default function HistoryScreen() {
  const { role, profile } = useTikisStore();
  const { isDark, colors: theme } = useThemeColors();
  const deliveriesQuery = trpc.deliveries.list.useQuery(undefined, { enabled: Boolean(profile?.phone) });
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");

  const history = useMemo(() => {
    const all = (deliveriesQuery.data ?? []).filter((d) => d.status === "completed" || d.status === "expired" || d.status === "cancelled" || d.status === "disabled");
    const q = search.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr-FR").trim();
    return all
      .filter((d) => {
        if (filter === "ongoing") return statusKey(d) === "ongoing";
        if (filter === "done") return statusKey(d) === "done";
        return true;
      })
      .filter((d) => {
        if (!q) return true;
        const route = formatListRouteParts(d.pickup, d.dropoff);
        const haystack = [d.title, d.driverName ?? "", d.senderName ?? "", route.pickup, route.dropoff].join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr-FR");
        return haystack.includes(q);
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [deliveriesQuery.data, filter, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, Delivery[]>();
    for (const d of history) {
      const key = groupMonthLabel(d.createdAt);
      const list = map.get(key) ?? [];
      list.push(d);
      map.set(key, list);
    }
    return Array.from(map.entries());
  }, [history]);

  const counts = useMemo(() => {
    const all = (deliveriesQuery.data ?? []).filter((d) => d.status === "completed" || d.status === "expired" || d.status === "cancelled" || d.status === "disabled");
    return {
      all: all.length,
      ongoing: all.filter((d) => statusKey(d) === "ongoing").length,
      done: all.filter((d) => statusKey(d) === "done").length,
    };
  }, [deliveriesQuery.data]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={["left", "right"]}>
      <FlatList
        data={grouped}
        keyExtractor={([month]) => month}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <HistoryHeader
            role={role}
            filter={filter}
            setFilter={setFilter}
            search={search}
            setSearch={setSearch}
            counts={counts}
            isLoading={deliveriesQuery.isLoading}
          />
        }
        renderItem={({ item: [month, items] }) => (
          <HistorySection month={month} items={items} role={role} isDark={isDark} theme={theme} />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <MaterialIcons name={deliveriesQuery.isLoading ? "hourglass-empty" : "history"} size={32} color={theme.muted} />
            <Text style={[styles.emptyTitle, { color: theme.foreground }]}>{deliveriesQuery.isLoading ? "Chargement…" : "Aucun historique"}</Text>
            <Text style={[styles.emptyText, { color: theme.muted }]}>
              {deliveriesQuery.error
                ? "Impossible de charger l’historique. Réessayez dans un instant."
                : "Les livraisons terminées, annulées ou expirées apparaîtront ici avec leur statut et leur date."}
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

function HistoryHeader({ role, filter, setFilter, search, setSearch, counts, isLoading }: { role: "sender" | "driver"; filter: FilterKey; setFilter: (k: FilterKey) => void; search: string; setSearch: (s: string) => void; counts: { all: number; ongoing: number; done: number }; isLoading: boolean }) {
  const { colors: theme } = useThemeColors();
  return (
    <View>
      <View style={styles.pageHeader}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.back, pressed && styles.pressed]} accessibilityLabel="Retour">
          <MaterialIcons name="arrow-back" size={20} color={theme.foreground} />
        </Pressable>
        <View style={styles.pageHeaderText}>
          <Text style={[styles.pageEyebrow, { color: theme.muted }]}>Historique</Text>
          <Text style={[styles.pageTitle, { color: theme.foreground }]}>{role === "sender" ? "Toutes mes courses" : "Mes courses"}</Text>
        </View>
      </View>

      <View style={styles.searchRow}>
        <View style={[styles.search, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <MaterialIcons name="search" size={16} color={theme.muted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Rechercher"
            placeholderTextColor={theme.muted}
            style={[styles.searchInput, { color: theme.foreground }]}
            maxLength={80}
          />
          {search ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Effacer" onPress={() => setSearch("")} style={styles.searchClear}>
              <MaterialIcons name="close" size={12} color={theme.muted} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={[styles.tabs, { borderBottomColor: theme.border }]}>
        <Tab label="Tout" count={counts.all} active={filter === "all"} onPress={() => setFilter("all")} />
        <Tab label="Non terminées" count={counts.ongoing} active={filter === "ongoing"} onPress={() => setFilter("ongoing")} />
        <Tab label="Terminées" count={counts.done} active={filter === "done"} onPress={() => setFilter("done")} />
      </View>

      {!isLoading && (counts.all > 0 || counts.ongoing > 0) ? null : null}
    </View>
  );
}

function Tab({ label, count, active, onPress }: { label: string; count: number; active: boolean; onPress: () => void }) {
  const { colors: theme } = useThemeColors();
  return (
    <Pressable onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: active }} style={({ pressed }) => [styles.tab, pressed && styles.pressed]}>
      <Text style={[styles.tabLabel, { color: active ? theme.foreground : theme.muted }]}>{label}</Text>
      <Text style={[styles.tabCount, { color: theme.muted }]}>{count}</Text>
      {active ? <View style={[styles.tabIndicator, { backgroundColor: theme.foreground }]} /> : null}
    </Pressable>
  );
}

function HistorySection({ month, items, role, isDark, theme }: { month: string; items: Delivery[]; role: "sender" | "driver"; isDark: boolean; theme: any }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: theme.muted }]}>{month.toUpperCase()}</Text>
        <Text style={[styles.sectionCount, { color: theme.muted }]}>{items.length} course{items.length > 1 ? "s" : ""}</Text>
      </View>
      <View style={[styles.listCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        {items.map((delivery, index) => (
          <HistoryRow
            key={delivery.id}
            delivery={delivery}
            role={role}
            isDark={isDark}
            theme={theme}
            isLast={index === items.length - 1}
          />
        ))}
      </View>
    </View>
  );
}

function HistoryRow({ delivery, role, isDark, theme, isLast }: { delivery: Delivery; role: "sender" | "driver"; isDark: boolean; theme: any; isLast: boolean }) {
  const counterpart = role === "sender" ? delivery.driverName ?? "Livreur" : delivery.senderName ?? "Expéditeur";
  const route = formatListRouteParts(delivery.pickup, delivery.dropoff);
  const amount = delivery.offeredPrice ?? delivery.estimatedPrice;
  const isMonetary = delivery.status === "completed";
  const stripeOpacity = delivery.status === "completed" ? 1 : 0.35;
  const stripeColor = delivery.status === "completed" ? theme.foreground : theme.muted;
  const dateLine = `${statusLabel(delivery.status)} · ${shortDate(delivery.createdAt)}`;
  const routeLine = route.pickup && route.dropoff ? `${route.pickup} → ${route.dropoff}` : route.pickup || route.dropoff;
  return (
    <Pressable
      onPress={() => router.push(`/delivery/${delivery.id}` as any)}
      style={({ pressed }) => [styles.row, !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border }, pressed && styles.rowPressed]}
      accessibilityRole="button"
    >
      <View style={[styles.stripe, { backgroundColor: stripeColor, opacity: stripeOpacity }]} />
      <View style={styles.rowBody}>
        <Text style={[styles.rowTitle, { color: theme.foreground }]} numberOfLines={1}>{delivery.title}</Text>
        <Text style={[styles.rowSub, { color: theme.muted }]} numberOfLines={1}>{counterpart} · {routeLine}</Text>
      </View>
      <View style={styles.rowRight}>
        <Text style={[styles.rowAmount, { color: isMonetary ? theme.foreground : theme.muted }]}>{isMonetary ? formatMoney(amount) : "—"}</Text>
        <Text style={[styles.rowDate, { color: theme.muted }]} numberOfLines={1}>{dateLine}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 32, gap: 16 },

  pageHeader: { flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 12, paddingBottom: 4 },
  back: { width: 36, height: 36, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  pageHeaderText: { flex: 1 },
  pageEyebrow: { fontSize: 11, fontWeight: "500", letterSpacing: 0.3 },
  pageTitle: { fontSize: 20, fontWeight: "600", letterSpacing: -0.4, marginTop: 2, lineHeight: 26 },
  pressed: { opacity: 0.5 },

  searchRow: { paddingTop: 8, paddingBottom: 4 },
  search: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, height: 40, borderRadius: 8, borderWidth: 1 },
  searchInput: { flex: 1, fontSize: 13, fontWeight: "500", paddingVertical: 0 },
  searchClear: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.06)" },

  tabs: { flexDirection: "row", gap: 20, marginTop: 4, borderBottomWidth: 1 },
  tab: { paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 5, position: "relative" },
  tabLabel: { fontSize: 13, fontWeight: "600" },
  tabCount: { fontSize: 10, fontWeight: "500" },
  tabIndicator: { position: "absolute", left: 0, right: 0, bottom: -1, height: 1 },

  section: { marginTop: 6 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: 6, paddingHorizontal: 2 },
  sectionTitle: { fontSize: 10, fontWeight: "700", letterSpacing: 1.2 },
  sectionCount: { fontSize: 10, fontWeight: "500" },

  listCard: { borderRadius: 10, borderWidth: 1, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, paddingHorizontal: 14 },
  rowPressed: { backgroundColor: "rgba(0,0,0,0.02)" },
  stripe: { width: 2, alignSelf: "stretch", borderRadius: 1 },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 13, fontWeight: "600", letterSpacing: -0.1 },
  rowSub: { fontSize: 11, fontWeight: "500", marginTop: 3 },
  rowRight: { alignItems: "flex-end" },
  rowAmount: { fontSize: 13, fontWeight: "700", fontVariant: ["tabular-nums"] },
  rowDate: { fontSize: 10, fontWeight: "500", marginTop: 3, maxWidth: 130 },

  empty: { alignItems: "center", paddingTop: 60, paddingHorizontal: 30, gap: 6 },
  emptyTitle: { fontSize: 15, fontWeight: "600", marginTop: 8 },
  emptyText: { fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 4 },
});
