import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";
import { formatListRouteParts } from "@/lib/geo-rules";
import { useDriverLocation } from "@/hooks/use-driver-location";
import { useLiveDeliveryPosition } from "@/hooks/use-live-delivery-position";
import { formatDistanceKm, formatDeliveryCreationDate } from "@/lib/date-format";
import { CandidatesSheet } from "@/components/tikis/candidates-sheet";
import { FinancialConfirmationModal } from "@/components/tikis/financial-modal";
import { ActionConfirmationModal } from "@/components/tikis/action-confirmation-modal";
import { availableWalletBalance, commissionFor, formatMoney, isDeliveryCompletedToday, isDeliveryCompletedWithinLast24Hours, type Delivery, type DeliveryStatus, type DriverCandidate } from "@/shared/tikis-domain";
import { resolveDriverHomeAction } from "@/shared/delivery-home-action";
import { useThemeColors } from "@/lib/use-theme-colors";

const SHEET_MIN = 130;
const SHEET_PEEK = 420;
const SHEET_EXPANDED = 720;

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
  | { kind: "withdraw"; delivery: Delivery }
  | { kind: "confirm"; delivery: Delivery }
  | { kind: "cancel"; delivery: Delivery }
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

function projectOntoCanvas(
  origin: { latitude: number; longitude: number },
  target: { latitude: number; longitude: number },
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number },
  canvas: { width: number; height: number },
  padding: number,
) {
  const latRange = bounds.maxLat - bounds.minLat || 0.0001;
  const lngRange = bounds.maxLng - bounds.minLng || 0.0001;
  const innerWidth = canvas.width - padding * 2;
  const innerHeight = canvas.height - padding * 2;
  const xFor = (lng: number) => padding + ((lng - bounds.minLng) / lngRange) * innerWidth;
  const yFor = (lat: number) => padding + (1 - (lat - bounds.minLat) / latRange) * innerHeight;
  return { x: xFor(target.longitude), y: yFor(target.latitude), originX: xFor(origin.longitude), originY: yFor(origin.latitude) };
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
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [candidateDelivery, setCandidateDelivery] = useState<Delivery | null>(null);
  const [applicationDelivery, setApplicationDelivery] = useState<Delivery | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingHomeAction | null>(null);
  const sheetHeight = useRef(new Animated.Value(SHEET_PEEK)).current;
  const sheetValue = useRef(SHEET_PEEK);
  const dragStartHeight = useRef(SHEET_PEEK);
  const filterTransition = useRef(new Animated.Value(1)).current;
  const previousDeliveryStatuses = useRef<Record<string, DeliveryStatus> | null>(null);
  const badgeScales = useRef<Record<FilterKey, Animated.Value>>({
    open: new Animated.Value(1),
    pending: new Animated.Value(1),
    active: new Animated.Value(1),
    completed: new Animated.Value(1),
  }).current;
  const driverLocation = useDriverLocation({ enabled: role === "driver" });

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
  const lastPublishedPosition = useRef<{ deliveryId: string; latitude: number; longitude: number } | null>(null);

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
    const position = driverLocation.location;
    const previous = lastPublishedPosition.current;
    if (previous?.deliveryId === selected.id && previous.latitude === position.latitude && previous.longitude === position.longitude) return;
    lastPublishedPosition.current = { deliveryId: selected.id, ...position };
    void publishLivePositionMutation.mutateAsync({ deliveryId: selected.id, latitude: position.latitude, longitude: position.longitude, heading: 0 })
      .catch(() => { lastPublishedPosition.current = null; });
  }, [driverLocation.location, publishLivePositionMutation, role, selected?.id, selected?.status]);

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

  function requestApply(delivery: Delivery) {
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
  }

  function requestDriverAction(delivery: Delivery) {
    const action = resolveDriverHomeAction(delivery);
    if (action === "withdraw") {
      setPendingAction({ kind: "withdraw", delivery });
      return;
    }
    if (action === "confirm") {
      setPendingAction({ kind: "confirm", delivery });
      return;
    }
    if (action === "start") {
      Alert.alert("Navigation mobile", "Démarrez la navigation externe depuis votre téléphone.");
      return;
    }
    if (action === "apply") requestApply(delivery);
  }

  async function handleApply(delivery: Delivery) {
    setApplyingId(delivery.id);
    try {
      const confirmedCommission = applicationCommission(delivery);
      if (confirmedCommission === null) throw new Error("La commission doit être chargée puis confirmée avant la candidature.");
      const result = await applyMutation.mutateAsync({ deliveryId: delivery.id, confirmedCommission });
      utilities.wallet.snapshot.setData(undefined, (current) => current ? { ...current, wallet: result.wallet } : current);
      await Promise.all([
        utilities.deliveries.list.invalidate(),
        utilities.wallet.snapshot.invalidate(),
        utilities.notifications.list.invalidate(),
      ]);
      setApplicationDelivery(null);
    } catch (cause) {
      Alert.alert("Candidature indisponible", cause instanceof Error ? cause.message : "Réessayez dans un instant.");
    } finally {
      setApplyingId(null);
    }
  }

  async function executeDriverAction(action: Extract<PendingHomeAction, { kind: "withdraw" | "confirm" }>) {
    setApplyingId(action.delivery.id);
    try {
      const result = action.kind === "withdraw"
        ? await withdrawMutation.mutateAsync({ deliveryId: action.delivery.id })
        : await confirmMutation.mutateAsync({ deliveryId: action.delivery.id });
      utilities.wallet.snapshot.setData(undefined, (current) => current ? { ...current, wallet: result.wallet } : current);
      await Promise.all([
        utilities.deliveries.list.invalidate(),
        utilities.wallet.snapshot.invalidate(),
        utilities.notifications.list.invalidate(),
      ]);
      setPendingAction(null);
    } catch (cause) {
      Alert.alert("Action indisponible", cause instanceof Error ? cause.message : "Réessayez dans un instant.");
    } finally {
      setApplyingId(null);
    }
  }

  async function cancelSenderDelivery(delivery: Delivery) {
    setApplyingId(delivery.id);
    try {
      await cancelMutation.mutateAsync({ deliveryId: delivery.id });
      await Promise.all([utilities.deliveries.list.invalidate(), utilities.notifications.list.invalidate()]);
      setPendingAction(null);
    } catch (cause) {
      Alert.alert("Annulation indisponible", cause instanceof Error ? cause.message : "Réessayez dans un instant.");
    } finally {
      setApplyingId(null);
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
    setApplyingId(candidate.id);
    try {
      await selectCandidateMutation.mutateAsync({ deliveryId: candidateDelivery.id, candidateId: candidate.id });
      setCandidateDelivery(null);
      await Promise.all([utilities.deliveries.list.invalidate(), utilities.wallet.snapshot.invalidate(), utilities.notifications.list.invalidate()]);
      setPendingAction(null);
    } catch (cause) {
      Alert.alert("Sélection indisponible", cause instanceof Error ? cause.message : "Réessayez dans un instant.");
    } finally {
      setApplyingId(null);
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
      <MapBackground selected={selected} role={role} driverPosition={role === "driver" ? driverLocation.location : senderLivePosition} />

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
          style={styles.scrollArea}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
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
              onApply={() => requestDriverAction(selected)}
            />
          ) : (
            <DeliveryRow
              key={selected.id}
              delivery={selected}
              role={role}
              selected
              driverDistance={null}
              driverLocationStatus={null}
              applying={applyingId === selected.id}
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
                  applying={applyingId === delivery.id}
                  onPress={() => setSelectedId(delivery.id)}
                  onDetails={() => router.push(`/delivery/${delivery.id}` as any)}
                  onApply={() => isDriver ? requestDriverAction(delivery) : handleSenderAction(delivery)}
                />
              ))}
            </View>
          ) : null}
          </Animated.View>
        </ScrollView>
      </Animated.View>
      <CandidatesSheet
        visible={Boolean(candidateDelivery)}
        candidates={candidatesQuery.data ?? []}
        deliveryStatus={candidateDelivery?.status ?? "open"}
        loadingId={applyingId}
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
          loading={applyingId === applicationDelivery.id}
          onCancel={() => !applyingId && setApplicationDelivery(null)}
          onConfirm={() => void handleApply(applicationDelivery)}
        />
      ) : null}
      {pendingAction?.kind === "cancel" ? (
        <ActionConfirmationModal visible title="Annuler cette livraison ?" description="La livraison sera retirée et ne recevra plus de candidatures." confirmLabel="Annuler la livraison" icon="cancel" tone="danger" loading={applyingId === pendingAction.delivery.id} onCancel={() => !applyingId && setPendingAction(null)} onConfirm={() => void cancelSenderDelivery(pendingAction.delivery)} />
      ) : null}
      {pendingAction?.kind === "withdraw" ? (
        <ActionConfirmationModal visible title="Renoncer à cette candidature ?" description="Votre candidature sera retirée et la commission réservée redeviendra immédiatement disponible." confirmLabel="Renoncer" icon="undo" tone="danger" loading={applyingId === pendingAction.delivery.id} onCancel={() => !applyingId && setPendingAction(null)} onConfirm={() => void executeDriverAction(pendingAction)} />
      ) : null}
      {pendingAction?.kind === "confirm" ? (
        <ActionConfirmationModal visible title="Confirmer cette mission ?" description="La commission réservée sera prélevée et la livraison passera en cours." confirmLabel="Confirmer" icon="check-circle" tone="success" loading={applyingId === pendingAction.delivery.id} onCancel={() => !applyingId && setPendingAction(null)} onConfirm={() => void executeDriverAction(pendingAction)} />
      ) : null}
      {pendingAction?.kind === "select" ? (
        <ActionConfirmationModal visible title="Choisir ce livreur ?" description={`${pendingAction.candidate.name} recevra votre demande de confirmation. Aucun montant ne sera débité du Wallet expéditeur.`} confirmLabel="Choisir" icon="person" tone="primary" loading={applyingId === pendingAction.candidate.id} onCancel={() => !applyingId && setPendingAction(null)} onConfirm={() => void chooseCandidate(pendingAction.candidate)} />
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

function MapBackground({ selected, role, driverPosition }: { selected: Delivery | null | undefined; role: "sender" | "driver"; driverPosition: { latitude: number; longitude: number } | null }) {
  const hasDriver = Boolean(selected?.status === "active" && driverPosition);
  const pickup = selected?.pickup;
  const dropoff = selected?.dropoff;
  const routeLine = useMemo(() => {
    if (!pickup || !dropoff) return null;
    const minLat = Math.min(pickup.latitude, dropoff.latitude);
    const maxLat = Math.max(pickup.latitude, dropoff.latitude);
    const minLng = Math.min(pickup.longitude, dropoff.longitude);
    const maxLng = Math.max(pickup.longitude, dropoff.longitude);
    const latPad = (maxLat - minLat || 0.005) * 0.4;
    const lngPad = (maxLng - minLng || 0.005) * 0.4;
    const projection = projectOntoCanvas(
      pickup,
      dropoff,
      { minLat: minLat - latPad, maxLat: maxLat + latPad, minLng: minLng - lngPad, maxLng: maxLng + lngPad },
      { width: 320, height: 640 },
      60,
    );
    const dx = projection.x - projection.originX;
    const dy = projection.y - projection.originY;
    const length = Math.max(1, Math.hypot(dx, dy));
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    return { left: projection.originX, top: projection.originY, length, angle };
  }, [pickup, dropoff]);
  const approachLine = useMemo(() => {
    if (!pickup || !driverPosition || selected?.status !== "active") return null;
    const points = [driverPosition, pickup, ...(dropoff ? [dropoff] : [])];
    const minLat = Math.min(...points.map((point) => point.latitude));
    const maxLat = Math.max(...points.map((point) => point.latitude));
    const minLng = Math.min(...points.map((point) => point.longitude));
    const maxLng = Math.max(...points.map((point) => point.longitude));
    const latPad = (maxLat - minLat || 0.005) * 0.4;
    const lngPad = (maxLng - minLng || 0.005) * 0.4;
    const projection = projectOntoCanvas(driverPosition, pickup, { minLat: minLat - latPad, maxLat: maxLat + latPad, minLng: minLng - lngPad, maxLng: maxLng + lngPad }, { width: 320, height: 640 }, 60);
    const dx = projection.x - projection.originX;
    const dy = projection.y - projection.originY;
    return { left: projection.originX, top: projection.originY, length: Math.max(1, Math.hypot(dx, dy)), angle: (Math.atan2(dy, dx) * 180) / Math.PI };
  }, [driverPosition, dropoff, pickup, selected?.status]);

  return (
    <View style={styles.mapBg}>
      <View style={[styles.mapBlock, { top: "10%", left: "8%", width: 90, height: 60 }]} />
      <View style={[styles.mapBlock, { top: "16%", right: "12%", width: 70, height: 80 }]} />
      <View style={[styles.mapBlock, { bottom: "20%", left: "6%", width: 100, height: 50 }]} />
      <View style={[styles.mapBlock, { bottom: "32%", right: "8%", width: 80, height: 70 }]} />
      <View style={[styles.mapRoad, styles.mapRoad1]} />
      <View style={[styles.mapRoad, styles.mapRoad2]} />
      <View style={[styles.mapRoad, styles.mapRoad3]} />

      {approachLine ? (
        <View
          style={[
            styles.approachLine,
            {
              left: approachLine.left,
              top: approachLine.top,
              width: approachLine.length,
              transform: [{ translateY: -1.5 }, { rotate: `${approachLine.angle}deg` }],
              transformOrigin: "0% 50%",
            },
          ]}
        />
      ) : null}
      {routeLine ? (
        <View
          style={[
            styles.routeLine,
            {
              left: routeLine.left,
              top: routeLine.top,
              width: routeLine.length,
              transform: [{ translateY: -1.5 }, { rotate: `${routeLine.angle}deg` }],
              transformOrigin: "0% 50%",
            },
          ]}
        />
      ) : null}

      <View style={[styles.marker, styles.markerStart]}>
        <MaterialIcons name="inventory-2" size={14} color="#FFFFFF" />
      </View>
      {hasDriver && approachLine ? (
        <View style={[styles.marker, styles.markerDriver, { left: approachLine.left - 16, top: approachLine.top - 16 }]}>
          <MaterialIcons name="two-wheeler" size={18} color="#FFFFFF" />
        </View>
      ) : null}
      <View style={[styles.marker, styles.markerEnd]}>
        <MaterialIcons name="location-on" size={16} color="#B4232D" />
      </View>
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
  const route = formatListRouteParts(delivery.pickup, delivery.dropoff);
  const dateInfo = formatDeliveryCreationDate(delivery.createdAt);
  const dateColor = dateInfo.tone === "primary" ? "#9A6201" : "#747474";
  const dateBg = dateInfo.tone === "primary" ? "#F8F0E5" : "#F0F0F2";
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
          <View style={styles.rowTitleLine}>
            <Text style={styles.rowTitle} numberOfLines={1}>{delivery.title}</Text>
            {isDriver ? <View style={styles.rowDriverDistance}><MaterialIcons name="explore" size={15} color="#007B8B" /><Text style={styles.rowDriverDistanceText}>À {driverDistText}</Text></View> : isSender ? <View style={[styles.rowStatusChip, { backgroundColor: STATUS_CHIP[delivery.status].bg }]}><Text style={[styles.rowStatusText, { color: STATUS_CHIP[delivery.status].color }]}>{STATUS_CHIP[delivery.status].label}</Text></View> : null}
          </View>
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
        {!isDriver ? (
          <View style={styles.rowStat}>
            <MaterialIcons name="group" size={12} color="#666666" />
            <Text style={styles.rowStatText}>{delivery.candidateCount ?? 0} candidat{(delivery.candidateCount ?? 0) > 1 ? "s" : ""}</Text>
          </View>
        ) : null}
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
  mapBlock: { position: "absolute", backgroundColor: "#DCDEE3", borderRadius: 6 },
  mapRoad: { position: "absolute", backgroundColor: "#FFFFFF", borderRadius: 99 },
  mapRoad1: { top: "30%", left: "-10%", right: "-10%", height: 18, transform: [{ rotate: "-12deg" }] },
  mapRoad2: { top: "56%", left: "-20%", width: "80%", height: 14, transform: [{ rotate: "6deg" }] },
  mapRoad3: { top: "78%", left: "20%", right: "-10%", height: 12, transform: [{ rotate: "-4deg" }] },
  routeLine: { position: "absolute", height: 3, backgroundColor: "#9A6201", borderRadius: 2 } as any,
  approachLine: { position: "absolute", height: 3, backgroundColor: "#176C52", borderRadius: 2 } as any,
  marker: { position: "absolute", width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: "#FFFFFF" },
  markerStart: { top: "32%", left: "16%", backgroundColor: "#9A6201" },
  markerDriver: { top: "50%", left: "42%", backgroundColor: "#111111" },
  markerEnd: { top: "64%", right: "18%", backgroundColor: "#FFFFFF", borderColor: "#B4232D" },

  fab: { position: "absolute", right: 14, bottom: 440, width: 50, height: 50, borderRadius: 14, backgroundColor: "#F7EFE5", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#E5D2B9", zIndex: 10 },
  sheetFab: { width: 36, height: 36, borderRadius: 10, backgroundColor: "#9A6201", alignItems: "center", justifyContent: "center" },

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
  rowDriverDistance: { marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 3, paddingTop: 1 },
  rowDriverDistanceText: { color: "#9A6201", fontSize: 12.5, fontWeight: "600" },
  rowStatusChip: { marginLeft: "auto", paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5 },
  rowStatusText: { fontSize: 9, fontWeight: "700", letterSpacing: 0.35 },
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
  rowBtnFilled: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 7, backgroundColor: "#F7EFE5", borderWidth: 1, borderColor: "#E5D2B9", minWidth: 64, alignItems: "center", flexDirection: "row", gap: 4, justifyContent: "center" },
  rowBtnFilledText: { color: "#9A6201", fontSize: 10.5, fontWeight: "700" },

  loadingState: { alignItems: "center", paddingVertical: 32, gap: 8 },
  loadingText: { color: "#666666", fontSize: 12 },
  empty: { alignItems: "center", paddingHorizontal: 24, paddingVertical: 24 },
  emptyIcon: { width: 60, height: 60, borderRadius: 14, backgroundColor: "#EEEDF3", alignItems: "center", justifyContent: "center", marginBottom: 12 },
  emptyTitle: { color: "#111111", fontSize: 14, fontWeight: "600", marginBottom: 4 },
  emptyText: { color: "#666666", fontSize: 12, textAlign: "center", lineHeight: 18 },

  pressed: { opacity: 0.7 },
});
