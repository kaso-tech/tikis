import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { SafeAreaView } from "react-native-safe-area-context";
import { DeliveryRouteMap } from "@/components/tikis/delivery-route-map";
import { formatDeliveryDetailPlace } from "@/lib/geo-rules";
import { useLiveDeliveryPosition } from "@/hooks/use-live-delivery-position";
import { haptic } from "@/lib/haptics";
import { useThemeColors } from "@/lib/use-theme-colors";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";

type Coordinate = { latitude: number; longitude: number };
const fallbackId = "00000000-0000-4000-8000-000000000000";

function haversineKm(a: Coordinate, b: Coordinate): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function etaMinutes(distanceKm: number): number {
  if (distanceKm <= 0) return 0;
  return Math.max(1, Math.round((distanceKm / 22) * 60));
}

const STEPS = [
  { key: "open", label: "Publiée", icon: "campaign" as const },
  { key: "pending_confirmation", label: "Attribuée", icon: "assignment-ind" as const },
  { key: "active", label: "En cours", icon: "local-shipping" as const },
  { key: "completed", label: "Livrée", icon: "check-circle" as const },
];
function stepIndex(status: string) {
  if (status === "open" || status === "disabled") return 0;
  if (status === "pending_confirmation") return 1;
  if (status === "active") return 2;
  return 3;
}

export default function DeliveryMapScreen() {
  const { colors: theme, isDark } = useThemeColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile, role } = useTikisStore();
  const deliveryQuery = trpc.deliveries.get.useQuery({ id: id ?? fallbackId }, { enabled: Boolean(id && profile?.phone), refetchInterval: 8_000 });
  const { mutateAsync: requestRoute, isPending: isRouteLoading } = trpc.geography.route.useMutation();
  const [coordinates, setCoordinates] = useState<Coordinate[]>([]);
  const [routeError, setRouteError] = useState(false);
  const delivery = deliveryQuery.data;
  const isLive = delivery?.status === "active";
  const livePosition = useLiveDeliveryPosition(delivery && isLive ? delivery.id : null, Boolean(delivery && isLive && role === "sender"));
  const pickupLatitude = delivery?.pickup.latitude;
  const pickupLongitude = delivery?.pickup.longitude;
  const dropoffLatitude = delivery?.dropoff.latitude;
  const dropoffLongitude = delivery?.dropoff.longitude;
  const routeInput = useMemo(() => delivery && pickupLatitude !== undefined && pickupLongitude !== undefined && dropoffLatitude !== undefined && dropoffLongitude !== undefined ? { origin: delivery.pickup, destination: delivery.dropoff } : null, [delivery, dropoffLatitude, dropoffLongitude, pickupLatitude, pickupLongitude]);

  useEffect(() => {
    let current = true;
    if (!routeInput) return;
    setRouteError(false);
    void requestRoute(routeInput).then((route) => {
      if (current) setCoordinates(route.coordinates ?? []);
    }).catch(() => {
      if (current) { setCoordinates([]); setRouteError(true); }
    });
    return () => { current = false; };
  }, [requestRoute, routeInput]);

  // Le suivi en direct est réservé aux Senders : un livreur n'a jamais accès à cette page.
  if (role === "driver") {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
        <View style={styles.center}>
          <MaterialIcons name="lock-outline" size={32} color="#9A6201" />
          <Text style={[styles.loadingText, { color: theme.muted, marginTop: 10 }]}>Le suivi en direct est réservé aux expéditeurs.</Text>
          <Pressable onPress={() => router.back()} style={{ marginTop: 16 }}><Text style={{ color: "#007B8B", fontWeight: "700" }}>Retour</Text></Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (deliveryQuery.isLoading || !delivery) return <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}><View style={styles.center}><ActivityIndicator color="#9A6201" /><Text style={[styles.loadingText, { color: theme.muted }]}>{deliveryQuery.isLoading ? "Chargement de la carte…" : "Livraison introuvable."}</Text></View></SafeAreaView>;

  const pickup = formatDeliveryDetailPlace(delivery.pickup);
  const dropoff = formatDeliveryDetailPlace(delivery.dropoff);
  const indicative = delivery.routeVisibility === "approximate";
  const step = stepIndex(delivery.status);

  const remainingKm = livePosition ? haversineKm({ latitude: livePosition.latitude, longitude: livePosition.longitude }, { latitude: delivery.dropoff.latitude, longitude: delivery.dropoff.longitude }) : null;
  const eta = remainingKm !== null ? etaMinutes(remainingKm) : null;

  async function callDriver() {
    if (!delivery?.driverPhone) return;
    haptic.light();
    const url = `tel:${delivery.driverPhone}`;
    if (await Linking.canOpenURL(url)) await Linking.openURL(url);
  }

  return <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={["top", "bottom"]}>
    <View style={[styles.header, { backgroundColor: theme.surface }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Retour" onPress={() => router.back()} style={({ pressed }) => [styles.back, { backgroundColor: theme.background }, pressed && styles.pressed]}><MaterialIcons name="arrow-back" size={22} color={theme.foreground} /></Pressable>
      <View style={styles.headerTitle}>
        <Text style={[styles.title, { color: theme.foreground }]} numberOfLines={1}>{delivery.title}</Text>
        <View style={styles.headerStatusRow}>
          {isLive ? <View style={styles.liveDot} /> : null}
          <Text style={[styles.headerStatusText, { color: isLive ? "#167A55" : theme.muted }]}>{isLive ? "Suivi en direct" : STEPS[step].label}</Text>
        </View>
      </View>
      <View style={styles.headerPlaceholder} />
    </View>

    {/* Bandeau ETA — l'élément central d'une page de suivi professionnelle */}
    {isLive ? (
      <View style={[styles.etaBanner, { backgroundColor: "#0B1F3A" }]}>
        <View style={styles.etaIconWrap}><MaterialIcons name="local-shipping" size={20} color="#FFFFFF" /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.etaValue}>{eta !== null ? `${eta} min` : "Calcul en cours…"}</Text>
          <Text style={styles.etaLabel}>{remainingKm !== null ? `${remainingKm.toFixed(1)} km restants jusqu’à la destination` : "En attente de la position du livreur"}</Text>
        </View>
      </View>
    ) : null}

    <View style={styles.mapWrap}>
      <DeliveryRouteMap pickup={delivery.pickup} dropoff={delivery.dropoff} coordinates={coordinates} driverPosition={livePosition} />
      {isRouteLoading ? <View style={styles.routeLoading}><ActivityIndicator size="small" color="#9A6201" /><Text style={styles.routeLoadingText}>Calcul de l’itinéraire…</Text></View> : null}
    </View>

    {/* Timeline de progression */}
    <View style={[styles.timelineRow, { backgroundColor: theme.surface }]}>
      {STEPS.map((s, i) => (
        <View key={s.key} style={styles.timelineStep}>
          <View style={[styles.timelineDot, { backgroundColor: i <= step ? "#007B8B" : theme.border }]}>
            <MaterialIcons name={s.icon} size={13} color={i <= step ? "#FFFFFF" : theme.muted} />
          </View>
          <Text style={[styles.timelineLabel, { color: i <= step ? theme.foreground : theme.muted }]}>{s.label}</Text>
          {i < STEPS.length - 1 ? <View style={[styles.timelineLine, { backgroundColor: i < step ? "#007B8B" : theme.border }]} /> : null}
        </View>
      ))}
    </View>

    <View style={[styles.bottomPanel, { backgroundColor: theme.surface }]}>
      {indicative ? <View style={[styles.privacyBanner, { backgroundColor: theme.background }]}><MaterialIcons name="privacy-tip" size={18} color="#8A5A0E" /><Text style={[styles.privacyText, { color: theme.muted }]}>Aperçu indicatif : les coordonnées précises sont protégées jusqu’à la confirmation de la mission.</Text></View> : null}
      {routeError ? <Text style={styles.routeError}>Le tracé détaillé est indisponible. La liaison entre les deux points reste affichée.</Text> : null}

      {delivery.driverName ? (
        <View style={[styles.driverCard, { borderColor: theme.border }]}>
          <View style={styles.driverAvatar}><Text style={styles.driverAvatarText}>{delivery.driverName.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()}</Text></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.driverName, { color: theme.foreground }]} numberOfLines={1}>{delivery.driverName}</Text>
            <Text style={[styles.driverSub, { color: theme.muted }]}>Votre livreur</Text>
          </View>
          {delivery.driverPhone ? (
            <Pressable onPress={() => void callDriver()} style={({ pressed }) => [styles.callButton, pressed && styles.pressed]} accessibilityLabel="Appeler le livreur">
              <MaterialIcons name="call" size={18} color="#FFFFFF" />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <View style={styles.placeRow}><View style={[styles.placeIcon, styles.pickupIcon]}><MaterialIcons name="inventory-2" size={16} color="#9A6201" /></View><View style={styles.placeCopy}><Text style={styles.placeLabel}>Récupération</Text><Text style={[styles.placeTitle, { color: theme.foreground }]} numberOfLines={1}>{pickup.title}</Text><Text style={[styles.placeSubtitle, { color: theme.muted }]} numberOfLines={1}>{pickup.subtitle}</Text></View></View>
      <View style={[styles.divider, { backgroundColor: theme.border }]} />
      <View style={styles.placeRow}><View style={[styles.placeIcon, styles.dropoffIcon]}><MaterialIcons name="location-on" size={17} color="#B4232D" /></View><View style={styles.placeCopy}><Text style={styles.placeLabel}>Destination</Text><Text style={[styles.placeTitle, { color: theme.foreground }]} numberOfLines={1}>{dropoff.title}</Text><Text style={[styles.placeSubtitle, { color: theme.muted }]} numberOfLines={1}>{dropoff.subtitle}</Text></View><Text style={[styles.distance, { color: theme.foreground }]}>{delivery.distanceKm.toLocaleString("fr-FR")} km</Text></View>
    </View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { height: 62, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 10 },
  back: { width: 40, height: 40, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, minWidth: 0 },
  title: { fontSize: 14, fontWeight: "600" },
  headerStatusRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#167A55" },
  headerStatusText: { fontSize: 11, fontWeight: "600" },
  headerPlaceholder: { width: 40 },
  etaBanner: { flexDirection: "row", alignItems: "center", gap: 12, marginHorizontal: 12, marginTop: 10, padding: 13, borderRadius: 12 },
  etaIconWrap: { width: 40, height: 40, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  etaValue: { color: "#FFFFFF", fontSize: 17, fontWeight: "800" },
  etaLabel: { color: "rgba(255,255,255,0.72)", fontSize: 11.5, marginTop: 2 },
  mapWrap: { flex: 1, margin: 12, marginBottom: 0, borderRadius: 10, overflow: "hidden" },
  routeLoading: { position: "absolute", top: 14, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, height: 30, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.95)" },
  routeLoadingText: { color: "#555555", fontSize: 11, fontWeight: "600" },
  timelineRow: { flexDirection: "row", marginHorizontal: 12, marginTop: 10, padding: 12, borderRadius: 10 },
  timelineStep: { flex: 1, alignItems: "center", position: "relative" },
  timelineDot: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  timelineLabel: { fontSize: 9.5, fontWeight: "600", marginTop: 4, textAlign: "center" },
  timelineLine: { position: "absolute", top: 13, left: "60%", right: "-40%", height: 2 },
  bottomPanel: { marginTop: 10, padding: 14, paddingBottom: 18 },
  privacyBanner: { flexDirection: "row", gap: 7, padding: 10, borderRadius: 8, marginBottom: 10 },
  privacyText: { flex: 1, fontSize: 11, lineHeight: 16, fontWeight: "500" },
  routeError: { color: "#9A6200", fontSize: 11, lineHeight: 16, marginBottom: 10 },
  driverCard: { flexDirection: "row", alignItems: "center", gap: 10, paddingBottom: 12, marginBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  driverAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#007B8B", alignItems: "center", justifyContent: "center" },
  driverAvatarText: { color: "#FFFFFF", fontWeight: "800", fontSize: 13 },
  driverName: { fontSize: 14, fontWeight: "700" },
  driverSub: { fontSize: 11, marginTop: 1 },
  callButton: { width: 38, height: 38, borderRadius: 19, backgroundColor: "#167A55", alignItems: "center", justifyContent: "center" },
  placeRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  placeIcon: { width: 30, height: 30, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  pickupIcon: { backgroundColor: "#EEEDF3" },
  dropoffIcon: { backgroundColor: "#FFF3F3" },
  placeCopy: { flex: 1, minWidth: 0 },
  placeLabel: { color: "#9A9A9A", fontSize: 9, fontWeight: "600", letterSpacing: 0.5, textTransform: "uppercase" },
  placeTitle: { fontSize: 13, fontWeight: "600", marginTop: 2 },
  placeSubtitle: { fontSize: 10, marginTop: 2 },
  divider: { height: 10, width: 1, marginLeft: 14, marginVertical: 3 },
  distance: { fontSize: 12, fontWeight: "600" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", gap: 9, padding: 18 },
  loadingText: { fontWeight: "500" },
  pressed: { opacity: 0.67 },
});
