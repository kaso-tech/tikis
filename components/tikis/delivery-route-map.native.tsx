import { useEffect, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import MapView, { Marker, Polyline } from "react-native-maps";
import type { LocationLabel } from "@/shared/tikis-domain";

type Coordinate = { latitude: number; longitude: number };

const FALLBACK_SEGMENTS = 12;

function buildInterpolatedRoute(pickup: Coordinate, dropoff: Coordinate): Coordinate[] {
  const points: Coordinate[] = [];
  for (let i = 0; i <= FALLBACK_SEGMENTS; i += 1) {
    const ratio = i / FALLBACK_SEGMENTS;
    points.push({
      latitude: pickup.latitude + (dropoff.latitude - pickup.latitude) * ratio,
      longitude: pickup.longitude + (dropoff.longitude - pickup.longitude) * ratio,
    });
  }
  return points;
}

export function DeliveryRouteMap({ pickup, dropoff, coordinates, routeSource, driverPosition }: { pickup: LocationLabel; dropoff: LocationLabel; coordinates: Coordinate[]; routeSource?: "routes" | "provisional"; driverPosition?: { latitude: number; longitude: number; heading?: number | null } | null }) {
  const mapRef = useRef<MapView>(null);
  const route = useMemo<Coordinate[]>(() => {
    if (coordinates.length >= 2) return coordinates;
    return buildInterpolatedRoute(
      { latitude: pickup.latitude, longitude: pickup.longitude },
      { latitude: dropoff.latitude, longitude: dropoff.longitude },
    );
  }, [coordinates, dropoff.latitude, dropoff.longitude, pickup.latitude, pickup.longitude]);
  const isFallback = routeSource === "provisional" || coordinates.length < 2;

  useEffect(() => {
    const points = driverPosition ? [...route, { latitude: driverPosition.latitude, longitude: driverPosition.longitude }] : route;
    const timer = setTimeout(() => mapRef.current?.fitToCoordinates(points, { edgePadding: { top: 72, right: 52, bottom: 82, left: 52 }, animated: true }), 180);
    return () => clearTimeout(timer);
  }, [route, driverPosition]);

  return (
    <View style={styles.container}>
      <MapView ref={mapRef} style={styles.map} initialRegion={{ latitude: pickup.latitude, longitude: pickup.longitude, latitudeDelta: 0.08, longitudeDelta: 0.08 }} showsCompass={false} rotateEnabled={false} toolbarEnabled={false}>
        <Polyline coordinates={route} strokeColor={isFallback ? "#9A6200" : "#9A6201"} strokeWidth={5} lineCap="round" lineJoin="round" lineDashPattern={isFallback ? [10, 6] : undefined} />
        <Marker coordinate={{ latitude: pickup.latitude, longitude: pickup.longitude }} anchor={{ x: 0.5, y: 0.5 }}><View style={styles.startMarker}><MaterialIcons name="inventory-2" size={15} color="#FFFFFF" /></View></Marker>
        <Marker coordinate={{ latitude: dropoff.latitude, longitude: dropoff.longitude }} anchor={{ x: 0.5, y: 0.85 }}><View style={styles.destinationMarker}><MaterialIcons name="location-on" size={26} color="#B4232D" /></View></Marker>
        {driverPosition ? (
          <Marker coordinate={{ latitude: driverPosition.latitude, longitude: driverPosition.longitude }} anchor={{ x: 0.5, y: 0.5 }} rotation={driverPosition.heading ?? 0} flat>
            <View style={styles.driverMarker}><MaterialIcons name="navigation" size={18} color="#FFFFFF" /></View>
          </Marker>
        ) : null}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#EEEDF3" }, map: { ...StyleSheet.absoluteFillObject }, startMarker: { width: 32, height: 32, borderRadius: 8, backgroundColor: "#9A6201", alignItems: "center", justifyContent: "center", borderWidth: 0 }, destinationMarker: { width: 34, height: 34, borderRadius: 9, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" }, driverMarker: { width: 34, height: 34, borderRadius: 17, backgroundColor: "#007B8B", alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#FFFFFF" },
});
