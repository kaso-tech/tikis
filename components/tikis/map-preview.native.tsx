import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { StyleSheet, Text, View } from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";

import { DropoffMarker, PickupMarker, PIN_ANCHOR } from "@/components/tikis/map-markers";
import { formatListRouteParts, formatNavigationTarget } from "@/lib/geo-rules";
import type { LocationLabel } from "@/shared/tikis-domain";

type Props = {
  pickup: LocationLabel;
  dropoff: LocationLabel;
  height?: number;
  approximate?: boolean;
  /** La légende double les adresses quand l'écran les affiche déjà juste en dessous. */
  showLegend?: boolean;
};

export function MapPreviewLeaflet({ pickup, dropoff, height = 132, approximate, showLegend = true }: Props) {
  // Même formateur centralisé que le texte du trajet (delivery-card.tsx) : sans lui, cette légende
  // affichait `pickup.name`/`dropoff.name` bruts, ignorant la règle "Ville → Ville" quand les villes
  // diffèrent — deux libellés différents pour le même trajet, dans le même écran.
  const route = formatListRouteParts(pickup, dropoff);
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
          strokeColor="#9A6201"
          strokeWidth={3}
          lineCap="round"
        />
        <Marker coordinate={{ latitude: pickup.latitude, longitude: pickup.longitude }} anchor={PIN_ANCHOR}>
          <PickupMarker />
        </Marker>
        <Marker coordinate={{ latitude: dropoff.latitude, longitude: dropoff.longitude }} anchor={PIN_ANCHOR}>
          <DropoffMarker />
        </Marker>
      </MapView>
      {approximate ? (
        <View style={styles.approximate}>
          <MaterialIcons name="privacy-tip" size={11} color="#9A6201" />
          <Text style={styles.approximateText}>Aperçu indicatif</Text>
        </View>
      ) : null}
      {showLegend ? (
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
      ) : null}
    </View>
  );
}

export { MapPreviewLeaflet as MapPreview };

const styles = StyleSheet.create({
  frame: {
    borderRadius: 9,
    backgroundColor: "#F0F3F8",
    overflow: "hidden",
    position: "relative",
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
    color: "#9A6201",
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
    backgroundColor: "#9A6201",
  },
  legendDotDropoff: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#A43740",
  },
  legendLabel: {
    color: "#111111",
    fontSize: 11,
    fontWeight: "600",
    flex: 1,
  },
  legendSub: {
    color: "#667085",
    fontSize: 10,
    lineHeight: 13,
    paddingLeft: 15,
  },
  legendDivider: {
    height: 1,
    backgroundColor: "#E3E3E3",
    marginVertical: 2,
  },
});
