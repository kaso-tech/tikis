import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useState } from "react";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { StatusBadge, TikisButton } from "@/components/tikis/ui";
import { FinancialConfirmationModal } from "@/components/tikis/financial-modal";
import { MapPreview } from "@/components/tikis/map-preview";
import { haptic } from "@/lib/haptics";
import { useDriverPickupDistance } from "@/hooks/use-driver-pickup-distance";
import { formatListRouteParts, formatNavigationTarget } from "@/lib/geo-rules";
import { useThemeColors } from "@/lib/use-theme-colors";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";
import { availableWalletBalance, commissionFor, deliveryStatusMeta, formatMoney, formatRelativeDate, type Delivery } from "@/shared/tikis-domain";

export function DeliveryCard({ delivery, onPress, onMap }: { delivery: Delivery; onPress: () => void; onMap: () => void }) {
  const { role } = useTikisStore();
  const { colors: theme } = useThemeColors();
  const utilities = trpc.useUtils();
  const application = trpc.deliveries.submitApplication.useMutation();
  const walletQuery = trpc.wallet.snapshot.useQuery(undefined, { enabled: role === "driver", refetchOnMount: "always", refetchOnWindowFocus: true });
  const status = deliveryStatusMeta[delivery.status];
  const route = formatListRouteParts(delivery.pickup, delivery.dropoff);
  const isApplying = application.isPending;
  const [openingMap, setOpeningMap] = useState(false);
  const [confirmationVisible, setConfirmationVisible] = useState(false);
  const mayApply = role === "driver" && delivery.status === "open" && !["applied", "selected", "confirmed"].includes(delivery.ownCandidateStatus ?? "");
  const driverDistance = useDriverPickupDistance(role === "driver" ? delivery.pickup : null);
  const commission = commissionFor(delivery.offeredPrice ?? delivery.estimatedPrice, { rate: walletQuery.data?.commissionRate ?? 0, currency: "FCFA" });

  async function apply() {
    try {
      const result = await application.mutateAsync({ deliveryId: delivery.id, confirmedCommission: commission });
      utilities.wallet.snapshot.setData(undefined, (current) => current ? { ...current, wallet: result.wallet } : current);
      await Promise.all([utilities.deliveries.list.invalidate(), utilities.deliveries.candidates.invalidate({ deliveryId: delivery.id }), utilities.wallet.snapshot.invalidate(), utilities.notifications.list.invalidate()]);
      setConfirmationVisible(false);
      haptic.success();
    } catch {
      Alert.alert("Candidature indisponible", "Votre candidature n'a pas pu être enregistrée. Vérifiez votre solde Wallet puis réessayez.");
    }
  }

  function confirmApplication() {
    if (!mayApply || isApplying) return;
    const wallet = walletQuery.data?.wallet;
    if (!wallet || !Number.isFinite(walletQuery.data?.commissionRate) || !walletQuery.data?.commissionRate) {
      Alert.alert("Wallet indisponible", "Votre solde doit être chargé avant de pouvoir candidater. Réessayez dans un instant.");
      return;
    }
    if (availableWalletBalance(wallet) < commission) {
      Alert.alert("Solde insuffisant", `Votre solde disponible doit couvrir la commission de ${formatMoney(commission)} pour candidater.`);
      return;
    }
    setConfirmationVisible(true);
  }

  function openMap() {
    setOpeningMap(true);
    onMap();
    setTimeout(() => setOpeningMap(false), 500);
  }

  const showApproximate = role === "driver" && delivery.routeVisibility === "approximate";

  return <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Consulter la livraison ${delivery.title}`} onPress={() => { haptic.light(); onPress(); }} style={({ pressed }) => [styles.summary, pressed && styles.pressed]}>
      <View style={styles.topRow}>
        <View style={[styles.vehicleIcon, { backgroundColor: theme.background }]}>
          <MaterialIcons name={delivery.type === "Personne" ? "person-pin-circle" : delivery.type === "Plis" ? "description" : "inventory-2"} size={18} color={theme.primary} />
        </View>
        <View style={styles.titleWrap}>
          <Text style={[styles.title, { color: theme.foreground }]} numberOfLines={1}>{delivery.title}</Text>
          <Text style={[styles.when, { color: theme.muted }]}>{delivery.type} · {formatRelativeDate(delivery.createdAt)}</Text>
        </View>
        <StatusBadge label={status.label} color={status.color} background={status.background} />
      </View>
      <View style={styles.mapWrap}>
        <MapPreview pickup={delivery.pickup} dropoff={delivery.dropoff} height={120} approximate={showApproximate} />
      </View>
      <View style={styles.addresses}>
        <View style={styles.addressRow}>
          <View style={[styles.addressDot, { backgroundColor: theme.primary }]} />
          <View style={styles.addressCopy}>
            <Text style={[styles.addressLabel, { color: theme.muted }]}>Récupération</Text>
            <Text numberOfLines={1} style={[styles.addressValue, { color: theme.foreground }]}>{route.pickup}</Text>
          </View>
        </View>
        <View style={styles.addressRow}>
          <View style={[styles.addressDot, { backgroundColor: theme.error }]} />
          <View style={styles.addressCopy}>
            <Text style={[styles.addressLabel, { color: theme.muted }]}>Destination</Text>
            <Text numberOfLines={1} style={[styles.addressValue, { color: theme.foreground }]}>{route.dropoff}</Text>
          </View>
        </View>
      </View>
      <View style={[styles.footer, { borderTopColor: theme.border }]}>
        {role === "driver" ? (
          <DriverDistanceInfo
            loading={driverDistance.status === "loading" || driverDistance.status === "idle"}
            ready={driverDistance.status === "ready"}
            value={driverDistance.distance?.value ?? null}
            unit={driverDistance.distance?.unit ?? null}
            routeKm={delivery.distanceKm}
            navigationTarget={formatNavigationTarget(delivery.pickup)}
            theme={theme}
          />
        ) : (
          <Text style={[styles.distance, { color: theme.foreground }]}>{delivery.distanceKm.toLocaleString("fr-FR")} km</Text>
        )}
        <View style={[styles.vehiclePill, { backgroundColor: theme.background }]}><MaterialIcons name="two-wheeler" size={13} color={theme.primary} /><Text style={[styles.vehicleText, { color: theme.muted }]}>{delivery.vehicleTypes[0] ?? "Engin"}</Text></View>
        <Text style={[styles.price, { color: theme.foreground }]}>{formatMoney(delivery.offeredPrice ?? delivery.estimatedPrice)}</Text>
        {role === "sender" ? <View style={styles.candidateCount}><MaterialIcons name="group" size={14} color={theme.muted} /><Text style={[styles.candidateCountText, { color: theme.muted }]}>{delivery.candidateCount ?? 0}</Text><MaterialIcons name="chevron-right" size={17} color={theme.muted} /></View> : null}
      </View>
    </Pressable>
    <View style={[styles.actions, { borderTopColor: theme.border, backgroundColor: theme.surface }]}>
      <TikisButton label="Carte" icon="map" variant="secondary" onPress={openMap} loading={openingMap} loadingLabel="Carte…" style={styles.mapButton} />
      {mayApply ? <TikisButton label="Postuler" icon="add-circle" onPress={confirmApplication} loading={isApplying} loadingLabel="Candidature…" style={styles.applyButton} /> : null}
      {role === "driver" && delivery.ownCandidateStatus === "applied" ? (
        <View style={[styles.appliedState, { backgroundColor: theme.background }]}>
          <MaterialIcons name="check-circle" size={17} color={theme.success} />
          <Text style={[styles.appliedStateText, { color: theme.success }]}>Candidature envoyée</Text>
        </View>
      ) : null}
    </View>
    <FinancialConfirmationModal visible={confirmationVisible} title="Envoyer votre candidature" description="La commission Tikis sera temporairement réservée sur votre Wallet. Elle ne sera prélevée qu'après votre sélection et votre confirmation." amount={commission} confirmLabel="Confirmer ma candidature" loading={isApplying} onCancel={() => !isApplying && setConfirmationVisible(false)} onConfirm={() => void apply()} />
  </View>;
}

function DriverDistanceInfo({ loading, ready, value, unit, routeKm, navigationTarget, theme }: { loading: boolean; ready: boolean; value: string | null; unit: "m" | "km" | null; routeKm: number; navigationTarget: string; theme: any }) {
  if (loading) {
    return <View style={styles.driverDistance}>
      <View style={[styles.driverDistanceIcon, { backgroundColor: theme.background }]}><MaterialIcons name="near-me" size={13} color={theme.primary} /></View>
      <View style={styles.driverDistanceCopy}>
        <Text style={[styles.driverDistanceLabel, { color: theme.muted }]}>Distance</Text>
        <Text style={[styles.driverDistanceValue, { color: theme.foreground }]}>Calcul en cours…</Text>
      </View>
    </View>;
  }
  if (!ready || !value || !unit) {
    return <View style={styles.driverDistance}>
      <View style={[styles.driverDistanceIcon, { backgroundColor: theme.background }]}><MaterialIcons name="location-disabled" size={13} color={theme.warning} /></View>
      <View style={styles.driverDistanceCopy}>
        <Text style={[styles.driverDistanceLabel, { color: theme.muted }]}>Distance</Text>
        <Text style={[styles.driverDistanceValueFallback, { color: theme.warning }]}>{navigationTarget}</Text>
        <Text style={[styles.driverDistanceSub, { color: theme.muted }]}>Course de {routeKm.toLocaleString("fr-FR")} km</Text>
      </View>
    </View>;
  }
  return <View style={styles.driverDistance}>
    <View style={[styles.driverDistanceIcon, { backgroundColor: theme.background }]}><MaterialIcons name="near-me" size={13} color={theme.primary} /></View>
    <View style={styles.driverDistanceCopy}>
      <Text style={[styles.driverDistanceLabel, { color: theme.muted }]}>Distance</Text>
      <Text style={[styles.driverDistanceValue, { color: theme.foreground }]}>{value} <Text style={[styles.driverDistanceUnit, { color: theme.muted }]}>{unit}</Text></Text>
      <Text style={[styles.driverDistanceSub, { color: theme.muted }]}>Course de {routeKm.toLocaleString("fr-FR")} km</Text>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  card: { borderRadius: 9, marginBottom: 8, overflow: "hidden", elevation: 0, borderWidth: 1 },
  summary: { padding: 12, paddingBottom: 10 },
  pressed: { opacity: 0.76 },
  topRow: { flexDirection: "row", alignItems: "center" },
  vehicleIcon: { width: 35, height: 35, borderRadius: 8, alignItems: "center", justifyContent: "center", marginRight: 9 },
  titleWrap: { flex: 1, marginRight: 8 },
  title: { fontSize: 15, fontWeight: "600" },
  when: { fontSize: 11, fontWeight: "500", marginTop: 2 },
  mapWrap: { marginTop: 10, borderRadius: 9, overflow: "hidden" },
  addresses: { marginTop: 10, gap: 8 },
  addressRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  addressDot: { width: 8, height: 8, borderRadius: 4, marginLeft: 4 },
  addressCopy: { flex: 1 },
  addressLabel: { fontSize: 9, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase" },
  addressValue: { fontSize: 12, fontWeight: "600", marginTop: 1 },
  footer: { borderTopWidth: 1, marginTop: 10, paddingTop: 9, flexDirection: "row", alignItems: "center" },
  distance: { fontSize: 12, fontWeight: "600" },
  driverDistance: { flexDirection: "row", alignItems: "center", gap: 7, flex: 1 },
  driverDistanceIcon: { width: 26, height: 26, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  driverDistanceCopy: { flex: 1 },
  driverDistanceLabel: { fontSize: 9, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase" },
  driverDistanceValue: { fontSize: 13, fontWeight: "600", marginTop: 1 },
  driverDistanceValueFallback: { fontSize: 12, fontWeight: "500", marginTop: 1 },
  driverDistanceSub: { fontSize: 10, fontWeight: "500", marginTop: 1 },
  driverDistanceUnit: { fontSize: 11, fontWeight: "500" },
  vehiclePill: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 5, paddingHorizontal: 7, paddingVertical: 4, marginLeft: 8 },
  vehicleText: { fontSize: 10.5, fontWeight: "600" },
  price: { fontSize: 15, fontWeight: "600", marginLeft: "auto" },
  candidateCount: { flexDirection: "row", alignItems: "center", gap: 2, marginLeft: 8 },
  candidateCountText: { fontSize: 11, fontWeight: "600" },
  actions: { flexDirection: "row", alignItems: "center", gap: 8, borderTopWidth: 1, padding: 9 },
  mapButton: { flex: 1, minHeight: 40, borderRadius: 7 },
  applyButton: { flex: 1.25, minHeight: 40, borderRadius: 7 },
  appliedState: { flex: 1.25, minHeight: 40, paddingHorizontal: 10, borderRadius: 7, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 },
  appliedStateText: { fontSize: 11, fontWeight: "600" },
});
