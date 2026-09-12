import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { StyleSheet, Text, View } from "react-native";

import { formatListRouteParts, formatNavigationTarget } from "@/lib/geo-rules";
import type { LocationLabel } from "@/shared/tikis-domain";

type Props = {
  pickup: LocationLabel;
  dropoff: LocationLabel;
  height?: number;
  approximate?: boolean;
};

function projectOntoCanvas(
  origin: { latitude: number; longitude: number },
  target: { latitude: number; longitude: number },
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number },
  canvas: { width: number; height: number },
  padding: number,
) {
  const latRange = bounds.maxLat - bounds.minLat || 0.0001;
  const lngRange = bounds.maxLng - bounds.minLng || 0.0001;
  const innerWidth = canvas.width - padding * 2;
  const innerHeight = canvas.height - padding * 2;
  const xFor = (lng: number) => padding + ((lng - bounds.minLng) / lngRange) * innerWidth;
  const yFor = (lat: number) => padding + (1 - (lat - bounds.minLat) / latRange) * innerHeight;
  return {
    x: xFor(target.longitude),
    y: yFor(target.latitude),
    originX: xFor(origin.longitude),
    originY: yFor(origin.latitude),
  };
}

export function MapPreviewLeaflet({ pickup, dropoff, height = 132, approximate }: Props) {
  // Même formateur centralisé que le texte du trajet (delivery-card.tsx) : sans lui, cette légende
  // affichait `pickup.name`/`dropoff.name` bruts, ignorant la règle "Ville → Ville" quand les villes
  // diffèrent — deux libellés différents pour le même trajet, dans le même écran.
  const route = formatListRouteParts(pickup, dropoff);
  const minLat = Math.min(pickup.latitude, dropoff.latitude);
  const maxLat = Math.max(pickup.latitude, dropoff.latitude);
  const minLng = Math.min(pickup.longitude, dropoff.longitude);
  const maxLng = Math.max(pickup.longitude, dropoff.longitude);
  const latPad = (maxLat - minLat || 0.005) * 0.4;
  const lngPad = (maxLng - minLng || 0.005) * 0.4;
  const bounds = {
    minLat: minLat - latPad,
    maxLat: maxLat + latPad,
    minLng: minLng - lngPad,
    maxLng: maxLng + lngPad,
  };
  const projection = projectOntoCanvas(
    pickup,
    dropoff,
    bounds,
    { width: 320, height },
    24,
  );
  const dx = projection.x - projection.originX;
  const dy = projection.y - projection.originY;
  const length = Math.max(1, Math.hypot(dx, dy));
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;

  return (
    <View style={[styles.frame, { height }]}>
      <View style={styles.grid} />
      <View style={styles.gridHorizontal} />
      <View
        style={[
          styles.routeLine,
          {
            left: projection.originX,
            top: projection.originY,
            width: length,
            transform: [{ translateY: -1 }, { rotate: `${angle}deg` }],
            transformOrigin: "0% 50%",
          },
        ]}
      />
      <View style={[styles.pickup, { left: projection.originX - 12, top: projection.originY - 12 }]}>
        <MaterialIcons name="trip-origin" size={14} color="#FFFFFF" />
      </View>
      <View style={[styles.dropoff, { left: projection.x - 12, top: projection.y - 12 }]}>
        <MaterialIcons name="location-on" size={16} color="#B4232D" />
      </View>
      {approximate ? (
        <View style={styles.approximate}>
          <MaterialIcons name="privacy-tip" size={11} color="#9A6200" />
          <Text style={styles.approximateText}>Aperçu indicatif</Text>
        </View>
      ) : null}
      <View style={styles.legend}>
        <View style={styles.legendRow}>
          <View style={styles.legendDotPickup} />
          <Text numberOfLines={1} style={styles.legendLabel}>
            {route.pickup || "Récupération"}
          </Text>
        </View>
        <Text numberOfLines={1} style={styles.legendSub}>
          {formatNavigationTarget(pickup)}
        </Text>
        <View style={styles.legendDivider} />
        <View style={styles.legendRow}>
          <View style={styles.legendDotDropoff} />
          <Text numberOfLines={1} style={styles.legendLabel}>
            {route.dropoff || "Destination"}
          </Text>
        </View>
        <Text numberOfLines={1} style={styles.legendSub}>
          {formatNavigationTarget(dropoff)}
        </Text>
      </View>
    </View>
  );
}

export { MapPreviewLeaflet as MapPreview };

const styles = StyleSheet.create({
  frame: {
    borderRadius: 9,
    backgroundColor: "#EEEDF3",
    overflow: "hidden",
    position: "relative",
  },
  grid: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.45,
    backgroundColor: "#EEEDF3",
  },
  gridHorizontal: {
    position: "absolute",
    top: "38%",
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: "#D7D5DE",
    opacity: 0.45,
  },
  routeLine: {
    position: "absolute",
    height: 2,
    backgroundColor: "#007B8B",
    borderRadius: 1,
  },
  pickup: {
    position: "absolute",
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#007B8B",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
  dropoff: {
    position: "absolute",
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#B4232D",
  },
  approximate: {
    position: "absolute",
    top: 8,
    right: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "#FFFFFF",
  },
  approximateText: {
    color: "#9A6200",
    fontSize: 10,
    fontWeight: "600",
  },
  legend: {
    position: "absolute",
    left: 8,
    right: 8,
    bottom: 8,
    padding: 8,
    borderRadius: 8,
    backgroundColor: "#FFFFFF",
    gap: 3,
  },
  legendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  legendDotPickup: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#007B8B",
  },
  legendDotDropoff: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#B4232D",
  },
  legendLabel: {
    color: "#111111",
    fontSize: 11,
    fontWeight: "600",
    flex: 1,
  },
  legendSub: {
    color: "#666666",
    fontSize: 10,
    lineHeight: 13,
    paddingLeft: 15,
  },
  legendDivider: {
    height: 1,
    backgroundColor: "#ECECEC",
    marginVertical: 2,
  },
});
