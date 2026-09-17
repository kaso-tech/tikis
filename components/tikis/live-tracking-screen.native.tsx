import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, Dimensions, Linking, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import MapView, { Marker, Polyline, type Region } from "react-native-maps";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLiveDeliveryPosition } from "@/hooks/use-live-delivery-position";
import { formatDistanceKm } from "@/lib/date-format";
import { formatDeliveryDetailPlace, geodesicDistanceKm, locationTitle } from "@/lib/geo-rules";
import {
  arrivalClockTime,
  buildMilestones,
  deliveryReference,
  describeSignalFreshness,
  formatCountdown,
  trackingStatusLabel,
  type Milestone,
  type SignalFreshness,
} from "@/lib/live-tracking-format";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";
import { useThemeColors } from "@/lib/use-theme-colors";
import type { Delivery, LocationLabel } from "@/shared/tikis-domain";
import { formatMoney } from "@/shared/tikis-domain";

const AVG_SPEED_KMH = 22;

type SheetLevel = "mini" | "mid" | "full";

function estimateEtaMinutes(distanceKm: number): number {
  if (distanceKm <= 0) return 0;
  return Math.max(1, Math.round((distanceKm / AVG_SPEED_KMH) * 60));
}

function regionFromPoints(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): Region {
  const minLat = Math.min(a.latitude, b.latitude);
  const maxLat = Math.max(a.latitude, b.latitude);
  const minLng = Math.min(a.longitude, b.longitude);
  const maxLng = Math.max(a.longitude, b.longitude);
  const midLat = (minLat + maxLat) / 2;
  const midLng = (minLng + maxLng) / 2;
  const latDelta = Math.max(0.02, (maxLat - minLat) * 1.6);
  const lngDelta = Math.max(0.02, (maxLng - minLng) * 1.6);
  return { latitude: midLat, longitude: midLng, latitudeDelta: latDelta, longitudeDelta: lngDelta };
}

function regionFromSinglePoint(point: { latitude: number; longitude: number }): Region {
  return { latitude: point.latitude, longitude: point.longitude, latitudeDelta: 0.04, longitudeDelta: 0.04 };
}

function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

/** Une horloge qui avance, cantonnée aux composants qui en ont besoin : faire
 *  battre la racine à la seconde re-rendrait la carte pour rien. */
function useNowTicker(intervalMs: number, enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, enabled]);
  return now;
}

/** La pastille du haut porte l'âge réel du dernier point GPS. « En direct » figé
 *  pendant dix minutes est un mensonge ; au-delà d'une minute elle le dit. */
function SignalPill({ recordedAt, isTracking, theme }: { recordedAt: string | null; isTracking: boolean; theme: ReturnType<typeof useThemeColors>["colors"] }) {
  const now = useNowTicker(1_000, isTracking);
  const freshness: SignalFreshness = describeSignalFreshness(isTracking ? recordedAt : null, now);
  const tone = freshness.state === "live" ? theme.success : freshness.state === "weak" ? theme.warning : theme.muted;
  return (
    <View style={[styles.signalPill, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={[styles.signalDot, { backgroundColor: tone }]} />
      <Text style={[styles.signalLabel, { color: tone }]}>{freshness.label}</Text>
      {freshness.age ? <Text style={[styles.signalAge, { color: theme.muted }]} numberOfLines={1}>· {freshness.age}</Text> : null}
    </View>
  );
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function LiveTrackingTikisScreen() {
  const { isDark, colors: theme } = useThemeColors();
  const router = useRouter();
  const { profile } = useTikisStore();
  const deliveriesQuery = trpc.deliveries.list.useQuery(undefined, {
    enabled: Boolean(profile?.phone),
    refetchInterval: 15_000,
  });

  const activeDeliveries = useMemo(() => (deliveriesQuery.data ?? []).filter((d) => d.status === "active"), [deliveriesQuery.data]);
  const pendingDeliveries = useMemo(() => (deliveriesQuery.data ?? []).filter((d) => d.status === "pending_confirmation"), [deliveriesQuery.data]);
  const todayDeliveries = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return (deliveriesQuery.data ?? []).filter((d) => {
      if (!d.createdAt) return false;
      const t = new Date(d.createdAt).getTime();
      return t >= start.getTime() && (d.status === "completed" || d.status === "active" || d.status === "pending_confirmation");
    });
  }, [deliveriesQuery.data]);

  const tracked = useMemo(() => activeDeliveries[0] ?? pendingDeliveries[0] ?? null, [activeDeliveries, pendingDeliveries]);

  if (!profile) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
        <View style={styles.empty}>
          <ActivityIndicator color={theme.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (deliveriesQuery.isLoading) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
        <View style={styles.empty}>
          <ActivityIndicator color={theme.primary} />
          <Text style={[styles.emptyText, { color: theme.muted }]}>Chargement des livraisons…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!tracked) {
    return <EmptyState theme={theme} onCreate={() => router.push("/(tabs)/" as any)} />;
  }

  return (
    <LiveTrackingFocus
      key={tracked.id}
      delivery={tracked}
      activeDeliveries={activeDeliveries}
      pendingDeliveries={pendingDeliveries}
      todayDeliveries={todayDeliveries}
      theme={theme}
      isDark={isDark}
      onBack={() => router.back()}
      onReport={(deliveryId) => router.push(`/report/${deliveryId}` as never)}
    />
  );
}

function EmptyState({ theme, onCreate }: { theme: ReturnType<typeof useThemeColors>["colors"]; onCreate: () => void }) {
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={styles.emptyContent} showsVerticalScrollIndicator={false}>
        <View style={[styles.emptyCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={[styles.emptyIcon, { backgroundColor: theme.background }]}>
            <MaterialIcons name="local-shipping" size={28} color={theme.primary} />
          </View>
          <Text style={[styles.emptyTitle, { color: theme.foreground }]}>Aucune livraison à suivre</Text>
          <Text style={[styles.emptyText, { color: theme.muted }]}>
            Dès qu'un livreur prend en charge l'une de vos courses, sa position s'affichera ici en direct.
          </Text>
          <Pressable
            onPress={onCreate}
            style={({ pressed }) => [styles.cta, { backgroundColor: theme.primary }, pressed && { opacity: 0.85 }]}
          >
            <MaterialIcons name="add" size={18} color="#FFFFFF" />
            <Text style={styles.ctaText}>Créer une livraison</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function LiveTrackingFocus({
  delivery,
  activeDeliveries,
  pendingDeliveries,
  todayDeliveries,
  theme,
  isDark,
  onBack,
  onReport,
}: {
  delivery: Delivery;
  activeDeliveries: Delivery[];
  pendingDeliveries: Delivery[];
  todayDeliveries: Delivery[];
  theme: ReturnType<typeof useThemeColors>["colors"];
  isDark: boolean;
  onBack: () => void;
  onReport: (deliveryId: string) => void;
}) {
  const mapRef = useRef<MapView | null>(null);
  // Le palier vit ici parce que le bouton de recentrage doit rester au-dessus du
  // sheet : en bas fixe, il disparaissait derrière le palier déployé.
  const [sheetLevel, setSheetLevel] = useState<SheetLevel>("mid");
  const liveDeliveryId = delivery.status === "active" ? delivery.id : null;
  const driverPosition = useLiveDeliveryPosition(liveDeliveryId, delivery.status === "active");
  const driverStatsQuery = trpc.deliveries.driverStats.useQuery(
    { driverPhone: delivery.driverPhone ?? "" },
    { enabled: Boolean(delivery.driverPhone), refetchInterval: 60_000 },
  );
  const dropoff = formatDeliveryDetailPlace(delivery.dropoff);
  const pickup = formatDeliveryDetailPlace(delivery.pickup);

  const driverCoord = driverPosition
    ? { latitude: driverPosition.latitude, longitude: driverPosition.longitude }
    : null;
  const pickupCoord = delivery.pickup.latitude && delivery.pickup.longitude
    ? { latitude: delivery.pickup.latitude, longitude: delivery.pickup.longitude }
    : null;
  const dropoffCoord = delivery.dropoff.latitude && delivery.dropoff.longitude
    ? { latitude: delivery.dropoff.latitude, longitude: delivery.dropoff.longitude }
    : null;

  const region = useMemo<Region | null>(() => {
    if (driverCoord && pickupCoord) return regionFromPoints(driverCoord, pickupCoord);
    if (driverCoord) return regionFromSinglePoint(driverCoord);
    if (pickupCoord && dropoffCoord) return regionFromPoints(pickupCoord, dropoffCoord);
    if (pickupCoord) return regionFromSinglePoint(pickupCoord);
    return null;
  }, [driverCoord?.latitude, driverCoord?.longitude, pickupCoord?.latitude, pickupCoord?.longitude, dropoffCoord?.latitude, dropoffCoord?.longitude]);

  useEffect(() => {
    if (!region || !mapRef.current) return;
    try { mapRef.current.animateToRegion(region, 500); } catch { /* map not ready */ }
  }, [region?.latitude, region?.longitude, region?.latitudeDelta, region?.longitudeDelta]);

  const mapStyle = isDark ? MAP_STYLE_DARK : undefined;

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <View style={styles.mapLayer}>
        {region ? (
          <MapView
            ref={(ref) => { mapRef.current = ref; }}
            style={StyleSheet.absoluteFill}
            initialRegion={region}
            showsCompass={false}
            rotateEnabled={false}
            toolbarEnabled={false}
            showsUserLocation={false}
            showsMyLocationButton={false}
            customMapStyle={mapStyle}
            zoomEnabled
            scrollEnabled
          >
            {pickupCoord ? (
              <Marker coordinate={pickupCoord} title="Point de collecte" description={pickup.title}>
                <View style={[styles.markerPickup, { backgroundColor: theme.foreground, borderColor: theme.background }]}>
                  <Text style={[styles.markerLetter, { color: theme.background }]}>A</Text>
                </View>
              </Marker>
            ) : null}
            {dropoffCoord ? (
              <Marker coordinate={dropoffCoord} title="Destination" description={dropoff.title}>
                <View style={[styles.markerDropoff, { backgroundColor: theme.foreground, borderColor: theme.background }]}>
                  <Text style={[styles.markerLetter, { color: theme.background }]}>B</Text>
                </View>
              </Marker>
            ) : null}
            {driverCoord ? (
              <Marker coordinate={driverCoord} title={delivery.driverName ?? "Livreur"} anchor={{ x: 0.5, y: 0.5 }}>
                <View style={[styles.markerDriver, { backgroundColor: theme.primary, borderColor: theme.background }]}>
                  <MaterialIcons name="two-wheeler" size={20} color="#FFFFFF" />
                </View>
              </Marker>
            ) : null}
            {/* La course à venir : volontairement en retrait, elle ne bouge pas. */}
            {pickupCoord && dropoffCoord ? (
              <Polyline
                coordinates={[pickupCoord, dropoffCoord]}
                strokeColor={theme.primary}
                strokeWidth={3}
                lineDashPattern={[2, 9]}
              />
            ) : null}
            {/* Le segment d'approche : c'est ce qui bouge maintenant, donc il domine. */}
            {driverCoord && pickupCoord ? (
              <Polyline
                coordinates={[driverCoord, pickupCoord]}
                strokeColor={theme.success}
                strokeWidth={4}
              />
            ) : null}
          </MapView>
        ) : (
          <View style={[styles.mapPlaceholder, { backgroundColor: theme.surface }]}>
            <MaterialIcons name="map" size={42} color={theme.muted} />
            <Text style={[styles.mapPlaceholderText, { color: theme.muted }]}>Coordonnées GPS indisponibles</Text>
          </View>
        )}

        {/* Top bar floating */}
        <SafeAreaView edges={["top"]} style={styles.topBar} pointerEvents="box-none">
          <View style={styles.topBarInner}>
            <Pressable
              onPress={onBack}
              accessibilityRole="button"
              accessibilityLabel="Retour"
              style={({ pressed }) => [styles.topBtn, { backgroundColor: theme.surface, borderColor: theme.border }, pressed && { opacity: 0.7 }]}
            >
              <MaterialIcons name="arrow-back" size={20} color={theme.foreground} />
            </Pressable>
            <View style={styles.topBarCenter} pointerEvents="box-none">
              <SignalPill recordedAt={driverPosition?.recordedAt ?? null} isTracking={delivery.status === "active"} theme={theme} />
            </View>
            <Pressable
              onPress={() => { void Linking.openURL("https://maps.google.com/?q=" + (pickupCoord ? `${pickupCoord.latitude},${pickupCoord.longitude}` : "")); }}
              accessibilityRole="button"
              accessibilityLabel="Ouvrir dans Maps"
              style={({ pressed }) => [styles.topBtn, { backgroundColor: theme.surface, borderColor: theme.border }, pressed && { opacity: 0.7 }]}
            >
              <MaterialIcons name="open-in-new" size={18} color={theme.foreground} />
            </Pressable>
          </View>
        </SafeAreaView>

        {/* FAB centrer sur moi */}
        <View style={[styles.fabStack, { bottom: Math.min(sheetHeightFor(sheetLevel) + 16, SCREEN_HEIGHT - 160) }]} pointerEvents="box-none">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Centrer la carte"
            onPress={() => {
              if (!region || !mapRef.current) return;
              try { mapRef.current.animateToRegion(region, 300); } catch { /* map not ready */ }
            }}
            style={({ pressed }) => [styles.fab, { backgroundColor: theme.surface, borderColor: theme.border }, pressed && { opacity: 0.7 }]}
          >
            <MaterialIcons name="my-location" size={18} color={theme.foreground} />
          </Pressable>
        </View>
      </View>

      {/* Draggable sheet */}
      <DraggableSheet
        tracked={delivery}
        activeDeliveries={activeDeliveries}
        pendingDeliveries={pendingDeliveries}
        todayDeliveries={todayDeliveries}
        driverPosition={driverPosition}
        driverStats={driverStatsQuery.data ?? null}
        theme={theme}
        sheetLevel={sheetLevel}
        onSheetLevelChange={setSheetLevel}
        onReport={onReport}
      />
    </View>
  );
}

type DriverStats = { rating: number; completedDeliveries: number; reviewsCount: number };

type DeliveryLite = {
  id: string;
  title: string;
  type: Delivery["type"];
  pickup: Delivery["pickup"];
  dropoff: Delivery["dropoff"];
  status: Delivery["status"];
  distanceKm: number;
  estimatedPrice: number;
  offeredPrice?: number;
  driverName?: string;
  driverPhone?: string;
  vehicleTypes?: Delivery["vehicleTypes"];
  createdAt: string;
};

function isLiveStatus(s: Delivery["status"]): boolean {
  return s === "active" || s === "pending_confirmation";
}

/** Ce qui reste à parcourir jusqu'au prochain point : la récupération tant que
 *  le livreur y va, la destination ensuite. `null` tant qu'aucune position n'est
 *  arrivée — une distance inventée vaut moins que pas de distance du tout. */
function getRemainingKm(d: DeliveryLite, driverCoord: { latitude: number; longitude: number } | null): number | null {
  const target = d.status === "active" ? d.pickup : d.dropoff;
  if (!driverCoord || !target?.latitude || !target?.longitude) return null;
  return geodesicDistanceKm(driverCoord, { latitude: target.latitude, longitude: target.longitude });
}

function getDeliveryEtaMinutes(d: DeliveryLite, driverCoord: { latitude: number; longitude: number } | null): number {
  const remaining = getRemainingKm(d, driverCoord);
  return remaining === null ? 0 : estimateEtaMinutes(remaining);
}

function DraggableSheet({
  tracked,
  activeDeliveries,
  pendingDeliveries,
  todayDeliveries,
  driverPosition,
  driverStats,
  theme,
  sheetLevel,
  onSheetLevelChange,
  onReport,
}: {
  tracked: Delivery;
  activeDeliveries: Delivery[];
  pendingDeliveries: Delivery[];
  todayDeliveries: Delivery[];
  driverPosition: { latitude: number; longitude: number; heading: number; recordedAt: string } | null;
  driverStats: DriverStats | null;
  theme: ReturnType<typeof useThemeColors>["colors"];
  sheetLevel: SheetLevel;
  onSheetLevelChange: (level: SheetLevel) => void;
  onReport: (deliveryId: string) => void;
}) {
  const [tab, setTab] = useState<"active" | "waiting" | "today">("active");
  const [selectedDeliveryId, setSelectedDeliveryId] = useState<string>(tracked.id);

  // Mutation pour annuler la delivery sélectionnée (utilise le tRPC sender.disable)
  const utils = trpc.useUtils();
  const cancelMutation = trpc.deliveries.disable.useMutation({
    onSuccess: () => {
      void utils.deliveries.list.invalidate();
    },
  });

  // Vue sélectionnée : la delivery choisie dans la liste (ou la tracked par défaut)
  const driverCoord = driverPosition ? { latitude: driverPosition.latitude, longitude: driverPosition.longitude } : null;

  const visibleDeliveries: Delivery[] = useMemo(() => {
    if (tab === "active") return activeDeliveries;
    if (tab === "waiting") return pendingDeliveries;
    return todayDeliveries;
  }, [tab, activeDeliveries, pendingDeliveries, todayDeliveries]);

  const selectedDelivery: Delivery | undefined = useMemo(() => {
    if (selectedDeliveryId && visibleDeliveries.some((d) => d.id === selectedDeliveryId)) {
      return visibleDeliveries.find((d) => d.id === selectedDeliveryId);
    }
    return visibleDeliveries[0] ?? tracked;
  }, [selectedDeliveryId, visibleDeliveries, tracked]);

  // === SHEET DRAG (height n'est pas animable sur UI thread — useNativeDriver: false est OK ici) ===
  const panY = useRef(new Animated.Value(0)).current;
  const sheetBaseHeight = useRef(new Animated.Value(sheetHeightFor(sheetLevel))).current;
  const dragState = useRef<{ active: boolean }>({ active: false });

  useEffect(() => {
    Animated.timing(sheetBaseHeight, {
      toValue: sheetHeightFor(sheetLevel),
      duration: 220,
      useNativeDriver: false,
    }).start();
  }, [sheetLevel, sheetBaseHeight]);

  // Reset panY quand le sheetLevel change (évite l'accumulation)
  useEffect(() => {
    panY.setValue(0);
  }, [sheetLevel, panY]);

  // Le PanResponder n'est construit qu'une fois : il capture la valeur de
  // `sheetLevel` du premier rendu. Sans ce miroir il croit toujours être au
  // palier intermédiaire, et un glissement vers le bas depuis le palier déployé
  // saute directement au palier replié.
  const sheetLevelRef = useRef(sheetLevel);
  sheetLevelRef.current = sheetLevel;
  const onSheetLevelChangeRef = useRef(onSheetLevelChange);
  onSheetLevelChangeRef.current = onSheetLevelChange;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dy) > 4,
      onPanResponderGrant: () => {
        dragState.current.active = true;
      },
      onPanResponderMove: (_, gestureState) => {
        if (!dragState.current.active) return;
        // Clamp entre -50 et +50 par rapport à la base pour éviter le drift
        const clamped = Math.max(-50, Math.min(50, gestureState.dy));
        panY.setValue(clamped);
      },
      onPanResponderRelease: (_, gestureState) => {
        dragState.current.active = false;
        const dy = gestureState.dy;
        const vY = gestureState.vy;
        // Velocity-based : swipe rapide = change d'état même avec un petit dy
        const level = sheetLevelRef.current;
        const fastSwipeUp = vY < -0.5 && level !== "full";
        const fastSwipeDown = vY > 0.5 && level !== "mini";
        if ((dy < -30 || fastSwipeUp) && level === "mini") onSheetLevelChangeRef.current("mid");
        else if ((dy < -30 || fastSwipeUp) && level === "mid") onSheetLevelChangeRef.current("full");
        else if ((dy > 30 || fastSwipeDown) && level === "full") onSheetLevelChangeRef.current("mid");
        else if ((dy > 30 || fastSwipeDown) && level === "mid") onSheetLevelChangeRef.current("mini");
        Animated.timing(panY, { toValue: 0, duration: 200, useNativeDriver: false }).start();
      },
      onPanResponderTerminate: () => {
        dragState.current.active = false;
        Animated.timing(panY, { toValue: 0, duration: 200, useNativeDriver: false }).start();
      },
    }),
  ).current;

  const finalHeight = Animated.add(sheetBaseHeight, panY);

  // Calculs dynamiques sur la delivery sélectionnée
  const selectedPickup = selectedDelivery ? formatDeliveryDetailPlace(selectedDelivery.pickup) : null;
  const selectedDropoff = selectedDelivery ? formatDeliveryDetailPlace(selectedDelivery.dropoff) : null;
  const selectedEtaMinutes = selectedDelivery ? getDeliveryEtaMinutes(selectedDelivery, driverCoord) : 0;
  const selectedIsLive = selectedDelivery ? (selectedDelivery.status === "active" && Boolean(driverCoord)) : false;

  const selectedRemainingKm = selectedDelivery ? getRemainingKm(selectedDelivery, driverCoord) : null;
  const statusLabel = selectedDelivery
    ? trackingStatusLabel(selectedDelivery.status, Boolean(selectedDelivery.driverName))
    : "AUCUNE COURSE SÉLECTIONNÉE";
  const milestones = useMemo<Milestone[]>(() => (selectedDelivery ? buildMilestones(selectedDelivery) : []), [selectedDelivery]);

  // L'heure d'arrivée se recalcule à la minute : la faire battre à la seconde
  // ferait clignoter un chiffre qui ne change pas.
  const nowMs = useNowTicker(30_000, selectedIsLive);
  const arrivalClock = selectedIsLive ? arrivalClockTime(selectedEtaMinutes, nowMs) : null;
  const countdown = selectedIsLive ? formatCountdown(selectedEtaMinutes) : null;
  const remainingDistance = selectedRemainingKm !== null ? formatDistanceKm(selectedRemainingKm) : null;

  /** Quand l'heure d'arrivée n'existe pas, on dit pourquoi plutôt que d'afficher
   *  un tiret : « pas encore de position » n'est pas une panne, c'est l'état le
   *  plus fréquent en début de course. */
  const notice: { tone: "info" | "warning" | "success"; icon: React.ComponentProps<typeof MaterialIcons>["name"]; text: string; short: string } | null = (() => {
    if (!selectedDelivery) return { tone: "info", icon: "inbox", text: "Aucune course sélectionnée.", short: "Aucune course" };
    if (selectedIsLive) return null;
    if (selectedDelivery.status === "active") {
      return {
        tone: "info",
        icon: "sensors-off",
        text: "Le téléphone du livreur n'a pas encore transmis sa position. Le trajet reste affiché : l'heure d'arrivée apparaîtra dès le premier point reçu.",
        short: "Position en attente",
      };
    }
    if (selectedDelivery.status === "pending_confirmation") {
      return {
        tone: "warning",
        icon: "hourglass-empty",
        text: `${selectedDelivery.driverName ?? "Le livreur"} doit confirmer sa disponibilité. Vous pouvez encore annuler le choix sans frais.`,
        short: "En attente de confirmation",
      };
    }
    if (selectedDelivery.status === "completed") {
      const delivered = milestones.find((m) => m.key === "completed")?.time;
      return {
        tone: "success",
        icon: "check-circle",
        text: delivered ? `Livrée à ${delivered}.` : "Course livrée.",
        short: delivered ? `Livrée à ${delivered}` : "Livrée",
      };
    }
    return { tone: "info", icon: "schedule", text: "Le suivi en direct démarrera dès qu'un livreur aura confirmé la course.", short: "Suivi pas encore démarré" };
  })();

  return (
    <Animated.View
      style={[
        styles.sheetWrap,
        { height: finalHeight, backgroundColor: theme.surface, borderColor: theme.border },
      ]}
    >
      <SafeAreaView edges={["bottom"]} style={styles.sheetSafe}>
        <View {...panResponder.panHandlers} style={styles.dragZone}>
          <View style={[styles.sheetHandle, { backgroundColor: theme.border }]} />
        </View>

        {/* Palier replié : l'heure d'arrivée et l'appel, rien d'autre. Un palier
            ne doit jamais cacher ce dont on a besoin au palier précédent. */}
        {sheetLevel === "mini" && selectedDelivery ? (
          <View style={styles.miniBar}>
            <View style={styles.miniFigures}>
              {arrivalClock ? (
                <>
                  <Text style={[styles.miniClock, { color: theme.foreground }]}>{arrivalClock}</Text>
                  <Text style={[styles.miniSub, { color: theme.muted }]} numberOfLines={1}>
                    {[countdown, remainingDistance ? `${remainingDistance.value} ${remainingDistance.unit}` : null].filter(Boolean).join(" · ")}
                  </Text>
                </>
              ) : (
                <>
                  <Text style={[styles.miniStatus, { color: theme.foreground }]} numberOfLines={1}>{notice?.short ?? statusLabel}</Text>
                  <Text style={[styles.miniSub, { color: theme.muted }]} numberOfLines={1}>
                    {`${formatDistance(selectedDelivery.distanceKm)} · ${formatMoney(selectedDelivery.offeredPrice ?? selectedDelivery.estimatedPrice)}`}
                  </Text>
                </>
              )}
            </View>
            {selectedDelivery.driverName ? (
              <View style={styles.miniDriver}>
                <Text style={[styles.miniDriverName, { color: theme.muted }]} numberOfLines={1}>{selectedDelivery.driverName}</Text>
                {selectedDelivery.driverPhone ? (
                  <Pressable
                    onPress={() => { void Linking.openURL(`tel:${selectedDelivery!.driverPhone}`); }}
                    accessibilityRole="button"
                    accessibilityLabel={`Appeler ${selectedDelivery.driverName}`}
                    style={({ pressed }) => [styles.driverAction, { backgroundColor: theme.success, borderColor: theme.success }, pressed && { opacity: 0.85 }]}
                  >
                    <MaterialIcons name="call" size={16} color="#FFFFFF" />
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}

        {sheetLevel === "mini" ? null : (
          <>
            {/* Sheet tabs (Active / En attente / Aujourd'hui) */}
            <View style={[styles.sheetTabs, { backgroundColor: theme.background }]}>
              <Pressable
                onPress={() => { setTab("active"); setSelectedDeliveryId(activeDeliveries[0]?.id ?? tracked.id); }}
                style={[styles.sheetTab, tab === "active" && { backgroundColor: theme.surface }]}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === "active" }}
              >
                <Text style={[styles.sheetTabText, { color: tab === "active" ? theme.primary : theme.muted }]}>
                  Actives{tab === "active" ? ` ${activeDeliveries.length}` : ""}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => { setTab("waiting"); setSelectedDeliveryId(pendingDeliveries[0]?.id ?? tracked.id); }}
                style={[styles.sheetTab, tab === "waiting" && { backgroundColor: theme.surface }]}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === "waiting" }}
              >
                <Text style={[styles.sheetTabText, { color: tab === "waiting" ? theme.primary : theme.muted }]}>
                  En attente{tab === "waiting" ? ` ${pendingDeliveries.length}` : ""}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setTab("today")}
                style={[styles.sheetTab, tab === "today" && { backgroundColor: theme.surface }]}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === "today" }}
              >
                <Text style={[styles.sheetTabText, { color: tab === "today" ? theme.primary : theme.muted }]}>Aujourd'hui</Text>
              </Pressable>
            </View>

            <ScrollView
              style={styles.sheetScroll}
              contentContainerStyle={styles.sheetContent}
              showsVerticalScrollIndicator={false}
            >
              {/* Ce que porte le sheet dès le palier intermédiaire : l'heure d'arrivée,
                  les jalons horodatés, le livreur. Rien de tout cela n'est caché à
                  un palier qu'on doit d'abord déplier. */}
              {selectedDelivery ? (
                <View style={styles.statusBlock}>
                  <View style={styles.statusHeader}>
                    <Text style={[styles.statusLabel, { color: theme.primary }]} numberOfLines={1}>{statusLabel}</Text>
                    <Text style={[styles.statusVehicle, { color: theme.muted }]} numberOfLines={1}>
                      {(selectedDelivery.vehicleTypes ?? []).join(" · ").toUpperCase() || "MOTO"}
                    </Text>
                  </View>

                  {arrivalClock ? (
                    <View style={styles.statusFigures}>
                      <View style={styles.statusFigureMain}>
                        <Text style={[styles.statusCaption, { color: theme.muted }]}>Arrivée estimée</Text>
                        <Text style={[styles.statusClock, { color: theme.foreground }]}>{arrivalClock}</Text>
                        {countdown ? <Text style={[styles.statusCountdown, { color: theme.muted }]}>{countdown}</Text> : null}
                      </View>
                      {remainingDistance ? (
                        <View style={styles.statusFigureSide}>
                          <Text style={[styles.statusDistance, { color: theme.foreground }]}>
                            {remainingDistance.value} {remainingDistance.unit}
                          </Text>
                          <Text style={[styles.statusCaption, { color: theme.muted }]}>Restants</Text>
                        </View>
                      ) : null}
                    </View>
                  ) : null}

                  {notice ? (
                    <View
                      style={[
                        styles.notice,
                        {
                          backgroundColor: theme.background,
                          borderColor: notice.tone === "warning" ? theme.warning : notice.tone === "success" ? theme.success : theme.border,
                        },
                      ]}
                    >
                      <MaterialIcons
                        name={notice.icon}
                        size={16}
                        color={notice.tone === "warning" ? theme.warning : notice.tone === "success" ? theme.success : theme.muted}
                      />
                      <Text style={[styles.noticeText, { color: theme.muted }]}>{notice.text}</Text>
                    </View>
                  ) : null}
                </View>
              ) : null}

              {/* Frise des jalons — chacun avec l'heure à laquelle il s'est produit. */}
              {selectedDelivery ? (
                <View style={styles.trackTimeline}>
                  {milestones.map((milestone, index) => (
                    <TrackStep
                      key={milestone.key}
                      milestone={milestone}
                      theme={theme}
                      last={index === milestones.length - 1}
                    />
                  ))}
                </View>
              ) : null}

              {/* Le livreur, et l'appel juste à côté : c'est l'action qu'on cherche
                  quand quelque chose cloche pendant une course. */}
              {selectedDelivery?.driverName ? (
                <View style={[styles.driverCard, { backgroundColor: theme.background, borderColor: theme.border }]}>
                  <View style={[styles.trackAvatar, { backgroundColor: theme.primary }]}>
                    <Text style={[styles.trackAvatarText, { color: theme.surface }]}>{getInitials(selectedDelivery.driverName)}</Text>
                  </View>
                  <View style={styles.driverIdentity}>
                    <Text style={[styles.trackDriverName, { color: theme.foreground }]} numberOfLines={1}>{selectedDelivery.driverName}</Text>
                    <Text style={[styles.trackDriverMeta, { color: theme.muted }]} numberOfLines={1}>
                      {driverStats && driverStats.reviewsCount > 0
                        ? `★ ${driverStats.rating.toFixed(1).replace(".", ",")} · ${driverStats.completedDeliveries} course${driverStats.completedDeliveries > 1 ? "s" : ""}`
                        : "Premières courses sur Tikis"}
                    </Text>
                  </View>
                  {selectedDelivery.driverPhone ? (
                    <Pressable
                      onPress={() => { void Linking.openURL(`sms:${selectedDelivery!.driverPhone}`); }}
                      accessibilityRole="button"
                      accessibilityLabel={`Envoyer un message à ${selectedDelivery.driverName}`}
                      style={({ pressed }) => [styles.driverAction, { backgroundColor: theme.surface, borderColor: theme.border }, pressed && { opacity: 0.7 }]}
                    >
                      <MaterialIcons name="chat-bubble-outline" size={16} color={theme.foreground} />
                    </Pressable>
                  ) : null}
                  {selectedDelivery.driverPhone ? (
                    <Pressable
                      onPress={() => { void Linking.openURL(`tel:${selectedDelivery!.driverPhone}`); }}
                      accessibilityRole="button"
                      accessibilityLabel={`Appeler ${selectedDelivery.driverName}`}
                      style={({ pressed }) => [styles.driverAction, { backgroundColor: theme.success, borderColor: theme.success }, pressed && { opacity: 0.85 }]}
                    >
                      <MaterialIcons name="call" size={16} color="#FFFFFF" />
                    </Pressable>
                  ) : null}
                </View>
              ) : null}

              {/* Trip info (only full) */}
              {sheetLevel === "full" && selectedDelivery && selectedPickup && selectedDropoff ? (
                <View style={styles.tripInfo}>
                  <View style={styles.tripRow}>
                    <View style={[styles.tripDot, { backgroundColor: theme.primary }]} />
                    <View style={styles.tripText}>
                      <Text style={[styles.tripLabel, { color: theme.muted }]}>Récupération</Text>
                      <Text style={[styles.tripValue, { color: theme.foreground }]} numberOfLines={1}>{selectedPickup.title}</Text>
                      <Text style={[styles.tripAddress, { color: theme.muted }]} numberOfLines={1}>{locationTitle(selectedDelivery.pickup as LocationLabel)}</Text>
                    </View>
                  </View>
                  <View style={[styles.tripRail, { backgroundColor: theme.border }]} />
                  <View style={styles.tripRow}>
                    <View style={[styles.tripDot, { backgroundColor: theme.error }]} />
                    <View style={styles.tripText}>
                      <Text style={[styles.tripLabel, { color: theme.muted }]}>Destination</Text>
                      <Text style={[styles.tripValue, { color: theme.foreground }]} numberOfLines={1}>{selectedDropoff.title}</Text>
                      <Text style={[styles.tripAddress, { color: theme.muted }]} numberOfLines={1}>{locationTitle(selectedDelivery.dropoff as LocationLabel)}</Text>
                    </View>
                  </View>
                </View>
              ) : null}

              {/* Montant, type et référence : ce qu'on cherche une fois, pas ce qu'on
                  regarde pendant la course. Donc au palier déployé seulement. */}
              {sheetLevel === "full" && selectedDelivery ? (
                <>
                  <View style={styles.facts}>
                    <View style={[styles.fact, { backgroundColor: theme.background, borderColor: theme.border }]}>
                      <Text style={[styles.factLabel, { color: theme.muted }]}>Montant</Text>
                      <Text style={[styles.factValue, { color: theme.foreground }]}>{formatMoney(selectedDelivery.offeredPrice ?? selectedDelivery.estimatedPrice)}</Text>
                    </View>
                    <View style={[styles.fact, { backgroundColor: theme.background, borderColor: theme.border }]}>
                      <Text style={[styles.factLabel, { color: theme.muted }]}>Trajet</Text>
                      <Text style={[styles.factValue, { color: theme.foreground }]}>{formatDistance(selectedDelivery.distanceKm)}</Text>
                    </View>
                    <View style={[styles.fact, styles.factWide, { backgroundColor: theme.background, borderColor: theme.border }]}>
                      <Text style={[styles.factLabel, { color: theme.muted }]}>Référence</Text>
                      <Text style={[styles.factValue, { color: theme.foreground }]}>{deliveryReference(selectedDelivery.id)}</Text>
                    </View>
                  </View>
                  <Text style={[styles.paymentNote, { color: theme.muted }]}>
                    Vous réglerez directement le livreur à la remise. Tikis ne prélève rien sur ce montant.
                  </Text>
                </>
              ) : null}

              {/* Les autres courses, sous la course suivie : les onglets du haut les
                  filtrent, et choisir une carte change ce que montre tout le reste du
                  sheet. Ce qui se passe maintenant passe avant la liste. */}
              {visibleDeliveries.length > 0 ? <View style={[styles.listDivider, { backgroundColor: theme.border }]} /> : null}
              {visibleDeliveries.map((d) => {
                const type = (d.type ?? "Plis").toLowerCase();
                const iconName: React.ComponentProps<typeof MaterialIcons>["name"] =
                  type === "personne" ? "person" : type === "autre" ? "inventory-2" : "local-shipping";
                const dPickup = formatDeliveryDetailPlace(d.pickup);
                const dDropoff = formatDeliveryDetailPlace(d.dropoff);
                const dEta = getDeliveryEtaMinutes(d, driverCoord);
                const dIsLive = d.status === "active" && Boolean(driverCoord);
                const isSelected = d.id === selectedDelivery?.id;
                return (
                  <Pressable
                    key={d.id}
                    onPress={() => setSelectedDeliveryId(d.id)}
                    style={[
                      styles.deliveryCard,
                      { backgroundColor: isSelected ? theme.background : theme.background, borderColor: isSelected ? theme.primary : "transparent" },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`Sélectionner ${d.title ?? d.type}`}
                  >
                    <View style={[styles.deliveryThumb, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                      <MaterialIcons name={iconName} size={18} color={theme.foreground} />
                      {dIsLive ? <View style={[styles.deliveryLiveDot, { backgroundColor: theme.success, borderColor: theme.surface }]} /> : null}
                    </View>
                    <View style={styles.deliveryInfo}>
                      <Text style={[styles.deliveryTitle, { color: theme.foreground }]} numberOfLines={1}>{d.title ?? d.type}</Text>
                      <Text style={[styles.deliveryRoute, { color: theme.muted }]} numberOfLines={1}>
                        {dPickup.title} → {dDropoff.title}
                      </Text>
                    </View>
                    <View style={styles.deliveryEta}>
                      <Text style={[styles.deliveryEtaTime, { color: theme.foreground }]}>
                        {dIsLive && dEta > 0 ? `${dEta} min` : "—"}
                      </Text>
                      <Text style={[styles.deliveryEtaLabel, { color: theme.muted }]}>
                        {dIsLive && dEta > 0 ? "ETA" : isLiveStatus(d.status) ? "attente" : "—"}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}

              {visibleDeliveries.length === 0 ? (
                <View style={[styles.emptyTab, { backgroundColor: theme.background }]}>
                  <MaterialIcons name="inbox" size={20} color={theme.muted} />
                  <Text style={[styles.emptyTabText, { color: theme.muted }]}>Aucune livraison dans cette catégorie.</Text>
                </View>
              ) : null}
            </ScrollView>

            {/* Actions de bas de sheet : ce qui ne concerne pas le livreur lui-même.
                L'appel et le message sont sur sa carte, là où on les cherche. */}
            <View style={[styles.sheetActions, { borderTopColor: theme.border }]}>
              <Pressable
                onPress={() => {
                  if (!selectedDelivery) return;
                  cancelMutation.mutate({ deliveryId: selectedDelivery.id });
                }}
                disabled={!selectedDelivery || !selectedDelivery.senderPhone || cancelMutation.isPending}
                accessibilityRole="button"
                accessibilityLabel="Annuler la course"
                style={({ pressed }) => [styles.sheetBtn, { backgroundColor: theme.surface, borderColor: theme.error }, pressed && { opacity: 0.7 }]}
              >
                {cancelMutation.isPending ? (
                  <ActivityIndicator size="small" color={theme.error} />
                ) : (
                  <>
                    <MaterialIcons name="delete-outline" size={14} color={theme.error} />
                    <Text style={[styles.sheetBtnText, { color: theme.error }]}>Annuler</Text>
                  </>
                )}
              </Pressable>
              <Pressable
                onPress={() => { if (selectedDelivery) onReport(selectedDelivery.id); }}
                disabled={!selectedDelivery}
                accessibilityRole="button"
                accessibilityLabel="Signaler un problème"
                style={({ pressed }) => [styles.sheetBtn, { backgroundColor: theme.surface, borderColor: theme.border }, pressed && { opacity: 0.7 }]}
              >
                <MaterialIcons name="flag" size={14} color={theme.foreground} />
                <Text style={[styles.sheetBtnText, { color: theme.foreground }]}>Signaler</Text>
              </Pressable>
            </View>
          </>
        )}
      </SafeAreaView>
    </Animated.View>
  );
}

function TrackStep({ milestone, theme, last }: { milestone: Milestone; theme: ReturnType<typeof useThemeColors>["colors"]; last?: boolean }) {
  const isDone = milestone.state === "done";
  const isCurrent = milestone.state === "current";
  const reached = isDone || isCurrent;
  return (
    <View style={styles.trackStep}>
      <View
        style={[
          styles.trackStepBullet,
          { backgroundColor: reached ? theme.success : theme.surface, borderColor: reached ? theme.success : theme.border },
          isCurrent && { borderColor: theme.success, borderWidth: 4 },
        ]}
      >
        {isDone ? <MaterialIcons name="check" size={11} color="#FFFFFF" /> : null}
      </View>
      {!last ? <View style={[styles.trackStepLine, { backgroundColor: isDone ? theme.success : theme.border }]} /> : null}
      <Text style={[styles.trackStepLabel, { color: reached ? theme.foreground : theme.muted, fontWeight: isCurrent ? "700" : "600" }]}>
        {milestone.label}
      </Text>
      <Text style={[styles.trackStepTime, { color: theme.muted }]}>{milestone.time ?? "—"}</Text>
    </View>
  );
}

const { height: SCREEN_HEIGHT } = Dimensions.get("window");
const SHEET_MIN_HEIGHT = 110;
const SHEET_MID_HEIGHT = Math.min(380, SCREEN_HEIGHT * 0.45);
const SHEET_FULL_HEIGHT = Math.min(640, SCREEN_HEIGHT * 0.78);

function sheetHeightFor(level: SheetLevel): number {
  return level === "mini" ? SHEET_MIN_HEIGHT : level === "mid" ? SHEET_MID_HEIGHT : SHEET_FULL_HEIGHT;
}

const MAP_STYLE_DARK = [
  { elementType: "geometry", stylers: [{ color: "#1d2c4d" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8ec3b9" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#1a3646" }] },
  { featureType: "administrative.country", elementType: "geometry.stroke", stylers: [{ color: "#4b6878" }] },
  { featureType: "land", elementType: "geometry", stylers: [{ color: "#0e1626" }] },
  { featureType: "poi", elementType: "geometry", stylers: [{ color: "#283d6a" }] },
  { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#6f9ba5" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#304a7d" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#255763" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#2c6675" }] },
  { featureType: "transit", elementType: "labels.text.fill", stylers: [{ color: "#3a4a63" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0e1626" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#4e6d70" }] },
];

const styles = StyleSheet.create({
  safe: { flex: 1 },
  root: { flex: 1 },

  // Map layer
  mapLayer: { flex: 1, position: "relative" },
  mapPlaceholder: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  mapPlaceholderText: { fontSize: 12, fontWeight: "500" },

  // Top bar (style 2: back + tabs + extra)
  topBar: { position: "absolute", top: 0, left: 0, right: 0 },
  topBarInner: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  topBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
  topBarCenter: { flex: 1, alignItems: "center", justifyContent: "center" },
  signalPill: { flexDirection: "row", alignItems: "center", gap: 6, maxWidth: "100%", paddingHorizontal: 12, height: 34, borderRadius: 17, borderWidth: StyleSheet.hairlineWidth },
  signalDot: { width: 7, height: 7, borderRadius: 4, flexShrink: 0 },
  signalLabel: { fontSize: 12.5, fontWeight: "700" },
  signalAge: { fontSize: 11.5, fontWeight: "500", flexShrink: 1 },

  // FAB stack (right side, above sheet)
  fabStack: { position: "absolute", right: 16, gap: 8 },
  fab: { width: 46, height: 46, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },

  // Markers
  markerPickup: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", borderWidth: 3 },
  markerDropoff: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", borderWidth: 3 },
  markerLetter: { fontSize: 14, fontWeight: "700" },
  markerDriver: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", borderWidth: 4 },

  // Draggable sheet
  sheetWrap: { position: "absolute", bottom: 0, left: 0, right: 0, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: StyleSheet.hairlineWidth, borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  sheetSafe: { flex: 1 },
  dragZone: { paddingTop: 10, paddingBottom: 6, alignItems: "center" },
  sheetHandle: { width: 40, height: 4, borderRadius: 2 },

  // Palier replié : une seule ligne, l'essentiel du suivi
  miniBar: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingTop: 2 },
  miniFigures: { flex: 1, minWidth: 0 },
  miniClock: { fontSize: 24, fontWeight: "700", fontVariant: ["tabular-nums"] },
  miniStatus: { fontSize: 13, fontWeight: "700" },
  miniSub: { fontSize: 11.5, marginTop: 2 },
  miniDriver: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0, maxWidth: "45%" },
  miniDriverName: { fontSize: 12, fontWeight: "600", flexShrink: 1 },

  // Sheet tabs
  sheetTabs: { flexDirection: "row", marginHorizontal: 14, marginTop: 4, borderRadius: 10, padding: 3, gap: 2 },
  sheetTab: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center" },
  sheetTabText: { fontSize: 12.5, fontWeight: "600" },

  sheetScroll: { flex: 1, marginTop: 10 },
  sheetContent: { paddingHorizontal: 14, paddingBottom: 8, gap: 8 },

  listDivider: { height: StyleSheet.hairlineWidth, marginTop: 10, marginBottom: 2 },

  // Delivery card (in sheet list)
  deliveryCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 12, borderWidth: 1.5 },
  deliveryThumb: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center", flexShrink: 0, position: "relative", borderWidth: StyleSheet.hairlineWidth },
  deliveryLiveDot: { position: "absolute", top: -2, right: -2, width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
  deliveryInfo: { flex: 1, minWidth: 0 },
  deliveryTitle: { fontSize: 13.5, fontWeight: "600" },
  deliveryRoute: { fontSize: 11.5, marginTop: 2 },
  deliveryEta: { alignItems: "flex-end", flexShrink: 0 },
  deliveryEtaTime: { fontSize: 16, fontWeight: "700", fontVariant: ["tabular-nums"] },
  deliveryEtaLabel: { fontSize: 10.5, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4, marginTop: 1 },

  // Track preview (timeline)
  trackPreview: { padding: 12, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, marginTop: 6 },
  trackPreviewHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 10 },
  trackPreviewLabel: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 },
  trackPreviewDriver: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 },
  trackAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  trackAvatarText: { fontSize: 13, fontWeight: "700" },
  trackDriverName: { fontSize: 14, fontWeight: "700" },
  trackDriverMeta: { fontSize: 11.5, marginTop: 2 },
  trackTimeline: { flexDirection: "row", alignItems: "flex-start", marginTop: 4 },
  trackStep: { flex: 1, alignItems: "center", position: "relative" },
  trackStepBullet: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: "center", justifyContent: "center", marginBottom: 4, zIndex: 1 },
  trackStepLine: { position: "absolute", top: 11, left: "50%", right: "-50%", height: 2 },
  trackStepLabel: { fontSize: 9.5, textAlign: "center", textTransform: "uppercase", letterSpacing: 0.3, fontWeight: "600" },
  trackStepTime: { fontSize: 10.5, marginTop: 2, fontVariant: ["tabular-nums"] },

  // Carte du livreur — l'appel y est l'action verte, la plus haute au pouce.
  driverCard: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, marginTop: 4 },
  driverIdentity: { flex: 1, minWidth: 0 },
  driverAction: { width: 38, height: 38, borderRadius: 19, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center", flexShrink: 0 },

  // Status block (mid + full)
  statusBlock: { paddingTop: 6, gap: 8 },
  statusHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  statusLabel: { flexShrink: 1, fontSize: 10.5, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" },
  statusVehicle: { fontSize: 10.5, fontWeight: "700", letterSpacing: 0.6, flexShrink: 0 },
  statusFigures: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12 },
  statusFigureMain: { flexShrink: 1, minWidth: 0 },
  statusFigureSide: { alignItems: "flex-end", flexShrink: 0 },
  statusCaption: { fontSize: 10, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase" },
  statusClock: { fontSize: 34, fontWeight: "700", lineHeight: 40, fontVariant: ["tabular-nums"] },
  statusCountdown: { fontSize: 12.5 },
  statusDistance: { fontSize: 18, fontWeight: "700", fontVariant: ["tabular-nums"] },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 10, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth },
  noticeText: { flex: 1, fontSize: 11.5, lineHeight: 16 },

  // Trip info (only full state)
  tripInfo: { marginTop: 4, position: "relative" },
  tripRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 8 },
  // Le rail vertical entre récupération et destination reprend le motif de la fiche livraison.
  tripRail: { position: "absolute", left: 4.5, top: 22, bottom: 22, width: 1 },
  tripDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4, flexShrink: 0 },
  tripText: { flex: 1, minWidth: 0 },
  tripLabel: { fontSize: 11, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase" },
  tripValue: { fontSize: 14, fontWeight: "600", marginTop: 2 },
  tripAddress: { fontSize: 12, marginTop: 2 },

  // Montant / trajet / référence (palier déployé)
  facts: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
  fact: { flexGrow: 1, flexBasis: "45%", minWidth: 0, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 10, paddingVertical: 8 },
  factWide: { flexBasis: "100%" },
  factLabel: { fontSize: 9, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" },
  factValue: { fontSize: 13, fontWeight: "700", marginTop: 3, fontVariant: ["tabular-nums"] },
  paymentNote: { fontSize: 11, lineHeight: 16, marginTop: 8 },

  // Sheet bottom actions
  sheetActions: { flexDirection: "row", paddingHorizontal: 14, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, gap: 8 },
  sheetBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 11, borderRadius: 10, borderWidth: 1, gap: 5 },
  sheetBtnText: { fontSize: 12.5, fontWeight: "600" },
  sheetBtnTextPrimary: { fontSize: 12.5, fontWeight: "600" },

  // Empty tab
  emptyTab: { flexDirection: "row", alignItems: "center", gap: 8, padding: 16, borderRadius: 12 },
  emptyTabText: { fontSize: 12.5 },

  // Empty (no delivery at all)
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 24 },
  emptyContent: { padding: 20, paddingTop: 60, alignItems: "center" },
  emptyCard: { width: "100%", maxWidth: 360, padding: 28, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", gap: 12 },
  emptyIcon: { width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 16, fontWeight: "700", textAlign: "center" },
  emptyText: { fontSize: 13, textAlign: "center", lineHeight: 19 },
  cta: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, marginTop: 4 },
  ctaText: { color: "#FFFFFF", fontSize: 13, fontWeight: "600" },
});
