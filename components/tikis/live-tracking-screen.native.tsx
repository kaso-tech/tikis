import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, Dimensions, Linking, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import MapView, { Marker, Polyline, type Region } from "react-native-maps";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLiveDeliveryPosition } from "@/hooks/use-live-delivery-position";
import { formatDeliveryDetailPlace, geodesicDistanceKm, locationTitle } from "@/lib/geo-rules";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";
import { useThemeColors } from "@/lib/use-theme-colors";
import type { Delivery, LocationLabel } from "@/shared/tikis-domain";
import { formatMoney } from "@/shared/tikis-domain";

const AVG_SPEED_KMH = 22;

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
}: {
  delivery: Delivery;
  activeDeliveries: Delivery[];
  pendingDeliveries: Delivery[];
  todayDeliveries: Delivery[];
  theme: ReturnType<typeof useThemeColors>["colors"];
  isDark: boolean;
  onBack: () => void;
}) {
  const mapRef = useRef<MapView | null>(null);
  const liveDeliveryId = delivery.status === "active" ? delivery.id : null;
  const driverPosition = useLiveDeliveryPosition(liveDeliveryId, delivery.status === "active");
  const driverStats: DriverStats | null = null;
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

  const targetForEta = delivery.status === "active" ? pickupCoord : dropoffCoord;
  const distanceToTargetKm = driverCoord && targetForEta
    ? geodesicDistanceKm(driverCoord, targetForEta)
    : 0;
  const etaMinutes = estimateEtaMinutes(distanceToTargetKm);

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
            {driverCoord && pickupCoord ? (
              <Polyline
                coordinates={[driverCoord, pickupCoord]}
                strokeColor={theme.primary}
                strokeWidth={3}
                lineDashPattern={[6, 6]}
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
            <View style={[styles.topbarTabs, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <View style={[styles.topbarTab, { backgroundColor: theme.primary }]}>
                <Text style={[styles.topbarTabTextActive, { color: theme.background }]}>En cours</Text>
                <View style={[styles.topbarTabCountActive, { backgroundColor: "rgba(255,255,255,0.25)" }]}>
                  <Text style={[styles.topbarTabCountActiveText, { color: theme.background }]}>{activeDeliveries.length}</Text>
                </View>
              </View>
              <View style={styles.topbarTab}>
                <Text style={[styles.topbarTabText, { color: theme.muted }]}>Aujourd'hui</Text>
              </View>
              <View style={styles.topbarTab}>
                <Text style={[styles.topbarTabText, { color: theme.muted }]}>Historique</Text>
              </View>
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
        <View style={styles.fabStack} pointerEvents="box-none">
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
        driverStats={driverStats}
        theme={theme}
        isDriverLive={delivery.status === "active" && Boolean(driverCoord)}
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

function getDeliveryEtaMinutes(d: DeliveryLite, driverCoord: { latitude: number; longitude: number } | null): number {
  const target = d.status === "active" ? d.pickup : d.dropoff;
  if (!driverCoord || !target?.latitude || !target?.longitude) return 0;
  const distance = geodesicDistanceKm(driverCoord, { latitude: target.latitude, longitude: target.longitude });
  return estimateEtaMinutes(distance);
}

function DraggableSheet({
  tracked,
  activeDeliveries,
  pendingDeliveries,
  todayDeliveries,
  driverPosition,
  driverStats,
  theme,
  isDriverLive,
}: {
  tracked: Delivery;
  activeDeliveries: Delivery[];
  pendingDeliveries: Delivery[];
  todayDeliveries: Delivery[];
  driverPosition: { latitude: number; longitude: number; heading: number; recordedAt: string } | null;
  driverStats: DriverStats | null;
  theme: ReturnType<typeof useThemeColors>["colors"];
  isDriverLive: boolean;
}) {
  const [tab, setTab] = useState<"active" | "waiting" | "today">("active");
  const [selectedDeliveryId, setSelectedDeliveryId] = useState<string>(tracked.id);
  const [sheetLevel, setSheetLevel] = useState<"mini" | "mid" | "full">("mid");

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
  const sheetBaseHeight = useRef(new Animated.Value(SHEET_MID_HEIGHT)).current;
  const dragState = useRef<{ active: boolean }>({ active: false });

  useEffect(() => {
    Animated.spring(sheetBaseHeight, {
      toValue: sheetLevel === "mini" ? SHEET_MIN_HEIGHT : sheetLevel === "mid" ? SHEET_MID_HEIGHT : SHEET_FULL_HEIGHT,
      useNativeDriver: false,
      tension: 220,
      friction: 22,
    }).start();
  }, [sheetLevel, sheetBaseHeight]);

  // Reset panY quand le sheetLevel change (évite l'accumulation)
  useEffect(() => {
    panY.setValue(0);
  }, [sheetLevel, panY]);

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
        const fastSwipeUp = vY < -0.5 && sheetLevel !== "full";
        const fastSwipeDown = vY > 0.5 && sheetLevel !== "mini";
        if ((dy < -30 || fastSwipeUp) && sheetLevel === "mini") setSheetLevel("mid");
        else if ((dy < -30 || fastSwipeUp) && sheetLevel === "mid") setSheetLevel("full");
        else if ((dy > 30 || fastSwipeDown) && sheetLevel === "full") setSheetLevel("mid");
        else if ((dy > 30 || fastSwipeDown) && sheetLevel === "mid") setSheetLevel("mini");
        Animated.spring(panY, { toValue: 0, useNativeDriver: false, tension: 220, friction: 22 }).start();
      },
      onPanResponderTerminate: () => {
        dragState.current.active = false;
        Animated.spring(panY, { toValue: 0, useNativeDriver: false }).start();
      },
    }),
  ).current;

  const finalHeight = Animated.add(sheetBaseHeight, panY);

  // Calculs dynamiques sur la delivery sélectionnée
  const selectedPickup = selectedDelivery ? formatDeliveryDetailPlace(selectedDelivery.pickup) : null;
  const selectedDropoff = selectedDelivery ? formatDeliveryDetailPlace(selectedDelivery.dropoff) : null;
  const selectedEtaMinutes = selectedDelivery ? getDeliveryEtaMinutes(selectedDelivery, driverCoord) : 0;
  const selectedIsLive = selectedDelivery ? (selectedDelivery.status === "active" && Boolean(driverCoord)) : false;

  const statusLabel = selectedDelivery?.status === "active"
    ? "EN ROUTE VERS LE POINT DE COLLECTE"
    : "EN ATTENTE DE CONFIRMATION";
  const statusSub = selectedIsLive && selectedPickup
    ? `${selectedDelivery?.driverName ?? "Le livreur"} est à ${formatDistance(geodesicDistanceKm(driverCoord!, { latitude: selectedDelivery!.pickup.latitude, longitude: selectedDelivery!.pickup.longitude }))} de ${selectedPickup.title}`
    : selectedDelivery
      ? "Recherche de la position du livreur…"
      : "Aucune livraison sélectionnée";

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
          {/* Delivery list (filtre par tab) */}
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

          {/* Track preview (timeline 4 étapes) */}
          {sheetLevel !== "mini" && selectedDelivery ? (() => {
            const sDriverName = selectedDelivery.driverName;
            const sVehicleTypes = (selectedDelivery.vehicleTypes ?? []).join(" · ") || "Moto";
            return (
              <View style={[styles.trackPreview, { backgroundColor: theme.background, borderColor: theme.border }]}>
                <View style={styles.trackPreviewHeader}>
                  <Text style={[styles.trackPreviewLabel, { color: theme.primary }]}>Course sélectionnée</Text>
                  {sDriverName ? (
                    <View style={styles.trackPreviewDriver}>
                      <View style={[styles.trackAvatar, { backgroundColor: theme.primary }]}>
                        <Text style={[styles.trackAvatarText, { color: theme.surface }]}>{getInitials(sDriverName)}</Text>
                      </View>
                      <View style={{ flexShrink: 1 }}>
                        <Text style={[styles.trackDriverName, { color: theme.foreground }]} numberOfLines={1}>{sDriverName}</Text>
                        <Text style={[styles.trackDriverMeta, { color: theme.muted }]} numberOfLines={1}>
                          {driverStats && driverStats.reviewsCount > 0
                            ? `★ ${driverStats.rating.toFixed(2)} · ${driverStats.completedDeliveries} course${driverStats.completedDeliveries > 1 ? "s" : ""}`
                            : sVehicleTypes}
                        </Text>
                      </View>
                    </View>
                  ) : null}
                </View>
                <View style={styles.trackTimeline}>
                  <TrackStep label="Publiée" state="done" theme={theme} />
                  <TrackStep label="Acceptée" state="done" theme={theme} />
                  <TrackStep
                    label="En route"
                    state={selectedDelivery.status === "active" ? "active" : "pending"}
                    theme={theme}
                  />
                  <TrackStep
                    label="Livrée"
                    state={selectedDelivery.status === "completed" ? "done" : "pending"}
                    theme={theme}
                    last
                  />
                </View>
              </View>
            );
          })() : null}

          {/* Status info (visible mid + full) */}
          {sheetLevel !== "mini" && selectedDelivery ? (
            <View style={styles.statusBlock}>
              <Text style={[styles.statusLabel, { color: theme.muted }]}>{statusLabel}</Text>
              <Text style={[styles.statusValue, { color: theme.foreground }]}>
                {selectedIsLive && selectedEtaMinutes > 0 ? `${selectedEtaMinutes} min` : "—"}
              </Text>
              <Text style={[styles.statusSub, { color: theme.muted }]}>{statusSub}</Text>
              {selectedIsLive ? (
                <View style={[styles.liveTag, { backgroundColor: theme.background }]}>
                  <View style={[styles.liveTagPulse, { backgroundColor: theme.success }]} />
                  <Text style={[styles.liveTagText, { color: theme.success }]}>Position en direct</Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Trip info (only full) */}
          {sheetLevel === "full" && selectedDelivery && selectedPickup && selectedDropoff ? (
            <View style={[styles.tripInfo, { borderTopColor: theme.border }]}>
              <View style={styles.tripRow}>
                <View style={[styles.tripDot, { backgroundColor: theme.foreground }]} />
                <View style={styles.tripText}>
                  <Text style={[styles.tripLabel, { color: theme.muted }]}>Point de collecte</Text>
                  <Text style={[styles.tripValue, { color: theme.foreground }]} numberOfLines={1}>{selectedPickup.title}</Text>
                  <Text style={[styles.tripAddress, { color: theme.muted }]} numberOfLines={1}>{locationTitle(selectedDelivery.pickup as LocationLabel)}</Text>
                </View>
              </View>
              <View style={[styles.tripRow, { borderTopColor: theme.border }]}>
                <View style={[styles.tripDot, { backgroundColor: theme.foreground }]} />
                <View style={styles.tripText}>
                  <Text style={[styles.tripLabel, { color: theme.muted }]}>Destination</Text>
                  <Text style={[styles.tripValue, { color: theme.foreground }]} numberOfLines={1}>{selectedDropoff.title}</Text>
                  <Text style={[styles.tripAddress, { color: theme.muted }]} numberOfLines={1}>
                    {locationTitle(selectedDelivery.dropoff as LocationLabel)} · {formatDistance(selectedDelivery.distanceKm)} · {formatMoney(selectedDelivery.offeredPrice ?? selectedDelivery.estimatedPrice)}
                  </Text>
                </View>
              </View>
            </View>
          ) : null}
        </ScrollView>

        {/* Bottom actions (always visible) */}
        <View style={[styles.sheetActions, { borderTopColor: theme.border }]}>
          <Pressable
            onPress={() => {
              if (!selectedDelivery) return;
              cancelMutation.mutate({ deliveryId: selectedDelivery.id });
            }}
            disabled={!selectedDelivery || !selectedDelivery.senderPhone || cancelMutation.isPending}
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
          {selectedDelivery?.driverPhone ? (
            <Pressable
              onPress={() => { void Linking.openURL(`tel:${selectedDelivery!.driverPhone}`); }}
              style={({ pressed }) => [styles.sheetBtn, { backgroundColor: theme.surface, borderColor: theme.border }, pressed && { opacity: 0.7 }]}
            >
              <MaterialIcons name="call" size={14} color={theme.foreground} />
              <Text style={[styles.sheetBtnText, { color: theme.foreground }]}>Appeler</Text>
            </Pressable>
          ) : null}
          {selectedDelivery?.driverPhone ? (
            <Pressable
              onPress={() => { void Linking.openURL(`sms:${selectedDelivery!.driverPhone}`); }}
              style={({ pressed }) => [styles.sheetBtn, { backgroundColor: theme.primary, borderColor: theme.primary }, pressed && { opacity: 0.85 }]}
            >
              <MaterialIcons name="chat-bubble" size={14} color={theme.background} />
              <Text style={[styles.sheetBtnTextPrimary, { color: theme.background }]}>Message</Text>
            </Pressable>
          ) : null}
        </View>
      </SafeAreaView>
    </Animated.View>
  );
}

function TrackStep({ label, state, theme, last }: { label: string; state: "done" | "active" | "pending"; theme: ReturnType<typeof useThemeColors>["colors"]; last?: boolean }) {
  const isDone = state === "done";
  const isActive = state === "active";
  return (
    <View style={styles.trackStep}>
      <View
        style={[
          styles.trackStepBullet,
          { backgroundColor: isDone || isActive ? theme.primary : theme.surface, borderColor: isDone || isActive ? theme.primary : theme.border },
        ]}
      >
        {isDone ? (
          <MaterialIcons name="check" size={11} color={theme.background} />
        ) : isActive ? (
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.surface }} />
        ) : null}
      </View>
      {!last ? <View style={[styles.trackStepLine, { backgroundColor: isDone ? theme.primary : theme.border }]} /> : null}
      <Text style={[styles.trackStepLabel, { color: isActive ? theme.primary : theme.muted, fontWeight: isActive ? "700" : "600" }]}>
        {label}
      </Text>
    </View>
  );
}

const { height: SCREEN_HEIGHT } = Dimensions.get("window");
const SHEET_MIN_HEIGHT = 110;
const SHEET_MID_HEIGHT = Math.min(380, SCREEN_HEIGHT * 0.45);
const SHEET_FULL_HEIGHT = Math.min(640, SCREEN_HEIGHT * 0.78);

const MAP_STYLE_DARK = [
  { elementType: "geometry", stylers: [{ color: "#1d2c4d" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8ec3b9" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#1a3646" }] },
  { featureType: "administrative.country", elementType: "geometry.stroke", stylers: [{ color: "#4b6878" }] },
  { featureType: "land", elementType: "geometry", stylers: [{ color: "#0e1626" }] },
  { featureType: "poi", elementType: "geometry", stylers: [{ color: "#283d6a" }] },
  { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#6f9ba5" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#304a7d" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#1F1206" }] },
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
  topbarTabs: { flex: 1, flexDirection: "row", borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 4, gap: 2 },
  topbarTab: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 8, borderRadius: 9, gap: 4 },
  topbarTabText: { fontSize: 12, fontWeight: "600" },
  topbarTabTextActive: { fontSize: 12, fontWeight: "700" },
  topbarTabCountActive: { paddingHorizontal: 5, borderRadius: 8, minWidth: 18, alignItems: "center" },
  topbarTabCountActiveText: { fontSize: 10, fontWeight: "700" },

  // FAB stack (right side, above sheet)
  fabStack: { position: "absolute", right: 16, bottom: 420, gap: 8 },
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

  // Sheet tabs
  sheetTabs: { flexDirection: "row", marginHorizontal: 14, marginTop: 4, borderRadius: 10, padding: 3, gap: 2 },
  sheetTab: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center" },
  sheetTabText: { fontSize: 12.5, fontWeight: "600" },

  sheetScroll: { flex: 1, marginTop: 10 },
  sheetContent: { paddingHorizontal: 14, paddingBottom: 8, gap: 8 },

  // Delivery card (in sheet list)
  deliveryCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 12, borderWidth: 1.5 },
  deliveryThumb: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center", flexShrink: 0, position: "relative", borderWidth: StyleSheet.hairlineWidth },
  deliveryLiveDot: { position: "absolute", top: -2, right: -2, width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
  deliveryInfo: { flex: 1, minWidth: 0 },
  deliveryTitle: { fontSize: 13.5, fontWeight: "600" },
  deliveryRoute: { fontSize: 11.5, marginTop: 2 },
  deliveryEta: { alignItems: "flex-end", flexShrink: 0 },
  deliveryEtaTime: { fontSize: 16, fontWeight: "700" },
  deliveryEtaLabel: { fontSize: 10.5, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4, marginTop: 1 },

  // Track preview (timeline)
  trackPreview: { padding: 12, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, marginTop: 6 },
  trackPreviewHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 10 },
  trackPreviewLabel: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 },
  trackPreviewDriver: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 },
  trackAvatar: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  trackAvatarText: { fontSize: 10, fontWeight: "700" },
  trackDriverName: { fontSize: 12, fontWeight: "600" },
  trackDriverMeta: { fontSize: 11, marginTop: 1 },
  trackTimeline: { flexDirection: "row", alignItems: "flex-start" },
  trackStep: { flex: 1, alignItems: "center", position: "relative" },
  trackStepBullet: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: "center", justifyContent: "center", marginBottom: 4, zIndex: 1 },
  trackStepLine: { position: "absolute", top: 11, left: "50%", right: "-50%", height: 2 },
  trackStepLabel: { fontSize: 9.5, textAlign: "center", textTransform: "uppercase", letterSpacing: 0.3, fontWeight: "600" },

  // Status block (mid + full)
  statusBlock: { alignItems: "center", paddingVertical: 6, gap: 4 },
  statusLabel: { fontSize: 10.5, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" },
  statusValue: { fontSize: 24, fontWeight: "700" },
  statusSub: { fontSize: 12.5, textAlign: "center", lineHeight: 17 },
  liveTag: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, alignSelf: "center" },
  liveTagPulse: { width: 6, height: 6, borderRadius: 3 },
  liveTagText: { fontSize: 11, fontWeight: "700" },

  // Trip info (only full state)
  tripInfo: { marginTop: 4 },
  tripRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  tripDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4, flexShrink: 0 },
  tripText: { flex: 1, minWidth: 0 },
  tripLabel: { fontSize: 11, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase" },
  tripValue: { fontSize: 14, fontWeight: "600", marginTop: 2 },
  tripAddress: { fontSize: 12, marginTop: 2 },

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
