import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, Dimensions, Linking, PanResponder, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import MapView, { Marker, Polyline, type Region } from "react-native-maps";
import { CandidatesSheet } from "@/components/tikis/candidates-sheet";
import { CHIP_ANCHOR, DriverMarker, DropoffMarker, PickupMarker, PIN_ANCHOR } from "@/components/tikis/map-markers";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTikisStore } from "@/lib/tikis-store";
import { haptic } from "@/lib/haptics";
import { trpc } from "@/lib/trpc";
import { formatDeliveryDetailPlace, formatListRouteParts, geodesicDistanceKm } from "@/lib/geo-rules";
import { useDriverLocation } from "@/hooks/use-driver-location";
import { useDriverBasePositionSync } from "@/hooks/use-driver-base-position-sync";
import { useDeviceHeading } from "@/hooks/use-device-heading";
import { useLiveDeliveryPosition } from "@/hooks/use-live-delivery-position";
import { compassRotationToTarget } from "@/lib/compass";
import { formatDistanceKm, formatDeliveryCreationDate } from "@/lib/date-format";
import { FinancialConfirmationModal } from "@/components/tikis/financial-modal";
import { ActionConfirmationModal } from "@/components/tikis/action-confirmation-modal";
import { RateDeliveryDialog } from "@/components/tikis/rate-delivery-dialog";
import { availableWalletBalance, commissionFor, formatMoney, isDeliveryCompletedToday, isDeliveryCompletedWithinLast24Hours, type Delivery, type DeliveryStatus } from "@/shared/tikis-domain";
import { resolveDriverHomeAction, resolveSenderHomeAction, senderHomeActionLabel } from "@/shared/delivery-home-action";
import { deliveryCardContext, deliveryCardSignal, deliveryCardStateLabel, deliveryCardTone } from "@/lib/delivery-card";
import { isOpenDeliveryStale } from "@/shared/delivery-freshness";
import { deliveryMetricsForDay } from "@/lib/wallet-metrics";
import { useThemeColors } from "@/lib/use-theme-colors";

const { height: SCREEN_H } = Dimensions.get("window");
const SHEET_MIN = 130;
const SHEET_PEEK = 420;
const SHEET_EXPANDED = Math.min(SCREEN_H * 0.78, 720);
const PICKUP_TOOLTIP_DURATION_MS = 3_000;

/** Le ton renvoyé par `deliveryCardTone`, traduit en couleur. La couleur reste
 *  ici : la logique de carte dit l'état, elle ne peint pas. */
const TONE_COLOR: Record<ReturnType<typeof deliveryCardTone>, string> = {
  open: "#9A6201",
  assigned: "#A65300",
  active: "#176C52",
  done: "#667085",
  idle: "#667085",
};


type FilterKey = "active" | "open" | "pending" | "completed";
type PendingHomeAction =
  | { kind: "withdraw" | "confirm" | "cancel"; delivery: Delivery };

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

  const deliveriesQuery = trpc.deliveries.list.useQuery(undefined, { enabled: Boolean(profile?.phone), refetchInterval: 5_000 });
  const deliveries = useMemo(() => deliveriesQuery.data ?? [], [deliveriesQuery.data]);

  const walletQuery = trpc.wallet.snapshot.useQuery(undefined, { enabled: role === "driver" && Boolean(profile?.phone), refetchInterval: 5_000, refetchOnMount: "always", refetchOnWindowFocus: true });
  const driverWallet = walletQuery.data?.wallet;
  // Gains de courses = informatifs, calculés depuis les livraisons terminées (jamais depuis le Wallet, qui n'est
  // jamais crédité par une livraison : le paiement se fait directement entre l'expéditeur et le livreur).
  const driverEarningsHistoryQuery = trpc.wallet.driverEarningsHistory.useQuery(undefined, { enabled: role === "driver" && Boolean(profile?.phone), refetchInterval: 5_000 });
  const driverEarningsHistory = driverEarningsHistoryQuery.data ?? [];

  const [filter, setFilter] = useState<FilterKey>("open");
  const [searchQuery, setSearchQuery] = useState("");
  const [nowTick, setNowTick] = useState(0);
  const [rateDeliveryId, setRateDeliveryId] = useState<string | null>(null);
  const now = Date.now() + nowTick;
  useEffect(() => {
    setFilter("open");
  }, [role]);

  useEffect(() => {
    const id = setInterval(() => setNowTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [driverOnline, setDriverOnline] = useState(true);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [applicationDelivery, setApplicationDelivery] = useState<Delivery | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingHomeAction | null>(null);
  const [candidatesDeliveryId, setCandidatesDeliveryId] = useState<string | null>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [, setNow] = useState(Date.now());
  const hasInitialData = useRef(false);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    if (deliveriesQuery.data) hasInitialData.current = true;
  }, [deliveriesQuery.data]);
  const scrollRef = useRef<ScrollView>(null);
  const sheetHeight = useRef(new Animated.Value(SHEET_PEEK)).current;
  const sheetValue = useRef(SHEET_PEEK);
  const dragStartHeight = useRef(SHEET_PEEK);
  const lastSheetSnap = useRef(SHEET_PEEK);
  /** Palier sur lequel la feuille s'est arrêtée. La carte s'y recadre : c'est
   *  lui qui dit quelle hauteur d'écran lui reste réellement. */
  const [sheetSnap, setSheetSnap] = useState(SHEET_PEEK);
  const filterTransition = useRef(new Animated.Value(1)).current;
  const previousDeliveryStatuses = useRef<Record<string, DeliveryStatus> | null>(null);
  const badgeScales = useRef<Record<FilterKey, Animated.Value>>({
    open: new Animated.Value(1),
    pending: new Animated.Value(1),
    active: new Animated.Value(1),
    completed: new Animated.Value(1),
  }).current;
  // Activée pour les deux rôles : l'expéditeur en a besoin pour se situer sur la
  // carte quand aucune course n'est sélectionnée. La synchronisation de position
  // vers le serveur, elle, reste réservée au livreur (ligne suivante).
  const driverLocation = useDriverLocation({ enabled: true });
  // Tient à jour le centre des rayons « alertes » et « affichage » du livreur (cf. app/driver-alerts.tsx).
  useDriverBasePositionSync(driverLocation.location, role === "driver");
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

  const publishLivePositionMutation = trpc.deliveries.updateLivePosition.useMutation();
  const publishLivePositionRef = useRef(publishLivePositionMutation.mutateAsync);
  publishLivePositionRef.current = publishLivePositionMutation.mutateAsync;
  useEffect(() => {
    if (role !== "driver" || selected?.status !== "active" || !driverLocation.location) return;
    const previous = lastPublishedPosition.current;
    const elapsed = Date.now() - (previous?.at ?? 0);
    const movedMeters = previous?.deliveryId === selected?.id
      ? geodesicDistanceKm(previous, driverLocation.location) * 1_000
      : Infinity;
    if (previous?.deliveryId === selected?.id && movedMeters < 4 && elapsed < 5_000) return;
    const position = driverLocation.location;
    const deliveryId = selected?.id;
    if (!deliveryId) return;
    lastPublishedPosition.current = { deliveryId, ...position, at: Date.now() };
    void publishLivePositionRef.current({
      deliveryId,
      latitude: position.latitude,
      longitude: position.longitude,
      heading: typeof deviceHeading === "number" && Number.isFinite(deviceHeading) ? deviceHeading : 0,
    }).catch(() => {
      if (lastPublishedPosition.current?.deliveryId === deliveryId) {
        lastPublishedPosition.current = null;
      }
    });
  }, [deviceHeading, driverLocation.location, role, selected?.id, selected?.status]);

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
      setSheetSnap(target);
      animateSheetTo(target);
    },
  })).current;

  const utilities = trpc.useUtils();
  const applyMutation = trpc.deliveries.submitApplication.useMutation();
  const withdrawMutation = trpc.deliveries.withdraw.useMutation();
  const confirmMutation = trpc.deliveries.confirm.useMutation();
  const cancelMutation = trpc.deliveries.cancel.useMutation();

  const applicationCommission = (delivery: Delivery, priceOverride?: number) => {
    const rate = walletQuery.data?.commissionRate;
    if (!Number.isFinite(rate) || !rate || rate <= 0 || rate >= 1) return null;
    return commissionFor(priceOverride ?? (delivery.offeredPrice ?? delivery.estimatedPrice), { rate, currency: "FCFA" });
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

  async function executeDriverAction(delivery: Delivery, counterOffer?: { amount: number | null }) {
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
        // Le serveur calcule la commission sur `offerPrice` quand une contre-offre est fournie (server/db.ts,
        // applyForTikisDelivery) : il faut recalculer sur ce même montant ici, sinon le contrôle de
        // correspondance ajouté côté serveur rejette systématiquement toute candidature avec contre-offre.
        const confirmedCommission = applicationCommission(delivery, counterOffer?.amount ?? undefined);
        if (confirmedCommission === null) throw new Error("La commission doit être chargée puis confirmée avant la candidature.");
        const result = await applyMutation.mutateAsync({ deliveryId: delivery.id, confirmedCommission, ...(counterOffer?.amount ? { offerPrice: counterOffer.amount } : {}) });
        utilities.wallet.snapshot.setData(undefined, (current) => current ? { ...current, wallet: result.wallet } : current);
        setApplicationDelivery(null);
      }
      await Promise.all([utilities.deliveries.list.invalidate(), utilities.wallet.snapshot.invalidate(), utilities.notifications.list.invalidate()]);
      if (delivery.ownCandidateStatus === "applied" || delivery.ownCandidateStatus === "selected") setPendingAction(null);
    } catch (cause) {
      Alert.alert("Action impossible", cause instanceof Error ? cause.message : "Réessayez dans un instant.");
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

  /** L'action de la carte côté expéditeur. Le libellé du bouton lit le même
   *  résolveur : tant qu'ils étaient écrits deux fois et sans cas par défaut,
   *  une livraison qu'aucune des deux listes ne couvrait donnait un bouton
   *  visible qui ne faisait rien. */
  function handleSenderAction(delivery: Delivery) {
    switch (resolveSenderHomeAction(delivery)) {
      case "candidates":
        setCandidatesDeliveryId(delivery.id);
        return;
      case "cancel":
        setPendingAction({ kind: "cancel", delivery });
        return;
      case "track":
        // « Suivre » mène au suivi en direct. La fiche livraison reste
        // accessible par le bouton « Détails » juste à côté.
        router.push(`/delivery/${delivery.id}/map` as any);
        return;
      case "rate":
        setRateDeliveryId(delivery.id);
        return;
      default:
        // Aucun cas particulier : la fiche livraison reste une réponse utile.
        // Un bouton visible ne doit jamais ne rien faire.
        router.push(`/delivery/${delivery.id}` as any);
    }
  }

  const isDriver = role === "driver";
  const filterItems = isDriver ? DRIVER_FILTERS : SENDER_FILTERS;
  const filterCounts = useMemo(() => Object.fromEntries(filterItems.map((item) => [item.key, deliveries.filter((delivery) => matchesFilter(delivery, item.key, isDriver)).length])) as Record<FilterKey, number>, [deliveries, filterItems, isDriver]);
  const filterTranslateY = filterTransition.interpolate({ inputRange: [0, 1], outputRange: [6, 0] });
  const firstNameDisplay = isDriver ? firstName : "à vous";
  const todaysEarnings = useMemo(() => isDriver ? deliveryMetricsForDay(driverEarningsHistory).earnings : 0, [driverEarningsHistory, isDriver]);
  const availableOpportunities = useMemo(() => {
    if (!isDriver) return 0;
    return deliveries.filter((delivery) => {
      if (isOpenDeliveryStale(delivery)) return false;
      const own = delivery.ownCandidateStatus;
      return (delivery.status === "open" || delivery.status === "pending_confirmation") && own !== "applied" && own !== "selected" && own !== "confirmed";
    }).length;
  }, [deliveries, isDriver]);
  const countLabel = isDriver ? `${availableOpportunities} opportunité${availableOpportunities > 1 ? "s" : ""} à proximité` : `${filteredList.length} livraison${filteredList.length > 1 ? "s" : ""} affichée${filteredList.length > 1 ? "s" : ""}`;

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
      <MapBackground
        selected={selected}
        role={role}
        sheetSnap={sheetSnap}
        driverPosition={role === "driver" ? driverLocation.location : senderLivePosition}
        driverHeading={role === "driver" ? deviceHeading ?? null : senderLivePosition?.heading ?? null}
        userLocation={driverLocation.location}
      />

      <Animated.View style={[styles.sheet, { height: sheetHeight }]}>
        <View style={styles.sheetHeader}>
          <View {...panResponder.panHandlers} style={styles.sheetDragHandle} accessibilityRole="adjustable" accessibilityLabel="Faire glisser le panneau de livraisons">
            <View style={styles.sheetGrip} />
          </View>
          <View style={styles.sheetTop}>
            <View style={styles.greetingBlock}>
              {isDriver ? (
                <View style={styles.driverGainsRow}>
                  <Text style={styles.sheetTitle}>Gains du jour</Text>
                  <Text style={styles.driverGainsValue}>{formatMoney(todaysEarnings)}</Text>
                </View>
              ) : (
                <Text style={styles.sheetTitle}>{`Bonjour ${firstNameDisplay} 👋`}</Text>
              )}
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
          ref={scrollRef}
          style={styles.scrollArea}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={(event) => setShowScrollTop(event.nativeEvent.contentOffset.y > 180)}
          refreshControl={
            <RefreshControl
              refreshing={isManualRefreshing}
              onRefresh={async () => {
                setIsManualRefreshing(true);
                try {
                  await Promise.all([
                    utilities.deliveries.list.invalidate(),
                    utilities.notifications.list.invalidate(),
                    role === "driver" ? utilities.wallet.snapshot.invalidate() : Promise.resolve(),
                  ]);
                } finally {
                  setIsManualRefreshing(false);
                }
              }}
              tintColor="#9A6201"
              colors={["#9A6201"]}
              progressBackgroundColor="#FFFFFF"
            />
          }
        >
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
              <MaterialIcons name="search" size={16} color="#667085" />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder={isDriver ? "Rechercher une opportunité…" : "Rechercher une livraison…"}
                placeholderTextColor={theme.placeholder}
                style={styles.searchInput}
                returnKeyType="search"
                clearButtonMode="while-editing"
              />
              {searchQuery.length > 0 ? (
                <Pressable onPress={() => setSearchQuery("")} hitSlop={8} accessibilityLabel="Effacer la recherche">
                  <MaterialIcons name="close" size={16} color="#667085" />
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
          {!hasInitialData.current && deliveriesQuery.isLoading ? (
            <View style={styles.loadingState}>
              <ActivityIndicator color="#9A6201" />
              <Text style={styles.loadingText}>Chargement de vos livraisons…</Text>
            </View>
          ) : !selected ? (
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <MaterialIcons name={isDriver ? "local-shipping" : "add"} size={26} color="#667085" />
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
                  now={now}
                  onPress={() => setSelectedId(delivery.id)}
                  onDetails={() => router.push(`/delivery/${delivery.id}` as any)}
                  onApply={() => requestDriverAction(delivery)}
                />
              ))}
            </View>
          ) : (
            <View style={styles.listSection}>
              {filteredList.map((delivery) => (
                <DeliveryRow
                  key={delivery.id}
                  delivery={delivery}
                  role={role}
                  selected={delivery.id === selected.id}
                  driverDistance={null}
                  driverLocationStatus={null}
                  compassRotation={0}
                  applying={actioningId === delivery.id}
                  now={now}
                  onPress={() => setSelectedId(delivery.id)}
                  onDetails={() => router.push(`/delivery/${delivery.id}` as any)}
                  onApply={() => handleSenderAction(delivery)}
                />
              ))}
            </View>
          )}

          </Animated.View>
        </ScrollView>
      </Animated.View>
      {isDriver && showScrollTop ? (
        <Pressable onPress={() => scrollRef.current?.scrollTo({ y: 0, animated: true })} style={({ pressed }) => [styles.scrollTopButton, pressed && styles.pressed]} accessibilityLabel="Revenir en haut">
          <MaterialIcons name="keyboard-arrow-up" size={20} color="#111111" />
        </Pressable>
      ) : null}
      <CandidatesSheet visible={Boolean(candidatesDeliveryId)} deliveryId={candidatesDeliveryId} onClose={() => setCandidatesDeliveryId(null)} />
      {applicationDelivery ? (
        <FinancialConfirmationModal
          visible
          title="Envoyer votre candidature"
          description="La commission Tikis sera temporairement réservée sur votre Wallet. Elle ne sera prélevée qu’après votre sélection et votre confirmation."
          amount={applicationCommission(applicationDelivery) ?? 0}
          confirmLabel="Confirmer ma candidature"
          allowCounterOffer
          loading={actioningId === applicationDelivery.id}
          onCancel={() => !actioningId && setApplicationDelivery(null)}
          onConfirm={(counterOffer) => void executeDriverAction(applicationDelivery, counterOffer)}
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
      {rateDeliveryId ? (
        <RateDeliveryDialog
          visible={Boolean(rateDeliveryId)}
          deliveryId={rateDeliveryId}
          driverName="votre livreur"
          onClose={() => setRateDeliveryId(null)}
          onRated={() => setRateDeliveryId(null)}
        />
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

function MapBackground({ selected, role, sheetSnap, driverPosition, driverHeading, userLocation }: { selected: Delivery | null | undefined; role: "sender" | "driver"; sheetSnap: number; driverPosition: { latitude: number; longitude: number } | null; /** Cap du livreur, en degrés : un nombre simple plutôt qu'un champ de `driverPosition`, dont la nouvelle identité relancerait le calcul d'itinéraire d'approche à chaque rendu. */ driverHeading: number | null; userLocation: { latitude: number; longitude: number } | null }) {
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

  const driverPositionRef = useRef(driverPosition);
  const userLocationRef = useRef(userLocation);
  useEffect(() => {
    driverPositionRef.current = driverPosition;
    userLocationRef.current = userLocation;
  }, [driverPosition, userLocation]);

  /** `true` dès que l'utilisateur a déplacé ou zoomé la carte : à partir de là
   *  elle lui appartient, et seul le bouton de recentrage la reprend. */
  const [userMovedMap, setUserMovedMap] = useState(false);

  /** Les marges réservées autour du tracé : la barre du haut, et la hauteur que
   *  la feuille occupe réellement. Elles étaient plancherées à 170 px en bas,
   *  donc la carte laissait de l'espace mort quand la feuille était repliée. */
  const edgePaddingFor = useCallback((snap: number) => ({
    top: 88,
    left: 20,
    right: 20,
    bottom: snap + 20,
  }), []);

  const fitToSelection = useCallback((animated: boolean, snap: number) => {
    const driver = driverPositionRef.current;
    if (!selected) {
      // Sans course sélectionnée, la carte se cale sur l'utilisateur.
      const user = userLocationRef.current;
      if (!user) return;
      mapRef.current?.animateToRegion({ ...user, latitudeDelta: 0.012, longitudeDelta: 0.012 }, animated ? 400 : 0);
      return;
    }
    const points = driver && selected.status === "active"
      ? [driver, selected.pickup, selected.dropoff]
      : [selected.pickup, selected.dropoff];
    mapRef.current?.fitToCoordinates(points, { edgePadding: edgePaddingFor(snap), animated });
  }, [edgePaddingFor, selected]);

  // Recadrage sur deux événements seulement : un changement de course, et un
  // changement de palier de la feuille — c'est là que l'espace disponible bouge.
  // Au palier déployé il ne reste pas de carte à cadrer, on ne touche à rien.
  // Le cadrage ne suit ni les points GPS ni le glissement continu du doigt :
  // il le faisait, et tout déplacement manuel était annulé dans la seconde.
  const lastFitKey = useRef<string | null>(null);
  const hasUserLocation = Boolean(userLocation);
  useEffect(() => {
    if (sheetSnap >= SHEET_EXPANDED) return;
    const key = `${selected?.id ?? (hasUserLocation ? "user" : "none")}:${sheetSnap}`;
    if (lastFitKey.current === key) return;
    lastFitKey.current = key;
    setUserMovedMap(false);
    const timer = setTimeout(() => fitToSelection(true, sheetSnap), 240);
    return () => clearTimeout(timer);
  }, [fitToSelection, hasUserLocation, selected?.id, sheetSnap]);

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
        style={[StyleSheet.absoluteFill, styles.mapCanvas]}
        initialRegion={region}
        showsCompass={false}
        rotateEnabled={false}
        toolbarEnabled={false}
        showsUserLocation={false}
        showsMyLocationButton={false}
        zoomEnabled
        scrollEnabled
        pitchEnabled={false}
        moveOnMarkerPress={false}
        onPanDrag={() => setUserMovedMap(true)}
        onRegionChangeComplete={(_region, details) => { if (details?.isGesture) setUserMovedMap(true); }}
      >
        {!selected && userLocation ? (
          <Marker coordinate={userLocation} anchor={{ x: 0.5, y: 0.5 }} title="Votre position">
            <View style={styles.userMarkerHalo}>
              <View style={styles.userMarkerDot} />
            </View>
          </Marker>
        ) : null}
        {selected ? (
          <>
            {approachCoordinates.length > 1 ? <Polyline coordinates={approachCoordinates} strokeColor="#176C52" strokeWidth={4} lineCap="round" /> : null}
            {routeCoordinates.length > 1 ? <Polyline coordinates={routeCoordinates} strokeColor="#9A6201" strokeWidth={4} lineCap="round" /> : null}
            <Marker coordinate={{ latitude: selected.pickup.latitude, longitude: selected.pickup.longitude }} anchor={PIN_ANCHOR}>
              <PickupMarker />
            </Marker>
            {hasDriver && driverPosition ? (
              <Marker coordinate={driverPosition} anchor={CHIP_ANCHOR}>
                <DriverMarker heading={driverHeading} />
              </Marker>
            ) : null}
            <Marker coordinate={{ latitude: selected.dropoff.latitude, longitude: selected.dropoff.longitude }} anchor={PIN_ANCHOR}>
              <DropoffMarker />
            </Marker>
          </>
        ) : null}
      </MapView>
      {userMovedMap && (selected || userLocation) ? (
        <Pressable
          onPress={() => { setUserMovedMap(false); fitToSelection(true, sheetSnap); }}
          accessibilityRole="button"
          accessibilityLabel="Recentrer la carte sur la course"
          style={({ pressed }) => [styles.fab, { bottom: sheetSnap + 20 }, pressed && styles.pressed]}
        >
          <MaterialIcons name="my-location" size={20} color="#111111" />
        </Pressable>
      ) : null}
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
  now,
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
  now: number;
  onPress: () => void;
  onDetails: () => void;
  onApply: () => void;
}) {
  const [showPickupTooltip, setShowPickupTooltip] = useState(false);
  const isDriver = role === "driver";
  const driverAction = delivery.status === "completed"
    ? null
    : delivery.ownCandidateStatus === "applied"
      ? "Se retirer"
      : delivery.ownCandidateStatus === "selected"
        ? "Confirmer"
        : delivery.ownCandidateStatus === "confirmed" || delivery.status === "active"
          ? "Démarrer"
          : "Postuler";

  const route = formatListRouteParts(delivery.pickup, delivery.dropoff);
  const dateInfo = formatDeliveryCreationDate(delivery.createdAt, now);
  const totalDistance = formatDistanceKm(delivery.distanceKm);
  const tripLine = `${(delivery.vehicleTypes ?? []).join(" · ") || "Moto"} · ${totalDistance.value} ${totalDistance.unit}`;
  const price = formatMoney(delivery.offeredPrice ?? delivery.estimatedPrice);
  const tone = deliveryCardTone(delivery.status);
  const toneColor = TONE_COLOR[tone];
  const signal = deliveryCardSignal(delivery);
  const context = deliveryCardContext(delivery);

  const pickupPlace = formatDeliveryDetailPlace(delivery.pickup);
  const dropoffPlace = formatDeliveryDetailPlace(delivery.dropoff);
  const driverDistText = driverDistance
    ? `${driverDistance.value} ${driverDistance.unit}`
    : driverLocationStatus === "loading" || driverLocationStatus === "idle"
      ? "…"
      : driverLocationStatus === "denied"
        ? "GPS désactivé"
        : "—";

  useEffect(() => {
    if (!showPickupTooltip) return;
    const timeout = setTimeout(() => setShowPickupTooltip(false), PICKUP_TOOLTIP_DURATION_MS);
    return () => clearTimeout(timeout);
  }, [showPickupTooltip]);

  // ---------- Registre (livreur) ----------
  if (isDriver) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityLabel={`${route.pickup} vers ${route.dropoff}, ${price}, à ${driverDistText}`}
        style={({ pressed }) => [styles.card, styles.cardCompact, selected && styles.cardSelected, pressed && styles.cardPressed]}
      >
        <View style={[styles.cardRail, { backgroundColor: toneColor }]} />
        <View style={styles.compactBody}>
          <View style={styles.compactRoute}>
            <Text style={styles.compactFrom} numberOfLines={1}>{route.pickup}</Text>
            <Text style={styles.compactArrow}>→</Text>
            <Text style={styles.compactTo} numberOfLines={1}>{route.dropoff}</Text>
          </View>
          <Text style={styles.compactMeta} numberOfLines={1}>{tripLine} · {dateInfo.primary.toLocaleLowerCase("fr")}</Text>
          <View style={styles.compactDistance}>
            <Pressable
              onPress={() => setShowPickupTooltip((visible) => !visible)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Afficher les lieux : collecte ${pickupPlace.title}, ${pickupPlace.subtitle} ; destination ${dropoffPlace.title}, ${dropoffPlace.subtitle}`}
              style={({ pressed }) => [pressed && styles.pressed]}
            >
              <MaterialIcons accessible={false} name="navigation" size={15} color="#9A6201" style={{ transform: [{ rotate: `${compassRotation}deg` }] }} />
            </Pressable>
            <Text style={styles.compactDistanceText} numberOfLines={1}>à {driverDistText} de vous</Text>
            {showPickupTooltip ? (
              <View style={styles.pickupTooltip}>
                <Text style={styles.pickupTooltipLabel}>COLLECTE</Text>
                <Text style={styles.pickupTooltipText} numberOfLines={1}>{pickupPlace.title}</Text>
                <Text style={styles.pickupTooltipDistrict} numberOfLines={1}>{pickupPlace.subtitle}</Text>
                <View style={styles.pickupTooltipDivider} />
                <Text style={styles.pickupTooltipLabel}>DESTINATION</Text>
                <Text style={styles.pickupTooltipText} numberOfLines={1}>{dropoffPlace.title}</Text>
                <Text style={styles.pickupTooltipDistrict} numberOfLines={1}>{dropoffPlace.subtitle}</Text>
              </View>
            ) : null}
          </View>
        </View>
        <View style={styles.compactRight}>
          <Text style={styles.compactPrice}>{price}</Text>
          {driverAction ? (
            <Pressable
              onPress={onApply}
              disabled={applying}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={`${driverAction} — ${delivery.title}`}
              style={({ pressed }) => [applying && { opacity: 0.6 }, pressed && !applying && styles.pressed]}
            >
              {applying ? <ActivityIndicator size="small" color="#9A6201" /> : <Text style={styles.compactAction}>{driverAction}</Text>}
            </Pressable>
          ) : null}
          {/* « Ouvrir » ne s'affichait qu'à défaut d'action, c'est-à-dire sur
              les seules courses terminées : tant qu'il restait « Postuler » à
              faire, le livreur n'avait aucun chemin vers la fiche. La fiche
              est pourtant ce qui lui dit s'il veut de la course. */}
          <Pressable
            onPress={onDetails}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`Détails — ${delivery.title}`}
            style={({ pressed }) => [pressed && styles.pressed]}
          >
            <Text style={styles.compactGhost}>Détails</Text>
          </Pressable>
        </View>
      </Pressable>
    );
  }

  // ---------- Trajet (expéditeur) ----------
  const senderAction = resolveSenderHomeAction(delivery);
  const senderLabel = senderHomeActionLabel(senderAction);
  const isCancel = senderAction === "cancel";

  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={`${route.pickup} vers ${route.dropoff}, ${price}, ${deliveryCardStateLabel(delivery.status)}`}
      style={({ pressed }) => [styles.card, styles.cardTrip, selected && styles.cardSelected, pressed && styles.cardPressed]}
    >
      <View style={[styles.cardRail, { backgroundColor: toneColor }]} />

      <View style={styles.tripHead}>
        <View style={styles.tripRail}>
          <View style={styles.tripDot} />
          <View style={styles.tripLine} />
          <View style={styles.tripPin} />
        </View>
        <View style={styles.tripStops}>
          <Text style={styles.tripStop} numberOfLines={1}>{route.pickup}</Text>
          <Text style={styles.tripStop} numberOfLines={1}>{route.dropoff}</Text>
        </View>
        <View style={styles.tripFigures}>
          <Text style={styles.tripPrice}>{price}</Text>
          <Text style={styles.tripTrip} numberOfLines={1}>{tripLine}</Text>
        </View>
      </View>

      {signal ? (
        <View style={[styles.tripSignal, { backgroundColor: toneColor + "1A" }]}>
          <MaterialIcons name={signal.kind === "candidates" ? "group" : "two-wheeler"} size={15} color={toneColor} />
          <Text style={[styles.tripSignalText, { color: toneColor }]} numberOfLines={1}>{signal.text}</Text>
        </View>
      ) : null}

      <Text style={styles.tripMeta} numberOfLines={1}>
        <Text style={[styles.tripState, { color: toneColor }]}>{deliveryCardStateLabel(delivery.status)}</Text>
        {`  ·  ${dateInfo.primary.toLocaleLowerCase("fr")}  ·  ${context}`}
      </Text>

      <View style={styles.tripFoot}>
        <Pressable onPress={onDetails} hitSlop={6} accessibilityRole="button" style={({ pressed }) => [pressed && styles.pressed]}>
          <Text style={styles.tripGhost}>Détails</Text>
        </Pressable>
        {senderLabel && isCancel ? (
          // Annuler ne redevient un bouton que lorsqu'il n'y a pas d'action utile
          // à côté : une action destructrice ne doit jamais être la plus visible.
          <Pressable
            onPress={onApply}
            disabled={applying}
            accessibilityRole="button"
            accessibilityLabel={`Annuler — ${delivery.title}`}
            style={({ pressed }) => [styles.tripCtaQuiet, applying && { opacity: 0.6 }, pressed && !applying && styles.pressed]}
          >
            {applying ? <ActivityIndicator size="small" color="#A43740" /> : <Text style={styles.tripCtaQuietText}>Annuler</Text>}
          </Pressable>
        ) : senderLabel ? (
          <Pressable
            onPress={onApply}
            disabled={applying}
            accessibilityRole="button"
            accessibilityLabel={`${senderLabel} — ${delivery.title}`}
            style={({ pressed }) => [styles.tripCta, applying && { opacity: 0.6 }, pressed && !applying && styles.pressed]}
          >
            {applying ? <ActivityIndicator size="small" color="#9A6201" /> : <Text style={styles.tripCtaText}>{senderLabel}</Text>}
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F0F3F8" },

  mapBg: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#F0F3F8", zIndex: 0 },
  mapCanvas: { zIndex: 0 },

  userMarkerHalo: { width: 26, height: 26, borderRadius: 13, backgroundColor: "rgba(154,98,1,0.18)", alignItems: "center", justifyContent: "center" },
  userMarkerDot: { width: 13, height: 13, borderRadius: 7, backgroundColor: "#9A6201", borderWidth: 2.5, borderColor: "#FFFFFF" },

  fab: { position: "absolute", right: 14, width: 50, height: 50, borderRadius: 14, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#E3E3E3", zIndex: 10 },
  sheetFab: { width: 36, height: 36, borderRadius: 10, backgroundColor: "#9A6201", alignItems: "center", justifyContent: "center" },

  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: "#FFFFFF", borderTopLeftRadius: 18, borderTopRightRadius: 18, overflow: "hidden", zIndex: 2, elevation: 2 },
  sheetHeader: { paddingTop: 10, paddingBottom: 8 },
  sheetDragHandle: { alignSelf: "stretch", minHeight: 28, alignItems: "center", justifyContent: "center" },
  sheetGrip: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: "#E3E3E3", marginBottom: 10 },
  sheetTop: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14 },
  greetingBlock: { flex: 1, minWidth: 0 },
  driverGainsRow: { flexDirection: "row", alignItems: "baseline", gap: 6, flexWrap: "wrap" },
  driverGainsValue: { color: "#9A6201", fontSize: 14, fontWeight: "700" },
  sheetTitle: { color: "#111111", fontSize: 14, fontWeight: "700", lineHeight: 18 },
  sheetSubtitle: { color: "#667085", fontSize: 10.5, marginTop: 1, fontWeight: "500" },

  servicePill: { paddingHorizontal: 12, height: 38, borderRadius: 11, backgroundColor: "#F0F3F8", flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: "#E3E3E3" },
  servicePillOffline: { backgroundColor: "#F0F3F8", borderWidth: StyleSheet.hairlineWidth, borderColor: "#E3E3E3" },
  servicePillNeutral: { backgroundColor: "#F0F3F8" },
  serviceText: { color: "#9A6201", fontSize: 11, fontWeight: "700", letterSpacing: 0.4 },
  serviceTextOffline: { color: "#111111" },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#9A6201" },
  onlineDotOffline: { backgroundColor: "#667085" },

  searchRow: { paddingTop: 10, paddingBottom: 6 },
  kycBanner: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 14, marginTop: 6, padding: 11, backgroundColor: "#F0F3F8", borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: "#E3E3E3" },
  kycBannerCopy: { flex: 1 },
  kycBannerTitle: { color: "#9A6201", fontSize: 12, fontWeight: "700" },
  kycBannerText: { color: "#9A6201", fontSize: 11, marginTop: 2, lineHeight: 16 },
  searchPill: { height: 40, backgroundColor: "#F0F3F8", borderRadius: 11, borderWidth: StyleSheet.hairlineWidth, borderColor: "#E3E3E3", flexDirection: "row", alignItems: "center", paddingHorizontal: 12, gap: 8 },
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

  filterRow: { flexDirection: "row", gap: 6, paddingBottom: 10, alignItems: "center" },
  filterScroll: { flexGrow: 0 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: "#F0F3F8", borderWidth: StyleSheet.hairlineWidth, borderColor: "#E3E3E3", flexDirection: "row", alignItems: "center", gap: 6 },
  chipActive: { backgroundColor: "#9A620114", borderColor: "#9A6201", borderWidth: 1 },
  chipText: { color: "#9A6201", fontSize: 11, fontWeight: "600" },
  chipTextActive: { color: "#9A6201" },
  chipCount: { minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, backgroundColor: "#9A6201", alignItems: "center", justifyContent: "center" },
  chipCountActive: { backgroundColor: "#9A6201" },
  chipCountText: { color: "#FFFFFF", fontSize: 10, fontWeight: "700", lineHeight: 12 },
  tabContent: { minHeight: 1 },

  scrollArea: { flex: 1, marginTop: 2 },
  scrollContent: { paddingHorizontal: 14, paddingTop: 6, paddingBottom: 90, gap: 8 },


  // ---------- Carte « Trajet » (expéditeur) et « Registre » (livreur) ----------
  card: {
    position: "relative", overflow: "hidden", backgroundColor: "#F0F3F8",
    borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: "#E3E3E3",
  },
  cardPressed: { backgroundColor: "#E7ECF4" },
  // La sélection cerne la carte au lieu de la repeindre : la liste ne change plus
  // de couleur autour de l'élément choisi.
  cardSelected: { borderColor: "#9A6201", borderWidth: 1.5 },
  cardRail: { position: "absolute", left: 0, top: 0, bottom: 0, width: 3 },

  cardTrip: { paddingVertical: 13, paddingLeft: 17, paddingRight: 14, gap: 11 },
  tripHead: { flexDirection: "row", alignItems: "flex-start", gap: 11 },
  tripRail: { width: 12, alignItems: "center", paddingTop: 5, alignSelf: "stretch" },
  tripDot: { width: 9, height: 9, borderRadius: 5, borderWidth: 2.5, borderColor: "#9A6201" },
  tripLine: { flex: 1, width: 1.5, minHeight: 16, backgroundColor: "#E3E3E3", marginVertical: 2 },
  tripPin: { width: 9, height: 9, borderRadius: 5, backgroundColor: "#A43740" },
  tripStops: { flex: 1, minWidth: 0, gap: 10 },
  tripStop: { fontSize: 14.5, fontWeight: "600", lineHeight: 17, color: "#111111" },
  tripFigures: { flexShrink: 0, alignItems: "flex-end", gap: 10 },
  tripPrice: { fontSize: 16, fontWeight: "800", lineHeight: 17, color: "#111111", fontVariant: ["tabular-nums"] },
  tripTrip: { fontSize: 11.5, lineHeight: 14, color: "#667085", fontVariant: ["tabular-nums"] },
  tripSignal: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 9, paddingVertical: 7, borderRadius: 9 },
  tripSignalText: { flex: 1, fontSize: 12, fontWeight: "600" },
  tripMeta: { fontSize: 11.5, color: "#667085" },
  tripState: { fontWeight: "700" },
  tripFoot: { flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#E3E3E3" },
  tripGhost: { fontSize: 12.5, fontWeight: "600", color: "#667085" },
  tripCta: { marginLeft: "auto", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 9, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#9A6201", minWidth: 96, alignItems: "center" },
  tripCtaText: { fontSize: 12.5, fontWeight: "700", color: "#9A6201" },
  tripCtaQuiet: { marginLeft: "auto", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 9, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#A43740", minWidth: 96, alignItems: "center" },
  tripCtaQuietText: { fontSize: 12.5, fontWeight: "700", color: "#A43740" },

  cardCompact: { flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 11, paddingLeft: 15, paddingRight: 12 },
  compactBody: { flex: 1, minWidth: 0, gap: 3 },
  compactRoute: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  compactFrom: { flexShrink: 1, minWidth: 0, fontSize: 13.5, fontWeight: "600", color: "#111111" },
  compactArrow: { flexShrink: 0, fontSize: 13.5, color: "#667085" },
  compactTo: { flexShrink: 1, minWidth: 0, fontSize: 13.5, fontWeight: "600", color: "#111111" },
  compactMeta: { fontSize: 11.5, color: "#667085" },
  compactDistance: { flexDirection: "row", alignItems: "center", gap: 5, position: "relative" },
  compactDistanceText: { fontSize: 11.5, fontWeight: "700", color: "#9A6201" },
  compactRight: { flexShrink: 0, alignItems: "flex-end", gap: 6 },
  compactPrice: { fontSize: 14.5, fontWeight: "800", color: "#111111", fontVariant: ["tabular-nums"] },
  compactAction: { fontSize: 11.5, fontWeight: "700", color: "#9A6201" },
  compactGhost: { fontSize: 11.5, fontWeight: "600", color: "#667085" },

  listSection: { marginTop: 4, gap: 8 },
  // Le sheet est blanc : une carte blanche y disparaîtrait. Les cartes sont
  // en retrait, et ce qu'elles contiennent repasse en blanc.
  pickupTooltip: { position: "absolute", right: 0, top: 28, minWidth: 168, maxWidth: 236, backgroundColor: "#111111", borderRadius: 7, paddingHorizontal: 9, paddingVertical: 7, zIndex: 20 },
  pickupTooltipLabel: { color: "rgba(255,255,255,0.64)", fontSize: 8, fontWeight: "700", letterSpacing: 0.55 },
  pickupTooltipText: { color: "#FFFFFF", fontSize: 11, fontWeight: "600", marginTop: 2 },
  pickupTooltipDistrict: { color: "rgba(255,255,255,0.68)", fontSize: 10, marginTop: 1 },
  pickupTooltipDivider: { height: 1, backgroundColor: "rgba(255,255,255,0.16)", marginVertical: 6 },

  loadingState: { alignItems: "center", paddingVertical: 32, gap: 8 },
  loadingText: { color: "#667085", fontSize: 12 },
  empty: { alignItems: "center", paddingHorizontal: 24, paddingVertical: 24 },
  emptyIcon: { width: 60, height: 60, borderRadius: 14, backgroundColor: "#F0F3F8", alignItems: "center", justifyContent: "center", marginBottom: 12 },
  emptyTitle: { color: "#111111", fontSize: 14, fontWeight: "600", marginBottom: 4 },
  emptyText: { color: "#667085", fontSize: 12, textAlign: "center", lineHeight: 18 },

  pressed: { opacity: 0.7 },
  scrollTopButton: { position: "absolute", right: 16, bottom: 24, width: 38, height: 38, borderRadius: 10, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E3E3E3", alignItems: "center", justifyContent: "center" },
});
