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
import { availableWalletBalance, formatMoney, type Delivery, type DeliveryStatus } from "@/shared/tikis-domain";

const { height: SCREEN_H } = Dimensions.get("window");
const SHEET_MIN = 110;
const SHEET_PEEK = 340;
const SHEET_EXPANDED = Math.min(SCREEN_H * 0.78, 720);

const TYPE_ICON: Record<Delivery["type"], React.ComponentProps<typeof MaterialIcons>["name"]> = {
  Plis: "inventory-2",
  Personne: "person",
  Autre: "local-shipping",
};

const STATUS_CHIP: Record<DeliveryStatus, { label: string; color: string; bg: string }> = {
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

function openNavigation(pickup: { latitude: number; longitude: number }, dropoff: { latitude: number; longitude: number }) {
  const url = `https://www.google.com/maps/dir/?api=1&origin=${pickup.latitude},${pickup.longitude}&destination=${dropoff.latitude},${dropoff.longitude}&travelmode=driving`;
  void Linking.openURL(url);
}

function fitRegionFor(pickup: { latitude: number; longitude: number }, dropoff: { latitude: number; longitude: number }): Region {
  const midLat = (pickup.latitude + dropoff.latitude) / 2;
  const midLng = (pickup.longitude + dropoff.longitude) / 2;
  const latDelta = Math.max(0.025, Math.abs(pickup.latitude - dropoff.latitude) * 2.2);
  const lngDelta = Math.max(0.025, Math.abs(pickup.longitude - dropoff.longitude) * 2.2);
  return { latitude: midLat, longitude: midLng, latitudeDelta: latDelta, longitudeDelta: lngDelta };
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
  const [expanded, setExpanded] = useState(false);
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
      const haystack = [
        d.title,
        d.type,
        route.pickup,
        route.dropoff,
        (d.vehicleTypes ?? []).join(" "),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    };
    if (role === "driver") {
      return [...deliveries]
        .filter(matches)
        .sort((a, b) => driverSortPriority(a) - driverSortPriority(b) || a.distanceKm - b.distanceKm);
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

  const animateSheet = (toExpanded: boolean) => {
    setExpanded(toExpanded);
    Animated.spring(sheetHeight, { toValue: toExpanded ? SHEET_EXPANDED : SHEET_PEEK, useNativeDriver: false, friction: 9, tension: 60 }).start();
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

  const animateSheetTo = (toValue: number) => {
    setExpanded(toValue === SHEET_EXPANDED);
    Animated.spring(sheetHeight, { toValue, useNativeDriver: false, friction: 9, tension: 60 }).start();
  };

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

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <MapBackground selected={selected} />

      <View style={styles.searchRow} pointerEvents="box-none">
        {role === "sender" ? (
          <>
            <View style={styles.searchPill}>
              <MaterialIcons name="search" size={16} color="#747474" />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Rechercher une livraison…"
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
            <Pressable onPress={() => openDrawer()} style={({ pressed }) => [styles.searchBtn, pressed && styles.pressed]} accessibilityLabel="Menu">
              <MaterialIcons name="menu" size={20} color="#111111" />
            </Pressable>
          </>
        ) : (
          <>
            <View style={[styles.searchPill, !driverOnline && styles.searchPillOffline]}>
              <Pressable onPress={() => setDriverOnline((prev) => !prev)} style={styles.onlineToggle} accessibilityLabel="Basculer en service">
                <View style={[styles.onlineDot, !driverOnline && styles.onlineDotOffline]} />
                <Text style={[styles.onlinePillText, !driverOnline && styles.onlinePillTextOffline]}>{driverOnline ? "EN SERVICE" : "HORS SERVICE"}</Text>
              </Pressable>
              <View style={styles.searchDivider} />
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
            <Pressable onPress={() => openDrawer()} style={({ pressed }) => [styles.searchBtn, pressed && styles.pressed]} accessibilityLabel="Menu">
              <MaterialIcons name="menu" size={20} color="#111111" />
            </Pressable>
          </>
        )}
      </View>

      <Pressable
        onPress={() => {
          if (role === "sender") router.push("/create-delivery" as any);
        }}
        style={({ pressed }) => [styles.fab, pressed && styles.pressed]}
        accessibilityLabel={role === "sender" ? "Créer une livraison" : "Recherche rapide"}
      >
        <MaterialIcons name={role === "sender" ? "add" : "search"} size={26} color="#FFFFFF" />
      </Pressable>

      <Animated.View style={[styles.sheet, { height: sheetHeight }]}>
        <View {...panResponder.panHandlers} style={styles.sheetHeader}>
          <View style={styles.sheetGrip} />
          <View style={styles.sheetTitleRow}>
            <View>
              <Text style={styles.sheetTitle}>Bonjour {firstName} 👋</Text>
              <Text style={styles.sheetSubtitle}>
                {role === "sender"
                  ? `${filteredList.length} livraison${filteredList.length > 1 ? "s" : ""} affichée${filteredList.length > 1 ? "s" : ""}`
                  : `${filteredList.length} opportunité${filteredList.length > 1 ? "s" : ""} à proximité`}
              </Text>
            </View>
            {role === "driver" ? (
              <View style={styles.walletBadge}>
                {walletQuery.isLoading ? (
                  <ActivityIndicator size="small" color="#007B8B" />
                ) : (
                  <>
                    <MaterialIcons name="account-balance-wallet" size={14} color="#007B8B" />
                    <Text style={styles.walletBadgeText}>{driverWallet ? formatMoney(availableWalletBalance(driverWallet)) : "—"}</Text>
                  </>
                )}
              </View>
            ) : null}
          </View>
          <View style={styles.filterRow}>
            {FILTERS.map((item) => (
              <Pressable key={item.key} onPress={() => setFilter(item.key)} style={({ pressed }) => [styles.chip, filter === item.key && styles.chipActive, pressed && styles.pressed]}>
                <Text style={[styles.chipText, filter === item.key && styles.chipTextActive]}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <ScrollView
          style={styles.scrollArea}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          scrollEnabled
        >
          {deliveriesQuery.isLoading ? (
            <View style={styles.loadingState}>
              <ActivityIndicator color="#007B8B" />
              <Text style={styles.loadingText}>Chargement de vos livraisons…</Text>
            </View>
          ) : !selected ? (
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <MaterialIcons name={role === "sender" ? "add" : "local-shipping"} size={26} color="#747474" />
              </View>
              <Text style={styles.emptyTitle}>{role === "sender" ? "Aucune livraison en cours" : "Aucune opportunité disponible"}</Text>
              <Text style={styles.emptyText}>
                {role === "sender"
                  ? "Publiez votre première course et comparez les livreurs disponibles."
                  : "Revenez dans quelques minutes, de nouvelles courses arrivent régulièrement."}
              </Text>
            </View>
          ) : (
            <UrgentCard
              delivery={selected}
              role={role}
              driverDistance={role === "driver" ? driverLocation.distanceTo(selected.pickup) : null}
              driverLocationStatus={role === "driver" ? driverLocation.status : null}
              applying={applyingId === selected.id}
              onAction={() => {
                if (role === "sender") router.push(`/track/${selected.id}` as any);
                else router.push(`/delivery/${selected.id}` as any);
              }}
              onDetails={() => router.push(`/delivery/${selected.id}` as any)}
              onApply={() => handleApply(selected.id)}
            />
          )}

          {otherDeliveries.length > 0 ? (
            <View style={styles.listSection}>
              <Text style={styles.listSectionTitle}>
                {role === "sender" ? "Autres livraisons" : "Autres opportunités"}
              </Text>
              {otherDeliveries.map((delivery) => (
                <DeliveryRow
                  key={delivery.id}
                  delivery={delivery}
                  role={role}
                  selected={delivery.id === selectedId}
                  driverDistance={role === "driver" ? driverLocation.distanceTo(delivery.pickup) : null}
                  driverLocationStatus={role === "driver" ? driverLocation.status : null}
                  applying={applyingId === delivery.id}
                  onPress={() => {
                    setSelectedId(delivery.id);
                    if (!expanded) animateSheet(true);
                  }}
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
  driverDistance,
  driverLocationStatus,
  applying,
  onAction,
  onDetails,
  onApply,
}: {
  delivery: Delivery;
  role: "sender" | "driver";
  driverDistance: { value: string; unit: "m" | "km"; km: number } | null;
  driverLocationStatus: "idle" | "loading" | "ready" | "denied" | "unavailable" | null;
  applying: boolean;
  onAction: () => void;
  onDetails: () => void;
  onApply: () => void;
}) {
  const route = formatListRouteParts(delivery.pickup, delivery.dropoff);
  const price = formatMoney(delivery.offeredPrice ?? delivery.estimatedPrice);
  const isSender = role === "sender";
  const isDriver = role === "driver";
  const isOwnActive = isDriver && (delivery.status === "pending_confirmation" || delivery.status === "active" || delivery.ownCandidateStatus === "selected" || delivery.ownCandidateStatus === "confirmed");
  const mayApply = isDriver && delivery.status === "open" && !["applied", "selected", "confirmed"].includes(delivery.ownCandidateStatus ?? "");
  const vehicleLabel = (delivery.vehicleTypes ?? []).join(" · ") || "Moto";

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
              ? `${route.pickup} → ${route.dropoff} · ${vehicleLabel}`
              : `${route.pickup} → ${route.dropoff} · ${vehicleLabel}`}
          </Text>
        </View>
        <View style={[styles.urgentChip, { backgroundColor: STATUS_CHIP[delivery.status].bg }]}>
          <Text style={[styles.urgentChipText, { color: STATUS_CHIP[delivery.status].color }]}>{STATUS_CHIP[delivery.status].label}</Text>
        </View>
      </View>
      <View style={styles.urgentPricing}>
        <View>
          <Text style={styles.urgentPrice}>{price}</Text>
          <Text style={styles.urgentPriceExtra}>{isSender ? "est. client" : "rémunération nette"}</Text>
        </View>
        <View style={styles.urgentSideStat}>
          <Text style={styles.urgentSideStatLabel}>{isSender ? "Livreur" : "Vous êtes à"}</Text>
          <Text style={styles.urgentSideStatValue}>
            {isSender
              ? delivery.driverName ?? "En attente"
              : driverDistance
                ? `${driverDistance.value} ${driverDistance.unit}`
                : driverLocationStatus === "loading" || driverLocationStatus === "idle"
                  ? "…"
                  : driverLocationStatus === "denied"
                    ? "GPS off"
                    : "—"}
          </Text>
        </View>
      </View>
      <View style={styles.urgentActions}>
        {isSender ? (
          <Pressable onPress={onAction} style={({ pressed }) => [styles.urgentBtnWhite, pressed && styles.pressed]}>
            <MaterialIcons name="my-location" size={15} color="#111111" />
            <Text style={styles.urgentBtnWhiteText}>Suivre la course</Text>
          </Pressable>
        ) : isOwnActive ? (
          <>
            <Pressable onPress={onDetails} style={({ pressed }) => [styles.urgentBtnLight, pressed && styles.pressed]}>
              <MaterialIcons name="description" size={15} color="#FFFFFF" />
              <Text style={styles.urgentBtnLightText}>Détails</Text>
            </Pressable>
            <Pressable onPress={() => openNavigation(delivery.pickup, delivery.dropoff)} style={({ pressed }) => [styles.urgentBtnWhite, pressed && styles.pressed]}>
              <MaterialIcons name="navigation" size={15} color="#007B8B" />
              <Text style={styles.urgentBtnWhiteText}>Démarrer</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable onPress={onDetails} style={({ pressed }) => [styles.urgentBtnLight, pressed && styles.pressed]}>
              <MaterialIcons name="description" size={15} color="#FFFFFF" />
              <Text style={styles.urgentBtnLightText}>Détails</Text>
            </Pressable>
            {mayApply ? (
              <Pressable
                onPress={onApply}
                disabled={applying}
                style={({ pressed }) => [styles.urgentBtnWhite, applying ? { opacity: 0.6 } : pressed ? styles.pressed : null]}
              >
                {applying ? (
                  <ActivityIndicator size="small" color="#007B8B" />
                ) : (
                  <MaterialIcons name="add-circle" size={15} color="#007B8B" />
                )}
                <Text style={styles.urgentBtnWhiteText}>{applying ? "Candidature…" : "Postuler"}</Text>
              </Pressable>
            ) : (
              <Pressable onPress={onDetails} style={({ pressed }) => [styles.urgentBtnWhite, pressed && styles.pressed]}>
                <MaterialIcons name="arrow-forward" size={15} color="#007B8B" />
                <Text style={styles.urgentBtnWhiteText}>Voir la course</Text>
              </Pressable>
            )}
          </>
        )}
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
  const route = formatListRouteParts(delivery.pickup, delivery.dropoff);
  const price = formatMoney(delivery.offeredPrice ?? delivery.estimatedPrice);
  const isSender = role === "sender";
  const isDriver = role === "driver";
  const isOwnActive = isDriver && (delivery.status === "pending_confirmation" || delivery.status === "active" || delivery.ownCandidateStatus === "selected" || delivery.ownCandidateStatus === "confirmed");
  const mayApply = isDriver && delivery.status === "open" && !["applied", "selected", "confirmed"].includes(delivery.ownCandidateStatus ?? "");
  const vehicleLabel = (delivery.vehicleTypes ?? []).join(" · ") || "Moto";
  const driverDistanceText = driverDistance
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
        <Text style={styles.rowPrice}>{price}</Text>
      </View>
      <View style={styles.rowBottom}>
        <View style={styles.rowStat}>
          <MaterialIcons name="route" size={12} color="#666666" />
          <Text style={styles.rowStatText}>{delivery.distanceKm.toFixed(1)} km</Text>
        </View>
        {isSender ? (
          <View style={styles.rowStat}>
            <MaterialIcons name="group" size={12} color="#666666" />
            <Text style={styles.rowStatText}>{delivery.candidateCount ?? 0} candidat{(delivery.candidateCount ?? 0) > 1 ? "s" : ""}</Text>
          </View>
        ) : (
          <View style={styles.rowStat}>
            <MaterialIcons name="my-location" size={12} color="#007B8B" />
            <Text style={[styles.rowStatText, { color: "#007B8B", fontWeight: "700" }]}>Vous êtes à {driverDistanceText}</Text>
          </View>
        )}
        <View style={styles.rowActions}>
          <Pressable onPress={onDetails} style={({ pressed }) => [styles.rowBtnOutline, pressed && styles.pressed]}>
            <Text style={styles.rowBtnOutlineText}>Détails</Text>
          </Pressable>
          {isSender ? (
            <Pressable onPress={onDetails} style={({ pressed }) => [styles.rowBtnFilled, pressed && styles.pressed]}>
              <Text style={styles.rowBtnFilledText}>Suivre</Text>
            </Pressable>
          ) : isOwnActive ? (
            <Pressable
              onPress={() => openNavigation(delivery.pickup, delivery.dropoff)}
              style={({ pressed }) => [styles.rowBtnFilled, pressed && styles.pressed]}
            >
              <MaterialIcons name="navigation" size={12} color="#FFFFFF" />
              <Text style={styles.rowBtnFilledText}>Démarrer</Text>
            </Pressable>
          ) : mayApply ? (
            <Pressable
              onPress={onApply}
              disabled={applying}
              style={({ pressed }) => [styles.rowBtnFilled, applying && { opacity: 0.6 }, pressed && !applying && styles.pressed]}
            >
              {applying ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.rowBtnFilledText}>Postuler</Text>}
            </Pressable>
          ) : (
            <Pressable onPress={onDetails} style={({ pressed }) => [styles.rowBtnFilled, pressed && styles.pressed]}>
              <Text style={styles.rowBtnFilledText}>Voir</Text>
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

  searchRow: { position: "absolute", top: 8, left: 14, right: 14, flexDirection: "row", alignItems: "center", gap: 8, zIndex: 10 },
  searchPill: { flex: 1, height: 40, borderRadius: 12, backgroundColor: "#FFFFFF", flexDirection: "row", alignItems: "center", paddingHorizontal: 12, gap: 8, shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  searchPillOffline: { backgroundColor: "#F3F2F6" },
  searchDivider: { width: 1, height: 22, backgroundColor: "#D7D5DE" },
  searchInput: { flex: 1, color: "#111111", fontSize: 13, paddingVertical: 0, paddingHorizontal: 0 },
  searchPillText: { color: "#666666", fontSize: 13 },
  searchBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  onlineToggle: { flexDirection: "row", alignItems: "center", gap: 6 },

  onlinePillText: { color: "#FFFFFF", fontSize: 12, fontWeight: "600" },
  onlinePillTextOffline: { color: "#111111" },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#FFFFFF" },
  onlineDotOffline: { backgroundColor: "#747474" },

  fab: { position: "absolute", right: 14, bottom: 360, width: 50, height: 50, borderRadius: 14, backgroundColor: "#007B8B", alignItems: "center", justifyContent: "center", shadowColor: "#007B8B", shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6, zIndex: 10 },

  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: "#FFFFFF", borderTopLeftRadius: 18, borderTopRightRadius: 18, shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 12, shadowOffset: { width: 0, height: -4 }, elevation: 8, overflow: "hidden" },
  sheetHeader: { paddingTop: 10, paddingBottom: 8 },
  sheetGrip: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: "#D5D5DC", marginBottom: 10 },
  sheetTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 10 },
  sheetTitle: { color: "#111111", fontSize: 15, fontWeight: "700" },
  sheetSubtitle: { color: "#666666", fontSize: 11, marginTop: 2, fontWeight: "500" },
  walletBadge: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: "#E6F4F5", borderRadius: 7 },
  walletBadgeText: { color: "#007B8B", fontSize: 11, fontWeight: "700" },
  filterRow: { flexDirection: "row", gap: 6, paddingHorizontal: 14, flexWrap: "wrap" },
  chip: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 7, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#D7D5DE" },
  chipActive: { backgroundColor: "#007B8B", borderColor: "#007B8B" },
  chipText: { color: "#666666", fontSize: 11, fontWeight: "600" },
  chipTextActive: { color: "#FFFFFF" },

  scrollArea: { flex: 1, marginTop: 4 },
  scrollContent: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 90, gap: 10 },

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
  urgentSideStat: { alignItems: "flex-end" },
  urgentSideStatLabel: { color: "rgba(255,255,255,0.65)", fontSize: 10 },
  urgentSideStatValue: { color: "#FFFFFF", fontSize: 14, fontWeight: "700", marginTop: 1 },
  urgentActions: { flexDirection: "row", gap: 7 },
  urgentBtnWhite: { flex: 1, height: 38, borderRadius: 9, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 },
  urgentBtnWhiteText: { color: "#007B8B", fontSize: 12, fontWeight: "700" },
  urgentBtnLight: { flex: 1, height: 38, borderRadius: 9, backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6, borderWidth: 1, borderColor: "rgba(255,255,255,0.22)" },
  urgentBtnLightText: { color: "#FFFFFF", fontSize: 12, fontWeight: "600" },

  listSection: { marginTop: 6 },
  listSectionTitle: { fontSize: 10.5, fontWeight: "600", color: "#747474", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 8, paddingHorizontal: 4 },
  row: { backgroundColor: "#FFFFFF", borderRadius: 10, padding: 11, marginBottom: 7, borderWidth: 1, borderColor: "#E3E3E3" },
  rowSelected: { borderColor: "#007B8B", backgroundColor: "#F5FBFB" },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 9 },
  rowThumb: { width: 30, height: 30, borderRadius: 8, backgroundColor: "#EEEDF3", alignItems: "center", justifyContent: "center" },
  rowThumbDriver: { backgroundColor: "#007B8B" },
  rowMain: { flex: 1, minWidth: 0 },
  rowTitle: { color: "#111111", fontSize: 12.5, fontWeight: "600" },
  rowSub: { color: "#666666", fontSize: 10.5, marginTop: 1 },
  rowPrice: { color: "#111111", fontSize: 14, fontWeight: "700" },
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
