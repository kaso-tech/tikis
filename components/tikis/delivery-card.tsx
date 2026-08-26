import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { StatusBadge } from "@/components/tikis/ui";
import { haptic } from "@/lib/haptics";
import { deliveryStatusMeta, displayLocation, formatMoney, type Delivery } from "@/shared/tikis-domain";

export function DeliveryCard({ delivery, onPress }: { delivery: Delivery; onPress: () => void }) {
  const status = deliveryStatusMeta[delivery.status];

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        haptic.light();
        onPress();
      }}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.topRow}>
        <View style={styles.vehicleIcon}><MaterialIcons name="local-shipping" size={19} color="#007B8B" /></View>
        <View style={styles.titleWrap}>
          <Text style={styles.title} numberOfLines={1}>{delivery.title}</Text>
          <Text style={styles.when}>{delivery.scheduledAt}</Text>
        </View>
        <StatusBadge label={status.label} color={status.color} background={status.background} />
      </View>
      <View style={styles.route}>
        <View style={styles.routeMarkerWrap}>
          <View style={styles.pickupDot} />
          <View style={styles.routeLine} />
          <View style={styles.dropoffDot} />
        </View>
        <View style={styles.routeLabels}>
          <Text numberOfLines={1} style={styles.routeText}>{displayLocation(delivery.pickup)}</Text>
          <Text numberOfLines={1} style={[styles.routeText, styles.dropoff]}>{displayLocation(delivery.dropoff)}</Text>
        </View>
      </View>
      <View style={styles.footer}>
        <Text style={styles.distance}>{delivery.distanceKm.toLocaleString("fr-FR")} km · {delivery.vehicleTypes.join(", ")}</Text>
        <Text style={styles.price}>{formatMoney(delivery.offeredPrice ?? delivery.estimatedPrice)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#FFFFFF", borderRadius: 20, padding: 15, borderWidth: 1, borderColor: "#E7ECF2", marginBottom: 12 },
  pressed: { opacity: 0.76, transform: [{ scale: 0.99 }] },
  topRow: { flexDirection: "row", alignItems: "center" },
  vehicleIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: "#E5F6F7", alignItems: "center", justifyContent: "center", marginRight: 10 },
  titleWrap: { flex: 1, marginRight: 8 },
  title: { color: "#0B1F3A", fontSize: 15, fontWeight: "900" },
  when: { color: "#778398", fontSize: 12, marginTop: 2 },
  route: { flexDirection: "row", marginTop: 15 },
  routeMarkerWrap: { width: 18, alignItems: "center", paddingTop: 4 },
  pickupDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#007B8B", borderWidth: 2, borderColor: "#CDE4E7" },
  routeLine: { height: 19, width: 1.5, backgroundColor: "#C9D4DF" },
  dropoffDot: { width: 8, height: 8, borderRadius: 2, backgroundColor: "#0B1F3A" },
  routeLabels: { flex: 1, gap: 10, paddingLeft: 5 },
  routeText: { color: "#485569", fontSize: 13, lineHeight: 16 },
  dropoff: { color: "#0B1F3A", fontWeight: "700" },
  footer: { borderTopColor: "#EEF2F6", borderTopWidth: 1, marginTop: 14, paddingTop: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  distance: { color: "#0B1F3A", fontSize: 12, fontWeight: "700" },
  price: { color: "#007B8B", fontSize: 15, fontWeight: "900" },
});

