import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { SafeAreaView } from "react-native-safe-area-context";
import { DeliveryRouteMap } from "@/components/tikis/delivery-route-map";
import { formatDeliveryDetailPlace } from "@/lib/geo-rules";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";

type Coordinate = { latitude: number; longitude: number };
const fallbackId = "00000000-0000-4000-8000-000000000000";

export default function DeliveryMapScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useTikisStore();
  const deliveryQuery = trpc.deliveries.get.useQuery({ id: id ?? fallbackId }, { enabled: Boolean(id && profile?.phone) });
  const { mutateAsync: requestRoute, isPending: isRouteLoading } = trpc.geography.route.useMutation();
  const [coordinates, setCoordinates] = useState<Coordinate[]>([]);
  const [routeError, setRouteError] = useState(false);
  const delivery = deliveryQuery.data;
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

  if (deliveryQuery.isLoading || !delivery) return <SafeAreaView style={styles.safe}><View style={styles.center}><ActivityIndicator color="#007B8B" /><Text style={styles.loadingText}>{deliveryQuery.isLoading ? "Chargement de la carte…" : "Livraison introuvable."}</Text></View></SafeAreaView>;
  const pickup = formatDeliveryDetailPlace(delivery.pickup);
  const dropoff = formatDeliveryDetailPlace(delivery.dropoff);
  const indicative = delivery.routeVisibility === "approximate";
  return <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Retour" onPress={() => router.back()} style={({ pressed }) => [styles.back, pressed && styles.pressed]}><MaterialIcons name="arrow-back" size={22} color="#111111" /></Pressable><View style={styles.headerTitle}><Text style={styles.eyebrow}>TRAJET DE LIVRAISON</Text><Text style={styles.title} numberOfLines={1}>{delivery.title}</Text></View><View style={styles.headerPlaceholder} /></View>
    <View style={styles.mapWrap}><DeliveryRouteMap pickup={delivery.pickup} dropoff={delivery.dropoff} coordinates={coordinates} />{isRouteLoading ? <View style={styles.routeLoading}><ActivityIndicator size="small" color="#007B8B" /><Text style={styles.routeLoadingText}>Calcul de l’itinéraire…</Text></View> : null}</View>
    <View style={styles.bottomPanel}>
      {indicative ? <View style={styles.privacyBanner}><MaterialIcons name="privacy-tip" size={18} color="#8A5A0E" /><Text style={styles.privacyText}>Aperçu indicatif : les coordonnées précises sont protégées jusqu’à la confirmation de la mission.</Text></View> : null}
      {routeError ? <Text style={styles.routeError}>Le tracé détaillé est indisponible. La liaison entre les deux points reste affichée.</Text> : null}
      <View style={styles.placeRow}><View style={[styles.placeIcon, styles.pickupIcon]}><MaterialIcons name="inventory-2" size={16} color="#007B8B" /></View><View style={styles.placeCopy}><Text style={styles.placeLabel}>Récupération</Text><Text style={styles.placeTitle} numberOfLines={1}>{pickup.title}</Text><Text style={styles.placeSubtitle} numberOfLines={1}>{pickup.subtitle}</Text></View></View>
      <View style={styles.divider} />
      <View style={styles.placeRow}><View style={[styles.placeIcon, styles.dropoffIcon]}><MaterialIcons name="location-on" size={17} color="#B4232D" /></View><View style={styles.placeCopy}><Text style={styles.placeLabel}>Destination</Text><Text style={styles.placeTitle} numberOfLines={1}>{dropoff.title}</Text><Text style={styles.placeSubtitle} numberOfLines={1}>{dropoff.subtitle}</Text></View><Text style={styles.distance}>{delivery.distanceKm.toLocaleString("fr-FR")} km</Text></View>
    </View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#EEEDF3" }, header: { height: 62, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#FFFFFF", borderBottomWidth: 0 }, back: { width: 40, height: 40, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "#EEEDF3" }, headerTitle: { flex: 1, minWidth: 0 }, eyebrow: { color: "#007B8B", fontSize: 10, fontWeight: "600", letterSpacing: 0.7 }, title: { color: "#111111", fontSize: 14, fontWeight: "600", marginTop: 2 }, headerPlaceholder: { width: 40 }, mapWrap: { flex: 1, margin: 12, marginBottom: 0, borderRadius: 10, overflow: "hidden" }, routeLoading: { position: "absolute", top: 14, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, height: 30, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.95)" }, routeLoadingText: { color: "#555555", fontSize: 11, fontWeight: "600" }, bottomPanel: { marginTop: 10, backgroundColor: "#FFFFFF", padding: 14, paddingBottom: 18, borderTopWidth: 0 }, privacyBanner: { flexDirection: "row", gap: 7, backgroundColor: "#EEEDF3", padding: 10, borderRadius: 8, marginBottom: 10 }, privacyText: { flex: 1, color: "#666666", fontSize: 11, lineHeight: 16, fontWeight: "500" }, routeError: { color: "#9A6200", fontSize: 11, lineHeight: 16, marginBottom: 10 }, placeRow: { flexDirection: "row", alignItems: "center", gap: 9 }, placeIcon: { width: 30, height: 30, borderRadius: 7, alignItems: "center", justifyContent: "center" }, pickupIcon: { backgroundColor: "#EEEDF3" }, dropoffIcon: { backgroundColor: "#FFF3F3" }, placeCopy: { flex: 1, minWidth: 0 }, placeLabel: { color: "#747474", fontSize: 9, fontWeight: "600", letterSpacing: 0.5, textTransform: "uppercase" }, placeTitle: { color: "#111111", fontSize: 13, fontWeight: "600", marginTop: 2 }, placeSubtitle: { color: "#666666", fontSize: 10, marginTop: 2 }, divider: { height: 10, width: 1, backgroundColor: "#CFCFCF", marginLeft: 14, marginVertical: 3 }, distance: { color: "#111111", fontSize: 12, fontWeight: "600" }, center: { flex: 1, justifyContent: "center", alignItems: "center", gap: 9, padding: 18 }, loadingText: { color: "#666666", fontWeight: "500" }, pressed: { opacity: 0.67 },
});
