import { StyleSheet, Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import type { LocationLabel } from "@/shared/tikis-domain";

export function DeliveryRouteMap({ pickup, dropoff }: { pickup: LocationLabel; dropoff: LocationLabel; coordinates: { latitude: number; longitude: number }[] }) {
  return <View style={styles.container}><View style={styles.grid} /><View style={styles.route} /><View style={styles.start}><MaterialIcons name="inventory-2" size={17} color="#FFFFFF" /></View><View style={styles.destination}><MaterialIcons name="location-on" size={25} color="#E45858" /></View><View style={styles.webNote}><MaterialIcons name="map" size={17} color="#006572" /><Text style={styles.webNoteText}>La carte interactive est disponible dans Expo Go sur iOS et Android.</Text></View></View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, overflow: "hidden", backgroundColor: "#D8E8E5", position: "relative" }, grid: { ...StyleSheet.absoluteFillObject, opacity: 0.28, backgroundColor: "#E9F2EF" }, route: { position: "absolute", height: 6, borderRadius: 4, backgroundColor: "#007B8B", width: "65%", top: "51%", left: "17%", transform: [{ rotate: "-17deg" }] }, start: { position: "absolute", left: "15%", top: "62%", width: 32, height: 32, borderRadius: 12, backgroundColor: "#007B8B", alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#FFFFFF" }, destination: { position: "absolute", right: "15%", top: "31%", width: 35, height: 35, borderRadius: 18, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", shadowColor: "#0B1F3A", shadowOpacity: 0.2, shadowRadius: 6 }, webNote: { position: "absolute", left: 18, right: 18, bottom: 20, padding: 13, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.94)", flexDirection: "row", gap: 8, alignItems: "center" }, webNoteText: { color: "#35656C", fontSize: 12, fontWeight: "700", flex: 1, lineHeight: 17 },
});
