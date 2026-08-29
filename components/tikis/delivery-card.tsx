import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useState } from "react";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { StatusBadge, TikisButton } from "@/components/tikis/ui";
import { MapPreview } from "@/components/tikis/map-preview";
import { haptic } from "@/lib/haptics";
import { useDriverPickupDistance } from "@/hooks/use-driver-pickup-distance";
import { formatListRouteParts, formatNavigationTarget } from "@/lib/geo-rules";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";
import { deliveryStatusMeta, formatMoney, formatRelativeDate, type Delivery } from "@/shared/tikis-domain";

export function DeliveryCard({ delivery, onPress, onMap }: { delivery: Delivery; onPress: () => void; onMap: () => void }) {
  const { role } = useTikisStore();
  const utilities = trpc.useUtils();
  const application = trpc.deliveries.submitApplication.useMutation();
  const status = deliveryStatusMeta[delivery.status];
  const route = formatListRouteParts(delivery.pickup, delivery.dropoff);
  const isApplying = application.isPending;
  const [openingMap, setOpeningMap] = useState(false);
  const mayApply = role === "driver" && delivery.status === "open" && !["applied", "selected", "confirmed"].includes(delivery.ownCandidateStatus ?? "");
  const driverDistance = useDriverPickupDistance(role === "driver" ? delivery.pickup : null);

  async function apply() {
    try {
      await application.mutateAsync({ deliveryId: delivery.id });
      await Promise.all([utilities.deliveries.list.invalidate(), utilities.deliveries.candidates.invalidate({ deliveryId: delivery.id }), utilities.wallet.snapshot.invalidate(), utilities.notifications.list.invalidate()]);
      haptic.success();
    } catch {
      Alert.alert("Candidature indisponible", "Votre candidature n’a pas pu être enregistrée. Vérifiez votre solde Wallet puis réessayez.");
    }
  }

  function confirmApplication() {
    if (!mayApply || isApplying) return;
    Alert.alert("Postuler à cette livraison", "La commission Tikis sera temporairement bloquée dans votre Wallet. Elle sera libérée si vous n’êtes pas retenu.", [{ text: "Plus tard", style: "cancel" }, { text: "Postuler", onPress: () => void apply() }]);
  }

  function openMap() {
    setOpeningMap(true);
    onMap();
    setTimeout(() => setOpeningMap(false), 500);
  }

  const showApproximate = role === "driver" && delivery.routeVisibility === "approximate";

  return <View style={styles.card}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Consulter la livraison ${delivery.title}`} onPress={() => { haptic.light(); onPress(); }} style={({ pressed }) => [styles.summary, pressed && styles.pressed]}>
      <View style={styles.topRow}><View style={styles.vehicleIcon}><MaterialIcons name={delivery.type === "Personne" ? "person-pin-circle" : delivery.type === "Plis" ? "description" : "inventory-2"} size={18} color="#111111" /></View><View style={styles.titleWrap}><Text style={styles.title} numberOfLines={1}>{delivery.title}</Text><Text style={styles.when}>{delivery.type} · {formatRelativeDate(delivery.createdAt)}</Text></View><StatusBadge label={status.label} color={status.color} background={status.background} /></View>
      <View style={styles.mapWrap}>
        <MapPreview pickup={delivery.pickup} dropoff={delivery.dropoff} height={120} approximate={showApproximate} />
      </View>
      <View style={styles.addresses}>
        <View style={styles.addressRow}>
          <View style={[styles.addressDot, styles.pickupDot]} />
          <View style={styles.addressCopy}>
            <Text style={styles.addressLabel}>Récupération</Text>
            <Text numberOfLines={1} style={styles.addressValue}>{route.pickup}</Text>
          </View>
        </View>
        <View style={styles.addressRow}>
          <View style={[styles.addressDot, styles.dropoffDot]} />
          <View style={styles.addressCopy}>
            <Text style={styles.addressLabel}>Destination</Text>
            <Text numberOfLines={1} style={styles.addressValue}>{route.dropoff}</Text>
          </View>
        </View>
      </View>
      <View style={styles.footer}>
        {role === "driver" ? (
          <DriverDistanceInfo
            loading={driverDistance.status === "loading" || driverDistance.status === "idle"}
            ready={driverDistance.status === "ready"}
            value={driverDistance.distance?.value ?? null}
            unit={driverDistance.distance?.unit ?? null}
            routeKm={delivery.distanceKm}
            navigationTarget={formatNavigationTarget(delivery.pickup)}
          />
        ) : (
          <Text style={styles.distance}>{delivery.distanceKm.toLocaleString("fr-FR")} km</Text>
        )}
        <View style={styles.vehiclePill}><MaterialIcons name="two-wheeler" size={13} color="#555555" /><Text style={styles.vehicleText}>{delivery.vehicleTypes[0] ?? "Engin"}</Text></View>
        <Text style={styles.price}>{formatMoney(delivery.offeredPrice ?? delivery.estimatedPrice)}</Text>
        {role === "sender" ? <View style={styles.candidateCount}><MaterialIcons name="group" size={14} color="#555555" /><Text style={styles.candidateCountText}>{delivery.candidateCount ?? 0}</Text><MaterialIcons name="chevron-right" size={17} color="#888888" /></View> : null}
      </View>
    </Pressable>
    <View style={styles.actions}><TikisButton label="Carte" icon="map" variant="secondary" onPress={openMap} loading={openingMap} loadingLabel="Carte…" style={styles.mapButton} />{mayApply ? <TikisButton label="Postuler" icon="add-task" onPress={confirmApplication} loading={isApplying} loadingLabel="Candidature…" style={styles.applyButton} /> : null}{role === "driver" && delivery.ownCandidateStatus === "applied" ? <View style={styles.appliedState}><MaterialIcons name="check-circle" size={17} color="#167A55" /><Text style={styles.appliedStateText}>Candidature envoyée</Text></View> : null}</View>
  </View>;
}

function DriverDistanceInfo({ loading, ready, value, unit, routeKm, navigationTarget }: { loading: boolean; ready: boolean; value: string | null; unit: "m" | "km" | null; routeKm: number; navigationTarget: string }) {
  if (loading) {
    return <View style={styles.driverDistance}>
      <View style={styles.driverDistanceIcon}><MaterialIcons name="near-me" size={13} color="#007B8B" /></View>
      <View style={styles.driverDistanceCopy}>
        <Text style={styles.driverDistanceLabel}>Distance</Text>
        <Text style={styles.driverDistanceValue}>Calcul en cours…</Text>
      </View>
    </View>;
  }
  if (!ready || !value || !unit) {
    return <View style={styles.driverDistance}>
      <View style={styles.driverDistanceIcon}><MaterialIcons name="location-disabled" size={13} color="#9A6200" /></View>
      <View style={styles.driverDistanceCopy}>
        <Text style={styles.driverDistanceLabel}>Distance</Text>
        <Text style={styles.driverDistanceValueFallback}>{navigationTarget}</Text>
        <Text style={styles.driverDistanceSub}>Course de {routeKm.toLocaleString("fr-FR")} km</Text>
      </View>
    </View>;
  }
  return <View style={styles.driverDistance}>
    <View style={styles.driverDistanceIcon}><MaterialIcons name="near-me" size={13} color="#007B8B" /></View>
    <View style={styles.driverDistanceCopy}>
      <Text style={styles.driverDistanceLabel}>Distance</Text>
      <Text style={styles.driverDistanceValue}>{value} <Text style={styles.driverDistanceUnit}>{unit}</Text></Text>
      <Text style={styles.driverDistanceSub}>Course de {routeKm.toLocaleString("fr-FR")} km</Text>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#FFFFFF", borderRadius: 9, marginBottom: 8, overflow: "hidden", elevation: 0 },
  summary: { padding: 12, paddingBottom: 10 },
  pressed: { opacity: 0.76 },
  topRow: { flexDirection: "row", alignItems: "center" },
  vehicleIcon: { width: 35, height: 35, borderRadius: 8, backgroundColor: "#EEEDF3", alignItems: "center", justifyContent: "center", marginRight: 9 },
  titleWrap: { flex: 1, marginRight: 8 },
  title: { color: "#111111", fontSize: 15, fontWeight: "600" },
  when: { color: "#747474", fontSize: 11, fontWeight: "500", marginTop: 2 },
  mapWrap: { marginTop: 10, borderRadius: 9, overflow: "hidden" },
  addresses: { marginTop: 10, gap: 8 },
  addressRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  addressDot: { width: 8, height: 8, borderRadius: 4, marginLeft: 4 },
  pickupDot: { backgroundColor: "#007B8B" },
  dropoffDot: { backgroundColor: "#B4232D" },
  addressCopy: { flex: 1 },
  addressLabel: { color: "#747474", fontSize: 9, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase" },
  addressValue: { color: "#111111", fontSize: 12, fontWeight: "600", marginTop: 1 },
  footer: { borderTopColor: "#ECECEC", borderTopWidth: 1, marginTop: 10, paddingTop: 9, flexDirection: "row", alignItems: "center" },
  distance: { color: "#111111", fontSize: 12, fontWeight: "600" },
  driverDistance: { flexDirection: "row", alignItems: "center", gap: 7, flex: 1 },
  driverDistanceIcon: { width: 26, height: 26, borderRadius: 7, backgroundColor: "#EEEDF3", alignItems: "center", justifyContent: "center" },
  driverDistanceCopy: { flex: 1 },
  driverDistanceLabel: { color: "#747474", fontSize: 9, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase" },
  driverDistanceValue: { color: "#111111", fontSize: 13, fontWeight: "600", marginTop: 1 },
  driverDistanceValueFallback: { color: "#9A6200", fontSize: 12, fontWeight: "500", marginTop: 1 },
  driverDistanceSub: { color: "#747474", fontSize: 10, fontWeight: "500", marginTop: 1 },
  driverDistanceUnit: { color: "#666666", fontSize: 11, fontWeight: "500" },
  vehiclePill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#EEEDF3", borderRadius: 5, paddingHorizontal: 7, paddingVertical: 4, marginLeft: 8 },
  vehicleText: { color: "#555555", fontSize: 10.5, fontWeight: "600" },
  price: { color: "#111111", fontSize: 15, fontWeight: "600", marginLeft: "auto" },
  candidateCount: { flexDirection: "row", alignItems: "center", gap: 2, marginLeft: 8 },
  candidateCountText: { color: "#555555", fontSize: 11, fontWeight: "600" },
  actions: { flexDirection: "row", alignItems: "center", gap: 8, borderTopWidth: 1, borderColor: "#ECECEC", padding: 9, backgroundColor: "#FFFFFF" },
  mapButton: { flex: 1, minHeight: 40, borderRadius: 7 },
  applyButton: { flex: 1.25, minHeight: 40, borderRadius: 7 },
  appliedState: { flex: 1.25, minHeight: 40, paddingHorizontal: 10, borderRadius: 7, backgroundColor: "#EEEDF3", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 },
  appliedStateText: { color: "#167A55", fontSize: 11, fontWeight: "600" },
});
