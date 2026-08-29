import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { SafeAreaView } from "react-native-safe-area-context";
import { TikisButton } from "@/components/tikis/ui";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";
import { formatNavigationTarget } from "@/lib/geo-rules";
import { type Delivery, type DeliveryType } from "@/shared/tikis-domain";

const SHEET_PEEK = 130;
const SHEET_EXPANDED = 560;

type Filter = "active" | "upcoming" | "done";
type TypeFilter = "all" | DeliveryType;

const TYPE_ICON: Record<DeliveryType, React.ComponentProps<typeof MaterialIcons>["name"]> = {
  Plis: "inventory-2",
  Personne: "directions-run",
  Autre: "category",
};

const TYPE_LABEL: Record<DeliveryType, string> = {
  Plis: "Plis",
  Personne: "Personnes",
  Autre: "Autres",
};

function isActiveStatus(status: Delivery["status"]): boolean {
  return status === "pending_confirmation" || status === "active";
}

function isUpcomingStatus(status: Delivery["status"]): boolean {
  return status === "open" || status === "pending_confirmation";
}

function statusChipProps(status: Delivery["status"]): { label: string; color: string; bg: string } {
  if (status === "active") return { label: "EN ROUTE", color: "#167A55", bg: "#E2F3F4" };
  if (status === "pending_confirmation") return { label: "EN ATTENTE", color: "#9A6200", bg: "#FEF6E2" };
  if (status === "open") return { label: "PUBLIÉE", color: "#3B6BCD", bg: "#EAF1FF" };
  if (status === "completed") return { label: "TERMINÉE", color: "#747474", bg: "#ECECEC" };
  return { label: "—", color: "#747474", bg: "#ECECEC" };
}

export function LiveScreen() {
  const { profile } = useTikisStore();
  const deliveriesQuery = trpc.deliveries.list.useQuery(undefined, { enabled: Boolean(profile?.phone), refetchInterval: 10_000 });
  const deliveries = useMemo(() => deliveriesQuery.data ?? [], [deliveriesQuery.data]);

  const [filter, setFilter] = useState<Filter>("active");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const sheetHeight = useRef(new Animated.Value(SHEET_PEEK)).current;
  const sheetValue = useRef(SHEET_PEEK);

  const visible = useMemo(() => {
    return deliveries.filter((d) => {
      if (filter === "active") return isActiveStatus(d.status);
      if (filter === "upcoming") return isUpcomingStatus(d.status);
      return d.status === "completed";
    }).filter((d) => typeFilter === "all" || d.type === typeFilter);
  }, [deliveries, filter, typeFilter]);

  useEffect(() => {
    if (!selectedId && visible.length > 0) setSelectedId(visible[0].id);
  }, [visible, selectedId]);

  useEffect(() => {
    if (visible.every((d) => d.id !== selectedId)) {
      setSelectedId(visible[0]?.id ?? null);
    }
  }, [visible, selectedId]);

  const selected = visible.find((d) => d.id === selectedId) ?? null;
  const countByType = useMemo(() => {
    const source = filter === "active" ? deliveries.filter((delivery) => isActiveStatus(delivery.status)) : filter === "upcoming" ? deliveries.filter((delivery) => isUpcomingStatus(delivery.status)) : deliveries.filter((delivery) => delivery.status === "completed");
    const counts: Record<TypeFilter, number> = { all: source.length, Plis: 0, Personne: 0, Autre: 0 };
    source.forEach((d) => { counts[d.type] = (counts[d.type] ?? 0) + 1; });
    return counts;
  }, [deliveries, filter]);

  useEffect(() => {
    const listener = sheetHeight.addListener(({ value }) => { sheetValue.current = value; });
    return () => sheetHeight.removeListener(listener);
  }, [sheetHeight]);

  const animateSheet = (toExpanded: boolean) => {
    setExpanded(toExpanded);
    Animated.spring(sheetHeight, { toValue: toExpanded ? SHEET_EXPANDED : SHEET_PEEK, useNativeDriver: false, friction: 9, tension: 60 }).start();
  };

  const panResponder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 6,
    onPanResponderMove: (_, gesture) => {
      const current = sheetValue.current;
      const next = Math.max(SHEET_PEEK, Math.min(SHEET_EXPANDED, current - gesture.dy));
      sheetHeight.setValue(next);
    },
    onPanResponderRelease: (_, gesture) => {
      const current = sheetValue.current;
      const shouldExpand = gesture.dy < -20 || current > (SHEET_PEEK + SHEET_EXPANDED) / 2;
      animateSheet(shouldExpand);
    },
  })).current;

  const liveCount = deliveries.filter((delivery) => isActiveStatus(delivery.status)).length;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.mapArea}>
        <MapBackground selected={selected} />

        <View style={styles.topBar} pointerEvents="box-none">
          <Pressable onPress={() => router.push("/")} style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]} accessibilityLabel="Fermer">
            <MaterialIcons name="arrow-back" size={20} color="#111111" />
          </Pressable>
          <View style={styles.searchPill}>
            <MaterialIcons name="search" size={16} color="#747474" />
            <Text style={styles.searchPillText}>Suivi en direct</Text>
          </View>
          <Pressable style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]} accessibilityLabel="Rechercher">
            <MaterialIcons name="tune" size={18} color="#111111" />
          </Pressable>
        </View>

        <View style={styles.livePill} pointerEvents="none">
          <View style={[styles.liveDot, liveCount === 0 && styles.liveDotIdle]} />
          <Text style={styles.livePillText}>
            {liveCount === 0 ? "Aucune livraison active" : `${liveCount} livraison${liveCount > 1 ? "s" : ""} en direct`}
          </Text>
        </View>

        <View style={styles.fab} pointerEvents="box-none">
          <Pressable style={styles.iconBtn} accessibilityLabel="Recentrer">
            <MaterialIcons name="my-location" size={20} color="#111111" />
          </Pressable>
          <Pressable style={[styles.iconBtn, styles.iconBtnPrimary]} accessibilityLabel="Vue d'ensemble">
            <MaterialIcons name="layers" size={20} color="#FFFFFF" />
          </Pressable>
        </View>
      </View>

      <Animated.View style={[styles.sheet, { height: sheetHeight }]}>
        <View {...panResponder.panHandlers} style={styles.sheetHeader}>
          <View style={styles.sheetGrip} />
          <View style={styles.sheetTitleRow}>
            <Text style={styles.sheetTitle}>Suivi en direct</Text>
            <View style={styles.segmented}>
              {(["active", "upcoming", "done"] as Filter[]).map((key) => (
                <Pressable key={key} onPress={() => setFilter(key)} style={({ pressed }) => [styles.segment, filter === key && styles.segmentActive, pressed && styles.pressed]}>
                  <Text style={[styles.segmentText, filter === key && styles.segmentTextActive]}>
                    {key === "active" ? "Actives" : key === "upcoming" ? "À venir" : "Terminées"}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsRow}>
            <Pressable onPress={() => setTypeFilter("all")} style={({ pressed }) => [styles.tab, typeFilter === "all" && styles.tabActive, pressed && styles.pressed]}>
              <Text style={[styles.tabText, typeFilter === "all" && styles.tabTextActive]}>Toutes</Text>
              <View style={[styles.tabBadge, typeFilter === "all" && styles.tabBadgeActive]}><Text style={[styles.tabBadgeText, typeFilter === "all" && styles.tabBadgeTextActive]}>{countByType.all}</Text></View>
            </Pressable>
            {(["Plis", "Personne", "Autre"] as DeliveryType[]).map((t) => (
              <Pressable key={t} onPress={() => setTypeFilter(t)} style={({ pressed }) => [styles.tab, typeFilter === t && styles.tabActive, pressed && styles.pressed]}>
                <Text style={[styles.tabText, typeFilter === t && styles.tabTextActive]}>{TYPE_LABEL[t]}</Text>
                <View style={[styles.tabBadge, typeFilter === t && styles.tabBadgeActive]}><Text style={[styles.tabBadgeText, typeFilter === t && styles.tabBadgeTextActive]}>{countByType[t]}</Text></View>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        <ScrollView
          style={styles.listScroll}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          scrollEnabled={expanded}
        >
          {deliveriesQuery.isLoading ? (
            <View style={styles.loadingState}>
              <ActivityIndicator color="#007B8B" />
              <Text style={styles.loadingText}>Chargement de vos livraisons…</Text>
            </View>
          ) : visible.length === 0 ? (
            <EmptyState filter={filter} onCreate={() => router.push("/create-delivery" as any)} />
          ) : (
            visible.map((delivery) => (
              <DeliveryListCard
                key={delivery.id}
                delivery={delivery}
                active={delivery.id === selectedId}
                onPress={() => {
                  setSelectedId(delivery.id);
                  if (!expanded) animateSheet(true);
                }}
                onOpen={() => router.push(`/delivery/${delivery.id}` as any)}
              />
            ))
          )}
        </ScrollView>
      </Animated.View>
    </SafeAreaView>
  );
}

function MapBackground({ selected }: { selected: Delivery | null }) {
  return (
    <View style={styles.mapBg}>
      <View style={[styles.mapBlock, { top: "10%", left: "8%", width: 90, height: 60 }]} />
      <View style={[styles.mapBlock, { top: "16%", right: "12%", width: 70, height: 80 }]} />
      <View style={[styles.mapBlock, { bottom: "18%", left: "6%", width: 100, height: 50 }]} />
      <View style={[styles.mapBlock, { bottom: "30%", right: "8%", width: 80, height: 70 }]} />
      <View style={[styles.mapRoad, styles.mapRoad1]} />
      <View style={[styles.mapRoad, styles.mapRoad2]} />
      <View style={[styles.mapRoad, styles.mapRoad3]} />

      <View style={[styles.marker, styles.markerStart]}>
        <MaterialIcons name="inventory-2" size={16} color="#FFFFFF" />
      </View>
      <View style={[styles.marker, styles.markerDriver]}>
        <MaterialIcons name="two-wheeler" size={18} color="#FFFFFF" />
      </View>
      <View style={[styles.marker, styles.markerEnd]}>
        <MaterialIcons name="location-on" size={16} color="#B4232D" />
      </View>

      {selected ? (
        <View style={styles.markerLabel}>
          <Text style={styles.markerLabelTitle} numberOfLines={1}>{selected.title}</Text>
          <Text style={styles.markerLabelSub} numberOfLines={1}>
            {selected.driverName ?? "Livreur en attente"} · {selected.distanceKm.toFixed(1)} km
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function DeliveryListCard({ delivery, active, onPress, onOpen }: { delivery: Delivery; active: boolean; onPress: () => void; onOpen: () => void }) {
  const chip = statusChipProps(delivery.status);
  const pickupText = formatNavigationTarget(delivery.pickup);
  const dropoffText = formatNavigationTarget(delivery.dropoff);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, active && styles.cardActive, pressed && styles.pressed]}>
      <View style={styles.cardRow}>
        <View style={styles.thumb}>
          <MaterialIcons name={TYPE_ICON[delivery.type] ?? "local-shipping"} size={20} color="#007B8B" />
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle} numberOfLines={1}>{delivery.title}</Text>
          <Text style={styles.cardMeta} numberOfLines={1}>
            {delivery.driverName ?? "En attente"} · {delivery.distanceKm.toFixed(1)} km
          </Text>
        </View>
        <View style={[styles.statusChip, { backgroundColor: chip.bg }]}>
          <View style={[styles.statusChipDot, { backgroundColor: chip.color }]} />
          <Text style={[styles.statusChipText, { color: chip.color }]}>{chip.label}</Text>
        </View>
      </View>
      <View style={styles.cardRoute}>
        <View style={[styles.routeDot, styles.routeDotFrom]} />
        <Text style={styles.routeLabel} numberOfLines={1}>{pickupText}</Text>
        <View style={styles.routeLine} />
        <Text style={styles.routeLabel} numberOfLines={1}>{dropoffText}</Text>
        <View style={[styles.routeDot, styles.routeDotTo]} />
      </View>
      {active ? (
        <View style={styles.cardActions}>
          <Pressable onPress={onOpen} style={({ pressed }) => [styles.cardAction, styles.cardActionPrimary, pressed && styles.pressed]}>
            <Text style={styles.cardActionPrimaryText}>Voir le détail</Text>
          </Pressable>
        </View>
      ) : null}
    </Pressable>
  );
}

function EmptyState({ filter, onCreate }: { filter: Filter; onCreate: () => void }) {
  const title = filter === "active" ? "Aucune livraison en cours" : filter === "upcoming" ? "Pas de livraison à venir" : "Aucune livraison terminée";
  const text = filter === "active"
    ? "Vos livraisons actives apparaîtront ici dès qu’un livreur sera retenu."
    : filter === "upcoming"
      ? "Publiez un nouveau besoin pour voir apparaître une livraison à venir."
      : "Vos livraisons terminées seront visibles ici.";
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <MaterialIcons name={filter === "done" ? "check-circle-outline" : "inbox"} size={26} color="#747474" />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyText}>{text}</Text>
      {filter !== "done" ? <TikisButton label="Créer une livraison" icon="add" onPress={onCreate} style={styles.emptyButton} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#EEEDF3" },
  mapArea: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },

  mapBg: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#EEEDF3" },
  mapBlock: { position: "absolute", backgroundColor: "#DCDEE3", borderRadius: 6 },
  mapRoad: { position: "absolute", backgroundColor: "#FFFFFF", borderRadius: 99 },
  mapRoad1: { top: "30%", left: "-10%", right: "-10%", height: 18, transform: [{ rotate: "-12deg" }] },
  mapRoad2: { top: "56%", left: "-20%", width: "80%", height: 14, transform: [{ rotate: "6deg" }] },
  mapRoad3: { top: "78%", left: "20%", right: "-10%", height: 12, transform: [{ rotate: "-4deg" }] },

  marker: { position: "absolute", width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: "#FFFFFF" },
  markerStart: { top: "32%", left: "14%", backgroundColor: "#007B8B" },
  markerDriver: { top: "50%", left: "38%", backgroundColor: "#111111" },
  markerEnd: { top: "64%", right: "18%", backgroundColor: "#FFFFFF", borderColor: "#B4232D" },
  markerLabel: { position: "absolute", top: "70%", left: "20%", right: "20%", backgroundColor: "#FFFFFF", borderRadius: 10, padding: 10 },
  markerLabelTitle: { color: "#111111", fontSize: 13, fontWeight: "600" },
  markerLabelSub: { color: "#666666", fontSize: 11, marginTop: 2 },

  topBar: { position: "absolute", top: 12, left: 14, right: 14, flexDirection: "row", alignItems: "center", gap: 10 },
  iconBtn: { width: 40, height: 40, borderRadius: 10, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  iconBtnPrimary: { backgroundColor: "#007B8B" },
  searchPill: { flex: 1, height: 40, borderRadius: 10, backgroundColor: "#FFFFFF", flexDirection: "row", alignItems: "center", paddingHorizontal: 12, gap: 8, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  searchPillText: { color: "#111111", fontSize: 13, fontWeight: "600" },

  livePill: { position: "absolute", top: 64, left: 14, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: "#FFFFFF", borderRadius: 8, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#167A55" },
  liveDotIdle: { backgroundColor: "#747474" },
  livePillText: { color: "#167A55", fontSize: 11, fontWeight: "600" },

  fab: { position: "absolute", right: 14, bottom: 150, gap: 8 },

  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: "#FFFFFF", borderTopLeftRadius: 18, borderTopRightRadius: 18, shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 12, shadowOffset: { width: 0, height: -4 }, elevation: 8, overflow: "hidden" },
  sheetHeader: { paddingTop: 12 },
  sheetGrip: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: "#D5D5DC", marginBottom: 10 },
  sheetTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 10 },
  sheetTitle: { color: "#111111", fontSize: 14, fontWeight: "600" },
  segmented: { flexDirection: "row", backgroundColor: "#EEEDF3", borderRadius: 8, padding: 3, gap: 2 },
  segment: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  segmentActive: { backgroundColor: "#FFFFFF", shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  segmentText: { color: "#666666", fontSize: 11, fontWeight: "600" },
  segmentTextActive: { color: "#111111" },

  tabsRow: { paddingHorizontal: 16, paddingBottom: 4, gap: 6 },
  tab: { flexDirection: "row", alignItems: "center", gap: 6, height: 30, paddingHorizontal: 12, borderRadius: 8, backgroundColor: "#EEEDF3" },
  tabActive: { backgroundColor: "#111111" },
  tabText: { color: "#666666", fontSize: 12, fontWeight: "600" },
  tabTextActive: { color: "#FFFFFF" },
  tabBadge: { backgroundColor: "#FFFFFF", paddingHorizontal: 6, borderRadius: 99, minWidth: 18, alignItems: "center" },
  tabBadgeActive: { backgroundColor: "rgba(255,255,255,0.18)" },
  tabBadgeText: { color: "#666666", fontSize: 10, fontWeight: "600" },
  tabBadgeTextActive: { color: "#FFFFFF" },

  listScroll: { flex: 1, marginTop: 6 },
  list: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 24, gap: 10 },

  card: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#ECECEC", borderRadius: 12, padding: 12, gap: 10 },
  cardActive: { borderColor: "#007B8B", shadowColor: "#007B8B", shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  cardRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  thumb: { width: 40, height: 40, borderRadius: 10, backgroundColor: "#E2F3F4", alignItems: "center", justifyContent: "center" },
  cardBody: { flex: 1, minWidth: 0 },
  cardTitle: { color: "#111111", fontSize: 13, fontWeight: "600" },
  cardMeta: { color: "#666666", fontSize: 11, marginTop: 2 },
  statusChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99 },
  statusChipDot: { width: 5, height: 5, borderRadius: 3 },
  statusChipText: { fontSize: 10, fontWeight: "600" },

  cardRoute: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: "#ECECEC" },
  routeDot: { width: 8, height: 8, borderRadius: 4 },
  routeDotFrom: { backgroundColor: "#007B8B" },
  routeDotTo: { backgroundColor: "#B4232D" },
  routeLine: { flex: 1, height: 1, backgroundColor: "#ECECEC" },
  routeLabel: { color: "#666666", fontSize: 10, maxWidth: 80 },

  cardActions: { flexDirection: "row", gap: 8 },
  cardAction: { flex: 1, height: 34, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  cardActionPrimary: { backgroundColor: "#111111" },
  cardActionPrimaryText: { color: "#FFFFFF", fontSize: 12, fontWeight: "600" },

  empty: { alignItems: "center", paddingHorizontal: 32, paddingVertical: 32 },
  emptyIcon: { width: 60, height: 60, borderRadius: 14, backgroundColor: "#EEEDF3", alignItems: "center", justifyContent: "center", marginBottom: 14 },
  emptyTitle: { color: "#111111", fontSize: 15, fontWeight: "600", marginBottom: 6 },
  emptyText: { color: "#666666", fontSize: 12, textAlign: "center", lineHeight: 18, marginBottom: 16 },
  emptyButton: { alignSelf: "stretch" },

  loadingState: { alignItems: "center", paddingVertical: 32, gap: 8 },
  loadingText: { color: "#666666", fontSize: 12 },

  pressed: { opacity: 0.7 },
});
