import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useState } from "react";
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
      await Promise.all([
        utilities.deliveries.list.invalidate(),
        utilities.deliveries.candidates.invalidate({ deliveryId: delivery.id }),
        utilities.wallet.snapshot.invalidate(),
        utilities.notifications.list.invalidate(),
      ]);
      haptic.success();
    } catch {
      Alert.alert("Candidature indisponible", "Votre candidature n’a pas pu être enregistrée. Vérifiez votre solde Wallet puis réessayez.");
    }
  }

  function confirmApplication() {
    if (!mayApply || isApplying) return;
    Alert.alert("Postuler à cette livraison", "La commission Tikis sera temporairement bloquée dans votre Wallet. Elle sera libérée si vous n’êtes pas retenu.", [
      { text: "Plus tard", style: "cancel" },
      { text: "Postuler", onPress: () => void apply() },
    ]);
  }

  function openMap() {
    setOpeningMap(true);
    onMap();
    setTimeout(() => setOpeningMap(false), 500);
  }

  return (
    <View style={styles.card}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Consulter la livraison ${delivery.title}`} onPress={() => { haptic.light(); onPress(); }} style={({ pressed }) => [styles.summary, pressed && styles.pressed]}>
        <View style={styles.topRow}>
          <View style={styles.vehicleIcon}><MaterialIcons name={delivery.type === "Personne" ? "person-pin-circle" : delivery.type === "Plis" ? "description" : "inventory-2"} size={19} color="#007B8B" /></View>
          <View style={styles.titleWrap}>
            <Text style={styles.title} numberOfLines={1}>{delivery.title}</Text>
            <Text style={styles.when}>{delivery.type} · {formatRelativeDate(delivery.createdAt)}</Text>
          </View>
          <StatusBadge label={status.label} color={status.color} background={status.background} />
        </View>
        <View style={styles.route}>
          <View style={styles.routeMarkerWrap}><View style={styles.pickupDot} /><View style={styles.routeLine} /><View style={styles.dropoffDot} /></View>
          <View style={styles.routeLabels}><Text numberOfLines={1} style={styles.routeText}>{route.pickup}</Text><Text numberOfLines={1} style={[styles.routeText, styles.dropoff]}>{route.dropoff}</Text></View>
        </View>
        <View style={styles.footer}>
          <Text style={styles.distance}>{delivery.distanceKm.toLocaleString("fr-FR")} km</Text>
          <View style={styles.vehiclePill}><MaterialIcons name="two-wheeler" size={14} color="#35656C" /><Text style={styles.vehicleText}>{delivery.vehicleTypes[0] ?? "Engin"}</Text></View>
          <Text style={styles.price}>{formatMoney(delivery.offeredPrice ?? delivery.estimatedPrice)}</Text>
          {role === "sender" ? <View style={styles.candidateCount}><MaterialIcons name="group" size={14} color="#35656C" /><Text style={styles.candidateCountText}>{delivery.candidateCount ?? 0}</Text><MaterialIcons name="chevron-right" size={17} color="#8A96A8" /></View> : null}
        </View>
      </Pressable>
      <View style={styles.actions}>
        <TikisButton label="Carte" icon="map" variant="secondary" onPress={openMap} loading={openingMap} loadingLabel="Carte…" style={styles.mapButton} />
        {mayApply ? <TikisButton label="Postuler" icon="add-task" onPress={confirmApplication} loading={isApplying} loadingLabel="Candidature…" style={styles.applyButton} /> : null}
        {role === "driver" && delivery.ownCandidateStatus === "applied" ? <View style={styles.appliedState}><MaterialIcons name="check-circle" size={17} color="#147A58" /><Text style={styles.appliedStateText}>Candidature envoyée</Text></View> : null}
      </View>
      {role === "driver" && delivery.routeVisibility === "approximate" ? <Text style={styles.privacyNote}>Carte indicative : les adresses exactes sont partagées après confirmation.</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: "rgba(255,255,255,0.78)", borderRadius: 22, borderWidth: 1, borderColor: "#E1E8F0", marginBottom: 13, overflow: "hidden", shadowColor: "#0B1F3A", shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  summary: { padding: 15, paddingBottom: 13 },
  pressed: { opacity: 0.76 },
  topRow: { flexDirection: "row", alignItems: "center" },
  vehicleIcon: { width: 38, height: 38, borderRadius: 13, backgroundColor: "#E5F6F7", alignItems: "center", justifyContent: "center", marginRight: 10 },
  titleWrap: { flex: 1, marginRight: 8 },
  title: { color: "#0B1F3A", fontSize: 15, fontWeight: "900" },
  when: { color: "#778398", fontSize: 11, fontWeight: "700", marginTop: 3 },
  route: { flexDirection: "row", marginTop: 15 },
  routeMarkerWrap: { width: 18, alignItems: "center", paddingTop: 4 },
  pickupDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#007B8B", borderWidth: 2, borderColor: "#CDE4E7" },
  routeLine: { height: 20, width: 1.5, backgroundColor: "#C9D4DF" },
  dropoffDot: { width: 9, height: 9, borderRadius: 3, backgroundColor: "#0B1F3A" },
  routeLabels: { flex: 1, gap: 10, paddingLeft: 5 },
  routeText: { color: "#637083", fontSize: 12.5, lineHeight: 16 },
  dropoff: { color: "#0B1F3A", fontWeight: "800" },
  footer: { borderTopColor: "#EEF2F6", borderTopWidth: 1, marginTop: 14, paddingTop: 11, flexDirection: "row", alignItems: "center" },
  distance: { color: "#0B1F3A", fontSize: 12, fontWeight: "900" },
  vehiclePill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#F0F6F7", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 5, marginLeft: 9 },
  vehicleText: { color: "#35656C", fontSize: 10.5, fontWeight: "900" },
  price: { color: "#007B8B", fontSize: 15, fontWeight: "900", marginLeft: "auto" },
  candidateCount: { flexDirection: "row", alignItems: "center", gap: 2, marginLeft: 8 },
  candidateCountText: { color: "#35656C", fontSize: 11, fontWeight: "900" },
  actions: { flexDirection: "row", alignItems: "center", gap: 9, borderTopWidth: 1, borderColor: "#EEF2F6", padding: 11, backgroundColor: "#FBFCFE" },
  mapButton: { flex: 1, minHeight: 42, borderRadius: 12 },
  applyButton: { flex: 1.25, minHeight: 42, borderRadius: 12 },
  appliedState: { flex: 1.25, minHeight: 42, paddingHorizontal: 10, borderRadius: 12, backgroundColor: "#E8F7EF", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 },
  appliedStateText: { color: "#147A58", fontSize: 11, fontWeight: "900" },
  privacyNote: { color: "#8A5A0E", fontSize: 10.5, lineHeight: 15, paddingHorizontal: 15, paddingBottom: 12, backgroundColor: "#FBFCFE" },
});
