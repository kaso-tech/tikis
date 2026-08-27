import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useState } from "react";
import { FlatList, KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { SectionHeading, SurfaceCard, TikisButton, tikisStyles } from "@/components/tikis/ui";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";
import { availableWalletBalance, formatMoney, formatRelativeDate, type WalletOperation } from "@/shared/tikis-domain";
import { offeredPriceError, parseOfferedPrice, sanitizeOfferedPriceInput } from "@/lib/delivery-price";

const operationMeta: Record<WalletOperation, { label: string; icon: React.ComponentProps<typeof MaterialIcons>["name"]; color: string; background: string }> = {
  block: { label: "Commission bloquée", icon: "lock-clock", color: "#B45309", background: "#FEF3C7" },
  unblock: { label: "Commission débloquée", icon: "lock-open", color: "#007B8B", background: "#E5F6F7" },
  debit: { label: "Commission prélevée", icon: "north-east", color: "#C23B45", background: "#FDEBEC" },
  compensation: { label: "Compensation", icon: "sync-alt", color: "#007B8B", background: "#E5F6F7" },
  credit: { label: "Crédit", icon: "south-west", color: "#18A572", background: "#DCFCE7" },
  refund: { label: "Remboursement", icon: "replay", color: "#18A572", background: "#DCFCE7" },
  deposit_request: { label: "Dépôt en attente", icon: "add-card", color: "#007B8B", background: "#E5F6F7" },
  withdrawal_request: { label: "Retrait en attente", icon: "account-balance-wallet", color: "#B45309", background: "#FEF3C7" },
};

export default function WalletScreen() {
  const { role, profile } = useTikisStore();
  const walletQuery = trpc.wallet.snapshot.useQuery(undefined, { enabled: Boolean(profile?.phone), refetchInterval: 12_000 });
  const wallet = walletQuery.data?.wallet ?? { total: 0, blocked: 0 };
  const journal = walletQuery.data?.journal ?? [];
  const requestMutation = trpc.wallet.requestOperation.useMutation({ onSuccess: () => void walletQuery.refetch() });
  const [requestType, setRequestType] = useState<"deposit" | "withdrawal" | null>(null);
  const [amountInput, setAmountInput] = useState("");
  const [requestError, setRequestError] = useState("");
  const requestLoading = requestMutation.isPending;
  const isDriver = role === "driver";

  function openRequest(type: "deposit" | "withdrawal") { setRequestError(""); setAmountInput(""); setRequestType(type); }
  async function confirmRequest() {
    const amount = parseOfferedPrice(amountInput);
    const error = offeredPriceError(amountInput) ?? (!amount || amount < 100 ? "Saisissez au moins 100 FCFA." : "");
    if (error || !amount) { setRequestError(error || "Montant invalide."); return; }
    try { await requestMutation.mutateAsync({ type: requestType!, amount }); setRequestType(null); } catch (cause) { setRequestError(cause instanceof Error ? cause.message : "La demande n’a pas pu être enregistrée."); }
  }

  return (
    <View style={tikisStyles.screen}>
      <FlatList
        data={journal}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={<>
          <Text style={tikisStyles.eyebrow}>{isDriver ? "Vos commissions Tikis" : "Vos mouvements Tikis"}</Text>
          <Text style={[tikisStyles.title, styles.title]}>Votre Wallet</Text>
          <SurfaceCard style={styles.balanceCard}>
            <Text style={styles.balanceLabel}>Solde disponible</Text>
            <Text style={styles.balance}>{formatMoney(availableWalletBalance(wallet))}</Text>
            <View style={styles.balanceDivider} />
            <View style={styles.balanceRow}><Text style={styles.balanceSub}>Solde total</Text><Text style={styles.balanceSubValue}>{formatMoney(wallet.total)}</Text></View>
            <View style={styles.balanceRow}><Text style={styles.balanceSub}>Commission bloquée</Text><Text style={styles.balanceSubValue}>{formatMoney(wallet.blocked)}</Text></View>
          </SurfaceCard>
          <View style={styles.walletActions}><TikisButton label="Dépôt" icon="add-card" variant="secondary" onPress={() => openRequest("deposit")} disabled={requestLoading} style={styles.walletAction} /><TikisButton label="Retrait" icon="account-balance-wallet" variant="secondary" onPress={() => openRequest("withdrawal")} disabled={requestLoading} style={styles.walletAction} /></View>
          {!isDriver ? <SurfaceCard style={styles.senderCard}><View style={styles.senderIcon}><MaterialIcons name="handshake" size={26} color="#007B8B" /></View><Text style={styles.senderTitle}>Paiement direct au livreur</Text><Text style={styles.senderText}>Le paiement de la course se fait directement à la remise. Les mouvements Tikis sont réservés aux règles de mise en relation.</Text></SurfaceCard> : null}
          <SectionHeading title={walletQuery.isLoading ? "Chargement du journal" : "Journal financier"} />
        </>}
        renderItem={({ item }) => {
          const meta = operationMeta[item.operation];
          return <View style={styles.transaction}><View style={[styles.transactionIcon, { backgroundColor: meta.background }]}><MaterialIcons name={meta.icon} size={18} color={meta.color} /></View><View style={styles.transactionInfo}><Text style={styles.transactionTitle}>{meta.label}</Text><Text style={styles.transactionReason}>{item.reason}</Text><Text style={styles.transactionTime}>{formatRelativeDate(item.createdAt)}</Text></View><Text style={[styles.transactionAmount, { color: meta.color }]}>{formatMoney(item.amount)}</Text></View>;
        }}
        ListEmptyComponent={<View style={styles.guarantees}><View style={styles.guarantee}><MaterialIcons name={walletQuery.isLoading ? "hourglass-empty" : "receipt-long"} size={19} color="#007B8B" /><Text style={styles.guaranteeText}>{walletQuery.error ? "Le journal financier est momentanément indisponible." : walletQuery.isLoading ? "Chargement sécurisé de vos opérations…" : "Aucun mouvement financier enregistré pour le moment."}</Text></View><View style={styles.guarantee}><MaterialIcons name="visibility-off" size={19} color="#007B8B" /><Text style={styles.guaranteeText}>Vos coordonnées restent masquées avant le choix d’un livreur.</Text></View></View>}
      />
      <Modal visible={requestType !== null} transparent animationType="fade" onRequestClose={() => !requestLoading && setRequestType(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalOverlay}>
          <SurfaceCard style={styles.requestModal}><View style={styles.requestIcon}><MaterialIcons name={requestType === "deposit" ? "add-card" : "account-balance-wallet"} size={24} color="#007B8B" /></View><Text style={styles.requestTitle}>{requestType === "deposit" ? "Demander un dépôt" : "Demander un retrait"}</Text><Text style={styles.requestDescription}>{requestType === "deposit" ? "Votre demande sera enregistrée. Le solde ne sera crédité qu’après validation par le moyen de paiement autorisé." : "Votre demande sera enregistrée puis traitée. Aucun solde ne sera débité avant son traitement."}</Text><View style={styles.amountWrap}><TextInput value={amountInput} onChangeText={(value) => setAmountInput(sanitizeOfferedPriceInput(value))} keyboardType="number-pad" maxLength={8} autoFocus style={styles.amountInput} placeholder="Montant" placeholderTextColor="#9AA5B6" /><Text style={styles.amountCurrency}>FCFA</Text></View>{requestError ? <Text style={styles.requestError}>{requestError}</Text> : <Text style={styles.requestHint}>Le montant et les conséquences seront enregistrés dans votre journal financier.</Text>}<View style={styles.requestActions}><TikisButton label="Annuler" variant="secondary" disabled={requestLoading} onPress={() => setRequestType(null)} style={styles.requestAction} /><TikisButton label={requestType === "deposit" ? "Confirmer le dépôt" : "Confirmer le retrait"} loading={requestLoading} disabled={requestLoading} onPress={() => void confirmRequest()} style={styles.requestAction} /></View></SurfaceCard>
        </KeyboardAvoidingView>
      </Modal>
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
  walletActions: { flexDirection: "row", gap: 10, marginTop: -17, marginBottom: 22 }, walletAction: { flex: 1, minHeight: 44 },
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
  transactionAmount: { fontWeight: "900", fontSize: 13 }, modalOverlay: { flex: 1, backgroundColor: "rgba(11,31,58,0.48)", justifyContent: "center", padding: 22 }, requestModal: { padding: 20 }, requestIcon: { width: 48, height: 48, borderRadius: 16, alignSelf: "center", alignItems: "center", justifyContent: "center", backgroundColor: "#E5F6F7", marginBottom: 10 }, requestTitle: { color: "#0B1F3A", fontSize: 18, fontWeight: "900", textAlign: "center" }, requestDescription: { color: "#697386", fontSize: 13, lineHeight: 19, marginTop: 7, textAlign: "center" }, amountWrap: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: "#B8DDE0", borderRadius: 14, paddingHorizontal: 14, marginTop: 18 }, amountInput: { flex: 1, minHeight: 50, color: "#0B1F3A", fontSize: 16, fontWeight: "900" }, amountCurrency: { color: "#697386", fontSize: 12, fontWeight: "900" }, requestHint: { color: "#4D7075", fontSize: 11, lineHeight: 16, textAlign: "center", marginTop: 8 }, requestError: { color: "#C23B45", fontSize: 11, fontWeight: "700", lineHeight: 16, textAlign: "center", marginTop: 8 }, requestActions: { flexDirection: "row", gap: 10, marginTop: 18 }, requestAction: { flex: 1, minHeight: 45 },
  guarantees: { gap: 10 },
  guarantee: { flexDirection: "row", gap: 10, alignItems: "flex-start", backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E7ECF2", borderRadius: 15, padding: 13 },
  guaranteeText: { flex: 1, color: "#485569", fontSize: 13, lineHeight: 19 },
});
