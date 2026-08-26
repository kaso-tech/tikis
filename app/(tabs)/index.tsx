import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router } from "expo-router";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { DeliveryCard } from "@/components/tikis/delivery-card";
import { SectionHeading, SurfaceCard, TikisButton, tikisStyles } from "@/components/tikis/ui";
import { useTikisStore } from "@/lib/tikis-store";
import { availableWalletBalance, formatMoney } from "@/shared/tikis-domain";

export default function HomeScreen() {
  const { role, profile, deliveries, wallet } = useTikisStore();
  const firstName = (profile?.fullName ?? (role === "sender" ? "Aïcha Traoré" : "Antoine Kaboré")).split(" ")[0];
  const visibleDeliveries = role === "sender"
    ? deliveries.filter((delivery) => delivery.senderName === "A. Traoré")
    : deliveries.filter((delivery) => delivery.status === "open" || delivery.status === "pending_confirmation" || (delivery.driverId === "driver-antoine" && delivery.status !== "completed"));

  return (
    <View style={tikisStyles.screen}>
      <FlatList
        data={visibleDeliveries}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => <DeliveryCard delivery={item} onPress={() => router.push(`/delivery/${item.id}` as any)} />}
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
                  <Text style={styles.walletValue}>{formatMoney(availableWalletBalance(wallet))}</Text>
                  <Text style={styles.walletSub}>Commission bloquée : {formatMoney(wallet.blocked)}</Text>
                </View>
                <View style={styles.walletIcon}><MaterialIcons name="account-balance-wallet" size={27} color="#007B8B" /></View>
              </SurfaceCard>
            )}

            <SectionHeading title={role === "sender" ? "Vos livraisons" : "Opportunités pour vous"} action={role === "sender" ? "Tout voir" : "Filtrer"} />
          </>
        }
        ListEmptyComponent={<Text style={styles.empty}>Aucune course pour le moment.</Text>}
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
  walletIcon: { width: 50, height: 50, borderRadius: 17, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  empty: { textAlign: "center", color: "#697386", marginTop: 38 },
  pressed: { opacity: 0.7 },
});
