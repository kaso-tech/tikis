import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import MapView, { Marker, Polyline } from "react-native-maps";
import { useThemeColors } from "@/lib/use-theme-colors";
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

export function DeliveryRouteMap({
  pickup,
  dropoff,
  coordinates,
  routeSource,
  driverPosition,
  approachCoordinates,
  bottomInset = 0,
}: {
  pickup: LocationLabel;
  dropoff: LocationLabel;
  coordinates: Coordinate[];
  routeSource?: "routes" | "provisional";
  driverPosition?: { latitude: number; longitude: number; heading?: number | null } | null;
  /** Segment livreur → récupération : ce qui bouge maintenant, tracé par-dessus la course. */
  approachCoordinates?: Coordinate[];
  /** Hauteur occupée en bas de l'écran (feuille de suivi), pour que le cadrage ne passe pas dessous. */
  bottomInset?: number;
}) {
  const { colors: theme } = useThemeColors();
  const mapRef = useRef<MapView>(null);
  const route = useMemo<Coordinate[]>(() => {
    if (coordinates.length >= 2) return coordinates;
    return buildInterpolatedRoute(
      { latitude: pickup.latitude, longitude: pickup.longitude },
      { latitude: dropoff.latitude, longitude: dropoff.longitude },
    );
  }, [coordinates, dropoff.latitude, dropoff.longitude, pickup.latitude, pickup.longitude]);
  const isFallback = routeSource === "provisional" || coordinates.length < 2;

  // Le cadrage lisait `driverPosition` : la carte se replaçait à chaque point GPS
  // reçu, donc tout déplacement au doigt était annulé quelques secondes plus tard.
  const driverPositionRef = useRef(driverPosition);
  const bottomInsetRef = useRef(bottomInset);
  useEffect(() => {
    driverPositionRef.current = driverPosition;
    bottomInsetRef.current = bottomInset;
  }, [bottomInset, driverPosition]);
  const [userMovedMap, setUserMovedMap] = useState(false);

  const fitToRoute = useCallback((animated: boolean) => {
    const driver = driverPositionRef.current;
    const points = driver ? [...route, { latitude: driver.latitude, longitude: driver.longitude }] : route;
    // Marges au plus juste : le cadrage doit zoomer autant que l'espace le
    // permet. Les 52 px de côté et le plancher de 82 px en bas laissaient de
    // l'espace mort autour du tracé, donc une carte inutilement dézoomée.
    mapRef.current?.fitToCoordinates(points, {
      edgePadding: { top: 28, right: 24, bottom: Math.max(28, bottomInsetRef.current + 20), left: 24 },
      animated,
    });
  }, [route]);

  useEffect(() => {
    setUserMovedMap(false);
    const timer = setTimeout(() => fitToRoute(true), 180);
    return () => clearTimeout(timer);
  }, [fitToRoute]);

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={{ latitude: pickup.latitude, longitude: pickup.longitude, latitudeDelta: 0.08, longitudeDelta: 0.08 }}
        showsCompass={false}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
        onPanDrag={() => setUserMovedMap(true)}
        onRegionChangeComplete={(_region, details) => { if (details?.isGesture) setUserMovedMap(true); }}
      >
        <Polyline coordinates={route} strokeColor={isFallback ? theme.warning : theme.primary} strokeWidth={5} lineCap="round" lineJoin="round" lineDashPattern={isFallback ? [10, 6] : undefined} />
        {approachCoordinates && approachCoordinates.length >= 2 ? (
          <Polyline coordinates={approachCoordinates} strokeColor={theme.success} strokeWidth={5} lineCap="round" lineJoin="round" />
        ) : null}
        <Marker coordinate={{ latitude: pickup.latitude, longitude: pickup.longitude }} anchor={{ x: 0.5, y: 0.5 }}><View style={styles.startMarker}><MaterialIcons name="inventory-2" size={15} color={theme.surface} /></View></Marker>
        <Marker coordinate={{ latitude: dropoff.latitude, longitude: dropoff.longitude }} anchor={{ x: 0.5, y: 0.85 }}><View style={styles.destinationMarker}><MaterialIcons name="location-on" size={26} color={theme.error} /></View></Marker>
        {driverPosition ? (
          <Marker coordinate={{ latitude: driverPosition.latitude, longitude: driverPosition.longitude }} anchor={{ x: 0.5, y: 0.5 }} rotation={driverPosition.heading ?? 0} flat>
            <View style={styles.driverMarker}><MaterialIcons name="navigation" size={18} color={theme.surface} /></View>
          </Marker>
        ) : null}
      </MapView>
      {userMovedMap ? (
        <Pressable
          onPress={() => { setUserMovedMap(false); fitToRoute(true); }}
          accessibilityRole="button"
          accessibilityLabel="Recentrer la carte sur le trajet"
          style={({ pressed }) => [styles.recenter, { backgroundColor: theme.surface, borderColor: theme.border, bottom: bottomInset + 16 }, pressed && { opacity: 0.7 }]}
        >
          <MaterialIcons name="my-location" size={18} color={theme.foreground} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F0F3F8" },
  map: { ...StyleSheet.absoluteFill },
  startMarker: { width: 32, height: 32, borderRadius: 8, backgroundColor: "#9A6201", alignItems: "center", justifyContent: "center", borderWidth: 0 },
  destinationMarker: { width: 34, height: 34, borderRadius: 9, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  driverMarker: { width: 34, height: 34, borderRadius: 17, backgroundColor: "#9A6201", alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#FFFFFF" },
  recenter: { position: "absolute", right: 14, width: 44, height: 44, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
});
