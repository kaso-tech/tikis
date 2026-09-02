import { StyleSheet, Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import type { LocationLabel } from "@/shared/tikis-domain";

type Coordinate = { latitude: number; longitude: number };

export function DeliveryRouteMap({ pickup, dropoff, coordinates, routeSource, driverPosition }: { pickup: LocationLabel; dropoff: LocationLabel; coordinates: Coordinate[]; routeSource?: "routes" | "provisional"; driverPosition?: { latitude: number; longitude: number; heading?: number | null } | null }) {
  const hasRoute = coordinates.length >= 2;
  const isFallback = routeSource === "provisional" || !hasRoute;
  return <View style={styles.container}><View style={styles.grid} /><View style={[styles.route, isFallback && styles.routeFallback]} /><View style={styles.start}><MaterialIcons name="inventory-2" size={17} color="#FFFFFF" /></View><View style={styles.destination}><MaterialIcons name="location-on" size={25} color="#B4232D" /></View>{driverPosition ? <View style={styles.driver}><MaterialIcons name="navigation" size={15} color="#FFFFFF" /></View> : null}<View style={styles.webNote}><MaterialIcons name="map" size={17} color="#9A6201" /><Text style={styles.webNoteText}>{isFallback ? "Itinéraire approximatif : la carte interactive affiche l'itinéraire réel dans Expo Go." : "La carte interactive est disponible dans Expo Go sur iOS et Android."}</Text></View></View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, overflow: "hidden", backgroundColor: "#EEEDF3", position: "relative" }, grid: { ...StyleSheet.absoluteFillObject, opacity: 0.28, backgroundColor: "#EEEDF3" }, route: { position: "absolute", height: 6, borderRadius: 4, backgroundColor: "#9A6201", width: "65%", top: "51%", left: "17%", transform: [{ rotate: "-17deg" }] }, routeFallback: { backgroundColor: "#9A6200", opacity: 0.85, borderStyle: "dashed" }, start: { position: "absolute", left: "15%", top: "62%", width: 30, height: 30, borderRadius: 7, backgroundColor: "#9A6201", alignItems: "center", justifyContent: "center", borderWidth: 0 }, destination: { position: "absolute", right: "15%", top: "31%", width: 32, height: 32, borderRadius: 8, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", shadowOpacity: 0, shadowRadius: 0, elevation: 0 }, driver: { position: "absolute", left: "48%", top: "45%", width: 30, height: 30, borderRadius: 15, backgroundColor: "#007B8B", alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#FFFFFF" }, webNote: { position: "absolute", left: 14, right: 14, bottom: 14, padding: 11, borderRadius: 9, backgroundColor: "rgba(255,255,255,0.94)", flexDirection: "row", gap: 7, alignItems: "center" }, webNoteText: { color: "#666666", fontSize: 12, fontWeight: "500", flex: 1, lineHeight: 17 },
});
