import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useThemeColors } from "@/lib/use-theme-colors";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";
import { formatListRouteParts } from "@/lib/geo-rules";
import { formatMoney, type Delivery, type DeliveryStatus } from "@/shared/tikis-domain";

type StatusFilter = "all" | "completed" | "cancelled" | "expired";
type PeriodFilter = "all" | "week" | "month";

const ARCHIVABLE_STATUSES: DeliveryStatus[] = ["completed", "expired", "cancelled", "disabled"];

function isArchivable(delivery: Delivery) {
  return ARCHIVABLE_STATUSES.includes(delivery.status);
}

function groupMonthLabel(value: string): string {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "—";
  const months = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  const month = months[d.getMonth()] ?? "—";
  return `${month.charAt(0).toUpperCase()}${month.slice(1)} ${d.getFullYear()}`;
}

function groupWeekLabel(value: string): string {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "—";
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setHours(0, 0, 0, 0);
  startOfWeek.setDate(startOfWeek.getDate() - ((startOfWeek.getDay() + 6) % 7));
  const startOfLastWeek = new Date(startOfWeek);
  startOfLastWeek.setDate(startOfLastWeek.getDate() - 7);
  const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  if (d.getTime() >= startOfWeek.getTime()) return "Cette semaine";
  if (d.getTime() >= startOfLastWeek.getTime()) return "Semaine précédente";
  if (d.getTime() >= startOfThisMonth.getTime()) return "Ce mois";
  return groupMonthLabel(value);
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

function preciseDate(value: string): string {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "—";
  const date = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${date} ${time}`;
}

function statusLabel(status: DeliveryStatus): string {
  if (status === "completed") return "Terminée";
  if (status === "cancelled") return "Annulée";
  if (status === "expired") return "Expirée";
  if (status === "disabled") return "Désactivée";
  return "—";
}

function statusIconName(status: DeliveryStatus): React.ComponentProps<typeof MaterialIcons>["name"] {
  if (status === "completed") return "check";
  if (status === "cancelled") return "close";
  if (status === "expired") return "schedule";
  return "block";
}

function statusFilterMatches(filter: StatusFilter, status: DeliveryStatus) {
  if (filter === "all") return true;
  if (filter === "completed") return status === "completed";
  if (filter === "cancelled") return status === "cancelled" || status === "disabled";
  if (filter === "expired") return status === "expired";
  return true;
}

function periodFilterMatches(filter: PeriodFilter, value: string) {
  if (filter === "all") return true;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return false;
  const now = new Date();
  if (filter === "week") {
    const startOfWeek = new Date(now);
    startOfWeek.setHours(0, 0, 0, 0);
    startOfWeek.setDate(startOfWeek.getDate() - ((startOfWeek.getDay() + 6) % 7));
    return d.getTime() >= startOfWeek.getTime();
  }
  if (filter === "month") {
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }
  return true;
}

export default function HistoryScreen() {
  const { profile } = useTikisStore();
  const { colors: theme, isDark } = useThemeColors();
  const deliveriesQuery = trpc.deliveries.list.useQuery(undefined, { enabled: Boolean(profile?.phone), refetchInterval: 5_000 });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>("all");

  const archive = useMemo(() => (deliveriesQuery.data ?? []).filter(isArchivable), [deliveriesQuery.data]);

  const history = useMemo(() => {
    const q = search.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr-FR").trim();
    return archive
      .filter((d) => statusFilterMatches(statusFilter, d.status))
      .filter((d) => periodFilterMatches(periodFilter, d.createdAt))
      .filter((d) => {
        if (!q) return true;
        const route = formatListRouteParts(d.pickup, d.dropoff);
        const haystack = [d.title, d.driverName ?? "", d.senderName ?? "", route.pickup, route.dropoff].join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr-FR");
        return haystack.includes(q);
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [archive, statusFilter, periodFilter, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, Delivery[]>();
    for (const d of history) {
      const key = periodFilter === "week" || periodFilter === "all" ? groupWeekLabel(d.createdAt) : groupMonthLabel(d.createdAt);
      const list = map.get(key) ?? [];
      list.push(d);
      map.set(key, list);
    }
    return Array.from(map.entries());
  }, [history, periodFilter]);

  const counts = useMemo(() => {
    return {
      all: archive.length,
      completed: archive.filter((d) => d.status === "completed").length,
      cancelled: archive.filter((d) => d.status === "cancelled" || d.status === "disabled").length,
      expired: archive.filter((d) => d.status === "expired").length,
    };
  }, [archive]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={["top"]}>
      <FlatList
        data={grouped}
        keyExtractor={([group]) => group}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <ArchiveHeader
            role={profile?.role ?? "sender"}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            periodFilter={periodFilter}
            setPeriodFilter={setPeriodFilter}
            search={search}
            setSearch={setSearch}
            counts={counts}
            isLoading={deliveriesQuery.isLoading}
            isDark={isDark}
          />
        }
        renderItem={({ item: [group, items] }) => <ArchiveGroup group={group} items={items} role={profile?.role ?? "sender"} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={[styles.emptyIcon, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <MaterialIcons name="inventory-2" size={28} color={theme.muted} />
            </View>
            <Text style={[styles.emptyTitle, { color: theme.foreground }]}>
              {deliveriesQuery.isLoading ? "Chargement…" : "Aucune course archivée"}
            </Text>
            <Text style={[styles.emptyText, { color: theme.muted }]}>
              {deliveriesQuery.error
                ? "Impossible de charger l’archive. Réessayez dans un instant."
                : "Les livraisons terminées, annulées ou expirées apparaîtront ici. Cet espace est en lecture seule."}
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

function ArchiveHeader({ role, statusFilter, setStatusFilter, periodFilter, setPeriodFilter, search, setSearch, counts, isLoading, isDark }: { role: "sender" | "driver"; statusFilter: StatusFilter; setStatusFilter: (k: StatusFilter) => void; periodFilter: PeriodFilter; setPeriodFilter: (k: PeriodFilter) => void; search: string; setSearch: (s: string) => void; counts: { all: number; completed: number; cancelled: number; expired: number }; isLoading: boolean; isDark: boolean }) {
  const { colors: theme } = useThemeColors();
  return (
    <View>
      <View style={styles.topbar}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.back, { backgroundColor: theme.surface, borderColor: theme.border }, pressed && styles.pressed]} accessibilityLabel="Retour">
          <MaterialIcons name="arrow-back" size={20} color={theme.foreground} />
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable style={({ pressed }) => [styles.iconBtn, { backgroundColor: theme.surface, borderColor: theme.border }, pressed && styles.pressed]} accessibilityLabel="Trier">
          <MaterialIcons name="swap-vert" size={18} color={theme.foreground} />
        </Pressable>
      </View>

      <Text style={[styles.pageTitle, { color: theme.foreground }]}>Archive des courses</Text>
      <Text style={[styles.pageSub, { color: theme.muted }]}>
        {role === "driver" ? "Vos courses terminées et expirées" : "Vos courses terminées, annulées et expirées"}
      </Text>

      <View style={styles.statsBand}>
        <StatPill value={counts.all} label="Total" tone="primary" theme={theme} />
        <StatPill value={counts.completed} label="Terminées" tone="success" theme={theme} />
        <StatPill value={counts.cancelled} label="Annulées" tone="error" theme={theme} />
        <StatPill value={counts.expired} label="Expirées" tone="warning" theme={theme} />
      </View>

      <View style={[styles.searchRow]}>
        <View style={[styles.search, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <MaterialIcons name="search" size={16} color={theme.muted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={role === "driver" ? "Rechercher titre, adresse, expéditeur…" : "Rechercher titre, adresse, livreur…"}
            placeholderTextColor={theme.muted}
            style={[styles.searchInput, { color: theme.foreground }]}
            maxLength={80}
          />
          {search ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Effacer" onPress={() => setSearch("")} style={[styles.searchClear, { backgroundColor: theme.pressed }]}>
              <MaterialIcons name="close" size={12} color={theme.muted} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={styles.chipsRow}>
        <Chip label="Tout" count={counts.all} active={statusFilter === "all"} onPress={() => setStatusFilter("all")} />
        <Chip label="Terminées" count={counts.completed} active={statusFilter === "completed"} onPress={() => setStatusFilter("completed")} />
        <Chip label="Annulées" count={counts.cancelled} active={statusFilter === "cancelled"} onPress={() => setStatusFilter("cancelled")} />
        <Chip label="Expirées" count={counts.expired} active={statusFilter === "expired"} onPress={() => setStatusFilter("expired")} />
      </View>

      <View style={styles.chipsRow}>
        <Chip label="Toutes périodes" active={periodFilter === "all"} onPress={() => setPeriodFilter("all")} icon="event" />
        <Chip label="Cette semaine" active={periodFilter === "week"} onPress={() => setPeriodFilter("week")} icon="today" />
        <Chip label="Ce mois" active={periodFilter === "month"} onPress={() => setPeriodFilter("month")} icon="calendar-month" />
      </View>
    </View>
  );
}

function StatPill({ value, label, tone, theme }: { value: number; label: string; tone: "primary" | "success" | "error" | "warning"; theme: any }) {
  const toneMap = { primary: theme.primary, success: theme.success, error: theme.error, warning: theme.warning };
  return (
    <View style={[styles.statPill, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Text style={[styles.statPillValue, { color: toneMap[tone] }]}>{value}</Text>
      <Text style={[styles.statPillLabel, { color: theme.muted }]}>{label}</Text>
    </View>
  );
}

function Chip({ label, count, active, onPress, icon }: { label: string; count?: number; active: boolean; onPress: () => void; icon?: React.ComponentProps<typeof MaterialIcons>["name"] }) {
  const { colors: theme } = useThemeColors();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.chip, active ? { backgroundColor: theme.primary, borderColor: theme.primary } : { backgroundColor: theme.surface, borderColor: theme.border }, pressed && styles.pressed]} accessibilityRole="tab" accessibilityState={{ selected: active }}>
      {icon ? <MaterialIcons name={icon} size={12} color={active ? "#FFFFFF" : theme.muted} /> : null}
      <Text style={[styles.chipText, { color: active ? "#FFFFFF" : theme.muted }]}>{label}</Text>
      {typeof count === "number" ? (
        <View style={[styles.chipCount, { backgroundColor: active ? "rgba(255,255,255,0.22)" : theme.pressed }]}>
          <Text style={[styles.chipCountText, { color: active ? "#FFFFFF" : theme.primary }]}>{count}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function ArchiveGroup({ group, items, role }: { group: string; items: Delivery[]; role: "sender" | "driver" }) {
  const { colors: theme } = useThemeColors();
  return (
    <View style={styles.group}>
      <View style={styles.groupHeader}>
        <Text style={[styles.groupLabel, { color: theme.muted }]}>{group.toUpperCase()}</Text>
        <Text style={[styles.groupCount, { color: theme.muted }]}>{items.length} entrée{items.length > 1 ? "s" : ""}</Text>
      </View>
      <View style={[styles.listCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        {items.map((delivery, index) => (
          <ArchiveRow
            key={delivery.id}
            delivery={delivery}
            role={role}
            isLast={index === items.length - 1}
          />
        ))}
      </View>
    </View>
  );
}

function ArchiveRow({ delivery, role, isLast }: { delivery: Delivery; role: "sender" | "driver"; isLast: boolean }) {
  const { colors: theme } = useThemeColors();
  const counterpart = role === "sender" ? delivery.driverName ?? "Aucun livreur" : delivery.senderName ?? "Aucun expéditeur";
  const amount = delivery.offeredPrice ?? delivery.estimatedPrice;
  const isMonetary = delivery.status === "completed";
  const statusBg: Record<DeliveryStatus, string> = {
    completed: "#E2F3F4",
    cancelled: "#FDEBEC",
    expired: "#FEF6E2",
    disabled: "#EEEDF3",
    draft: "#EEEDF3",
    open: "#F7EFE5",
    pending_confirmation: "#F7EFE5",
    active: "#F7EFE5",
  };
  const statusColor: Record<DeliveryStatus, string> = {
    completed: theme.success,
    cancelled: theme.error,
    expired: theme.warning,
    disabled: theme.muted,
    draft: theme.muted,
    open: theme.primary,
    pending_confirmation: theme.primary,
    active: theme.primary,
  };
  return (
    <Pressable
      onPress={() => router.push(`/delivery/${delivery.id}` as any)}
      style={({ pressed }) => [styles.row, !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border }, pressed && { backgroundColor: theme.pressed }]}
      accessibilityRole="button"
      accessibilityLabel={`${delivery.title}, ${statusLabel(delivery.status)}`}
    >
      <View style={[styles.statusIcon, { backgroundColor: statusBg[delivery.status] }]}>
        <MaterialIcons name={statusIconName(delivery.status)} size={14} color={statusColor[delivery.status]} />
      </View>
      <View style={styles.rowBody}>
        <Text style={[styles.rowTitle, { color: theme.foreground }]} numberOfLines={1}>{delivery.title}</Text>
        <View style={styles.rowMeta}>
          <Text style={[styles.rowMetaText, { color: theme.muted }]} numberOfLines={1}>{counterpart}</Text>
          <Text style={[styles.rowMetaSep, { color: theme.border }]}>·</Text>
          <Text style={[styles.rowMetaText, { color: theme.muted }]} numberOfLines={1}>{shortDate(delivery.createdAt)}</Text>
        </View>
      </View>
      <View style={styles.rowRight}>
        <Text style={[styles.rowAmount, isMonetary ? { color: theme.foreground } : { color: theme.muted }]}>{isMonetary ? formatMoney(amount) : "—"}</Text>
        <Text style={[styles.rowDate, { color: theme.muted }]}>{preciseDate(delivery.createdAt)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 40, gap: 12 },

  topbar: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 6, paddingBottom: 4 },
  back: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  iconBtn: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  pressed: { opacity: 0.7 },

  pageTitle: { fontSize: 22, fontWeight: "800", letterSpacing: -0.5, marginTop: 6 },
  pageSub: { fontSize: 12, marginTop: 2 },

  statsBand: { flexDirection: "row", gap: 6, marginTop: 14 },
  statPill: { flex: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 6, alignItems: "center", borderWidth: 1, gap: 2 },
  statPillValue: { fontSize: 16, fontWeight: "800", letterSpacing: -0.3 },
  statPillLabel: { fontSize: 9, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase" },

  searchRow: { marginTop: 14 },
  search: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, height: 40, borderRadius: 10, borderWidth: 1 },
  searchInput: { flex: 1, fontSize: 13, fontWeight: "500", paddingVertical: 0 },
  searchClear: { width: 20, height: 20, borderRadius: 6, alignItems: "center", justifyContent: "center" },

  chipsRow: { flexDirection: "row", gap: 6, marginTop: 8, flexWrap: "wrap" },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 99, borderWidth: 1 },
  chipText: { fontSize: 12, fontWeight: "600" },
  chipCount: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 99, minWidth: 20, alignItems: "center", justifyContent: "center" },
  chipCountText: { fontSize: 10, fontWeight: "700" },

  group: { marginTop: 12 },
  groupHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 2, paddingBottom: 6 },
  groupLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 0.6 },
  groupCount: { fontSize: 10, fontWeight: "600" },

  listCard: { borderRadius: 12, overflow: "hidden", borderWidth: 1, paddingHorizontal: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12 },
  statusIcon: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 13, fontWeight: "600", letterSpacing: -0.1 },
  rowMeta: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 },
  rowMetaText: { fontSize: 10, fontWeight: "500" },
  rowMetaSep: { fontSize: 10 },
  rowRight: { alignItems: "flex-end", flexShrink: 0 },
  rowAmount: { fontSize: 12, fontWeight: "700", fontVariant: ["tabular-nums"] },
  rowDate: { fontSize: 9, fontWeight: "500", marginTop: 2, fontVariant: ["tabular-nums"] },

  empty: { alignItems: "center", paddingTop: 60, paddingHorizontal: 30, gap: 6 },
  emptyIcon: { width: 64, height: 64, borderRadius: 16, alignItems: "center", justifyContent: "center", borderWidth: 1, marginBottom: 8 },
  emptyTitle: { fontSize: 15, fontWeight: "600", marginTop: 4 },
  emptyText: { fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 4 },
});
