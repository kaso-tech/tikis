import { router } from "expo-router";
import { useMemo } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { DeliveryCard } from "@/components/tikis/delivery-card";
import { SectionHeading, SurfaceCard, TikisButton, tikisStyles } from "@/components/tikis/ui";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";
import { availableWalletBalance, formatMoney } from "@/shared/tikis-domain";

export default function HomeScreen() {
  const { role, profile } = useTikisStore();
  const deliveriesQuery = trpc.deliveries.list.useQuery(undefined, { enabled: Boolean(profile?.phone) });
  const walletQuery = trpc.wallet.snapshot.useQuery(undefined, { enabled: role === "driver" && Boolean(profile?.phone), refetchInterval: 12_000 });
  const driverWallet = walletQuery.data?.wallet;
  const firstName = profile?.fullName.split(" ")[0] ?? "";
  const visibleDeliveries = useMemo(() => {
    const deliveries = (deliveriesQuery.data ?? []).filter((delivery) => delivery.status !== "completed");
    return role === "driver" ? [...deliveries].sort((left, right) => left.distanceKm - right.distanceKm || (right.offeredPrice ?? right.estimatedPrice) - (left.offeredPrice ?? left.estimatedPrice)) : deliveries;
  }, [deliveriesQuery.data, role]);

  return <View style={tikisStyles.screen}>
    <FlatList
      data={visibleDeliveries}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => <DeliveryCard delivery={item} onPress={() => router.push(`/delivery/${item.id}` as any)} onMap={() => router.push(`/delivery/${item.id}/map` as any)} />}
      ListHeaderComponent={<><View style={styles.header}><Text style={tikisStyles.eyebrow}>{role === "sender" ? "Espace expéditeur" : "Espace livreur"}</Text><Text style={[tikisStyles.title, styles.greeting]}>Bonjour, {firstName}</Text></View>{role === "sender" ? <SurfaceCard style={styles.heroCard}><View style={styles.heroTop}><View style={styles.heroIcon}><MaterialIcons name="add-road" size={22} color="#FFFFFF" /></View><View style={styles.heroTextWrap}><Text style={styles.heroTitle}>Une course à organiser ?</Text><Text style={styles.heroText}>Publiez votre besoin et comparez les livreurs disponibles.</Text></View></View><TikisButton label="Créer une livraison" icon="add" variant="secondary" onPress={() => router.push("/create-delivery" as any)} style={styles.heroButton} /></SurfaceCard> : <SurfaceCard style={styles.walletCard}><View><Text style={styles.walletLabel}>Solde disponible</Text>{walletQuery.isLoading ? <View style={styles.walletLoading}><ActivityIndicator size="small" color="#007B8B" /><Text style={styles.walletLoadingText}>Chargement sécurisé…</Text></View> : driverWallet ? <><Text style={styles.walletValue}>{formatMoney(availableWalletBalance(driverWallet))}</Text><Text style={styles.walletSub}>Commission bloquée : {formatMoney(driverWallet.blocked)}</Text></> : <Text style={styles.walletUnavailable}>Solde momentanément indisponible</Text>}</View><View style={styles.walletIcon}><MaterialIcons name="account-balance-wallet" size={25} color="#111111" /></View></SurfaceCard>}<SectionHeading title={role === "sender" ? "Vos livraisons" : "Opportunités pour vous"} action={role === "sender" ? "Tout voir" : "Filtrer"} /></>}
      ListEmptyComponent={<Text style={styles.empty}>{deliveriesQuery.isLoading ? "Chargement des livraisons…" : deliveriesQuery.error ? "Impossible de charger les livraisons." : "Aucune course pour le moment."}</Text>}
    />
  </View>;
}

const styles = StyleSheet.create({
  list: { padding: 16, paddingBottom: 98 },
  header: { marginBottom: 16 },
  greeting: { marginTop: 2, fontSize: 25 },
  heroCard: { backgroundColor: "#111111", borderColor: "#111111", marginBottom: 20 },
  heroTop: { flexDirection: "row", gap: 10 },
  heroIcon: { width: 40, height: 40, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: "#007B8B" },
  heroTextWrap: { flex: 1 },
  heroTitle: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  heroText: { color: "#D0D0D0", fontSize: 13, lineHeight: 18, marginTop: 3 },
  heroButton: { backgroundColor: "#FFFFFF", borderColor: "#FFFFFF", marginTop: 14 },
  walletCard: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#E3E3E3", marginBottom: 20 },
  walletLabel: { color: "#555555", fontWeight: "600", fontSize: 13 },
  walletValue: { color: "#111111", fontWeight: "700", fontSize: 23, marginTop: 2 },
  walletSub: { color: "#666666", fontSize: 12, marginTop: 2 },
  walletLoading: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 32, marginTop: 3 },
  walletLoadingText: { color: "#555555", fontSize: 12, fontWeight: "600" },
  walletUnavailable: { color: "#B4232D", fontSize: 12, fontWeight: "700", marginTop: 5 },
  walletIcon: { width: 44, height: 44, borderRadius: 10, backgroundColor: "#F3F3F3", alignItems: "center", justifyContent: "center" },
  empty: { textAlign: "center", color: "#666666", marginTop: 32, fontSize: 14 },
});
