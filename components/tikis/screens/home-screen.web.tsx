import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTikisStore } from "@/lib/tikis-store";
import { useTikisNavigation } from "@/lib/tikis-navigation";
import { trpc } from "@/lib/trpc";
import { formatNavigationTarget } from "@/lib/geo-rules";
import { availableWalletBalance, formatMoney, type Delivery, type DeliveryStatus } from "@/shared/tikis-domain";

const SHEET_PEEK = 280;
const SHEET_EXPANDED = 620;

const TYPE_ICON: Record<Delivery["type"], React.ComponentProps<typeof MaterialIcons>["name"]> = {
  Plis: "inventory-2",
  Personne: "person",
  Autre: "local-shipping",
};

function isLiveStatus(status: DeliveryStatus): boolean {
  return status === "pending_confirmation" || status === "active";
}

function statusChipProps(status: DeliveryStatus): { label: string; color: string; bg: string } {
  if (status === "active") return { label: "EN ROUTE", color: "#167A55", bg: "#E2F3F4" };
  if (status === "pending_confirmation") return { label: "EN ATTENTE", color: "#9A6200", bg: "#FEF6E2" };
  if (status === "open") return { label: "PUBLIÉE", color: "#3B6BCD", bg: "#EAF1FF" };
  if (status === "completed") return { label: "TERMINÉE", color: "#747474", bg: "#ECECEC" };
  return { label: "—", color: "#747474", bg: "#ECECEC" };
}

export function HomeScreen() {
  const { role, profile } = useTikisStore();
  const { openDrawer } = useTikisNavigation();
  const firstName = profile?.fullName.split(" ")[0] ?? "à vous";

  const deliveriesQuery = trpc.deliveries.list.useQuery(undefined, { enabled: Boolean(profile?.phone), refetchInterval: 10_000 });
  const deliveries = useMemo(() => deliveriesQuery.data ?? [], [deliveriesQuery.data]);

  const walletQuery = trpc.wallet.snapshot.useQuery(undefined, { enabled: role === "driver" && Boolean(profile?.phone), refetchInterval: 12_000 });
  const driverWallet = walletQuery.data?.wallet;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [driverOnline, setDriverOnline] = useState(true);
  const sheetHeight = useRef(new Animated.Value(SHEET_PEEK)).current;
  const sheetValue = useRef(SHEET_PEEK);

  const focusedList = useMemo(() => {
    if (role === "driver") {
      return [...deliveries].sort((left, right) => left.distanceKm - right.distanceKm || (right.offeredPrice ?? right.estimatedPrice) - (left.offeredPrice ?? left.estimatedPrice));
    }
    return deliveries.filter((d) => d.status !== "completed");
  }, [deliveries, role]);

  const urgent = useMemo(() => {
    if (focusedList.length === 0) return null;
    if (role === "driver") {
      return focusedList.find((d) => d.status === "open" || d.status === "pending_confirmation") ?? focusedList[0];
    }
    return focusedList.find((d) => d.status === "active" || d.status === "pending_confirmation") ?? focusedList[0];
  }, [focusedList, role]);

  useEffect(() => {
    if (!selectedId && urgent) setSelectedId(urgent.id);
  }, [urgent, selectedId]);

  useEffect(() => {
    if (selectedId && focusedList.every((d) => d.id !== selectedId) && urgent) {
      setSelectedId(urgent.id);
    } else if (!selectedId && urgent) {
      setSelectedId(urgent.id);
    }
  }, [focusedList, selectedId, urgent]);

  const liveCount = deliveries.filter((delivery) => isLiveStatus(delivery.status)).length;
  const otherDeliveries = focusedList.filter((d) => d.id !== urgent?.id).slice(0, 4);

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

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <MapBackground selected={selectedId ? deliveries.find((d) => d.id === selectedId) ?? urgent : urgent} />

      <View style={styles.searchRow} pointerEvents="box-none">
        {role === "sender" ? (
          <>
            <View style={styles.searchPill}>
              <MaterialIcons name="search" size={16} color="#747474" />
              <Text style={styles.searchPillText}>Où allez-vous ?</Text>
            </View>
            <Pressable onPress={() => openDrawer()} style={({ pressed }) => [styles.searchBtn, pressed && styles.pressed]} accessibilityLabel="Menu">
              <MaterialIcons name="menu" size={20} color="#111111" />
            </Pressable>
          </>
        ) : (
          <>
            <Pressable onPress={() => setDriverOnline((prev) => !prev)} style={({ pressed }) => [styles.onlinePill, !driverOnline && styles.onlinePillOffline, pressed && styles.pressed]}>
              <View style={[styles.onlineDot, !driverOnline && styles.onlineDotOffline]} />
              <Text style={styles.onlinePillText}>{driverOnline ? "EN SERVICE" : "HORS SERVICE"}</Text>
            </Pressable>
            <Pressable onPress={() => openDrawer()} style={({ pressed }) => [styles.searchBtn, pressed && styles.pressed]} accessibilityLabel="Menu">
              <MaterialIcons name="menu" size={20} color="#111111" />
            </Pressable>
          </>
        )}
      </View>

      {role === "sender" ? (
        <View style={styles.livePill} pointerEvents="none">
          <View style={[styles.liveDot, liveCount === 0 && styles.liveDotIdle]} />
          <Text style={[styles.livePillText, liveCount === 0 && styles.livePillTextIdle]}>
            {liveCount === 0 ? "Aucune livraison active" : `${liveCount} livraison${liveCount > 1 ? "s" : ""} actives`}
          </Text>
        </View>
      ) : (
        <View style={[styles.livePill, walletQuery.isLoading ? styles.livePillLoading : null]} pointerEvents="none">
          {walletQuery.isLoading ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <>
              <MaterialIcons name="account-balance-wallet" size={13} color="#FFFFFF" />
              <Text style={styles.walletPillText}>
                {driverWallet ? formatMoney(availableWalletBalance(driverWallet)) : "Wallet indisponible"}
              </Text>
            </>
          )}
        </View>
      )}

      <Pressable
        onPress={() => {
          if (role === "sender") {
            router.push("/create-delivery" as any);
          } else if (urgent) {
            router.push(`/delivery/${urgent.id}` as any);
          } else {
            router.push("/(tabs)/deliveries" as any);
          }
        }}
        style={({ pressed }) => [styles.fab, role === "driver" && styles.fabWhite, pressed && styles.pressed]}
        accessibilityLabel={role === "sender" ? "Créer une livraison" : "Accepter la prochaine course"}
      >
        <MaterialIcons name="add" size={26} color={role === "sender" ? "#FFFFFF" : "#007B8B"} />
      </Pressable>

      <Animated.View style={[styles.sheet, { height: sheetHeight }]}>
        <View {...panResponder.panHandlers} style={styles.sheetHeader}>
          <View style={styles.sheetGrip} />
          <View style={styles.sheetTitleRow}>
            <Text style={styles.sheetTitle}>Bonjour {firstName} 👋</Text>
            <Pressable
              onPress={() => role === "sender" ? router.push("/(tabs)/profile" as any) : router.push("/(tabs)/wallet" as any)}
              style={({ pressed }) => [pressed && styles.pressed]}
            >
              <Text style={styles.sheetLink}>{role === "sender" ? "Profil" : "Wallet"}</Text>
            </Pressable>
          </View>
        </View>

        <ScrollView
          style={styles.scrollArea}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          scrollEnabled={expanded}
        >
          {deliveriesQuery.isLoading ? (
            <View style={styles.loadingState}>
              <ActivityIndicator color="#007B8B" />
              <Text style={styles.loadingText}>Chargement de vos livraisons…</Text>
            </View>
          ) : !urgent ? (
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <MaterialIcons name={role === "sender" ? "add" : "local-shipping"} size={26} color="#747474" />
              </View>
              <Text style={styles.emptyTitle}>{role === "sender" ? "Aucune livraison en cours" : "Aucune opportunité disponible"}</Text>
              <Text style={styles.emptyText}>
                {role === "sender" ? "Publiez votre première course et comparez les livreurs disponibles." : "Revenez dans quelques minutes, de nouvelles courses arrivent régulièrement."}
              </Text>
            </View>
          ) : (
            <UrgentCard delivery={urgent} role={role} />
          )}

          <View style={styles.shortcuts}>
            {role === "sender" ? (
              <>
                <Shortcut icon="add" label="Nouvelle" onPress={() => router.push("/create-delivery" as any)} />
                <Shortcut icon="my-location" label="Suivi" onPress={() => router.push("/(tabs)/live" as any)} />
                <Shortcut icon="bookmark" label="Adresses" onPress={() => router.push("/(tabs)/addresses" as any)} />
              </>
            ) : (
              <>
                <Shortcut icon="map" label="Carte" onPress={() => router.push("/(tabs)/live" as any)} />
                <Shortcut icon="local-shipping" label="Courses" onPress={() => router.push("/(tabs)/deliveries" as any)} />
                <Shortcut icon="account-balance-wallet" label="Wallet" onPress={() => router.push("/(tabs)/wallet" as any)} />
              </>
            )}
          </View>

          {otherDeliveries.length > 0 ? (
            <View style={styles.miniList}>
              {otherDeliveries.map((delivery) => (
                <MiniItem
                  key={delivery.id}
                  delivery={delivery}
                  onPress={() => {
                    setSelectedId(delivery.id);
                    if (!expanded) animateSheet(true);
                  }}
                />
              ))}
            </View>
          ) : null}
        </ScrollView>
      </Animated.View>
    </SafeAreaView>
  );
}

function MapBackground({ selected }: { selected: Delivery | null | undefined }) {
  const hasDriver = selected ? selected.status !== "open" : false;
  return (
    <View style={styles.mapBg}>
      <View style={[styles.mapBlock, { top: "10%", left: "8%", width: 90, height: 60 }]} />
      <View style={[styles.mapBlock, { top: "16%", right: "12%", width: 70, height: 80 }]} />
      <View style={[styles.mapBlock, { bottom: "20%", left: "6%", width: 100, height: 50 }]} />
      <View style={[styles.mapBlock, { bottom: "32%", right: "8%", width: 80, height: 70 }]} />
      <View style={[styles.mapRoad, styles.mapRoad1]} />
      <View style={[styles.mapRoad, styles.mapRoad2]} />
      <View style={[styles.mapRoad, styles.mapRoad3]} />

      <View style={[styles.marker, styles.markerStart]}>
        <MaterialIcons name="inventory-2" size={14} color="#FFFFFF" />
      </View>
      {hasDriver ? (
        <View style={[styles.marker, styles.markerDriver]}>
          <MaterialIcons name="two-wheeler" size={18} color="#FFFFFF" />
        </View>
      ) : null}
      <View style={[styles.marker, styles.markerEnd]}>
        <MaterialIcons name="location-on" size={16} color="#B4232D" />
      </View>
    </View>
  );
}

function UrgentCard({ delivery, role }: { delivery: Delivery; role: "sender" | "driver" }) {
  const cta = role === "sender" ? "Suivre" : "Accepter";
  const ctaAction = () => {
    if (role === "sender") {
      router.push(`/track/${delivery.id}` as any);
    } else {
      router.push(`/delivery/${delivery.id}` as any);
    }
  };
  return (
    <View style={[styles.urgentCard, role === "driver" && styles.urgentCardDriver]}>
      <View style={[styles.urgentThumb, role === "driver" && styles.urgentThumbDriver]}>
        <MaterialIcons name={TYPE_ICON[delivery.type] ?? "local-shipping"} size={18} color={role === "driver" ? "#007B8B" : "#FFFFFF"} />
      </View>
      <View style={styles.urgentBody}>
        <Text style={styles.urgentTitle} numberOfLines={1}>{delivery.title}</Text>
        <Text style={styles.urgentMeta} numberOfLines={1}>
          {role === "sender"
            ? `${delivery.driverName ?? "Livreur en attente"} · ${delivery.distanceKm.toFixed(1)} km · ETA 8 min`
            : `${delivery.distanceKm.toFixed(1)} km · ${formatMoney(delivery.offeredPrice ?? delivery.estimatedPrice)} · ${delivery.vehicleTypes[0] ?? "Moto"}`}
        </Text>
      </View>
      <Pressable onPress={ctaAction} style={({ pressed }) => [styles.urgentCta, role === "driver" && styles.urgentCtaDriver, pressed && styles.pressed]}>
        <Text style={[styles.urgentCtaText, role === "driver" && styles.urgentCtaTextDriver]}>{cta}</Text>
      </Pressable>
    </View>
  );
}

function Shortcut({ icon, label, onPress }: { icon: React.ComponentProps<typeof MaterialIcons>["name"]; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.shortcut, pressed && styles.pressed]}>
      <MaterialIcons name={icon} size={16} color="#007B8B" />
      <Text style={styles.shortcutText}>{label}</Text>
    </Pressable>
  );
}

function MiniItem({ delivery, onPress }: { delivery: Delivery; onPress: () => void }) {
  const chip = statusChipProps(delivery.status);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.miniItem, pressed && styles.pressed]}>
      <View style={styles.miniThumb}>
        <MaterialIcons name={TYPE_ICON[delivery.type] ?? "local-shipping"} size={14} color="#666666" />
      </View>
      <View style={styles.miniBody}>
        <Text style={styles.miniTitle} numberOfLines={1}>{delivery.title}</Text>
        <Text style={styles.miniMeta} numberOfLines={1}>
          {delivery.distanceKm.toFixed(1)} km · {formatNavigationTarget(delivery.pickup)}
        </Text>
      </View>
      <View style={[styles.miniChip, { backgroundColor: chip.bg }]}>
        <Text style={[styles.miniChipText, { color: chip.color }]}>{chip.label}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#EEEDF3" },

  mapBg: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#EEEDF3" },
  mapBlock: { position: "absolute", backgroundColor: "#DCDEE3", borderRadius: 6 },
  mapRoad: { position: "absolute", backgroundColor: "#FFFFFF", borderRadius: 99 },
  mapRoad1: { top: "30%", left: "-10%", right: "-10%", height: 18, transform: [{ rotate: "-12deg" }] },
  mapRoad2: { top: "56%", left: "-20%", width: "80%", height: 14, transform: [{ rotate: "6deg" }] },
  mapRoad3: { top: "78%", left: "20%", right: "-10%", height: 12, transform: [{ rotate: "-4deg" }] },
  marker: { position: "absolute", width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: "#FFFFFF", shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  markerStart: { top: "32%", left: "16%", backgroundColor: "#007B8B" },
  markerDriver: { top: "50%", left: "42%", backgroundColor: "#111111" },
  markerEnd: { top: "64%", right: "18%", backgroundColor: "#FFFFFF", borderColor: "#B4232D" },

  searchRow: { position: "absolute", top: 8, left: 14, right: 14, flexDirection: "row", alignItems: "center", gap: 8, zIndex: 10 },
  searchPill: { flex: 1, height: 40, borderRadius: 12, backgroundColor: "#FFFFFF", flexDirection: "row", alignItems: "center", paddingHorizontal: 12, gap: 8, shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  searchPillText: { color: "#666666", fontSize: 13 },
  searchBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3 },

  onlinePill: { flex: 1, height: 40, borderRadius: 12, backgroundColor: "#007B8B", flexDirection: "row", alignItems: "center", paddingHorizontal: 12, gap: 8, shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  onlinePillOffline: { backgroundColor: "#FFFFFF" },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#FFFFFF" },
  onlineDotOffline: { backgroundColor: "#747474" },
  onlinePillText: { color: "#FFFFFF", fontSize: 12, fontWeight: "600" },

  livePill: { position: "absolute", top: 60, left: 14, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: "#FFFFFF", borderRadius: 7, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  livePillLoading: { backgroundColor: "#111111" },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#167A55" },
  liveDotIdle: { backgroundColor: "#747474" },
  livePillText: { color: "#167A55", fontSize: 10, fontWeight: "600" },
  livePillTextIdle: { color: "#747474" },
  walletPillText: { color: "#FFFFFF", fontSize: 10, fontWeight: "600" },

  fab: { position: "absolute", right: 14, bottom: 310, width: 50, height: 50, borderRadius: 14, backgroundColor: "#007B8B", alignItems: "center", justifyContent: "center", shadowColor: "#007B8B", shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6, zIndex: 10 },
  fabWhite: { backgroundColor: "#FFFFFF" },

  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: "#FFFFFF", borderTopLeftRadius: 18, borderTopRightRadius: 18, shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 12, shadowOffset: { width: 0, height: -4 }, elevation: 8, overflow: "hidden" },
  sheetHeader: { paddingTop: 12, paddingBottom: 6 },
  sheetGrip: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: "#D5D5DC", marginBottom: 12 },
  sheetTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16 },
  sheetTitle: { color: "#111111", fontSize: 15, fontWeight: "700" },
  sheetLink: { color: "#007B8B", fontSize: 12, fontWeight: "600" },

  scrollArea: { flex: 1, marginTop: 4 },
  scrollContent: { paddingHorizontal: 14, paddingTop: 4, paddingBottom: 90, gap: 10 },

  urgentCard: { backgroundColor: "#111111", borderRadius: 12, padding: 14, flexDirection: "row", alignItems: "center", gap: 10 },
  urgentCardDriver: { backgroundColor: "#007B8B" },
  urgentThumb: { width: 40, height: 40, borderRadius: 9, backgroundColor: "#007B8B", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  urgentThumbDriver: { backgroundColor: "#FFFFFF" },
  urgentBody: { flex: 1, minWidth: 0 },
  urgentTitle: { color: "#FFFFFF", fontSize: 13, fontWeight: "600" },
  urgentMeta: { color: "rgba(255,255,255,0.6)", fontSize: 10, marginTop: 2 },
  urgentCta: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 7, backgroundColor: "#007B8B" },
  urgentCtaDriver: { backgroundColor: "#FFFFFF" },
  urgentCtaText: { color: "#FFFFFF", fontSize: 11, fontWeight: "600" },
  urgentCtaTextDriver: { color: "#007B8B" },

  shortcuts: { flexDirection: "row", gap: 8, marginTop: 4 },
  shortcut: { flex: 1, backgroundColor: "#EEEDF3", borderRadius: 9, paddingVertical: 11, paddingHorizontal: 6, alignItems: "center", gap: 5 },
  shortcutText: { color: "#111111", fontSize: 11, fontWeight: "600" },

  miniList: { backgroundColor: "#FFFFFF", borderRadius: 12, paddingHorizontal: 4, paddingVertical: 2, marginTop: 4 },
  miniItem: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#ECECEC" },
  miniThumb: { width: 28, height: 28, borderRadius: 7, backgroundColor: "#EEEDF3", alignItems: "center", justifyContent: "center" },
  miniBody: { flex: 1, minWidth: 0 },
  miniTitle: { color: "#111111", fontSize: 12, fontWeight: "500" },
  miniMeta: { color: "#666666", fontSize: 10, marginTop: 2 },
  miniChip: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5 },
  miniChipText: { fontSize: 9, fontWeight: "600" },

  loadingState: { alignItems: "center", paddingVertical: 32, gap: 8 },
  loadingText: { color: "#666666", fontSize: 12 },

  empty: { alignItems: "center", paddingHorizontal: 24, paddingVertical: 24 },
  emptyIcon: { width: 60, height: 60, borderRadius: 14, backgroundColor: "#EEEDF3", alignItems: "center", justifyContent: "center", marginBottom: 12 },
  emptyTitle: { color: "#111111", fontSize: 14, fontWeight: "600", marginBottom: 4 },
  emptyText: { color: "#666666", fontSize: 12, textAlign: "center", lineHeight: 18 },

  pressed: { opacity: 0.7 },
});
