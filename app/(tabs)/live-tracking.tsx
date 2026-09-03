import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router } from "expo-router";
import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { formatDeliveryDetailPlace } from "@/lib/geo-rules";
import { useThemeColors } from "@/lib/use-theme-colors";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";
import { formatMoney } from "@/shared/tikis-domain";
import { useLiveDeliveryPosition } from "@/hooks/use-live-delivery-position";

export default function LiveTrackingTabScreen() {
  const { colors: theme } = useThemeColors();
  const { profile } = useTikisStore();
  const deliveriesQuery = trpc.deliveries.list.useQuery(undefined, { enabled: Boolean(profile?.phone), refetchInterval: 15_000 });

  const active = useMemo(() => (deliveriesQuery.data ?? []).filter((d) => d.status === "active"), [deliveriesQuery.data]);
  const pending = useMemo(() => (deliveriesQuery.data ?? []).filter((d) => d.status === "pending_confirmation"), [deliveriesQuery.data]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={[styles.title, { color: theme.foreground }]}>Suivi en direct</Text>
        <Text style={[styles.subtitle, { color: theme.muted }]}>Vos livraisons en cours, avec la position du livreur en temps réel.</Text>

        {active.length === 0 && pending.length === 0 ? (
          <View style={[styles.empty, { backgroundColor: theme.surface }]}>
            <View style={[styles.emptyIcon, { backgroundColor: theme.background }]}><MaterialIcons name="local-shipping" size={26} color={theme.primary} /></View>
            <Text style={[styles.emptyTitle, { color: theme.foreground }]}>Aucune livraison à suivre</Text>
            <Text style={[styles.emptyText, { color: theme.muted }]}>Dès qu’un livreur est en route vers vous, cette page affiche sa position en direct.</Text>
          </View>
        ) : null}

        {active.length > 0 ? (
          <>
            <Text style={[styles.sectionLabel, { color: theme.muted }]}>EN COURS</Text>
            {active.map((delivery) => (
              <TrackingCard key={delivery.id} delivery={delivery} live theme={theme} />
            ))}
          </>
        ) : null}

        {pending.length > 0 ? (
          <>
            <Text style={[styles.sectionLabel, { color: theme.muted }]}>EN ATTENTE DE CONFIRMATION</Text>
            {pending.map((delivery) => (
              <TrackingCard key={delivery.id} delivery={delivery} live={false} theme={theme} />
            ))}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function TrackingCard({ delivery, live, theme }: { delivery: any; live: boolean; theme: any }) {
  const dropoff = formatDeliveryDetailPlace(delivery.dropoff);
  const positionQuery = useLiveDeliveryPosition(live ? delivery.id : null, live);
  const hasFix = Boolean(positionQuery.position?.latitude && positionQuery.position?.longitude);
  return (
    <Pressable onPress={() => router.push(`/delivery/${delivery.id}/map` as any)} style={({ pressed }) => [styles.card, { backgroundColor: theme.surface, borderColor: theme.border }, pressed && styles.pressed]}>
      <View style={styles.cardTop}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.cardTitle, { color: theme.foreground }]} numberOfLines={1}>{delivery.title}</Text>
          <Text style={[styles.cardSub, { color: theme.muted }]} numberOfLines={1}>Vers {dropoff.title}</Text>
        </View>
        {live ? (
          hasFix ? <View style={styles.livePill}><View style={styles.liveDot} /><Text style={styles.livePillText}>En direct</Text></View> : <View style={styles.searchingPill}><Text style={styles.searchingPillText}>Recherche GPS…</Text></View>
        ) : <View style={[styles.pendingPill, { backgroundColor: theme.background }]}><Text style={[styles.pendingPillText, { color: theme.muted }]}>En attente</Text></View>}
      </View>
      <View style={[styles.cardFooter, { borderTopColor: theme.border }]}>
        <Text style={[styles.cardDriver, { color: theme.muted }]}>
          {live && !hasFix ? "Position du livreur en attente de réception…" : delivery.driverName ?? "Livreur en cours d’attribution"}
        </Text>
        <Text style={[styles.cardPrice, { color: theme.foreground }]}>{formatMoney(delivery.offeredPrice ?? delivery.estimatedPrice)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  title: { fontSize: 22, fontWeight: "800" },
  subtitle: { fontSize: 13, lineHeight: 19, marginTop: 4, marginBottom: 18 },
  sectionLabel: { fontSize: 10.5, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase", marginTop: 16, marginBottom: 8 },
  card: { borderRadius: 12, borderWidth: 1, padding: 13, marginBottom: 10 },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  cardTitle: { fontSize: 14, fontWeight: "700" },
  cardSub: { fontSize: 11.5, marginTop: 2 },
  livePill: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#E6F4ED", paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#167A55" },
  livePillText: { color: "#167A55", fontSize: 10.5, fontWeight: "700" },
  searchingPill: { backgroundColor: "#FFF3E0", paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999 },
  searchingPillText: { color: "#9A6200", fontSize: 10.5, fontWeight: "700" },
  pendingPill: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999 },
  pendingPillText: { fontSize: 10.5, fontWeight: "700" },
  cardFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 11, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  cardDriver: { fontSize: 11.5 },
  cardPrice: { fontSize: 13, fontWeight: "700" },
  empty: { alignItems: "center", padding: 26, borderRadius: 12, marginTop: 8 },
  emptyIcon: { width: 56, height: 56, borderRadius: 18, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  emptyTitle: { fontSize: 15, fontWeight: "700" },
  emptyText: { fontSize: 12.5, lineHeight: 18, textAlign: "center", marginTop: 5 },
  pressed: { opacity: 0.7 },
});
