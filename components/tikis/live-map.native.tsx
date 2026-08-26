import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";
import { coordinateAtStep, remainingMinutes, routeProgress, SIMULATED_ROUTE } from "@/lib/gps-simulator";

export function LiveMap({ driverName }: { driverName: string }) {
  const [step, setStep] = useState(3);
  const mapRef = useRef<MapView | null>(null);
  const position = coordinateAtStep(step);
  const progress = routeProgress(step);

  useEffect(() => {
    const interval = setInterval(() => setStep((current) => current >= SIMULATED_ROUTE.length - 1 ? 0 : current + 1), 2800);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    mapRef.current?.animateCamera({ center: position, pitch: 35, heading: 40, zoom: 15.3 }, { duration: 720 });
  }, [position]);

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={{ latitude: position.latitude, longitude: position.longitude, latitudeDelta: 0.018, longitudeDelta: 0.018 }}
        showsUserLocation={false}
        showsCompass={false}
        rotateEnabled={false}
        toolbarEnabled={false}
      >
        <Polyline coordinates={SIMULATED_ROUTE} strokeColor="#007B8B" strokeWidth={5} lineCap="round" />
        <Marker coordinate={SIMULATED_ROUTE[0]} anchor={{ x: 0.5, y: 0.5 }}>
          <View style={styles.startMarker}><MaterialIcons name="inventory-2" size={15} color="#FFFFFF" /></View>
        </Marker>
        <Marker coordinate={SIMULATED_ROUTE[SIMULATED_ROUTE.length - 1]} anchor={{ x: 0.5, y: 0.85 }}>
          <View style={styles.destinationMarker}><MaterialIcons name="location-on" size={26} color="#E45858" /></View>
        </Marker>
        <Marker coordinate={position} anchor={{ x: 0.5, y: 0.5 }} flat rotation={40}>
          <View style={styles.driverMarker}><MaterialIcons name="two-wheeler" size={22} color="#FFFFFF" /></View>
        </Marker>
      </MapView>
      <View style={styles.liveBadge}><View style={styles.liveDot} /><Text style={styles.liveText}>POSITION MISE À JOUR</Text></View>
      <View style={styles.progressBubble}><Text style={styles.progressMain}>{progress} %</Text><Text style={styles.progressSub}>{driverName} · arrivée estimée dans {remainingMinutes(step)} min</Text></View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { height: 360, overflow: "hidden", borderRadius: 24, backgroundColor: "#D8E8E5" },
  map: { ...StyleSheet.absoluteFillObject },
  startMarker: { width: 31, height: 31, borderRadius: 12, backgroundColor: "#007B8B", alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#FFFFFF" },
  destinationMarker: { width: 33, height: 33, borderRadius: 17, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", shadowColor: "#0B1F3A", shadowOpacity: 0.2, shadowRadius: 6, elevation: 4 },
  driverMarker: { width: 46, height: 46, borderRadius: 23, backgroundColor: "#0B1F3A", alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: "#FFFFFF", shadowColor: "#0B1F3A", shadowOpacity: 0.3, shadowRadius: 7, elevation: 6 },
  liveBadge: { position: "absolute", top: 14, left: 14, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 10, height: 30, borderRadius: 15, backgroundColor: "rgba(255,255,255,0.95)" },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#18A572" }, liveText: { color: "#147A58", fontSize: 10, fontWeight: "900", letterSpacing: 0.45 },
  progressBubble: { position: "absolute", left: 14, right: 14, bottom: 14, padding: 12, borderRadius: 17, backgroundColor: "rgba(11,31,58,0.94)" },
  progressMain: { color: "#FFFFFF", fontSize: 18, fontWeight: "900" }, progressSub: { color: "#BED0E7", fontSize: 12, marginTop: 2 },
});

