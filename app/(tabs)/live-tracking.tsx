import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Dimensions, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
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

function regionFromPoints(a: { lat: number; lng: number }, b: { lat: number; lng: number }): Region {
  const minLat = Math.min(a.lat, b.lat);
  const maxLat = Math.max(a.lat, b.lat);
  const minLng = Math.min(a.lng, b.lng);
  const maxLng = Math.max(a.lng, b.lng);
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

  const tracked = useMemo(() => {
    const list = deliveriesQuery.data ?? [];
    return list.find((d) => d.status === "active")
      ?? list.find((d) => d.status === "pending_confirmation")
      ?? null;
  }, [deliveriesQuery.data]);

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

  return <LiveTrackingFocus key={tracked.id} delivery={tracked} theme={theme} isDark={isDark} onBack={() => router.back()} />;
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
  theme,
  isDark,
  onBack,
}: {
  delivery: Delivery;
  theme: ReturnType<typeof useThemeColors>["colors"];
  isDark: boolean;
  onBack: () => void;
}) {
  const mapRef = useRef<MapView | null>(null);
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

  const targetForEta = delivery.status === "active" ? pickupCoord : dropoffCoord;
  const distanceToTargetKm = driverCoord && targetForEta
    ? geodesicDistanceKm(driverCoord, targetForEta)
    : 0;
  const etaMinutes = estimateEtaMinutes(distanceToTargetKm);

  const statusLabel = delivery.status === "active"
    ? "EN ROUTE VERS LE POINT DE COLLECTE"
    : "EN ATTENTE DE CONFIRMATION";
  const statusSub = delivery.status === "active"
    ? driverCoord && pickup
      ? `${delivery.driverName ?? "Le livreur"} est à ${formatDistance(distanceToTargetKm)} de ${pickup.title}`
      : "Recherche de la position du livreur…"
    : `${delivery.driverName ?? "Un livreur"} n'a pas encore confirmé le départ.`;

  const mapStyle = isDark ? MAP_STYLE_DARK : undefined;

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      {/* Map full screen */}
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
            <View style={[styles.etaBadge, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              {delivery.status === "active" ? (
                <>
                  <View style={[styles.livePulse, { backgroundColor: theme.success }]} />
                  <Text style={[styles.etaBadgeText, { color: theme.foreground }]}>
                    {driverCoord ? `Arrivée dans ${etaMinutes} min` : "Recherche GPS…"}
                  </Text>
                </>
              ) : (
                <Text style={[styles.etaBadgeText, { color: theme.foreground }]}>En attente</Text>
              )}
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
      </View>

      {/* Bottom sheet */}
      <SafeAreaView edges={["bottom"]} style={styles.sheetWrap} pointerEvents="box-none">
        <View style={[styles.sheet, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={[styles.grip, { backgroundColor: theme.border }]} />

          <ScrollView contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>
            <Text style={[styles.statusLabel, { color: theme.muted }]}>{statusLabel}</Text>
            <Text style={[styles.statusValue, { color: theme.foreground }]}>
              {delivery.status === "active" && driverCoord ? `${etaMinutes} min` : "—"}
            </Text>
            <Text style={[styles.statusSub, { color: theme.muted }]}>{statusSub}</Text>

            {delivery.status === "active" ? (
              <View style={[styles.liveTag, { backgroundColor: theme.background }]}>
                <View style={[styles.liveTagPulse, { backgroundColor: theme.success }]} />
                <Text style={[styles.liveTagText, { color: theme.success }]}>Position en direct</Text>
              </View>
            ) : null}

            <View style={[styles.progressTrack, { backgroundColor: theme.background }]}>
              <View style={[styles.progressFill, { backgroundColor: theme.primary, width: delivery.status === "active" ? "55%" : "10%" }]} />
            </View>

            {delivery.driverName ? (
              <View style={[styles.driverCard, { backgroundColor: theme.background, borderColor: theme.border }]}>
                <View style={[styles.avatar, { backgroundColor: theme.primary }]}>
                  <Text style={styles.avatarText}>{getInitials(delivery.driverName)}</Text>
                </View>
                <View style={styles.driverInfo}>
                  <Text style={[styles.driverName, { color: theme.foreground }]} numberOfLines={1}>{delivery.driverName}</Text>
                  <View style={styles.driverMetaRow}>
                    {driverStatsQuery.data && driverStatsQuery.data.reviewsCount > 0 ? (
                      <View style={[styles.ratingPill, { backgroundColor: theme.foreground }]}>
                        <Text style={[styles.ratingPillText, { color: theme.background }]}>★ {driverStatsQuery.data.rating.toFixed(2)}</Text>
                      </View>
                    ) : null}
                    <Text style={[styles.driverMetaText, { color: theme.muted }]}>
                      {driverStatsQuery.data && driverStatsQuery.data.completedDeliveries > 0
                        ? `${driverStatsQuery.data.completedDeliveries} course${driverStatsQuery.data.completedDeliveries > 1 ? "s" : ""} · ${(delivery.vehicleTypes ?? []).join(" · ") || "Moto"}`
                        : (delivery.vehicleTypes ?? []).join(" · ") || "Moto"}
                    </Text>
                  </View>
                </View>
                {delivery.driverPhone ? (
                  <>
                    <Pressable
                      onPress={() => { void Linking.openURL(`tel:${delivery.driverPhone}`); }}
                      accessibilityRole="button"
                      accessibilityLabel="Appeler le livreur"
                      style={({ pressed }) => [styles.iconBtn, { backgroundColor: theme.surface, borderColor: theme.border }, pressed && { opacity: 0.7 }]}
                    >
                      <MaterialIcons name="call" size={18} color={theme.foreground} />
                    </Pressable>
                    <Pressable
                      onPress={() => { void Linking.openURL(`sms:${delivery.driverPhone}`); }}
                      accessibilityRole="button"
                      accessibilityLabel="Envoyer un message"
                      style={({ pressed }) => [styles.iconBtn, { backgroundColor: theme.surface, borderColor: theme.border }, pressed && { opacity: 0.7 }]}
                    >
                      <MaterialIcons name="chat-bubble-outline" size={18} color={theme.foreground} />
                    </Pressable>
                  </>
                ) : null}
              </View>
            ) : null}

            <View style={styles.tripInfo}>
              <View style={[styles.tripRow, { borderColor: theme.border }]}>
                <View style={[styles.tripDot, { backgroundColor: theme.foreground }]} />
                <View style={styles.tripText}>
                  <Text style={[styles.tripLabel, { color: theme.muted }]}>Point de collecte</Text>
                  <Text style={[styles.tripValue, { color: theme.foreground }]} numberOfLines={1}>{pickup.title}</Text>
                  <Text style={[styles.tripAddress, { color: theme.muted }]} numberOfLines={1}>{locationTitle(delivery.pickup as LocationLabel)}</Text>
                </View>
              </View>
              <View style={[styles.tripRow, { borderColor: theme.border }]}>
                <View style={[styles.tripDot, { backgroundColor: theme.foreground }]} />
                <View style={styles.tripText}>
                  <Text style={[styles.tripLabel, { color: theme.muted }]}>Destination</Text>
                  <Text style={[styles.tripValue, { color: theme.foreground }]} numberOfLines={1}>{dropoff.title}</Text>
                  <Text style={[styles.tripAddress, { color: theme.muted }]} numberOfLines={1}>
                    {locationTitle(delivery.dropoff as LocationLabel)} · {formatDistance(delivery.distanceKm)} · {formatMoney(delivery.offeredPrice ?? delivery.estimatedPrice)}
                  </Text>
                </View>
              </View>
            </View>
          </ScrollView>
        </View>
      </SafeAreaView>
    </View>
  );
}

const { height: SCREEN_HEIGHT } = Dimensions.get("window");
const SHEET_MIN_HEIGHT = 280;
const SHEET_MAX_HEIGHT = Math.min(420, SCREEN_HEIGHT * 0.55);

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

  // Top bar
  topBar: { position: "absolute", top: 0, left: 0, right: 0 },
  topBarInner: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  topBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
  etaBadge: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth },
  etaBadgeText: { fontSize: 13, fontWeight: "600" },
  livePulse: { width: 8, height: 8, borderRadius: 4 },

  // Markers
  markerPickup: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", borderWidth: 3 },
  markerDropoff: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", borderWidth: 3 },
  markerLetter: { fontSize: 14, fontWeight: "700" },
  markerDriver: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", borderWidth: 3 },

  // Sheet
  sheetWrap: { position: "absolute", bottom: 0, left: 0, right: 0 },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: StyleSheet.hairlineWidth, minHeight: SHEET_MIN_HEIGHT, maxHeight: SHEET_MAX_HEIGHT, paddingBottom: 16 },
  grip: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginTop: 10, marginBottom: 14 },
  sheetContent: { paddingHorizontal: 20, paddingBottom: 8, gap: 10 },

  statusLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase", textAlign: "center" },
  statusValue: { fontSize: 26, fontWeight: "700", textAlign: "center", marginTop: 4 },
  statusSub: { fontSize: 13, textAlign: "center", lineHeight: 18 },
  liveTag: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "center", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  liveTagPulse: { width: 6, height: 6, borderRadius: 3 },
  liveTagText: { fontSize: 11, fontWeight: "700" },

  progressTrack: { height: 4, borderRadius: 2, overflow: "hidden", marginVertical: 6 },
  progressFill: { height: "100%", borderRadius: 2 },

  driverCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, marginTop: 6 },
  avatar: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  avatarText: { color: "#FFFFFF", fontWeight: "700", fontSize: 16 },
  driverInfo: { flex: 1, minWidth: 0 },
  driverName: { fontSize: 15, fontWeight: "600" },
  driverMetaRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  ratingPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 4 },
  ratingPillText: { fontSize: 11, fontWeight: "700" },
  driverMetaText: { fontSize: 12 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },

  tripInfo: { marginTop: 6 },
  tripRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  tripDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4, flexShrink: 0 },
  tripText: { flex: 1, minWidth: 0 },
  tripLabel: { fontSize: 11, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase" },
  tripValue: { fontSize: 14, fontWeight: "600", marginTop: 2 },
  tripAddress: { fontSize: 12, marginTop: 2 },

  // Empty
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 24 },
  emptyContent: { padding: 20, paddingTop: 60, alignItems: "center" },
  emptyCard: { width: "100%", maxWidth: 360, padding: 28, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", gap: 12 },
  emptyIcon: { width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 16, fontWeight: "700", textAlign: "center" },
  emptyText: { fontSize: 13, textAlign: "center", lineHeight: 19 },
  cta: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, marginTop: 4 },
  ctaText: { color: "#FFFFFF", fontSize: 13, fontWeight: "600" },
});
