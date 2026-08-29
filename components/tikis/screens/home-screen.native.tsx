import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, Dimensions, Linking, PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import MapView, { Marker, Polyline, type Region } from "react-native-maps";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTikisStore } from "@/lib/tikis-store";
import { useTikisNavigation } from "@/lib/tikis-navigation";
import { trpc } from "@/lib/trpc";
import { formatListRouteParts } from "@/lib/geo-rules";
import { useDriverLocation } from "@/hooks/use-driver-location";
import { formatDistanceKm, formatDeliveryCreationDate } from "@/lib/date-format";
import { availableWalletBalance, formatMoney, type Delivery, type DeliveryStatus } from "@/shared/tikis-domain";

const { height: SCREEN_H } = Dimensions.get("window");
const SHEET_MIN = 130;
const SHEET_PEEK = 420;
const SHEET_EXPANDED = Math.min(SCREEN_H * 0.78, 720);

const TYPE_ICON: Record<Delivery["type"], React.ComponentProps<typeof MaterialIcons>["name"]> = {
  Plis: "inventory-2",
  Personne: "person",
  Autre: "local-shipping",
};

const STATUS_CHIP: Record<DeliveryStatus, { label: string; color: string; bg: string }> = {
  draft: { label: "BROUILLON", color: "#747474", bg: "#ECECEC" },
  open: { label: "PUBLIÉE", color: "#3B6BCD", bg: "#EAF1FF" },
  pending_confirmation: { label: "EN ATTENTE", color: "#9A6200", bg: "#FEF6E2" },
  active: { label: "EN ROUTE", color: "#167A55", bg: "#E2F3F4" },
  completed: { label: "TERMINÉE", color: "#747474", bg: "#ECECEC" },
  disabled: { label: "DÉSACTIVÉE", color: "#747474", bg: "#ECECEC" },
  cancelled: { label: "ANNULÉE", color: "#B4232D", bg: "#FBE8EA" },
};

type FilterKey = "all" | "active" | "open" | "pending" | "completed";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "Toutes" },
  { key: "active", label: "En cours" },
  { key: "open", label: "Publiées" },
  { key: "pending", label: "À confirmer" },
  { key: "completed", label: "Terminées" },
];

function matchesFilter(status: DeliveryStatus, filter: FilterKey): boolean {
  if (filter === "all") return status !== "cancelled" && status !== "disabled";
  if (filter === "active") return status === "active";
  if (filter === "open") return status === "open";
  if (filter === "pending") return status === "pending_confirmation";
  if (filter === "completed") return status === "completed";
  return true;
}

function driverSortPriority(d: Delivery): number {
  if (d.ownCandidateStatus === "confirmed" || d.status === "active") return 0;
  if (d.ownCandidateStatus === "selected" || d.status === "pending_confirmation") return 1;
  if (d.status === "open") return 2;
  return 3;
}

function fitRegionFor(pickup: { latitude: number; longitude: number }, dropoff: { latitude: number; longitude: number }): Region {
  const midLat = (pickup.latitude + dropoff.latitude) / 2;
  const midLng = (pickup.longitude + dropoff.longitude) / 2;
  const latDelta = Math.max(0.025, Math.abs(pickup.latitude - dropoff.latitude) * 2.2);
  const lngDelta = Math.max(0.025, Math.abs(pickup.longitude - dropoff.longitude) * 2.2);
  return { latitude: midLat, longitude: midLng, latitudeDelta: latDelta, longitudeDelta: lngDelta };
}

function openNavigation(pickup: { latitude: number; longitude: number }, dropoff: { latitude: number; longitude: number }) {
  const url = `https://www.google.com/maps/dir/?api=1&origin=${pickup.latitude},${pickup.longitude}&destination=${dropoff.latitude},${dropoff.longitude}&travelmode=driving`;
  void Linking.openURL(url);
}

export function HomeScreen() {
  const { role, profile } = useTikisStore();
  const { openDrawer } = useTikisNavigation();
  const firstName = profile?.fullName.split(" ")[0] ?? "à vous";

  const deliveriesQuery = trpc.deliveries.list.useQuery(undefined, { enabled: Boolean(profile?.phone), refetchInterval: 10_000 });
  const deliveries = useMemo(() => deliveriesQuery.data ?? [], [deliveriesQuery.data]);

  const walletQuery = trpc.wallet.snapshot.useQuery(undefined, { enabled: role === "driver" && Boolean(profile?.phone), refetchInterval: 12_000 });
  const driverWallet = walletQuery.data?.wallet;

  const [filter, setFilter] = useState<FilterKey>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [driverOnline, setDriverOnline] = useState(true);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const sheetHeight = useRef(new Animated.Value(SHEET_PEEK)).current;
  const sheetValue = useRef(SHEET_PEEK);
  const driverLocation = useDriverLocation({ enabled: role === "driver" });

  const filteredList = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const matches = (d: Delivery) => {
      if (!matchesFilter(d.status, filter)) return false;
      if (q.length === 0) return true;
      const route = formatListRouteParts(d.pickup, d.dropoff);
      const haystack = [d.title, d.type, route.pickup, route.dropoff, (d.vehicleTypes ?? []).join(" ")].join(" ").toLowerCase();
      return haystack.includes(q);
    };
    if (role === "driver") {
      return [...deliveries].filter(matches).sort((a, b) => driverSortPriority(a) - driverSortPriority(b) || a.distanceKm - b.distanceKm);
    }
    return deliveries.filter(matches);
  }, [deliveries, filter, role, searchQuery]);

  const selected = useMemo(() => {
    if (selectedId) {
      const found = filteredList.find((d) => d.id === selectedId);
      if (found) return found;
    }
    if (role === "driver") {
      const own = filteredList.find((d) => d.ownCandidateStatus === "selected" || d.ownCandidateStatus === "confirmed" || d.status === "active");
      if (own) return own;
    }
    return filteredList[0] ?? null;
  }, [filteredList, selectedId, role]);

  useEffect(() => {
    if (!selectedId && selected) setSelectedId(selected.id);
  }, [selected, selectedId]);

  useEffect(() => {
    if (selectedId && filteredList.every((d) => d.id !== selectedId)) {
      if (role === "driver") {
        const own = filteredList.find((d) => d.ownCandidateStatus === "selected" || d.ownCandidateStatus === "confirmed" || d.status === "active");
        setSelectedId(own?.id ?? filteredList[0]?.id ?? null);
      } else {
        setSelectedId(filteredList[0]?.id ?? null);
      }
    }
  }, [filteredList, selectedId, role]);

  const otherDeliveries = useMemo(() => filteredList.filter((d) => d.id !== selected?.id).slice(0, 5), [filteredList, selected?.id]);

  useEffect(() => {
    const listener = sheetHeight.addListener(({ value }) => { sheetValue.current = value; });
    return () => sheetHeight.removeListener(listener);
  }, [sheetHeight]);

  const animateSheetTo = (toValue: number) => {
    Animated.spring(sheetHeight, { toValue, useNativeDriver: false, friction: 9, tension: 60 }).start();
  };

  const panResponder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 6,
    onPanResponderMove: (_, gesture) => {
      const current = sheetValue.current;
      const next = Math.max(SHEET_MIN, Math.min(SHEET_EXPANDED, current - gesture.dy));
      sheetHeight.setValue(next);
    },
    onPanResponderRelease: (_, gesture) => {
      const current = sheetValue.current;
      const range = SHEET_EXPANDED - SHEET_MIN;
      const ratio = (current - SHEET_MIN) / range;
      let target: number;
      if (gesture.dy < -30) target = SHEET_EXPANDED;
      else if (gesture.dy > 30) target = ratio < 0.25 ? SHEET_MIN : SHEET_PEEK;
      else if (ratio > 0.66) target = SHEET_EXPANDED;
      else if (ratio < 0.25) target = SHEET_MIN;
      else target = SHEET_PEEK;
      animateSheetTo(target);
    },
  })).current;

  const utilities = trpc.useUtils();
  const applyMutation = trpc.deliveries.submitApplication.useMutation();

  async function handleApply(deliveryId: string) {
    setApplyingId(deliveryId);
    try {
      await applyMutation.mutateAsync({ deliveryId });
      await Promise.all([
        utilities.deliveries.list.invalidate(),
        utilities.wallet.snapshot.invalidate(),
        utilities.notifications.list.invalidate(),
      ]);
    } catch {
    } finally {
      setApplyingId(null);
    }
  }

  const isDriver = role === "driver";
  const firstNameDisplay = isDriver ? firstName : "à vous";
  const countLabel = isDriver ? `${filteredList.length} opportunité${filteredList.length > 1 ? "s" : ""} à proximité` : `${filteredList.length} livraison${filteredList.length > 1 ? "s" : ""} affichée${filteredList.length > 1 ? "s" : ""}`;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <MapBackground selected={selected} />

      <Pressable
        onPress={() => {
          if (!isDriver) router.push("/create-delivery" as any);
        }}
        style={({ pressed }) => [styles.fab, pressed && styles.pressed]}
        accessibilityLabel={!isDriver ? "Créer une livraison" : ""}
      >
        {!isDriver && <MaterialIcons name="add" size={26} color="#FFFFFF" />}
      </Pressable>

      <Animated.View style={[styles.sheet, { height: sheetHeight }]}>
        <View {...panResponder.panHandlers} style={styles.sheetHeader}>
          <View style={styles.sheetGrip} />
          <View style={styles.sheetTop}>
            <View style={styles.greetingBlock}>
              <Text style={styles.sheetTitle}>Bonjour {firstNameDisplay} 👋</Text>
              <Text style={styles.sheetSubtitle}>{countLabel}</Text>
            </View>
            {isDriver ? (
              <Pressable
                onPress={() => setDriverOnline((prev) => !prev)}
                style={({ pressed }) => [styles.servicePill, !driverOnline && styles.servicePillOffline, pressed && styles.pressed]}
                accessibilityLabel={driverOnline ? "Passer hors service" : "Passer en service"}
              >
                <View style={[styles.onlineDot, !driverOnline && styles.onlineDotOffline]} />
                <Text style={[styles.serviceText, !driverOnline && styles.serviceTextOffline]}>
                  {driverOnline ? "EN SERVICE" : "HORS SERVICE"}
                </Text>
              </Pressable>
            ) : (
              <Pressable onPress={() => openDrawer()} style={({ pressed }) => [styles.servicePill, styles.servicePillNeutral, pressed && styles.pressed]} accessibilityLabel="Ouvrir le menu">
                <MaterialIcons name="menu" size={16} color="#111111" />
              </Pressable>
            )}
          </View>
        </View>

        <ScrollView
          style={styles.scrollArea}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {isDriver && driverWallet ? <WalletCard walletBalance={availableWalletBalance(driverWallet)} totalBalance={driverWallet.total} pendingBalance={0} blockedBalance={driverWallet.blocked} /> : null}

          {isDriver ? (
            <View style={styles.searchRow}>
              <View style={styles.searchPill}>
                <MaterialIcons name="search" size={16} color="#747474" />
                <TextInput
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="Rechercher une opportunité…"
                  placeholderTextColor="#747474"
                  style={styles.searchInput}
                  returnKeyType="search"
                  clearButtonMode="while-editing"
                />
                {searchQuery.length > 0 ? (
                  <Pressable onPress={() => setSearchQuery("")} hitSlop={8} accessibilityLabel="Effacer la recherche">
                    <MaterialIcons name="close" size={16} color="#747474" />
                  </Pressable>
                ) : null}
              </View>
            </View>
          ) : null}

          <View style={styles.filterRow}>
            {FILTERS.map((item) => (
              <Pressable key={item.key} onPress={() => setFilter(item.key)} style={({ pressed }) => [styles.chip, filter === item.key && styles.chipActive, pressed && styles.pressed]}>
                <Text style={[styles.chipText, filter === item.key && styles.chipTextActive]}>{item.label}</Text>
              </Pressable>
            ))}
          </View>

          {deliveriesQuery.isLoading ? (
            <View style={styles.loadingState}>
              <ActivityIndicator color="#007B8B" />
              <Text style={styles.loadingText}>Chargement de vos livraisons…</Text>
            </View>
          ) : !selected ? (
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <MaterialIcons name={isDriver ? "local-shipping" : "add"} size={26} color="#747474" />
              </View>
              <Text style={styles.emptyTitle}>{isDriver ? "Aucune opportunité disponible" : "Aucune livraison en cours"}</Text>
              <Text style={styles.emptyText}>
                {isDriver
                  ? "Revenez dans quelques minutes, de nouvelles courses arrivent régulièrement."
                  : "Publiez votre première course et comparez les livreurs disponibles."}
              </Text>
            </View>
          ) : isDriver ? (
            <DeliveryRow
              key={selected.id}
              delivery={selected}
              role={role}
              selected
              driverDistance={driverLocation.distanceTo(selected.pickup)}
              driverLocationStatus={driverLocation.status}
              applying={applyingId === selected.id}
              onPress={() => {}}
              onDetails={() => router.push(`/delivery/${selected.id}` as any)}
              onApply={() => handleApply(selected.id)}
            />
          ) : (
            <UrgentCard
              delivery={selected}
              role={role}
              onAction={() => router.push(`/track/${selected.id}` as any)}
            />
          )}

          {otherDeliveries.length > 0 ? (
            <View style={styles.listSection}>
              {otherDeliveries.map((delivery) => (
                <DeliveryRow
                  key={delivery.id}
                  delivery={delivery}
                  role={role}
                  selected={false}
                  driverDistance={isDriver ? driverLocation.distanceTo(delivery.pickup) : null}
                  driverLocationStatus={isDriver ? driverLocation.status : null}
                  applying={applyingId === delivery.id}
                  onPress={() => setSelectedId(delivery.id)}
                  onDetails={() => router.push(`/delivery/${delivery.id}` as any)}
                  onApply={() => handleApply(delivery.id)}
                />
              ))}
            </View>
          ) : null}
        </ScrollView>
      </Animated.View>
    </SafeAreaView>
  );
}

function WalletCard({ walletBalance, totalBalance, pendingBalance, blockedBalance }: { walletBalance: number; totalBalance: number; pendingBalance: number; blockedBalance: number }) {
  return (
    <View style={styles.walletCard}>
      <Text style={styles.walletEyebrow}>SOLDE DISPONIBLE</Text>
      <View style={styles.walletRow}>
        <Text style={styles.walletAmount}>{formatMoney(walletBalance)}</Text>
        <View style={styles.walletTrend}>
          <MaterialIcons name="trending-up" size={11} color="#48B889" />
          <Text style={styles.walletTrendText}>+12%</Text>
        </View>
      </View>
      <View style={styles.walletDivider} />
      <View style={styles.walletStats}>
        <View style={styles.walletStat}>
          <Text style={styles.walletStatLabel}>Solde total</Text>
          <Text style={styles.walletStatValue}>{formatMoney(totalBalance)}</Text>
        </View>
        <View style={styles.walletStat}>
          <Text style={styles.walletStatLabel}>Bloquée</Text>
          <Text style={styles.walletStatValue}>{formatMoney(blockedBalance)}</Text>
        </View>
        <View style={styles.walletStat}>
          <Text style={styles.walletStatLabel}>En attente</Text>
          <Text style={styles.walletStatValue}>{formatMoney(pendingBalance)}</Text>
        </View>
      </View>
    </View>
  );
}

function MapBackground({ selected }: { selected: Delivery | null | undefined }) {
  const mapRef = useRef<MapView>(null);
  const hasDriver = selected ? selected.status !== "open" : false;
  const region = useMemo(() => {
    if (!selected) return { latitude: 5.3599, longitude: -4.0083, latitudeDelta: 0.12, longitudeDelta: 0.12 };
    return fitRegionFor(selected.pickup, selected.dropoff);
  }, [selected]);

  useEffect(() => {
    if (!selected) return;
    const timer = setTimeout(() => {
      mapRef.current?.animateToRegion(region, 600);
    }, 220);
    return () => clearTimeout(timer);
  }, [region, selected]);

  return (
    <View style={styles.mapBg}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={region}
        showsCompass={false}
        rotateEnabled={false}
        toolbarEnabled={false}
        showsUserLocation={false}
        showsMyLocationButton={false}
        zoomEnabled
        scrollEnabled
      >
        {selected ? (
          <>
            <Polyline
              coordinates={[
                { latitude: selected.pickup.latitude, longitude: selected.pickup.longitude },
                { latitude: selected.dropoff.latitude, longitude: selected.dropoff.longitude },
              ]}
              strokeColor="#007B8B"
              strokeWidth={4}
              lineCap="round"
            />
            <Marker coordinate={{ latitude: selected.pickup.latitude, longitude: selected.pickup.longitude }} anchor={{ x: 0.5, y: 0.5 }}>
              <View style={styles.nativeMarkerStart}>
                <MaterialIcons name="inventory-2" size={15} color="#FFFFFF" />
              </View>
            </Marker>
            {hasDriver ? (
              <Marker coordinate={{ latitude: selected.pickup.latitude, longitude: selected.pickup.longitude }} anchor={{ x: 0.5, y: 0.5 }}>
                <View style={styles.nativeMarkerDriver}>
                  <MaterialIcons name="two-wheeler" size={16} color="#FFFFFF" />
                </View>
              </Marker>
            ) : null}
            <Marker coordinate={{ latitude: selected.dropoff.latitude, longitude: selected.dropoff.longitude }} anchor={{ x: 0.5, y: 0.85 }}>
              <View style={styles.nativeMarkerEnd}>
                <MaterialIcons name="location-on" size={18} color="#B4232D" />
              </View>
            </Marker>
          </>
        ) : null}
      </MapView>
    </View>
  );
}

function UrgentCard({
  delivery,
  role,
  onAction,
}: {
  delivery: Delivery;
  role: "sender" | "driver";
  onAction: () => void;
}) {
  const isSender = role === "sender";
  return (
    <View style={[styles.urgentCard, isSender ? styles.urgentCardSender : styles.urgentCardDriver]}>
      <View style={styles.urgentHead}>
        <View style={[styles.urgentThumb, isSender ? styles.urgentThumbSender : styles.urgentThumbDriver]}>
          <MaterialIcons name={TYPE_ICON[delivery.type] ?? "local-shipping"} size={18} color={isSender ? "#FFFFFF" : "#007B8B"} />
        </View>
        <View style={styles.urgentMeta}>
          <Text style={styles.urgentTitle} numberOfLines={1}>{delivery.title}</Text>
          <Text style={styles.urgentSub} numberOfLines={1}>
            {isSender
              ? `${delivery.driverName ?? "Livreur en attente"} · ${formatDistanceKm(delivery.distanceKm).value} ${formatDistanceKm(delivery.distanceKm).unit}`
              : `${(delivery.vehicleTypes ?? []).join(" · ") || "Moto"}`}
          </Text>
        </View>
        <View style={[styles.urgentChip, { backgroundColor: STATUS_CHIP[delivery.status].bg }]}>
          <Text style={[styles.urgentChipText, { color: STATUS_CHIP[delivery.status].color }]}>{STATUS_CHIP[delivery.status].label}</Text>
        </View>
      </View>
      <View style={styles.urgentPricing}>
        <View>
          <Text style={styles.urgentPrice}>{formatMoney(delivery.offeredPrice ?? delivery.estimatedPrice)}</Text>
          <Text style={styles.urgentPriceExtra}>{isSender ? "est. client" : "rémunération nette"}</Text>
        </View>
      </View>
      <View style={styles.urgentActions}>
        {isSender ? (
          <Pressable onPress={onAction} style={({ pressed }) => [styles.urgentBtnWhite, pressed && styles.pressed]}>
            <MaterialIcons name="my-location" size={15} color="#111111" />
            <Text style={styles.urgentBtnWhiteText}>Suivre la course</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function DeliveryRow({
  delivery,
  role,
  selected,
  driverDistance,
  driverLocationStatus,
  applying,
  onPress,
  onDetails,
  onApply,
}: {
  delivery: Delivery;
  role: "sender" | "driver";
  selected: boolean;
  driverDistance: { value: string; unit: "m" | "km"; km: number } | null;
  driverLocationStatus: "idle" | "loading" | "ready" | "denied" | "unavailable" | null;
  applying: boolean;
  onPress: () => void;
  onDetails: () => void;
  onApply: () => void;
}) {
  const isSender = role === "sender";
  const isDriver = role === "driver";
  const mayApply = isDriver && delivery.status === "open" && !["applied", "selected", "confirmed"].includes(delivery.ownCandidateStatus ?? "");
  const vehicleLabel = (delivery.vehicleTypes ?? []).join(" · ") || "Moto";
  const route = formatListRouteParts(delivery.pickup, delivery.dropoff);
  const dateInfo = formatDeliveryCreationDate(delivery.createdAt);
  const dateColor = dateInfo.tone === "primary" ? "#007B8B" : "#747474";
  const dateBg = dateInfo.tone === "primary" ? "#E6F4F5" : "#F0F0F2";
  const totalDistance = formatDistanceKm(delivery.distanceKm);
  const driverDistText = driverDistance
    ? `${driverDistance.value} ${driverDistance.unit}`
    : driverLocationStatus === "loading" || driverLocationStatus === "idle"
      ? "…"
      : driverLocationStatus === "denied"
        ? "GPS off"
        : "—";

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, selected && styles.rowSelected, pressed && styles.pressed]}>
      <View style={styles.rowTop}>
        <View style={[styles.rowThumb, isSender ? null : styles.rowThumbDriver]}>
          <MaterialIcons name={TYPE_ICON[delivery.type] ?? "local-shipping"} size={15} color={isSender ? "#111111" : "#FFFFFF"} />
        </View>
        <View style={styles.rowMain}>
          <Text style={styles.rowTitle} numberOfLines={1}>{delivery.title}</Text>
          <Text style={styles.rowSub} numberOfLines={1}>{route.pickup} → {route.dropoff} · {vehicleLabel}</Text>
        </View>
        <Text style={styles.rowPrice}>{formatMoney(delivery.offeredPrice ?? delivery.estimatedPrice)}</Text>
      </View>
      <View style={styles.rowDateRow}>
        <View style={[styles.datePill, { backgroundColor: dateBg }]}>
          <MaterialIcons name={dateInfo.icon} size={11} color={dateColor} />
          <Text style={[styles.datePillText, { color: dateColor }]}>{dateInfo.primary}</Text>
        </View>
      </View>
      <View style={styles.rowBottom}>
        <View style={styles.rowStat}>
          <MaterialIcons name="route" size={12} color="#666666" />
          <Text style={styles.rowStatText}>{totalDistance.value} {totalDistance.unit}</Text>
        </View>
        {isDriver ? (
          <View style={styles.rowStat}>
            <MaterialIcons name="my-location" size={12} color="#007B8B" />
            <Text style={[styles.rowStatText, { color: "#007B8B", fontWeight: "700" }]}>Vous êtes à {driverDistText}</Text>
          </View>
        ) : (
          <View style={styles.rowStat}>
            <MaterialIcons name="group" size={12} color="#666666" />
            <Text style={styles.rowStatText}>{delivery.candidateCount ?? 0} candidat{(delivery.candidateCount ?? 0) > 1 ? "s" : ""}</Text>
          </View>
        )}
        <View style={styles.rowActions}>
          <Pressable onPress={onDetails} style={({ pressed }) => [styles.rowBtnOutline, pressed && styles.pressed]}>
            <Text style={styles.rowBtnOutlineText}>Détails</Text>
          </Pressable>
          {isDriver && mayApply ? (
            <Pressable
              onPress={onApply}
              disabled={applying}
              style={({ pressed }) => [styles.rowBtnFilled, applying && { opacity: 0.6 }, pressed && !applying && styles.pressed]}
            >
              {applying ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.rowBtnFilledText}>Postuler</Text>}
            </Pressable>
          ) : (
            <Pressable onPress={onDetails} style={({ pressed }) => [styles.rowBtnFilled, pressed && styles.pressed]}>
              <Text style={styles.rowBtnFilledText}>{isSender ? "Suivre" : "Voir"}</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#EEEDF3" },

  mapBg: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#EEEDF3" },
  nativeMarkerStart: { width: 32, height: 32, borderRadius: 9, backgroundColor: "#007B8B", alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: "#FFFFFF" },
  nativeMarkerDriver: { width: 30, height: 30, borderRadius: 15, backgroundColor: "#111111", alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#FFFFFF" },
  nativeMarkerEnd: { width: 32, height: 32, borderRadius: 9, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: "#B4232D" },

  fab: { position: "absolute", right: 14, bottom: 440, width: 50, height: 50, borderRadius: 14, backgroundColor: "#007B8B", alignItems: "center", justifyContent: "center", shadowColor: "#007B8B", shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6, zIndex: 10 },

  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: "#FFFFFF", borderTopLeftRadius: 18, borderTopRightRadius: 18, shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 12, shadowOffset: { width: 0, height: -4 }, elevation: 8, overflow: "hidden" },
  sheetHeader: { paddingTop: 10, paddingBottom: 8 },
  sheetGrip: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: "#D5D5DC", marginBottom: 10 },
  sheetTop: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14 },
  greetingBlock: { flex: 1, minWidth: 0 },
  sheetTitle: { color: "#111111", fontSize: 14, fontWeight: "700", lineHeight: 18 },
  sheetSubtitle: { color: "#666666", fontSize: 10.5, marginTop: 1, fontWeight: "500" },

  servicePill: { paddingHorizontal: 12, height: 38, borderRadius: 11, backgroundColor: "#007B8B", flexDirection: "row", alignItems: "center", gap: 6, shadowColor: "#007B8B", shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  servicePillOffline: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#D7D5DE", shadowOpacity: 0, elevation: 0 },
  servicePillNeutral: { backgroundColor: "#EEEDF3", shadowOpacity: 0, elevation: 0 },
  serviceText: { color: "#FFFFFF", fontSize: 11, fontWeight: "700", letterSpacing: 0.4 },
  serviceTextOffline: { color: "#111111" },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#FFFFFF" },
  onlineDotOffline: { backgroundColor: "#747474" },

  searchRow: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 6 },
  searchPill: { height: 40, backgroundColor: "#EEEDF3", borderRadius: 11, flexDirection: "row", alignItems: "center", paddingHorizontal: 12, gap: 8 },
  searchInput: { flex: 1, color: "#111111", fontSize: 13, paddingVertical: 0, paddingHorizontal: 0 },

  walletCard: { marginHorizontal: 14, marginTop: 6, marginBottom: 8, backgroundColor: "#111111", borderRadius: 12, padding: 14 },
  walletEyebrow: { color: "rgba(255,255,255,0.55)", fontSize: 10, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" },
  walletRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginTop: 4, marginBottom: 10 },
  walletAmount: { color: "#FFFFFF", fontSize: 26, fontWeight: "700", letterSpacing: -0.4 },
  walletTrend: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(72,184,137,0.16)", paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  walletTrendText: { color: "#48B889", fontSize: 11, fontWeight: "700" },
  walletDivider: { height: 1, backgroundColor: "rgba(255,255,255,0.10)", marginBottom: 10 },
  walletStats: { flexDirection: "row", gap: 12 },
  walletStat: { flex: 1 },
  walletStatLabel: { color: "rgba(255,255,255,0.55)", fontSize: 10 },
  walletStatValue: { color: "#FFFFFF", fontSize: 13, fontWeight: "700", marginTop: 2 },

  filterRow: { flexDirection: "row", gap: 6, paddingHorizontal: 14, paddingBottom: 10, flexWrap: "wrap" },
  chip: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 7, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#D7D5DE" },
  chipActive: { backgroundColor: "#007B8B", borderColor: "#007B8B" },
  chipText: { color: "#666666", fontSize: 11, fontWeight: "600" },
  chipTextActive: { color: "#FFFFFF" },

  scrollArea: { flex: 1, marginTop: 2 },
  scrollContent: { paddingHorizontal: 14, paddingTop: 6, paddingBottom: 90, gap: 8 },

  urgentCard: { borderRadius: 12, padding: 12, gap: 10 },
  urgentCardSender: { backgroundColor: "#111111" },
  urgentCardDriver: { backgroundColor: "#007B8B" },
  urgentHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  urgentThumb: { width: 36, height: 36, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  urgentThumbSender: { backgroundColor: "#007B8B" },
  urgentThumbDriver: { backgroundColor: "#FFFFFF" },
  urgentMeta: { flex: 1, minWidth: 0 },
  urgentTitle: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  urgentSub: { color: "rgba(255,255,255,0.65)", fontSize: 11, marginTop: 2 },
  urgentChip: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5 },
  urgentChipText: { fontSize: 9, fontWeight: "700", letterSpacing: 0.4 },
  urgentPricing: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  urgentPrice: { color: "#FFFFFF", fontSize: 20, fontWeight: "700", letterSpacing: -0.3 },
  urgentPriceExtra: { color: "rgba(255,255,255,0.6)", fontSize: 10, marginTop: 1 },
  urgentActions: { flexDirection: "row", gap: 7 },
  urgentBtnWhite: { flex: 1, height: 38, borderRadius: 9, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 },
  urgentBtnWhiteText: { color: "#007B8B", fontSize: 12, fontWeight: "700" },

  listSection: { marginTop: 4, gap: 8 },
  row: { backgroundColor: "#FFFFFF", borderRadius: 10, padding: 11, borderWidth: 1, borderColor: "#E3E3E3" },
  rowSelected: { borderColor: "#007B8B", backgroundColor: "#F5FBFB" },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 9 },
  rowThumb: { width: 30, height: 30, borderRadius: 8, backgroundColor: "#EEEDF3", alignItems: "center", justifyContent: "center" },
  rowThumbDriver: { backgroundColor: "#007B8B" },
  rowMain: { flex: 1, minWidth: 0 },
  rowTitle: { color: "#111111", fontSize: 12.5, fontWeight: "600" },
  rowSub: { color: "#666666", fontSize: 10.5, marginTop: 1 },
  rowPrice: { color: "#111111", fontSize: 14, fontWeight: "700" },
  rowDateRow: { flexDirection: "row", alignItems: "center", marginTop: 8 },
  datePill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  datePillText: { fontSize: 10.5, fontWeight: "700" },
  rowBottom: { flexDirection: "row", alignItems: "center", marginTop: 8, gap: 10 },
  rowStat: { flexDirection: "row", alignItems: "center", gap: 4 },
  rowStatText: { color: "#666666", fontSize: 10.5, fontWeight: "500" },
  rowActions: { marginLeft: "auto", flexDirection: "row", gap: 6 },
  rowBtnOutline: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 7, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#D7D5DE" },
  rowBtnOutlineText: { color: "#111111", fontSize: 10.5, fontWeight: "600" },
  rowBtnFilled: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 7, backgroundColor: "#007B8B", minWidth: 64, alignItems: "center", flexDirection: "row", gap: 4, justifyContent: "center" },
  rowBtnFilledText: { color: "#FFFFFF", fontSize: 10.5, fontWeight: "700" },

  loadingState: { alignItems: "center", paddingVertical: 32, gap: 8 },
  loadingText: { color: "#666666", fontSize: 12 },
  empty: { alignItems: "center", paddingHorizontal: 24, paddingVertical: 24 },
  emptyIcon: { width: 60, height: 60, borderRadius: 14, backgroundColor: "#EEEDF3", alignItems: "center", justifyContent: "center", marginBottom: 12 },
  emptyTitle: { color: "#111111", fontSize: 14, fontWeight: "600", marginBottom: 4 },
  emptyText: { color: "#666666", fontSize: 12, textAlign: "center", lineHeight: 18 },

  pressed: { opacity: 0.7 },
});
