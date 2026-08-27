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
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Retour" onPress={() => router.back()} style={({ pressed }) => [styles.back, pressed && styles.pressed]}><MaterialIcons name="arrow-back" size={22} color="#0B1F3A" /></Pressable><View style={styles.headerTitle}><Text style={styles.eyebrow}>TRAJET DE LIVRAISON</Text><Text style={styles.title} numberOfLines={1}>{delivery.title}</Text></View><View style={styles.headerPlaceholder} /></View>
    <View style={styles.mapWrap}><DeliveryRouteMap pickup={delivery.pickup} dropoff={delivery.dropoff} coordinates={coordinates} />{isRouteLoading ? <View style={styles.routeLoading}><ActivityIndicator size="small" color="#007B8B" /><Text style={styles.routeLoadingText}>Calcul de l’itinéraire…</Text></View> : null}</View>
    <View style={styles.bottomPanel}>
      {indicative ? <View style={styles.privacyBanner}><MaterialIcons name="privacy-tip" size={18} color="#8A5A0E" /><Text style={styles.privacyText}>Aperçu indicatif : les coordonnées précises sont protégées jusqu’à la confirmation de la mission.</Text></View> : null}
      {routeError ? <Text style={styles.routeError}>Le tracé détaillé est indisponible. La liaison entre les deux points reste affichée.</Text> : null}
      <View style={styles.placeRow}><View style={[styles.placeIcon, styles.pickupIcon]}><MaterialIcons name="inventory-2" size={16} color="#007B8B" /></View><View style={styles.placeCopy}><Text style={styles.placeLabel}>Récupération</Text><Text style={styles.placeTitle} numberOfLines={1}>{pickup.title}</Text><Text style={styles.placeSubtitle} numberOfLines={1}>{pickup.subtitle}</Text></View></View>
      <View style={styles.divider} />
      <View style={styles.placeRow}><View style={[styles.placeIcon, styles.dropoffIcon]}><MaterialIcons name="location-on" size={17} color="#C23B45" /></View><View style={styles.placeCopy}><Text style={styles.placeLabel}>Destination</Text><Text style={styles.placeTitle} numberOfLines={1}>{dropoff.title}</Text><Text style={styles.placeSubtitle} numberOfLines={1}>{dropoff.subtitle}</Text></View><Text style={styles.distance}>{delivery.distanceKm.toLocaleString("fr-FR")} km</Text></View>
    </View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F6F8FC" }, header: { height: 78, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#FFFFFF", borderBottomWidth: 1, borderColor: "#E7ECF2" }, back: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: "#F6F8FC", borderWidth: 1, borderColor: "#E7ECF2" }, headerTitle: { flex: 1, minWidth: 0 }, eyebrow: { color: "#7B899B", fontSize: 9.5, fontWeight: "900", letterSpacing: 0.8 }, title: { color: "#0B1F3A", fontSize: 15, fontWeight: "900", marginTop: 3 }, headerPlaceholder: { width: 42 }, mapWrap: { flex: 1, margin: 14, marginBottom: 0, borderRadius: 24, overflow: "hidden", shadowColor: "#0B1F3A", shadowOpacity: 0.14, shadowRadius: 14, elevation: 4 }, routeLoading: { position: "absolute", top: 16, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, height: 34, borderRadius: 17, backgroundColor: "rgba(255,255,255,0.95)" }, routeLoadingText: { color: "#35656C", fontSize: 11, fontWeight: "900" }, bottomPanel: { marginTop: 14, backgroundColor: "#FFFFFF", padding: 18, paddingBottom: 22, borderTopWidth: 1, borderColor: "#E7ECF2" }, privacyBanner: { flexDirection: "row", gap: 8, backgroundColor: "#FFF6E4", padding: 11, borderRadius: 13, marginBottom: 13 }, privacyText: { flex: 1, color: "#8A5A0E", fontSize: 11, lineHeight: 16, fontWeight: "700" }, routeError: { color: "#8A5A0E", fontSize: 11, lineHeight: 16, marginBottom: 12 }, placeRow: { flexDirection: "row", alignItems: "center", gap: 10 }, placeIcon: { width: 32, height: 32, borderRadius: 11, alignItems: "center", justifyContent: "center" }, pickupIcon: { backgroundColor: "#E5F6F7" }, dropoffIcon: { backgroundColor: "#FDEBEC" }, placeCopy: { flex: 1, minWidth: 0 }, placeLabel: { color: "#8A96A8", fontSize: 9.5, fontWeight: "900", letterSpacing: 0.6, textTransform: "uppercase" }, placeTitle: { color: "#0B1F3A", fontSize: 13, fontWeight: "900", marginTop: 2 }, placeSubtitle: { color: "#697386", fontSize: 10.5, marginTop: 2 }, divider: { height: 13, width: 1, backgroundColor: "#C9D4DF", marginLeft: 15, marginVertical: 3 }, distance: { color: "#0B1F3A", fontSize: 12, fontWeight: "900" }, center: { flex: 1, justifyContent: "center", alignItems: "center", gap: 11, padding: 20 }, loadingText: { color: "#697386", fontWeight: "800" }, pressed: { opacity: 0.67 },
});
