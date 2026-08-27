import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router } from "expo-router";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";
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
  const visibleDeliveries = (deliveriesQuery.data ?? []).filter((delivery) => role === "sender" ? delivery.status !== "completed" : delivery.status !== "completed");

  return (
    <View style={tikisStyles.screen}>
      <FlatList
        data={visibleDeliveries}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => <DeliveryCard delivery={item} onPress={() => router.push(`/delivery/${item.id}` as any)} onMap={() => router.push(`/delivery/${item.id}/map` as any)} />}
        ListHeaderComponent={
          <>
            <View style={styles.header}>
              <Text style={tikisStyles.eyebrow}>{role === "sender" ? "Espace expéditeur" : "Espace livreur"}</Text>
              <Text style={[tikisStyles.title, styles.greeting]}>Bonjour, {firstName}</Text>
            </View>

            {role === "sender" ? (
              <SurfaceCard style={styles.heroCard}>
                <View style={styles.heroTop}>
                  <View style={styles.heroIcon}><MaterialIcons name="add-road" size={24} color="#FFFFFF" /></View>
                  <View style={styles.heroTextWrap}>
                    <Text style={styles.heroTitle}>Une course à organiser ?</Text>
                    <Text style={styles.heroText}>Publiez votre besoin et comparez les livreurs disponibles.</Text>
                  </View>
                </View>
                <TikisButton label="Créer une livraison" icon="add" onPress={() => router.push("/create-delivery" as any)} style={styles.heroButton} />
              </SurfaceCard>
            ) : (
              <SurfaceCard style={styles.walletCard}>
                <View>
                  <Text style={styles.walletLabel}>Solde disponible</Text>
                  {walletQuery.isLoading ? <View style={styles.walletLoading}><ActivityIndicator size="small" color="#007B8B" /><Text style={styles.walletLoadingText}>Chargement sécurisé…</Text></View> : driverWallet ? <><Text style={styles.walletValue}>{formatMoney(availableWalletBalance(driverWallet))}</Text><Text style={styles.walletSub}>Commission bloquée : {formatMoney(driverWallet.blocked)}</Text></> : <Text style={styles.walletUnavailable}>Solde momentanément indisponible</Text>}
                </View>
                <View style={styles.walletIcon}><MaterialIcons name="account-balance-wallet" size={27} color="#007B8B" /></View>
              </SurfaceCard>
            )}

            <SectionHeading title={role === "sender" ? "Vos livraisons" : "Opportunités pour vous"} action={role === "sender" ? "Tout voir" : "Filtrer"} />
          </>
        }
        ListEmptyComponent={<Text style={styles.empty}>{deliveriesQuery.isLoading ? "Chargement des livraisons…" : deliveriesQuery.error ? "Impossible de charger les livraisons." : "Aucune course pour le moment."}</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: 20, paddingBottom: 115 },
  header: { marginBottom: 22 },
  greeting: { marginTop: 3, fontSize: 28 },
  heroCard: { backgroundColor: "#0B1F3A", borderColor: "#0B1F3A", marginBottom: 27 },
  heroTop: { flexDirection: "row", gap: 12 },
  heroIcon: { width: 45, height: 45, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "#007B8B" },
  heroTextWrap: { flex: 1 },
  heroTitle: { color: "#FFFFFF", fontSize: 17, fontWeight: "900" },
  heroText: { color: "#BED0E7", fontSize: 13, lineHeight: 19, marginTop: 4 },
  heroButton: { backgroundColor: "#18A572", borderColor: "#18A572", marginTop: 18 },
  walletCard: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "#E5F6F7", borderColor: "#CDE4E7", marginBottom: 27 },
  walletLabel: { color: "#35656C", fontWeight: "700", fontSize: 13 },
  walletValue: { color: "#0B1F3A", fontWeight: "900", fontSize: 24, marginTop: 2 },
  walletSub: { color: "#697386", fontSize: 12, marginTop: 2 },
  walletLoading: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 34, marginTop: 3 },
  walletLoadingText: { color: "#35656C", fontSize: 12, fontWeight: "700" },
  walletUnavailable: { color: "#C23B45", fontSize: 12, fontWeight: "800", marginTop: 5 },
  walletIcon: { width: 50, height: 50, borderRadius: 17, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  empty: { textAlign: "center", color: "#697386", marginTop: 38 },
  pressed: { opacity: 0.7 },
});
