import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, Dimensions, Linking, PanResponder, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import MapView, { Marker, Polyline, type Region } from "react-native-maps";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTikisStore } from "@/lib/tikis-store";
import { haptic } from "@/lib/haptics";
import { trpc } from "@/lib/trpc";
import { formatListRouteParts, geodesicDistanceKm, locationTitle } from "@/lib/geo-rules";
import { useDriverLocation } from "@/hooks/use-driver-location";
import { useDeviceHeading } from "@/hooks/use-device-heading";
import { useLiveDeliveryPosition } from "@/hooks/use-live-delivery-position";
import { compassRotationToTarget } from "@/lib/compass";
import { formatDistanceKm, formatDeliveryCreationDate } from "@/lib/date-format";
import { CandidatesSheet } from "@/components/tikis/candidates-sheet";
import { FinancialConfirmationModal } from "@/components/tikis/financial-modal";
import { ActionConfirmationModal } from "@/components/tikis/action-confirmation-modal";
import { availableWalletBalance, commissionFor, formatMoney, isDeliveryCompletedToday, isDeliveryCompletedWithinLast24Hours, type Delivery, type DeliveryStatus, type DriverCandidate } from "@/shared/tikis-domain";
import { resolveDriverHomeAction } from "@/shared/delivery-home-action";
import { isOpenDeliveryStale } from "@/shared/delivery-freshness";
import { useThemeColors } from "@/lib/use-theme-colors";

const { height: SCREEN_H } = Dimensions.get("window");
const SHEET_MIN = 130;
const SHEET_PEEK = 420;
const SHEET_EXPANDED = Math.min(SCREEN_H * 0.78, 720);
const PICKUP_TOOLTIP_DURATION_MS = 3_000;

const TYPE_ICON: Record<Delivery["type"], React.ComponentProps<typeof MaterialIcons>["name"]> = {
  Plis: "inventory-2",
  Personne: "person",
  Autre: "local-shipping",
};

const STATUS_CHIP: Record<DeliveryStatus, { label: string; color: string; bg: string }> = {
  draft: { label: "BROUILLON", color: "#7A6E61", bg: "#EEE8E0" },
  open: { label: "PUBLIÉE", color: "#9A6201", bg: "#F8E8CE" },
  pending_confirmation: { label: "ATTRIBUÉE", color: "#7A5600", bg: "#F4E9D2" },
  active: { label: "EN TRANSIT", color: "#176C52", bg: "#DDEFE7" },
  completed: { label: "TERMINÉE", color: "#4F6A5A", bg: "#E6EFE9" },
  disabled: { label: "DÉSACTIVÉE", color: "#A43740", bg: "#F7E6E7" },
  cancelled: { label: "ANNULÉE", color: "#A43740", bg: "#F7E6E7" },
  expired: { label: "EXPIRÉE", color: "#6B6257", bg: "#EEE8E0" },
};

type FilterKey = "active" | "open" | "pending" | "completed";
type PendingHomeAction =
  | { kind: "withdraw" | "confirm" | "cancel"; delivery: Delivery }
  | { kind: "select"; delivery: Delivery; candidate: DriverCandidate };

const SENDER_FILTERS: { key: FilterKey; label: string }[] = [
  { key: "open", label: "Publiées" },
  { key: "pending", label: "Attribuées" },
  { key: "active", label: "En cours" },
  { key: "completed", label: "Terminées" },
];

const DRIVER_FILTERS: { key: FilterKey; label: string }[] = [
  { key: "open", label: "Publiées" },
  { key: "pending", label: "Attribuées" },
  { key: "active", label: "En cours" },
  { key: "completed", label: "Terminées" },
];

function matchesFilter(delivery: Delivery, filter: FilterKey, isDriver: boolean): boolean {
  const { status } = delivery;
  if (status === "expired" || status === "cancelled" || status === "disabled") return false;
  if (isOpenDeliveryStale(delivery)) return false;
  if (filter === "active") return status === "active";
  if (filter === "open") return status === "open";
  if (filter === "pending") return status === "pending_confirmation" || (isDriver && delivery.ownCandidateStatus === "selected");
  if (filter === "completed") return isDriver ? isDeliveryCompletedToday(delivery) : isDeliveryCompletedWithinLast24Hours(delivery);
  return true;
}

function badgeFilterForDelivery(delivery: Delivery, isDriver: boolean): FilterKey | null {
  if (delivery.status === "open") return "open";
  if (delivery.status === "pending_confirmation") return "pending";
  if (delivery.status === "active") return "active";
  if (delivery.status === "completed" && matchesFilter(delivery, "completed", isDriver)) return "completed";
  return null;
}

function driverSortPriority(d: Delivery): number {
  if (d.ownCandidateStatus === "confirmed" || d.status === "active") return 0;
  if (d.ownCandidateStatus === "selected" || d.status === "pending_confirmation") return 1;
  if (d.ownCandidateStatus === "applied") return 2;
  if (d.status === "open") return 3;
  return 4;
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
  const { isDark, colors: theme } = useThemeColors();
  const firstName = profile?.fullName.split(" ")[0] ?? "à vous";

  const deliveriesQuery = trpc.deliveries.list.useQuery(undefined, { enabled: Boolean(profile?.phone), refetchInterval: 10_000 });
  const deliveries = useMemo(() => deliveriesQuery.data ?? [], [deliveriesQuery.data]);

  const walletQuery = trpc.wallet.snapshot.useQuery(undefined, { enabled: role === "driver" && Boolean(profile?.phone), refetchInterval: 12_000, refetchOnMount: "always", refetchOnWindowFocus: true });
  const driverWallet = walletQuery.data?.wallet;

  const [filter, setFilter] = useState<FilterKey>("open");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    setFilter("open");
  }, [role]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [driverOnline, setDriverOnline] = useState(true);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [candidateDelivery, setCandidateDelivery] = useState<Delivery | null>(null);
  const [applicationDelivery, setApplicationDelivery] = useState<Delivery | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingHomeAction | null>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const sheetHeight = useRef(new Animated.Value(SHEET_PEEK)).current;
  const sheetValue = useRef(SHEET_PEEK);
  const dragStartHeight = useRef(SHEET_PEEK);
  const lastSheetSnap = useRef(SHEET_PEEK);
  const filterTransition = useRef(new Animated.Value(1)).current;
  const previousDeliveryStatuses = useRef<Record<string, DeliveryStatus> | null>(null);
  const badgeScales = useRef<Record<FilterKey, Animated.Value>>({
    open: new Animated.Value(1),
    pending: new Animated.Value(1),
    active: new Animated.Value(1),
    completed: new Animated.Value(1),
  }).current;
  const driverLocation = useDriverLocation({ enabled: role === "driver" });
  const deviceHeading = useDeviceHeading(role === "driver");

  const filteredList = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const matches = (d: Delivery) => {
      if (!matchesFilter(d, filter, role === "driver")) return false;
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
  const liveDeliveryId = role === "sender" && selected?.status === "active" ? selected.id : null;
  const senderLivePosition = useLiveDeliveryPosition(liveDeliveryId, role === "sender");
  const publishLivePositionMutation = trpc.deliveries.updateLivePosition.useMutation();
  const lastPublishedPosition = useRef<{ deliveryId: string; latitude: number; longitude: number; at: number } | null>(null);

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

  useEffect(() => {
    if (role !== "driver" || selected?.status !== "active" || !driverLocation.location) return;
    const previous = lastPublishedPosition.current;
    const elapsed = Date.now() - (previous?.at ?? 0);
    const movedMeters = previous?.deliveryId === selected.id
      ? geodesicDistanceKm(previous, driverLocation.location) * 1_000
      : Infinity;
    if (previous?.deliveryId === selected.id && movedMeters < 4 && elapsed < 5_000) return;
    const position = driverLocation.location;
    lastPublishedPosition.current = { deliveryId: selected.id, ...position, at: Date.now() };
    void publishLivePositionMutation.mutateAsync({
      deliveryId: selected.id,
      latitude: position.latitude,
      longitude: position.longitude,
      heading: typeof deviceHeading === "number" && Number.isFinite(deviceHeading) ? deviceHeading : 0,
    }).catch(() => {
      lastPublishedPosition.current = null;
    });
  }, [deviceHeading, driverLocation.location, publishLivePositionMutation, role, selected?.id, selected?.status]);

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
      if (target !== lastSheetSnap.current) {
        lastSheetSnap.current = target;
        haptic.selection();
      }
      animateSheetTo(target);
    },
  })).current;

  const utilities = trpc.useUtils();
  const applyMutation = trpc.deliveries.submitApplication.useMutation();
  const withdrawMutation = trpc.deliveries.withdraw.useMutation();
  const confirmMutation = trpc.deliveries.confirm.useMutation();
  const cancelMutation = trpc.deliveries.cancel.useMutation();
  const selectCandidateMutation = trpc.deliveries.selectCandidate.useMutation();
  const candidatesQuery = trpc.deliveries.candidates.useQuery(
    { deliveryId: candidateDelivery?.id ?? "00000000-0000-0000-0000-000000000000" },
    { enabled: Boolean(candidateDelivery?.id) },
  );

  const applicationCommission = (delivery: Delivery) => {
    const rate = walletQuery.data?.commissionRate;
    if (!Number.isFinite(rate) || !rate || rate <= 0 || rate >= 1) return null;
    return commissionFor(delivery.offeredPrice ?? delivery.estimatedPrice, { rate, currency: "FCFA" });
  };

  function requestDriverAction(delivery: Delivery) {
    const action = resolveDriverHomeAction(delivery);
    if (action === "apply") {
      if (!profile?.photoUrl) {
        Alert.alert(
          "Profil à vérifier",
          "Pour candidater à des livraisons, vous devez d’abord faire vérifier votre profil. Ouvrez votre profil, ajoutez une photo et soumettez vos documents d’identité.",
          [
            { text: "Plus tard", style: "cancel" },
            { text: "Vérifier mon profil", onPress: () => router.push("/(tabs)/profile" as any) },
          ],
        );
        return;
      }
      const commission = applicationCommission(delivery);
      if (!driverWallet || commission === null) {
        Alert.alert("Wallet indisponible", "Votre solde doit être chargé avant de pouvoir candidater. Réessayez dans un instant.");
        return;
      }
      if (availableWalletBalance(driverWallet) < commission) {
        Alert.alert("Solde insuffisant", `Votre solde disponible doit couvrir la commission de ${formatMoney(commission)} pour candidater.`);
        return;
      }
      setApplicationDelivery(delivery);
      return;
    }
    if (action === "withdraw") {
      setPendingAction({ kind: "withdraw", delivery });
      return;
    }
    if (action === "confirm") {
      setPendingAction({ kind: "confirm", delivery });
      return;
    }
    if (action === "start") void executeDriverAction(delivery);
  }

  async function executeDriverAction(delivery: Delivery) {
    setActioningId(delivery.id);
    try {
      if (delivery.ownCandidateStatus === "applied") {
        const result = await withdrawMutation.mutateAsync({ deliveryId: delivery.id });
        utilities.wallet.snapshot.setData(undefined, (current) => current ? { ...current, wallet: result.wallet } : current);
      }
      else if (delivery.ownCandidateStatus === "selected") {
        const result = await confirmMutation.mutateAsync({ deliveryId: delivery.id });
        utilities.wallet.snapshot.setData(undefined, (current) => current ? { ...current, wallet: result.wallet } : current);
      }
      else if (delivery.ownCandidateStatus === "confirmed" || delivery.status === "active") {
        let origin = driverLocation.location;
        if (!origin) {
          const position = await driverLocation.request();
          origin = position ? { latitude: position.coords.latitude, longitude: position.coords.longitude } : null;
        }
        if (!origin) throw new Error("La position actuelle est requise pour démarrer la navigation.");
        openNavigation(origin, delivery.pickup, delivery.dropoff);
        return;
      } else {
        const confirmedCommission = applicationCommission(delivery);
        if (confirmedCommission === null) throw new Error("La commission doit être chargée puis confirmée avant la candidature.");
        const result = await applyMutation.mutateAsync({ deliveryId: delivery.id, confirmedCommission });
        utilities.wallet.snapshot.setData(undefined, (current) => current ? { ...current, wallet: result.wallet } : current);
        setApplicationDelivery(null);
      }
      await Promise.all([utilities.deliveries.list.invalidate(), utilities.wallet.snapshot.invalidate(), utilities.notifications.list.invalidate()]);
      if (delivery.ownCandidateStatus === "applied" || delivery.ownCandidateStatus === "selected") setPendingAction(null);
    } catch (cause) {
      Alert.alert("Action indisponible", cause instanceof Error ? cause.message : "Réessayez dans un instant.");
    } finally {
      setActioningId(null);
    }
  }

  async function cancelSenderDelivery(delivery: Delivery) {
    setActioningId(delivery.id);
    try {
      await cancelMutation.mutateAsync({ deliveryId: delivery.id });
      await Promise.all([utilities.deliveries.list.invalidate(), utilities.notifications.list.invalidate()]);
      setPendingAction(null);
    } catch (cause) {
      Alert.alert("Annulation indisponible", cause instanceof Error ? cause.message : "Réessayez dans un instant.");
    } finally {
      setActioningId(null);
    }
  }

  function handleSenderAction(delivery: Delivery) {
    if (delivery.status === "open" && delivery.candidateCount === 0) {
      setPendingAction({ kind: "cancel", delivery });
      return;
    }
    if (delivery.status === "open" && (delivery.candidateCount ?? 0) > 0) {
      setCandidateDelivery(delivery);
      return;
    }
    if (delivery.status === "active") {
      setSelectedId(delivery.id);
      animateSheetTo(SHEET_PEEK);
    }
  }

  async function chooseCandidate(candidate: DriverCandidate) {
    if (!candidateDelivery) return;
    setActioningId(candidate.id);
    try {
      await selectCandidateMutation.mutateAsync({ deliveryId: candidateDelivery.id, candidateId: candidate.id });
      setCandidateDelivery(null);
      await Promise.all([utilities.deliveries.list.invalidate(), utilities.wallet.snapshot.invalidate(), utilities.notifications.list.invalidate()]);
      setPendingAction(null);
    } catch (cause) {
      Alert.alert("Sélection indisponible", cause instanceof Error ? cause.message : "Réessayez dans un instant.");
    } finally {
      setActioningId(null);
    }
  }

  function requestCandidateSelection(candidate: DriverCandidate) {
    if (!candidateDelivery) return;
    setPendingAction({ kind: "select", delivery: candidateDelivery, candidate });
  }

  const isDriver = role === "driver";
  const filterItems = isDriver ? DRIVER_FILTERS : SENDER_FILTERS;
  const filterCounts = useMemo(() => Object.fromEntries(filterItems.map((item) => [item.key, deliveries.filter((delivery) => matchesFilter(delivery, item.key, isDriver)).length])) as Record<FilterKey, number>, [deliveries, filterItems, isDriver]);
  const filterTranslateY = filterTransition.interpolate({ inputRange: [0, 1], outputRange: [6, 0] });
  const firstNameDisplay = isDriver ? firstName : "à vous";
  const countLabel = isDriver ? `${filteredList.length} opportunité${filteredList.length > 1 ? "s" : ""} à proximité` : `${filteredList.length} livraison${filteredList.length > 1 ? "s" : ""} affichée${filteredList.length > 1 ? "s" : ""}`;

  function pulseBadge(filterKey: FilterKey) {
    const badgeScale = badgeScales[filterKey];
    badgeScale.stopAnimation();
    badgeScale.setValue(1);
    Animated.sequence([
      Animated.timing(badgeScale, { toValue: 1.14, duration: 110, useNativeDriver: true }),
      Animated.timing(badgeScale, { toValue: 1, duration: 170, useNativeDriver: true }),
    ]).start();
  }

  useEffect(() => {
    const currentStatuses = Object.fromEntries(deliveries.map((delivery) => [delivery.id, delivery.status])) as Record<string, DeliveryStatus>;
    const previousStatuses = previousDeliveryStatuses.current;
    previousDeliveryStatuses.current = currentStatuses;
    if (!previousStatuses) return;

    const changedFilters = new Set<FilterKey>();
    deliveries.forEach((delivery) => {
      if (previousStatuses[delivery.id] === delivery.status) return;
      const filterKey = badgeFilterForDelivery(delivery, isDriver);
      if (filterKey) changedFilters.add(filterKey);
    });
    changedFilters.forEach(pulseBadge);
  }, [deliveries, isDriver]);

  function selectFilter(nextFilter: FilterKey) {
    if (nextFilter === filter) return;
    filterTransition.stopAnimation();
    filterTransition.setValue(0);
    setFilter(nextFilter);
    Animated.timing(filterTransition, { toValue: 1, duration: 180, useNativeDriver: true }).start();
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={["top", "bottom"]}>
      <MapBackground selected={selected} role={role} sheetOverlayHeight={sheetValue.current} driverPosition={role === "driver" ? driverLocation.location : senderLivePosition} />


      <Animated.View style={[styles.sheet, { height: sheetHeight }]}>
        <View {...panResponder.panHandlers} style={styles.sheetHeader}>
          <View style={styles.sheetGrip} />
          <View style={styles.sheetTop}>
            <View style={styles.greetingBlock}>
              <Text style={styles.sheetTitle}>Bonjour {firstNameDisplay} 👋</Text>
              <Text style={styles.sheetSubtitle}>{countLabel}</Text>
            </View>
            <Pressable
              onPress={async () => {
                if (deliveriesQuery.isRefetching || walletQuery.isRefetching) return;
                await Promise.all([
                  utilities.deliveries.list.invalidate(),
                  utilities.notifications.list.invalidate(),
                  role === "driver" ? utilities.wallet.snapshot.invalidate() : Promise.resolve(),
                ]);
              }}
              style={({ pressed }) => [styles.refreshIndicator, pressed && styles.pressed]}
              accessibilityLabel="Actualiser les livraisons"
            >
              {(deliveriesQuery.isRefetching || walletQuery.isRefetching) ? (
                <ActivityIndicator size="small" color="#9A6201" />
              ) : (
                <MaterialIcons name="refresh" size={18} color="#9A6201" />
              )}
            </Pressable>
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
              <Pressable
                onPress={() => router.push("/create-delivery" as any)}
                style={({ pressed }) => [styles.sheetFab, pressed && styles.pressed]}
                accessibilityLabel="Créer une livraison"
              >
                <MaterialIcons name="add" size={22} color="#FFFFFF" />
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
          refreshControl={
            <RefreshControl
              refreshing={deliveriesQuery.isRefetching || walletQuery.isRefetching}
              onRefresh={async () => {
                await Promise.all([
                  utilities.deliveries.list.invalidate(),
                  utilities.notifications.list.invalidate(),
                  role === "driver" ? utilities.wallet.snapshot.invalidate() : Promise.resolve(),
                ]);
              }}
              tintColor="transparent"
              colors={["transparent"]}
              progressBackgroundColor="transparent"
            />
          }
        >
          {isDriver && driverWallet ? <WalletCard walletBalance={availableWalletBalance(driverWallet)} totalBalance={driverWallet.total} blockedBalance={driverWallet.blocked} /> : null}

          {isDriver && !profile?.photoUrl ? (
            <Pressable onPress={() => router.push("/(tabs)/profile" as any)} style={({ pressed }) => [styles.kycBanner, pressed && styles.pressed]} accessibilityLabel="Vérifier mon profil">
              <MaterialIcons name="verified-user" size={18} color="#9A6201" />
              <View style={styles.kycBannerCopy}>
                <Text style={styles.kycBannerTitle}>Profil à vérifier</Text>
                <Text style={styles.kycBannerText}>Ajoutez votre photo et vos documents pour pouvoir candidater aux livraisons.</Text>
              </View>
              <MaterialIcons name="chevron-right" size={18} color="#9A6201" />
            </Pressable>
          ) : null}

          <View style={styles.searchRow}>
            <View style={styles.searchPill}>
              <MaterialIcons name="search" size={16} color="#747474" />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder={isDriver ? "Rechercher une opportunité…" : "Rechercher une livraison…"}
                placeholderTextColor="#B48753"
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

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow} style={styles.filterScroll}>
            {filterItems.map((item) => (
              <Pressable key={item.key} onPress={() => selectFilter(item.key)} accessibilityRole="tab" accessibilityState={{ selected: filter === item.key }} accessibilityLabel={`${item.label}, ${filterCounts[item.key]} livraison${filterCounts[item.key] > 1 ? "s" : ""}`} style={({ pressed }) => [styles.chip, filter === item.key && styles.chipActive, pressed && styles.pressed]}>
                <Text style={[styles.chipText, filter === item.key && styles.chipTextActive]}>{item.label}</Text>
                <Animated.View style={{ transform: [{ scale: badgeScales[item.key] }] }}>
                  <View style={[styles.chipCount, filter === item.key && styles.chipCountActive]}><Text style={styles.chipCountText}>{filterCounts[item.key]}</Text></View>
                </Animated.View>
              </Pressable>
            ))}
          </ScrollView>

          <Animated.View style={[styles.tabContent, { opacity: filterTransition, transform: [{ translateY: filterTranslateY }] }]}>
          {deliveriesQuery.isLoading ? (
            <View style={styles.loadingState}>
              <ActivityIndicator color="#9A6201" />
              <Text style={styles.loadingText}>Chargement de vos livraisons…</Text>
            </View>
          ) : !selected ? (
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <MaterialIcons name={isDriver ? "local-shipping" : "add"} size={26} color="#747474" />
              </View>
                <Text style={styles.emptyTitle}>{filter === "completed" ? isDriver ? "Aucune livraison terminée aujourd’hui" : "Aucune livraison terminée récemment" : isDriver ? "Aucune opportunité disponible" : "Aucune livraison disponible"}</Text>
                <Text style={styles.emptyText}>
                  {filter === "completed"
                    ? isDriver ? "Les livraisons terminées aujourd’hui apparaîtront ici." : "Les livraisons terminées au cours des dernières 24 heures apparaîtront ici."
                    : isDriver
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
                  compassRotation={compassRotationToTarget(driverLocation.location, delivery.pickup, deviceHeading)}
                  applying={actioningId === delivery.id}
                  onPress={() => setSelectedId(delivery.id)}
                  onDetails={() => router.push(`/delivery/${delivery.id}` as any)}
                  onApply={() => requestDriverAction(delivery)}
                />
              ))}
            </View>
          ) : (
            <DeliveryRow
              key={selected.id}
              delivery={selected}
              role={role}
              selected
              driverDistance={null}
              driverLocationStatus={null}
              compassRotation={0}
              applying={actioningId === selected.id}
              onPress={() => {}}
              onDetails={() => router.push(`/delivery/${selected.id}` as any)}
              onApply={() => handleSenderAction(selected)}
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
                  compassRotation={isDriver ? compassRotationToTarget(driverLocation.location, delivery.pickup, deviceHeading) : 0}
                  applying={actioningId === delivery.id}
                  onPress={() => setSelectedId(delivery.id)}
                  onDetails={() => router.push(`/delivery/${delivery.id}` as any)}
                  onApply={() => handleSenderAction(delivery)}
                />
              ))}
            </View>
          ) : null}
          </Animated.View>
        </ScrollView>
      </Animated.View>
      {isDriver && showScrollTop ? (
        <Pressable onPress={() => scrollRef.current?.scrollTo({ y: 0, animated: true })} style={({ pressed }) => [styles.scrollTopButton, pressed && styles.pressed]} accessibilityLabel="Revenir en haut">
          <MaterialIcons name="keyboard-arrow-up" size={20} color="#111111" />
        </Pressable>
      ) : null}
      <CandidatesSheet
        visible={Boolean(candidateDelivery)}
        candidates={candidatesQuery.data ?? []}
        deliveryStatus={candidateDelivery?.status ?? "open"}
        loadingId={actioningId}
        onClose={() => setCandidateDelivery(null)}
        onChoose={requestCandidateSelection}
      />
      {applicationDelivery ? (
        <FinancialConfirmationModal
          visible
          title="Envoyer votre candidature"
          description="La commission Tikis sera temporairement réservée sur votre Wallet. Elle ne sera prélevée qu’après votre sélection et votre confirmation."
          amount={applicationCommission(applicationDelivery) ?? 0}
          confirmLabel="Confirmer ma candidature"
          loading={actioningId === applicationDelivery.id}
          onCancel={() => !actioningId && setApplicationDelivery(null)}
          onConfirm={() => void executeDriverAction(applicationDelivery)}
        />
      ) : null}
      {pendingAction?.kind === "withdraw" ? (
        <ActionConfirmationModal visible title="Retirer votre candidature ?" description="La commission réservée redeviendra immédiatement disponible sur votre Wallet." confirmLabel="Retirer" icon="undo" tone="danger" loading={actioningId === pendingAction.delivery.id} onCancel={() => !actioningId && setPendingAction(null)} onConfirm={() => void executeDriverAction(pendingAction.delivery)} />
      ) : null}
      {pendingAction?.kind === "confirm" ? (
        <ActionConfirmationModal visible title="Confirmer votre disponibilité ?" description="La commission réservée sera prélevée uniquement après votre confirmation." confirmLabel="Confirmer" icon="check-circle" tone="success" loading={actioningId === pendingAction.delivery.id} onCancel={() => !actioningId && setPendingAction(null)} onConfirm={() => void executeDriverAction(pendingAction.delivery)} />
      ) : null}
      {pendingAction?.kind === "cancel" ? (
        <ActionConfirmationModal visible title="Annuler cette livraison ?" description="La livraison sera retirée et ne recevra plus de candidatures." confirmLabel="Annuler la livraison" icon="cancel" tone="danger" loading={actioningId === pendingAction.delivery.id} onCancel={() => !actioningId && setPendingAction(null)} onConfirm={() => void cancelSenderDelivery(pendingAction.delivery)} />
      ) : null}
      {pendingAction?.kind === "select" ? (
        <ActionConfirmationModal visible title="Choisir ce livreur ?" description={`${pendingAction.candidate.name} recevra votre demande de confirmation. Aucun montant ne sera débité du Wallet expéditeur.`} confirmLabel="Choisir" icon="person" tone="primary" loading={actioningId === pendingAction.candidate.id} onCancel={() => !actioningId && setPendingAction(null)} onConfirm={() => void chooseCandidate(pendingAction.candidate)} />
      ) : null}
    </SafeAreaView>
  );
}

function WalletCard({ walletBalance, totalBalance, blockedBalance }: { walletBalance: number; totalBalance: number; blockedBalance: number }) {
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
      </View>
    </View>
  );
}

function MapBackground({ selected, role, sheetOverlayHeight, driverPosition }: { selected: Delivery | null | undefined; role: "sender" | "driver"; sheetOverlayHeight: number; driverPosition: { latitude: number; longitude: number } | null }) {
  const mapRef = useRef<MapView>(null);
  const routeMutation = trpc.geography.route.useMutation();
  const routeRequestRef = useRef(routeMutation.mutateAsync);
  const [routeCoordinates, setRouteCoordinates] = useState<{ latitude: number; longitude: number }[]>([]);
  const [approachCoordinates, setApproachCoordinates] = useState<{ latitude: number; longitude: number }[]>([]);
  const lastApproachRequest = useRef<{ deliveryId: string; latitude: number; longitude: number; at: number } | null>(null);
  const pickup = selected?.pickup;
  const dropoff = selected?.dropoff;
  const selectedDeliveryId = selected?.id;
  const selectedDeliveryStatus = selected?.status;
  const hasDriver = Boolean(selected?.status === "active" && driverPosition);
  const region = useMemo(() => {
    if (!selected) return { latitude: 5.3599, longitude: -4.0083, latitudeDelta: 0.12, longitudeDelta: 0.12 };
    return fitRegionFor(selected.pickup, selected.dropoff);
  }, [selected]);

  useEffect(() => {
    if (!selected) return;
    const timer = setTimeout(() => {
      const points = driverPosition && selected.status === "active" ? [driverPosition, selected.pickup, selected.dropoff] : [selected.pickup, selected.dropoff];
      mapRef.current?.fitToCoordinates(points, {
        edgePadding: { top: 84, left: 24, right: 24, bottom: Math.max(170, sheetOverlayHeight + 24) },
        animated: true,
      });
    }, 220);
    return () => clearTimeout(timer);
  }, [driverPosition, region, selected, sheetOverlayHeight]);

  useEffect(() => {
    routeRequestRef.current = routeMutation.mutateAsync;
  }, [routeMutation.mutateAsync]);

  useEffect(() => {
    let active = true;
    if (!pickup || !dropoff) { setRouteCoordinates([]); return; }
    void routeRequestRef.current({ origin: pickup, destination: dropoff })
      .then((route) => { if (active) setRouteCoordinates(route.coordinates); })
      .catch(() => { if (active) setRouteCoordinates([]); });
    return () => { active = false; };
  }, [selected?.id, pickup, dropoff]);

  useEffect(() => {
    let active = true;
    if (!selectedDeliveryId || selectedDeliveryStatus !== "active" || !pickup || !driverPosition) {
      setApproachCoordinates([]);
      return;
    }
    const previous = lastApproachRequest.current;
    const elapsed = Date.now() - (previous?.at ?? 0);
    const movedMeters = previous?.deliveryId === selectedDeliveryId
      ? geodesicDistanceKm(previous, driverPosition) * 1_000
      : Infinity;
    if (previous?.deliveryId === selectedDeliveryId && movedMeters < 80 && elapsed < 15_000) return;
    lastApproachRequest.current = { deliveryId: selectedDeliveryId, ...driverPosition, at: Date.now() };
    const origin = { name: "Position du livreur", district: "", city: "", latitude: driverPosition.latitude, longitude: driverPosition.longitude, source: "manual" as const };
    void routeRequestRef.current({ origin, destination: pickup })
      .then((route) => { if (active) setApproachCoordinates(route.coordinates); })
      .catch(() => { if (active) setApproachCoordinates([driverPosition, pickup]); });
    return () => { active = false; };
  }, [driverPosition, pickup, selectedDeliveryId, selectedDeliveryStatus]);

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
            {approachCoordinates.length > 1 ? <Polyline coordinates={approachCoordinates} strokeColor="#176C52" strokeWidth={4} lineCap="round" /> : null}
            {routeCoordinates.length > 1 ? <Polyline coordinates={routeCoordinates} strokeColor="#9A6201" strokeWidth={4} lineCap="round" /> : null}
            <Marker coordinate={{ latitude: selected.pickup.latitude, longitude: selected.pickup.longitude }} anchor={{ x: 0.5, y: 0.5 }}>
              <View style={styles.nativeMarkerStart}>
                <MaterialIcons name="inventory-2" size={15} color="#FFFFFF" />
              </View>
            </Marker>
            {hasDriver && driverPosition ? (
              <Marker coordinate={driverPosition} anchor={{ x: 0.5, y: 0.5 }}>
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
  applying,
  onAction,
}: {
  delivery: Delivery;
  role: "sender" | "driver";
  applying: boolean;
  onAction: () => void;
}) {
  const isSender = role === "sender";
  const senderAction = delivery.status === "open"
    ? (delivery.candidateCount ?? 0) > 0 ? "Candidats" : "Annuler"
    : delivery.status === "active" ? "Suivre" : null;
  return (
    <View style={[styles.urgentCard, isSender ? styles.urgentCardSender : styles.urgentCardDriver]}>
      <View style={styles.urgentHead}>
        <View style={[styles.urgentThumb, isSender ? styles.urgentThumbSender : styles.urgentThumbDriver]}>
          <MaterialIcons name={TYPE_ICON[delivery.type] ?? "local-shipping"} size={18} color={isSender ? "#FFFFFF" : "#9A6201"} />
        </View>
        <View style={styles.urgentMeta}>
          <Text style={styles.urgentTitle} numberOfLines={1}>{delivery.title}</Text>
          <Text style={styles.urgentSub} numberOfLines={1}>
            {isSender
              ? `${delivery.driverName ?? "Livreur en attente"} · ${formatDistanceKm(delivery.distanceKm).value} ${formatDistanceKm(delivery.distanceKm).unit}`
              : `${(delivery.vehicleTypes ?? []).join(" · ") || "Moto"}`}
          </Text>
        </View>
        {isSender ? <View style={[styles.urgentChip, { backgroundColor: STATUS_CHIP[delivery.status].bg }]}> 
          <Text style={[styles.urgentChipText, { color: STATUS_CHIP[delivery.status].color }]}>{STATUS_CHIP[delivery.status].label}</Text>
        </View> : null}
      </View>
      <View style={styles.urgentPricing}>
        <View>
          <Text style={styles.urgentPrice}>{formatMoney(delivery.offeredPrice ?? delivery.estimatedPrice)}</Text>
          <Text style={styles.urgentPriceExtra}>{isSender ? "est. client" : "rémunération nette"}</Text>
        </View>
      </View>
      <View style={styles.urgentActions}>
        {isSender && senderAction ? (
          <Pressable onPress={onAction} disabled={applying} style={({ pressed }) => [styles.urgentBtnWhite, applying && { opacity: 0.6 }, pressed && !applying && styles.pressed]}>
            {applying ? <ActivityIndicator size="small" color="#111111" /> : <><MaterialIcons name={senderAction === "Candidats" ? "group" : senderAction === "Annuler" ? "close" : "my-location"} size={15} color="#111111" /><Text style={styles.urgentBtnWhiteText}>{senderAction}</Text></>}
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
  compassRotation,
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
  compassRotation: number;
  applying: boolean;
  onPress: () => void;
  onDetails: () => void;
  onApply: () => void;
}) {
  const [showPickupTooltip, setShowPickupTooltip] = useState(false);
  const isSender = role === "sender";
  const isDriver = role === "driver";
  const driverAction = delivery.status === "completed"
    ? null
    : delivery.ownCandidateStatus === "applied"
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
  const dateColor = dateInfo.tone === "primary" ? "#9A6201" : "#747474";
  const dateBg = dateInfo.tone === "primary" ? "#F8F0E5" : "#F0F0F2";
  const totalDistance = formatDistanceKm(delivery.distanceKm);
  const pickupTitle = locationTitle(delivery.pickup);
  const pickupDistrict = delivery.pickup.district || delivery.pickup.city || "Quartier non renseigné";
  const dropoffTitle = locationTitle(delivery.dropoff);
  const dropoffDistrict = delivery.dropoff.district || delivery.dropoff.city || "Quartier non renseigné";
  const deliveryDetails = [delivery.type, delivery.passengers ? `${delivery.passengers} pers.` : null, `${totalDistance.value} ${totalDistance.unit}`, dimensions, vehicleLabel].filter(Boolean).join(" · ");
  const driverDistText = driverDistance
    ? `${driverDistance.value} ${driverDistance.unit}`
    : driverLocationStatus === "loading" || driverLocationStatus === "idle"
      ? "…"
        : driverLocationStatus === "denied"
          ? "GPS off"
          : "—";

  useEffect(() => {
    if (!showPickupTooltip) return;
    const timeout = setTimeout(() => setShowPickupTooltip(false), PICKUP_TOOLTIP_DURATION_MS);
    return () => clearTimeout(timeout);
  }, [showPickupTooltip]);

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, selected && styles.rowSelected, pressed && styles.pressed]}>
      <View style={styles.rowTop}>
        <View style={[styles.rowThumb, isSender ? null : styles.rowThumbDriver]}>
          <MaterialIcons name={TYPE_ICON[delivery.type] ?? "local-shipping"} size={15} color={isSender ? "#111111" : "#FFFFFF"} />
        </View>
        <View style={styles.rowMain}>
          <View style={styles.rowTitleLine}>
            <Text style={styles.rowTitle} numberOfLines={1}>{delivery.title}</Text>
            {isDriver ? <View accessibilityLabel={`Direction du point de collecte, à ${driverDistText}`} style={styles.rowDriverDistance}><Pressable onPress={() => setShowPickupTooltip((visible) => !visible)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Afficher les lieux de collecte et destination : ${pickupTitle}, ${pickupDistrict}; destination ${dropoffTitle}, ${dropoffDistrict}`} style={({ pressed }) => [styles.directionButton, pressed && styles.pressed]}><MaterialIcons accessible={false} name="navigation" size={17} color="#007B8B" style={{ transform: [{ rotate: `${compassRotation}deg` }] }} /></Pressable><Text style={styles.rowDriverDistanceText}>À {driverDistText}</Text>{showPickupTooltip ? <View style={styles.pickupTooltip}><Text style={styles.pickupTooltipLabel}>COLLECTE</Text><Text style={styles.pickupTooltipText} numberOfLines={1}>{pickupTitle}</Text><Text style={styles.pickupTooltipDistrict} numberOfLines={1}>{pickupDistrict}</Text><View style={styles.pickupTooltipDivider} /><Text style={styles.pickupTooltipLabel}>DESTINATION</Text><Text style={styles.pickupTooltipText} numberOfLines={1}>{dropoffTitle}</Text><Text style={styles.pickupTooltipDistrict} numberOfLines={1}>{dropoffDistrict}</Text></View> : null}</View> : isSender ? <View style={[styles.rowStatusChip, { backgroundColor: STATUS_CHIP[delivery.status].bg }]}><Text style={[styles.rowStatusText, { color: STATUS_CHIP[delivery.status].color }]}>{STATUS_CHIP[delivery.status].label}</Text></View> : null}
          </View>
          <Text style={styles.rowSub} numberOfLines={1}>{route.pickup} → {route.dropoff}</Text>
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
              {applying ? <ActivityIndicator size="small" color="#9A6201" /> : <Text style={styles.rowBtnFilledText}>{driverAction}</Text>}
            </Pressable>
          ) : (() => {
            const senderAction = delivery.status === "open" ? (delivery.candidateCount ?? 0) > 0 ? "Candidats" : "Annuler" : delivery.status === "active" ? "Suivre" : null;
            return senderAction ? <Pressable onPress={onApply} disabled={applying} style={({ pressed }) => [styles.rowBtnFilled, applying && { opacity: 0.6 }, pressed && !applying && styles.pressed]}>
              {applying ? <ActivityIndicator size="small" color="#9A6201" /> : <Text style={styles.rowBtnFilledText}>{senderAction}</Text>}
            </Pressable> : null;
          })()}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#EEEDF3" },

  mapBg: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#EEEDF3" },
  nativeMarkerStart: { width: 32, height: 32, borderRadius: 9, backgroundColor: "#9A6201", alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: "#FFFFFF" },
  nativeMarkerDriver: { width: 30, height: 30, borderRadius: 15, backgroundColor: "#111111", alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#FFFFFF" },
  nativeMarkerEnd: { width: 32, height: 32, borderRadius: 9, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: "#B4232D" },

  fab: { position: "absolute", right: 14, bottom: 440, width: 50, height: 50, borderRadius: 14, backgroundColor: "#F7EFE5", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#E5D2B9", zIndex: 10 },
  sheetFab: { width: 36, height: 36, borderRadius: 10, backgroundColor: "#9A6201", alignItems: "center", justifyContent: "center" },
  refreshIndicator: { width: 32, height: 32, borderRadius: 8, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#D7D5DE" },

  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: "#EEEDF3", borderTopLeftRadius: 18, borderTopRightRadius: 18, overflow: "hidden" },
  sheetHeader: { paddingTop: 10, paddingBottom: 8 },
  sheetGrip: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: "#D5D5DC", marginBottom: 10 },
  sheetTop: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14 },
  greetingBlock: { flex: 1, minWidth: 0 },
  sheetTitle: { color: "#111111", fontSize: 14, fontWeight: "700", lineHeight: 18 },
  sheetSubtitle: { color: "#666666", fontSize: 10.5, marginTop: 1, fontWeight: "500" },

  servicePill: { paddingHorizontal: 12, height: 38, borderRadius: 11, backgroundColor: "#F7EFE5", flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: "#E5D2B9" },
  servicePillOffline: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#D7D5DE", shadowOpacity: 0, elevation: 0 },
  servicePillNeutral: { backgroundColor: "#EEEDF3", shadowOpacity: 0, elevation: 0 },
  serviceText: { color: "#9A6201", fontSize: 11, fontWeight: "700", letterSpacing: 0.4 },
  serviceTextOffline: { color: "#111111" },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#9A6201" },
  onlineDotOffline: { backgroundColor: "#747474" },

  searchRow: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 6 },
  kycBanner: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 14, marginTop: 6, padding: 11, backgroundColor: "#F7EFE5", borderRadius: 10, borderWidth: 1, borderColor: "#E5D2B9" },
  kycBannerCopy: { flex: 1 },
  kycBannerTitle: { color: "#9A6201", fontSize: 12, fontWeight: "700" },
  kycBannerText: { color: "#6B4A1B", fontSize: 11, marginTop: 2, lineHeight: 16 },
  searchPill: { height: 40, backgroundColor: "#F7EFE5", borderRadius: 11, borderWidth: 1, borderColor: "#E5D2B9", flexDirection: "row", alignItems: "center", paddingHorizontal: 12, gap: 8 },
  searchInput: { flex: 1, color: "#9A6201", fontSize: 13, paddingVertical: 0, paddingHorizontal: 0 },

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

  filterRow: { flexDirection: "row", gap: 6, paddingHorizontal: 14, paddingBottom: 10, alignItems: "center" },
  filterScroll: { flexGrow: 0 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: "#F7EFE5", borderWidth: 1, borderColor: "#E5D2B9", flexDirection: "row", alignItems: "center", gap: 6 },
  chipActive: { backgroundColor: "#F7EFE5", borderColor: "#9A6201" },
  chipText: { color: "#9A6201", fontSize: 11, fontWeight: "600" },
  chipTextActive: { color: "#9A6201" },
  chipCount: { minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, backgroundColor: "#9A6201", alignItems: "center", justifyContent: "center" },
  chipCountActive: { backgroundColor: "#9A6201" },
  chipCountText: { color: "#F7EFE5", fontSize: 10, fontWeight: "700", lineHeight: 12 },
  tabContent: { minHeight: 1 },

  scrollArea: { flex: 1, marginTop: 2 },
  scrollContent: { paddingHorizontal: 14, paddingTop: 6, paddingBottom: 90, gap: 8 },

  urgentCard: { borderRadius: 12, padding: 12, gap: 10 },
  urgentCardSender: { backgroundColor: "#111111" },
  urgentCardDriver: { backgroundColor: "#9A6201" },
  urgentHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  urgentThumb: { width: 36, height: 36, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  urgentThumbSender: { backgroundColor: "#9A6201" },
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
  urgentBtnWhiteText: { color: "#9A6201", fontSize: 12, fontWeight: "700" },

  listSection: { marginTop: 4, gap: 8 },
  row: { backgroundColor: "#FFFFFF", borderRadius: 10, padding: 11, borderWidth: 0, borderColor: "transparent" },
  rowSelected: { borderColor: "transparent", backgroundColor: "#FFFFFF" },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 9 },
  rowThumb: { width: 30, height: 30, borderRadius: 8, backgroundColor: "#EEEDF3", alignItems: "center", justifyContent: "center" },
  rowThumbDriver: { backgroundColor: "#9A6201" },
  rowMain: { flex: 1, minWidth: 0 },
  rowTitleLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  rowTitle: { color: "#111111", fontSize: 12.5, fontWeight: "600" },
  rowSub: { color: "#666666", fontSize: 10.5, marginTop: 1 },
  rowPrice: { color: "#111111", fontSize: 14, fontWeight: "700", textAlign: "right" },
  rowDetails: { flex: 1, color: "#111111", fontSize: 11.5, lineHeight: 16, paddingRight: 8 },
  rowDriverDistance: { marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 3, paddingTop: 1, position: "relative" },
  directionButton: { width: 24, height: 24, alignItems: "center", justifyContent: "center" },
  rowDriverDistanceText: { color: "#9A6201", fontSize: 12.5, fontWeight: "600" },
  pickupTooltip: { position: "absolute", right: 0, top: 28, minWidth: 168, maxWidth: 236, backgroundColor: "#111111", borderRadius: 7, paddingHorizontal: 9, paddingVertical: 7, zIndex: 20 },
  pickupTooltipLabel: { color: "rgba(255,255,255,0.64)", fontSize: 8, fontWeight: "700", letterSpacing: 0.55 },
  pickupTooltipText: { color: "#FFFFFF", fontSize: 11, fontWeight: "600", marginTop: 2 },
  pickupTooltipDistrict: { color: "rgba(255,255,255,0.68)", fontSize: 10, marginTop: 1 },
  pickupTooltipDivider: { height: 1, backgroundColor: "rgba(255,255,255,0.16)", marginVertical: 6 },
  rowStatusChip: { marginLeft: "auto", paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5 },
  rowStatusText: { fontSize: 9, fontWeight: "700", letterSpacing: 0.35 },
  rowDateRow: { flexDirection: "row", alignItems: "center", marginTop: 8 },
  datePill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  datePillText: { fontSize: 10.5, fontWeight: "700" },
  rowBottom: { flexDirection: "row", alignItems: "center", marginTop: 8, gap: 10 },
  rowStat: { flexDirection: "row", alignItems: "center", gap: 4 },
  rowStatText: { color: "#666666", fontSize: 10.5, fontWeight: "500" },
  rowActions: { marginLeft: "auto", flexDirection: "row", gap: 6 },
  rowBtnOutline: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 7, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#D7D5DE" },
  rowBtnOutlineText: { color: "#111111", fontSize: 10.5, fontWeight: "600" },
  rowBtnFilled: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 7, backgroundColor: "#F7EFE5", borderWidth: 1, borderColor: "#E5D2B9", minWidth: 64, alignItems: "center", flexDirection: "row", gap: 4, justifyContent: "center" },
  rowBtnFilledText: { color: "#9A6201", fontSize: 10.5, fontWeight: "700" },

  loadingState: { alignItems: "center", paddingVertical: 32, gap: 8 },
  loadingText: { color: "#666666", fontSize: 12 },
  empty: { alignItems: "center", paddingHorizontal: 24, paddingVertical: 24 },
  emptyIcon: { width: 60, height: 60, borderRadius: 14, backgroundColor: "#EEEDF3", alignItems: "center", justifyContent: "center", marginBottom: 12 },
  emptyTitle: { color: "#111111", fontSize: 14, fontWeight: "600", marginBottom: 4 },
  emptyText: { color: "#666666", fontSize: 12, textAlign: "center", lineHeight: 18 },

  pressed: { opacity: 0.7 },
  scrollTopButton: { position: "absolute", right: 16, bottom: 24, width: 38, height: 38, borderRadius: 10, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#D7D5DE", alignItems: "center", justifyContent: "center" },
});
