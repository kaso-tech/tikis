import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, PanResponder, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { DriverMarker, DropoffMarker, PickupMarker } from "@/components/tikis/map-markers";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";
import { formatListRouteParts } from "@/lib/geo-rules";
import { useDriverLocation } from "@/hooks/use-driver-location";
import { useDriverBasePositionSync } from "@/hooks/use-driver-base-position-sync";
import { useLiveDeliveryPosition } from "@/hooks/use-live-delivery-position";
import { formatDistanceKm, formatDeliveryCreationDate } from "@/lib/date-format";
import { FinancialConfirmationModal } from "@/components/tikis/financial-modal";
import { ActionConfirmationModal } from "@/components/tikis/action-confirmation-modal";
import { availableWalletBalance, commissionFor, formatMoney, isDeliveryCompletedToday, isDeliveryCompletedWithinLast24Hours, type Delivery, type DeliveryStatus } from "@/shared/tikis-domain";
import { resolveDriverHomeAction, resolveSenderHomeAction, senderHomeActionLabel } from "@/shared/delivery-home-action";
import { sortDriverOpportunities } from "@/shared/driver-opportunities";
import { deliveryCardContext, deliveryCardSignal, deliveryCardStateLabel, deliveryCardTone } from "@/lib/delivery-card";
import { isOpenDeliveryStale } from "@/shared/delivery-freshness";
import { deliveryMetricsForDay } from "@/lib/wallet-metrics";
import { useThemeColors } from "@/lib/use-theme-colors";

/** Le ton renvoyé par `deliveryCardTone`, traduit en couleur. La couleur reste
 *  ici : la logique de carte dit l'état, elle ne peint pas. */
const TONE_COLOR: Record<ReturnType<typeof deliveryCardTone>, string> = {
  open: "#9A6201",
  assigned: "#A65300",
  active: "#176C52",
  done: "#667085",
  idle: "#667085",
};

const SHEET_MIN = 130;
const SHEET_PEEK = 420;
const SHEET_EXPANDED = 720;


type FilterKey = "active" | "open" | "pending" | "completed";
type PendingHomeAction =
  | { kind: "withdraw"; delivery: Delivery }
  | { kind: "confirm"; delivery: Delivery }
  | { kind: "cancel"; delivery: Delivery };

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

  useEffect(() => {
    setFilter("open");
  }, [role]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [driverOnline, setDriverOnline] = useState(true);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [applicationDelivery, setApplicationDelivery] = useState<Delivery | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingHomeAction | null>(null);
  const [nowTick, setNow] = useState(0);
  const now = Date.now() + nowTick;
  const hasInitialData = useRef(false);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  useEffect(() => {
    const interval = setInterval(() => setNow((t) => t + 1), 30_000);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    if (deliveriesQuery.data) hasInitialData.current = true;
  }, [deliveriesQuery.data]);
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
  // Tient à jour le centre des rayons « alertes » et « affichage » du livreur (cf. app/driver-alerts.tsx).
  useDriverBasePositionSync(driverLocation.location, role === "driver");

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
      // Le classement est celui du serveur, emprunté au même module : la copie
      // locale triait les annonces par distance du trajet et ignorait donc le prix.
      return sortDriverOpportunities(deliveries.filter(matches));
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

  const applicationCommission = (delivery: Delivery, priceOverride?: number) => {
    const rate = walletQuery.data?.commissionRate;
    if (!Number.isFinite(rate) || !rate || rate <= 0 || rate >= 1) return null;
    return commissionFor(priceOverride ?? (delivery.offeredPrice ?? delivery.estimatedPrice), { rate, currency: "FCFA" });
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

  async function handleApply(delivery: Delivery, counterOffer?: { amount: number | null }) {
    setApplyingId(delivery.id);
    try {
      // Le serveur calcule la commission sur `offerPrice` quand une contre-offre est fournie (server/db.ts,
      // applyForTikisDelivery) : il faut recalculer sur ce même montant ici, sinon le contrôle de
      // correspondance ajouté côté serveur rejette systématiquement toute candidature avec contre-offre.
      const confirmedCommission = applicationCommission(delivery, counterOffer?.amount ?? undefined);
      if (confirmedCommission === null) throw new Error("La commission doit être chargée puis confirmée avant la candidature.");
      const result = await applyMutation.mutateAsync({ deliveryId: delivery.id, confirmedCommission, ...(counterOffer?.amount ? { offerPrice: counterOffer.amount } : {}) });
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
      Alert.alert("Action impossible", cause instanceof Error ? cause.message : "Réessayez dans un instant.");
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

  /** L'action de la carte côté expéditeur. Le libellé du bouton lit le même
   *  résolveur : tant qu'ils étaient écrits deux fois et sans cas par défaut,
   *  une livraison qu'aucune des deux listes ne couvrait donnait un bouton
   *  visible qui ne faisait rien. */
  function handleSenderAction(delivery: Delivery) {
    switch (resolveSenderHomeAction(delivery)) {
      case "candidates":
        // Choisir un livreur bloque sa commission et engage l'expéditeur sur un
        // montant : cela mérite un écran, pas un tiroir ouvert par-dessus l'accueil.
        router.push(`/delivery/${delivery.id}/candidates` as any);
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
        // Pas de dialogue de notation sur le web : la fiche livraison le porte.
        router.push(`/delivery/${delivery.id}` as any);
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
      <MapBackground selected={selected} role={role} driverPosition={role === "driver" ? driverLocation.location : senderLivePosition} driverHeading={senderLivePosition?.heading ?? null} />

      <Animated.View style={[styles.sheet, { height: sheetHeight }]}>
        <View {...panResponder.panHandlers} style={styles.sheetHeader}>
          <View style={styles.sheetGrip} />
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
          style={styles.scrollArea}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
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
            <DeliveryRow
              key={selected.id}
              delivery={selected}
              role={role}
              selected
              driverDistance={driverLocation.distanceTo(selected.pickup)}
              driverLocationStatus={driverLocation.status}
              applying={applyingId === selected.id}
              now={now}
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
              now={now}
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
                  now={now}
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
      {applicationDelivery ? (
        <FinancialConfirmationModal
          visible
          title="Envoyer votre candidature"
          description="La commission Tikis sera temporairement réservée sur votre Wallet. Elle ne sera prélevée qu’après votre sélection et votre confirmation."
          amount={applicationCommission(applicationDelivery) ?? 0}
          confirmLabel="Confirmer ma candidature"
          allowCounterOffer
          loading={applyingId === applicationDelivery.id}
          onCancel={() => !applyingId && setApplicationDelivery(null)}
          onConfirm={(counterOffer) => void handleApply(applicationDelivery, counterOffer)}
        />
      ) : null}
      {pendingAction?.kind === "cancel" ? (
        <ActionConfirmationModal visible title="Annuler cette livraison ?" description="La livraison sera retirée et ne recevra plus de candidatures." confirmLabel="Annuler la livraison" icon="cancel" tone="danger" loading={applyingId === pendingAction.delivery.id} onCancel={() => !applyingId && setPendingAction(null)} onConfirm={() => void cancelSenderDelivery(pendingAction.delivery)} />
      ) : null}
      {pendingAction?.kind === "withdraw" ? (
        <ActionConfirmationModal visible title="Se retirer de cette candidature ?" description="Votre candidature sera retirée et la commission réservée redeviendra immédiatement disponible." confirmLabel="Se retirer" icon="undo" tone="danger" loading={applyingId === pendingAction.delivery.id} onCancel={() => !applyingId && setPendingAction(null)} onConfirm={() => void executeDriverAction(pendingAction)} />
      ) : null}
      {pendingAction?.kind === "confirm" ? (
        <ActionConfirmationModal visible title="Confirmer cette mission ?" description="La commission réservée sera prélevée et la livraison passera en cours." confirmLabel="Confirmer" icon="check-circle" tone="success" loading={applyingId === pendingAction.delivery.id} onCancel={() => !applyingId && setPendingAction(null)} onConfirm={() => void executeDriverAction(pendingAction)} />
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

function MapBackground({ selected, role, driverPosition, driverHeading }: { selected: Delivery | null | undefined; role: "sender" | "driver"; driverPosition: { latitude: number; longitude: number } | null; driverHeading: number | null }) {
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
    <View style={styles.mapBg} pointerEvents="none">
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

      {routeLine ? (
        <>
          <View style={[styles.mapPin, { left: routeLine.left - 19, top: routeLine.top - 37 }]}>
            <PickupMarker />
          </View>
          <View
            style={[
              styles.mapPin,
              {
                left: routeLine.left + Math.cos((routeLine.angle * Math.PI) / 180) * routeLine.length - 19,
                top: routeLine.top + Math.sin((routeLine.angle * Math.PI) / 180) * routeLine.length - 37,
              },
            ]}
          >
            <DropoffMarker />
          </View>
        </>
      ) : null}
      {hasDriver && approachLine ? (
        <View style={[styles.mapChip, { left: approachLine.left - 22, top: approachLine.top - 22 }]}>
          <DriverMarker heading={driverHeading} />
        </View>
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
  applying: boolean;
  now: number;
  onPress: () => void;
  onDetails: () => void;
  onApply: () => void;
}) {
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

  const driverDistText = driverDistance
    ? `${driverDistance.value} ${driverDistance.unit}`
    : driverLocationStatus === "loading" || driverLocationStatus === "idle"
      ? "…"
      : driverLocationStatus === "denied"
        ? "GPS désactivé"
        : "—";

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
            <MaterialIcons name="explore" size={15} color="#9A6201" />
            <Text style={styles.compactDistanceText} numberOfLines={1}>à {driverDistText} de vous</Text>
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

  mapBg: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#F0F3F8" },
  mapBlock: { position: "absolute", backgroundColor: "#DCDEE3", borderRadius: 6 },
  mapRoad: { position: "absolute", backgroundColor: "#FFFFFF", borderRadius: 99 },
  mapRoad1: { top: "30%", left: "-10%", right: "-10%", height: 18, transform: [{ rotate: "-12deg" }] },
  mapRoad2: { top: "56%", left: "-20%", width: "80%", height: 14, transform: [{ rotate: "6deg" }] },
  mapRoad3: { top: "78%", left: "20%", right: "-10%", height: 12, transform: [{ rotate: "-4deg" }] },
  routeLine: { position: "absolute", height: 3, backgroundColor: "#9A6201", borderRadius: 2 } as any,
  approachLine: { position: "absolute", height: 3, backgroundColor: "#176C52", borderRadius: 2 } as any,
  // Les extrémités se posaient à des pourcentages fixes, sans rapport avec le
  // tracé calculé juste au-dessus : elles flottaient à côté de leur propre
  // ligne. Elles sont désormais calées sur ses deux bouts.
  mapPin: { position: "absolute" },
  mapChip: { position: "absolute" },

  fab: { position: "absolute", right: 14, bottom: 440, width: 50, height: 50, borderRadius: 14, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#E3E3E3", zIndex: 10 },
  sheetFab: { width: 36, height: 36, borderRadius: 10, backgroundColor: "#9A6201", alignItems: "center", justifyContent: "center" },

  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: "#FFFFFF", borderTopLeftRadius: 18, borderTopRightRadius: 18, overflow: "hidden" },
  sheetHeader: { paddingTop: 10, paddingBottom: 8 },
  sheetGrip: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: "#E3E3E3", marginBottom: 10 },
  sheetTop: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14 },
  greetingBlock: { flex: 1, minWidth: 0 },
  driverGainsRow: { flexDirection: "row", alignItems: "baseline", gap: 6, flexWrap: "wrap" },
  driverGainsValue: { color: "#9A6201", fontSize: 14, fontWeight: "700" },
  sheetTitle: { color: "#111111", fontSize: 14, fontWeight: "700", lineHeight: 18 },
  sheetSubtitle: { color: "#667085", fontSize: 10.5, marginTop: 1, fontWeight: "500" },

  servicePill: { paddingHorizontal: 12, height: 38, borderRadius: 11, backgroundColor: "#F0F3F8", flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: "#E3E3E3" },
  servicePillOffline: { backgroundColor: "#F0F3F8", borderWidth: StyleSheet.hairlineWidth, borderColor: "#E3E3E3", shadowOpacity: 0, elevation: 0 },
  servicePillNeutral: { backgroundColor: "#F0F3F8", shadowOpacity: 0, elevation: 0 },
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

  loadingState: { alignItems: "center", paddingVertical: 32, gap: 8 },
  loadingText: { color: "#667085", fontSize: 12 },
  empty: { alignItems: "center", paddingHorizontal: 24, paddingVertical: 24 },
  emptyIcon: { width: 60, height: 60, borderRadius: 14, backgroundColor: "#F0F3F8", alignItems: "center", justifyContent: "center", marginBottom: 12 },
  emptyTitle: { color: "#111111", fontSize: 14, fontWeight: "600", marginBottom: 4 },
  emptyText: { color: "#667085", fontSize: 12, textAlign: "center", lineHeight: 18 },

  pressed: { opacity: 0.7 },
});
