import { StyleSheet, Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { DriverMarker, DropoffMarker, PickupMarker } from "@/components/tikis/map-markers";
import { useThemeColors } from "@/lib/use-theme-colors";
import type { LocationLabel } from "@/shared/tikis-domain";

type Coordinate = { latitude: number; longitude: number };

export function DeliveryRouteMap({ pickup, dropoff, coordinates, routeSource, driverPosition }: { pickup: LocationLabel; dropoff: LocationLabel; coordinates: Coordinate[]; routeSource?: "routes" | "provisional"; driverPosition?: { latitude: number; longitude: number; heading?: number | null } | null; /** Ignorés sur le web : l'aperçu n'est pas une vraie carte. */ approachCoordinates?: Coordinate[]; bottomInset?: number }) {
  const { colors: theme } = useThemeColors();
  const hasRoute = coordinates.length >= 2;
  const isFallback = routeSource === "provisional" || !hasRoute;
  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.grid, { backgroundColor: theme.background }]} />
      <View style={[styles.route, isFallback && { backgroundColor: theme.warning, opacity: 0.85 }, { backgroundColor: theme.primary }]} />
      <View style={styles.start}><PickupMarker /></View>
      <View style={styles.destination}><DropoffMarker /></View>
      {driverPosition ? (
        <View style={styles.driver}><DriverMarker heading={driverPosition.heading} /></View>
      ) : null}
      <View style={styles.webNote}>
        <MaterialIcons name="map" size={17} color={theme.primary} />
        <Text style={[styles.webNoteText, { color: theme.muted }]}>{isFallback ? "Itinéraire approximatif : la carte interactive affiche l'itinéraire réel dans Expo Go." : "La carte interactive est disponible dans Expo Go sur iOS et Android."}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, overflow: "hidden", position: "relative" },
  grid: { ...StyleSheet.absoluteFill, opacity: 0.28 },
  route: { position: "absolute", height: 6, borderRadius: 4, width: "65%", top: "51%", left: "17%", transform: [{ rotate: "-17deg" }] },
  // Les marqueurs sont ancrés par leur pointe : on positionne le coin haut-gauche du dessin.
  start: { position: "absolute", left: "15%", top: "62%", marginLeft: -19, marginTop: -37 },
  destination: { position: "absolute", right: "15%", top: "31%", marginRight: -19, marginTop: -37 },
  driver: { position: "absolute", left: "48%", top: "45%", marginLeft: -22, marginTop: -22 },
  webNote: { position: "absolute", left: 14, right: 14, bottom: 14, padding: 11, borderRadius: 9, backgroundColor: "rgba(255,255,255,0.94)", flexDirection: "row", gap: 7, alignItems: "center" },
  webNoteText: { fontSize: 12, fontWeight: "500", flex: 1, lineHeight: 17 },
});
