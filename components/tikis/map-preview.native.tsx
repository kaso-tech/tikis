import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { StyleSheet, Text, View } from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";

import { formatNavigationTarget } from "@/lib/geo-rules";
import type { LocationLabel } from "@/shared/tikis-domain";

type Props = {
  pickup: LocationLabel;
  dropoff: LocationLabel;
  height?: number;
  approximate?: boolean;
};

export function MapPreviewLeaflet({ pickup, dropoff, height = 132, approximate }: Props) {
  const center = {
    latitude: (pickup.latitude + dropoff.latitude) / 2,
    longitude: (pickup.longitude + dropoff.longitude) / 2,
  };
  const latitudeDelta = Math.max(0.018, Math.abs(pickup.latitude - dropoff.latitude) * 1.9);
  const longitudeDelta = Math.max(0.018, Math.abs(pickup.longitude - dropoff.longitude) * 1.9);

  return (
    <View style={[styles.frame, { height }]}>
      <MapView
        style={StyleSheet.absoluteFill}
        initialRegion={{ ...center, latitudeDelta, longitudeDelta }}
        pointerEvents="none"
        showsCompass={false}
        showsUserLocation={false}
        showsMyLocationButton={false}
        toolbarEnabled={false}
        rotateEnabled={false}
        zoomEnabled={false}
        scrollEnabled={false}
      >
        <Polyline
          coordinates={[
            { latitude: pickup.latitude, longitude: pickup.longitude },
            { latitude: dropoff.latitude, longitude: dropoff.longitude },
          ]}
          strokeColor="#007B8B"
          strokeWidth={3}
          lineCap="round"
        />
        <Marker coordinate={{ latitude: pickup.latitude, longitude: pickup.longitude }} anchor={{ x: 0.5, y: 0.5 }}>
          <View style={styles.pickupMarker}>
            <MaterialIcons name="trip-origin" size={14} color="#FFFFFF" />
          </View>
        </Marker>
        <Marker coordinate={{ latitude: dropoff.latitude, longitude: dropoff.longitude }} anchor={{ x: 0.5, y: 0.85 }}>
          <View style={styles.dropoffMarker}>
            <MaterialIcons name="location-on" size={16} color="#B4232D" />
          </View>
        </Marker>
      </MapView>
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
            {pickup.name || "Récupération"}
          </Text>
        </View>
        <Text numberOfLines={1} style={styles.legendSub}>
          {formatNavigationTarget(pickup)}
        </Text>
        <View style={styles.legendDivider} />
        <View style={styles.legendRow}>
          <View style={styles.legendDotDropoff} />
          <Text numberOfLines={1} style={styles.legendLabel}>
            {dropoff.name || "Destination"}
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
  pickupMarker: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#007B8B",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
  dropoffMarker: {
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
