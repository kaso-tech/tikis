import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { SectionHeading, SurfaceCard, tikisStyles } from "@/components/tikis/ui";
import { useTikisStore } from "@/lib/tikis-store";
import { availableWalletBalance, formatMoney, type WalletOperation } from "@/shared/tikis-domain";

const operationMeta: Record<WalletOperation, { label: string; icon: React.ComponentProps<typeof MaterialIcons>["name"]; color: string; background: string }> = {
  block: { label: "Commission bloquée", icon: "lock-clock", color: "#B45309", background: "#FEF3C7" },
  unblock: { label: "Commission débloquée", icon: "lock-open", color: "#007B8B", background: "#E5F6F7" },
  debit: { label: "Commission prélevée", icon: "north-east", color: "#C23B45", background: "#FDEBEC" },
  compensation: { label: "Compensation", icon: "sync-alt", color: "#007B8B", background: "#E5F6F7" },
  credit: { label: "Crédit", icon: "south-west", color: "#18A572", background: "#DCFCE7" },
};

export default function WalletScreen() {
  const { role, wallet, journal } = useTikisStore();
  const isDriver = role === "driver";

  return (
    <View style={tikisStyles.screen}>
      <FlatList
        data={isDriver ? journal : []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={<>
          <Text style={tikisStyles.eyebrow}>{isDriver ? "Vos commissions Tikis" : "Transparence financière"}</Text>
          <Text style={[tikisStyles.title, styles.title]}>{isDriver ? "Votre Wallet" : "Paiement de la course"}</Text>
          {isDriver ? <SurfaceCard style={styles.balanceCard}>
            <Text style={styles.balanceLabel}>Solde disponible</Text>
            <Text style={styles.balance}>{formatMoney(availableWalletBalance(wallet))}</Text>
            <View style={styles.balanceDivider} />
            <View style={styles.balanceRow}><Text style={styles.balanceSub}>Solde total</Text><Text style={styles.balanceSubValue}>{formatMoney(wallet.total)}</Text></View>
            <View style={styles.balanceRow}><Text style={styles.balanceSub}>Commission bloquée</Text><Text style={styles.balanceSubValue}>{formatMoney(wallet.blocked)}</Text></View>
          </SurfaceCard> : <SurfaceCard style={styles.senderCard}>
            <View style={styles.senderIcon}><MaterialIcons name="handshake" size={26} color="#007B8B" /></View>
            <Text style={styles.senderTitle}>Vous payez directement le livreur</Text>
            <Text style={styles.senderText}>Tikis sécurise la mise en relation. Le paiement de la course se fait à la remise de votre colis, en espèces ou par Mobile Money.</Text>
          </SurfaceCard>}
          {isDriver ? <SectionHeading title="Journal financier" /> : <SectionHeading title="Ce que Tikis garantit" />}
        </>}
        renderItem={({ item }) => {
          const meta = operationMeta[item.operation];
          return <View style={styles.transaction}><View style={[styles.transactionIcon, { backgroundColor: meta.background }]}><MaterialIcons name={meta.icon} size={18} color={meta.color} /></View><View style={styles.transactionInfo}><Text style={styles.transactionTitle}>{meta.label}</Text><Text style={styles.transactionReason}>{item.reason}</Text><Text style={styles.transactionTime}>{item.createdAt}</Text></View><Text style={[styles.transactionAmount, { color: meta.color }]}>{formatMoney(item.amount)}</Text></View>;
        }}
        ListEmptyComponent={<View style={styles.guarantees}><View style={styles.guarantee}><MaterialIcons name="visibility-off" size={19} color="#007B8B" /><Text style={styles.guaranteeText}>Vos coordonnées restent masquées avant le choix d’un livreur.</Text></View><View style={styles.guarantee}><MaterialIcons name="receipt-long" size={19} color="#007B8B" /><Text style={styles.guaranteeText}>Chaque commission Tikis est expliquée avant toute action.</Text></View></View>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: 20, paddingBottom: 115 },
  title: { marginTop: 3, marginBottom: 18 },
  balanceCard: { backgroundColor: "#0B1F3A", borderColor: "#0B1F3A", marginBottom: 27 },
  balanceLabel: { color: "#B6C8DF", fontSize: 13, fontWeight: "700" },
  balance: { color: "#FFFFFF", fontSize: 29, fontWeight: "900", marginTop: 3 },
  balanceDivider: { height: 1, backgroundColor: "#294465", marginVertical: 15 },
  balanceRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  balanceSub: { color: "#B6C8DF", fontSize: 13 },
  balanceSubValue: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
  senderCard: { marginBottom: 27 },
  senderIcon: { width: 48, height: 48, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "#E5F6F7", marginBottom: 12 },
  senderTitle: { color: "#0B1F3A", fontSize: 17, fontWeight: "900" },
  senderText: { color: "#697386", fontSize: 13, lineHeight: 20, marginTop: 5 },
  transaction: { flexDirection: "row", alignItems: "center", paddingVertical: 13, borderBottomWidth: 1, borderColor: "#E7ECF2" },
  transactionIcon: { width: 37, height: 37, borderRadius: 12, alignItems: "center", justifyContent: "center", marginRight: 11 },
  transactionInfo: { flex: 1, paddingRight: 7 },
  transactionTitle: { color: "#0B1F3A", fontWeight: "800", fontSize: 14 },
  transactionReason: { color: "#697386", fontSize: 12, lineHeight: 16, marginTop: 2 },
  transactionTime: { color: "#9AA5B6", fontSize: 11, marginTop: 3 },
  transactionAmount: { fontWeight: "900", fontSize: 13 },
  guarantees: { gap: 10 },
  guarantee: { flexDirection: "row", gap: 10, alignItems: "flex-start", backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E7ECF2", borderRadius: 15, padding: 13 },
  guaranteeText: { flex: 1, color: "#485569", fontSize: 13, lineHeight: 19 },
});

