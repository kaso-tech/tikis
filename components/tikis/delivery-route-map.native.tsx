import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import MapView, { Polyline } from "react-native-maps";
import { CHIP_ANCHOR, DriverMarker, DropoffMarker, MAP_Z, PickupMarker, PIN_ANCHOR } from "@/components/tikis/map-markers";
import { TrackedMarker } from "@/components/tikis/tracked-marker";
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
        {/* Clés stables et rang de dessin explicite : à rang égal la
            bibliothèque ne promet aucun ordre, et sans clé elle retire côté
            natif le calque qui occupe l'index libéré plutôt que le bon. */}
        <Polyline key="route-line" coordinates={route} strokeColor={isFallback ? theme.warning : theme.primary} strokeWidth={5} lineCap="round" lineJoin="round" lineDashPattern={isFallback ? [10, 6] : undefined} zIndex={MAP_Z.route} />
        {approachCoordinates && approachCoordinates.length >= 2 ? (
          <Polyline key="approach-line" coordinates={approachCoordinates} strokeColor={theme.success} strokeWidth={5} lineCap="round" lineJoin="round" zIndex={MAP_Z.approach} />
        ) : null}
        <TrackedMarker key="pickup" coordinate={{ latitude: pickup.latitude, longitude: pickup.longitude }} anchor={PIN_ANCHOR} zIndex={MAP_Z.pin}>
          <PickupMarker />
        </TrackedMarker>
        <TrackedMarker key="dropoff" coordinate={{ latitude: dropoff.latitude, longitude: dropoff.longitude }} anchor={PIN_ANCHOR} zIndex={MAP_Z.pin}>
          <DropoffMarker />
        </TrackedMarker>
        {driverPosition ? (
          <TrackedMarker key="driver" coordinate={{ latitude: driverPosition.latitude, longitude: driverPosition.longitude }} anchor={CHIP_ANCHOR} zIndex={MAP_Z.driver} redrawKey={driverPosition.heading ?? "no-heading"}>
            <DriverMarker heading={driverPosition.heading} />
          </TrackedMarker>
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
  recenter: { position: "absolute", right: 14, width: 44, height: 44, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
});
