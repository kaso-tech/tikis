import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useState } from "react";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { StatusBadge, TikisButton } from "@/components/tikis/ui";
import { haptic } from "@/lib/haptics";
import { formatListRouteParts } from "@/lib/geo-rules";
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

  return <View style={styles.card}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Consulter la livraison ${delivery.title}`} onPress={() => { haptic.light(); onPress(); }} style={({ pressed }) => [styles.summary, pressed && styles.pressed]}>
      <View style={styles.topRow}><View style={styles.vehicleIcon}><MaterialIcons name={delivery.type === "Personne" ? "person-pin-circle" : delivery.type === "Plis" ? "description" : "inventory-2"} size={18} color="#111111" /></View><View style={styles.titleWrap}><Text style={styles.title} numberOfLines={1}>{delivery.title}</Text><Text style={styles.when}>{delivery.type} · {formatRelativeDate(delivery.createdAt)}</Text></View><StatusBadge label={status.label} color={status.color} background={status.background} /></View>
      <View style={styles.route}><View style={styles.routeMarkerWrap}><View style={styles.pickupDot} /><View style={styles.routeLine} /><View style={styles.dropoffDot} /></View><View style={styles.routeLabels}><Text numberOfLines={1} style={styles.routeText}>{route.pickup}</Text><Text numberOfLines={1} style={[styles.routeText, styles.dropoff]}>{route.dropoff}</Text></View></View>
      <View style={styles.footer}><Text style={styles.distance}>{delivery.distanceKm.toLocaleString("fr-FR")} km</Text><View style={styles.vehiclePill}><MaterialIcons name="two-wheeler" size={13} color="#555555" /><Text style={styles.vehicleText}>{delivery.vehicleTypes[0] ?? "Engin"}</Text></View><Text style={styles.price}>{formatMoney(delivery.offeredPrice ?? delivery.estimatedPrice)}</Text>{role === "sender" ? <View style={styles.candidateCount}><MaterialIcons name="group" size={14} color="#555555" /><Text style={styles.candidateCountText}>{delivery.candidateCount ?? 0}</Text><MaterialIcons name="chevron-right" size={17} color="#888888" /></View> : null}</View>
    </Pressable>
    <View style={styles.actions}><TikisButton label="Carte" icon="map" variant="secondary" onPress={openMap} loading={openingMap} loadingLabel="Carte…" style={styles.mapButton} />{mayApply ? <TikisButton label="Postuler" icon="add-task" onPress={confirmApplication} loading={isApplying} loadingLabel="Candidature…" style={styles.applyButton} /> : null}{role === "driver" && delivery.ownCandidateStatus === "applied" ? <View style={styles.appliedState}><MaterialIcons name="check-circle" size={17} color="#167A55" /><Text style={styles.appliedStateText}>Candidature envoyée</Text></View> : null}</View>
    {role === "driver" && delivery.routeVisibility === "approximate" ? <Text style={styles.privacyNote}>Carte indicative : les adresses exactes sont partagées après confirmation.</Text> : null}
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
  route: { flexDirection: "row", marginTop: 12 },
  routeMarkerWrap: { width: 18, alignItems: "center", paddingTop: 4 },
  pickupDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#007B8B", borderWidth: 2, borderColor: "#CDE4E7" },
  routeLine: { height: 19, width: 1.5, backgroundColor: "#CFCFCF" },
  dropoffDot: { width: 9, height: 9, borderRadius: 2, backgroundColor: "#111111" },
  routeLabels: { flex: 1, gap: 8, paddingLeft: 5 },
  routeText: { color: "#666666", fontSize: 12, lineHeight: 16 },
  dropoff: { color: "#111111", fontWeight: "600" },
  footer: { borderTopColor: "#ECECEC", borderTopWidth: 1, marginTop: 12, paddingTop: 9, flexDirection: "row", alignItems: "center" },
  distance: { color: "#111111", fontSize: 12, fontWeight: "600" },
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
  privacyNote: { color: "#666666", fontSize: 10.5, lineHeight: 15, paddingHorizontal: 13, paddingBottom: 10, backgroundColor: "#FFFFFF" },
});
