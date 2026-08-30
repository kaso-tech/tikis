import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, Dimensions, Linking, PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
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

function openNavigation(origin: { latitude: number; longitude: number }, pickup: { latitude: number; longitude: number }, dropoff: { latitude: number; longitude: number }) {
  const url = `https://www.google.com/maps/dir/?api=1&origin=${origin.latitude},${origin.longitude}&destination=${dropoff.latitude},${dropoff.longitude}&waypoints=${pickup.latitude},${pickup.longitude}&travelmode=driving`;
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
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const sheetHeight = useRef(new Animated.Value(SHEET_PEEK)).current;
  const sheetValue = useRef(SHEET_PEEK);
  const dragStartHeight = useRef(SHEET_PEEK);
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
    Animated.timing(sheetHeight, { toValue, duration: 220, useNativeDriver: false }).start();
  };

  const panResponder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 5 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderGrant: () => { dragStartHeight.current = sheetValue.current; },
    onPanResponderMove: (_, gesture) => {
      const next = Math.max(SHEET_MIN, Math.min(SHEET_EXPANDED, dragStartHeight.current - gesture.dy));
      sheetHeight.setValue(next);
    },
    onPanResponderRelease: (_, gesture) => {
      const current = sheetValue.current;
      const targets = [SHEET_MIN, SHEET_PEEK, SHEET_EXPANDED];
      const target = gesture.vy <= -0.65
        ? SHEET_EXPANDED
        : gesture.vy >= 0.65
          ? SHEET_MIN
          : targets.reduce((closest, snap) => Math.abs(snap - current) < Math.abs(closest - current) ? snap : closest, SHEET_PEEK);
      animateSheetTo(target);
    },
  })).current;

  const utilities = trpc.useUtils();
  const applyMutation = trpc.deliveries.submitApplication.useMutation();
  const withdrawMutation = trpc.deliveries.withdraw.useMutation();
  const confirmMutation = trpc.deliveries.confirm.useMutation();

  async function handleDriverAction(delivery: Delivery) {
    setActioningId(delivery.id);
    try {
      if (delivery.ownCandidateStatus === "applied") await withdrawMutation.mutateAsync({ deliveryId: delivery.id });
      else if (delivery.ownCandidateStatus === "selected") await confirmMutation.mutateAsync({ deliveryId: delivery.id });
      else if (delivery.ownCandidateStatus === "confirmed" || delivery.status === "active") {
        let origin = driverLocation.location;
        if (!origin) {
          const position = await driverLocation.request();
          origin = position ? { latitude: position.coords.latitude, longitude: position.coords.longitude } : null;
        }
        if (!origin) throw new Error("La position actuelle est requise pour démarrer la navigation.");
        openNavigation(origin, delivery.pickup, delivery.dropoff);
        return;
      } else await applyMutation.mutateAsync({ deliveryId: delivery.id });
      await Promise.all([utilities.deliveries.list.invalidate(), utilities.wallet.snapshot.invalidate(), utilities.notifications.list.invalidate()]);
    } catch (cause) {
      Alert.alert("Action indisponible", cause instanceof Error ? cause.message : "Réessayez dans un instant.");
    } finally {
      setActioningId(null);
    }
  }

  const isDriver = role === "driver";
  const firstNameDisplay = isDriver ? firstName : "à vous";
  const countLabel = isDriver ? `${filteredList.length} opportunité${filteredList.length > 1 ? "s" : ""} à proximité` : `${filteredList.length} livraison${filteredList.length > 1 ? "s" : ""} affichée${filteredList.length > 1 ? "s" : ""}`;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <MapBackground selected={selected} sheetOverlayHeight={sheetValue.current} driverPosition={driverLocation.location} />

      {!isDriver ? <Pressable
        onPress={() => {
          if (!isDriver) router.push("/create-delivery" as any);
        }}
        style={({ pressed }) => [styles.fab, pressed && styles.pressed]}
        accessibilityLabel={!isDriver ? "Créer une livraison" : ""}
      >
        {!isDriver && <MaterialIcons name="add" size={26} color="#FFFFFF" />}
      </Pressable> : null}

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
          ref={scrollRef}
          style={styles.scrollArea}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={(event) => setShowScrollTop(event.nativeEvent.contentOffset.y > 180)}
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
            <View style={styles.listSection}>
              {filteredList.map((delivery) => (
                <DeliveryRow
                  key={delivery.id}
                  delivery={delivery}
                  role={role}
                  selected={delivery.id === selected.id}
                  driverDistance={driverLocation.distanceTo(delivery.pickup)}
                  driverLocationStatus={driverLocation.status}
                  applying={actioningId === delivery.id}
                  onPress={() => setSelectedId(delivery.id)}
                  onDetails={() => router.push(`/delivery/${delivery.id}` as any)}
                  onApply={() => void handleDriverAction(delivery)}
                />
              ))}
            </View>
          ) : (
            <UrgentCard
              delivery={selected}
              role={role}
              onAction={() => router.push(`/delivery/${selected.id}/map` as any)}
            />
          )}

          {!isDriver && otherDeliveries.length > 0 ? (
            <View style={styles.listSection}>
              {otherDeliveries.map((delivery) => (
                <DeliveryRow
                  key={delivery.id}
                  delivery={delivery}
                  role={role}
                  selected={false}
                  driverDistance={isDriver ? driverLocation.distanceTo(delivery.pickup) : null}
                  driverLocationStatus={isDriver ? driverLocation.status : null}
                  applying={actioningId === delivery.id}
                  onPress={() => setSelectedId(delivery.id)}
                  onDetails={() => router.push(`/delivery/${delivery.id}` as any)}
                  onApply={() => {}}
                />
              ))}
            </View>
          ) : null}
        </ScrollView>
      </Animated.View>
      {isDriver && showScrollTop ? (
        <Pressable onPress={() => scrollRef.current?.scrollTo({ y: 0, animated: true })} style={({ pressed }) => [styles.scrollTopButton, pressed && styles.pressed]} accessibilityLabel="Revenir en haut">
          <MaterialIcons name="keyboard-arrow-up" size={20} color="#111111" />
        </Pressable>
      ) : null}
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

function MapBackground({ selected, sheetOverlayHeight, driverPosition }: { selected: Delivery | null | undefined; sheetOverlayHeight: number; driverPosition: { latitude: number; longitude: number } | null }) {
  const mapRef = useRef<MapView>(null);
  const routeMutation = trpc.geography.route.useMutation();
  const [routeCoordinates, setRouteCoordinates] = useState<{ latitude: number; longitude: number }[]>([]);
  const hasDriver = selected ? selected.status !== "open" : false;
  const region = useMemo(() => {
    if (!selected) return { latitude: 5.3599, longitude: -4.0083, latitudeDelta: 0.12, longitudeDelta: 0.12 };
    return fitRegionFor(selected.pickup, selected.dropoff);
  }, [selected]);

  useEffect(() => {
    if (!selected) return;
    const timer = setTimeout(() => {
      mapRef.current?.fitToCoordinates([selected.pickup, selected.dropoff], {
        edgePadding: { top: 84, left: 24, right: 24, bottom: Math.max(170, sheetOverlayHeight + 24) },
        animated: true,
      });
    }, 220);
    return () => clearTimeout(timer);
  }, [region, selected, sheetOverlayHeight]);

  useEffect(() => {
    let active = true;
    if (!selected) { setRouteCoordinates([]); return; }
    void routeMutation.mutateAsync({ origin: selected.pickup, destination: selected.dropoff })
      .then((route) => { if (active) setRouteCoordinates(route.coordinates); })
      .catch(() => { if (active) setRouteCoordinates([]); });
    return () => { active = false; };
  }, [selected?.id]);

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
            {routeCoordinates.length > 1 ? <Polyline coordinates={routeCoordinates} strokeColor="#007B8B" strokeWidth={4} lineCap="round" /> : null}
            <Marker coordinate={{ latitude: selected.pickup.latitude, longitude: selected.pickup.longitude }} anchor={{ x: 0.5, y: 0.5 }}>
              <View style={styles.nativeMarkerStart}>
                <MaterialIcons name="inventory-2" size={15} color="#FFFFFF" />
              </View>
            </Marker>
            {hasDriver ? (
              <Marker coordinate={driverPosition ?? { latitude: selected.pickup.latitude + 0.00022, longitude: selected.pickup.longitude + 0.00022 }} anchor={{ x: 0.5, y: 0.5 }}>
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
  const driverAction = delivery.ownCandidateStatus === "applied"
    ? "Renoncer"
    : delivery.ownCandidateStatus === "selected"
      ? "Confirmer"
      : delivery.ownCandidateStatus === "confirmed" || delivery.status === "active"
        ? "Démarrer"
        : "Postuler";
  const vehicleLabel = (delivery.vehicleTypes ?? []).join(" · ") || "Moto";
  const dimensions = delivery.dimensions?.lengthCm && delivery.dimensions?.widthCm && delivery.dimensions?.heightCm
    ? `${delivery.dimensions.lengthCm}×${delivery.dimensions.widthCm}×${delivery.dimensions.heightCm} cm`
    : null;
  const route = formatListRouteParts(delivery.pickup, delivery.dropoff);
  const dateInfo = formatDeliveryCreationDate(delivery.createdAt);
  const dateColor = dateInfo.tone === "primary" ? "#007B8B" : "#747474";
  const dateBg = dateInfo.tone === "primary" ? "#E6F4F5" : "#F0F0F2";
  const totalDistance = formatDistanceKm(delivery.distanceKm);
  const deliveryDetails = [delivery.type, delivery.passengers ? `${delivery.passengers} pers.` : null, `${totalDistance.value} ${totalDistance.unit}`, dimensions, vehicleLabel].filter(Boolean).join(" · ");
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
          <View style={styles.rowTitleLine}>
            <Text style={styles.rowTitle} numberOfLines={1}>{delivery.title}</Text>
            {isDriver ? <View style={styles.rowDriverDistance}><MaterialIcons name="navigation" size={12} color="#007B8B" /><Text style={styles.rowDriverDistanceText}>À {driverDistText}</Text></View> : null}
          </View>
          <Text style={styles.rowSub} numberOfLines={1}>{route.pickup} → {route.dropoff} · {vehicleLabel}</Text>
        </View>
      </View>
      <View style={styles.rowDateRow}>
        <Text style={styles.rowDetails} numberOfLines={1}>{deliveryDetails}</Text>
        <Text style={styles.rowPrice}>{formatMoney(delivery.offeredPrice ?? delivery.estimatedPrice)}</Text>
      </View>
      <View style={styles.rowBottom}>
        <View style={[styles.datePill, { backgroundColor: dateBg }]}> 
          <MaterialIcons name={dateInfo.icon} size={11} color={dateColor} />
          <Text style={[styles.datePillText, { color: dateColor }]}>{dateInfo.primary}</Text>
        </View>
        <View style={styles.rowActions}>
          <Pressable onPress={onDetails} style={({ pressed }) => [styles.rowBtnOutline, pressed && styles.pressed]}>
            <Text style={styles.rowBtnOutlineText}>Détails</Text>
          </Pressable>
          {isDriver ? (
            <Pressable
              onPress={onApply}
              disabled={applying}
              style={({ pressed }) => [styles.rowBtnFilled, applying && { opacity: 0.6 }, pressed && !applying && styles.pressed]}
            >
              {applying ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.rowBtnFilledText}>{driverAction}</Text>}
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
  rowTitleLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  rowTitle: { color: "#111111", fontSize: 12.5, fontWeight: "600" },
  rowSub: { color: "#666666", fontSize: 10.5, marginTop: 1 },
  rowPrice: { color: "#111111", fontSize: 14, fontWeight: "700", textAlign: "right" },
  rowDetails: { flex: 1, color: "#111111", fontSize: 11.5, lineHeight: 16, paddingRight: 8 },
  rowDriverDistance: { marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 3, paddingTop: 1 },
  rowDriverDistanceText: { color: "#007B8B", fontSize: 10.5, fontWeight: "600" },
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
  scrollTopButton: { position: "absolute", right: 16, bottom: 24, width: 38, height: 38, borderRadius: 10, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#D7D5DE", alignItems: "center", justifyContent: "center" },
});
