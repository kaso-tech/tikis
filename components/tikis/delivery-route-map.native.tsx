import { useEffect, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import MapView, { Marker, Polyline } from "react-native-maps";
import type { LocationLabel } from "@/shared/tikis-domain";

type Coordinate = { latitude: number; longitude: number };

export function DeliveryRouteMap({ pickup, dropoff, coordinates }: { pickup: LocationLabel; dropoff: LocationLabel; coordinates: Coordinate[] }) {
  const mapRef = useRef<MapView>(null);
  const route = useMemo(() => coordinates.length >= 2 ? coordinates : [{ latitude: pickup.latitude, longitude: pickup.longitude }, { latitude: dropoff.latitude, longitude: dropoff.longitude }], [coordinates, dropoff.latitude, dropoff.longitude, pickup.latitude, pickup.longitude]);

  useEffect(() => {
    const timer = setTimeout(() => mapRef.current?.fitToCoordinates(route, { edgePadding: { top: 72, right: 52, bottom: 82, left: 52 }, animated: true }), 180);
    return () => clearTimeout(timer);
  }, [route]);

  return (
    <View style={styles.container}>
      <MapView ref={mapRef} style={styles.map} initialRegion={{ latitude: pickup.latitude, longitude: pickup.longitude, latitudeDelta: 0.08, longitudeDelta: 0.08 }} showsCompass={false} rotateEnabled={false} toolbarEnabled={false}>
        <Polyline coordinates={route} strokeColor="#007B8B" strokeWidth={5} lineCap="round" lineJoin="round" />
        <Marker coordinate={{ latitude: pickup.latitude, longitude: pickup.longitude }} anchor={{ x: 0.5, y: 0.5 }}><View style={styles.startMarker}><MaterialIcons name="inventory-2" size={15} color="#FFFFFF" /></View></Marker>
        <Marker coordinate={{ latitude: dropoff.latitude, longitude: dropoff.longitude }} anchor={{ x: 0.5, y: 0.85 }}><View style={styles.destinationMarker}><MaterialIcons name="location-on" size={26} color="#E45858" /></View></Marker>
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#D8E8E5" }, map: { ...StyleSheet.absoluteFillObject }, startMarker: { width: 32, height: 32, borderRadius: 8, backgroundColor: "#007B8B", alignItems: "center", justifyContent: "center", borderWidth: 0, shadowOpacity: 0, shadowRadius: 0, elevation: 0 }, destinationMarker: { width: 34, height: 34, borderRadius: 9, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", shadowOpacity: 0, shadowRadius: 0, elevation: 0 },
});
