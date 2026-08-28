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
  const initiateMutation = trpc.wallet.initiateLigdiSimulation.useMutation();
  const settleMutation = trpc.wallet.settleLigdiSimulation.useMutation({ onSuccess: () => void walletQuery.refetch() });
  const [requestType, setRequestType] = useState<"deposit" | "withdrawal" | null>(null);
  const [amountInput, setAmountInput] = useState("");
  const [requestError, setRequestError] = useState("");
  const [payment, setPayment] = useState<{ id: string; type: "deposit" | "withdrawal"; amount: number; providerReference: string } | null>(null);
  const requestLoading = initiateMutation.isPending || settleMutation.isPending;
  const isDriver = role === "driver";

  function openRequest(type: "deposit" | "withdrawal") { setRequestError(""); setAmountInput(""); setPayment(null); setRequestType(type); }
  async function confirmRequest() {
    const amount = parseOfferedPrice(amountInput);
    const error = offeredPriceError(amountInput) ?? (!amount || amount < 100 ? "Saisissez au moins 100 FCFA." : "");
    if (error || !amount) { setRequestError(error || "Montant invalide."); return; }
    try {
      const result = await initiateMutation.mutateAsync({ type: requestType!, amount, idempotencyKey: `ligdi-${Date.now()}-${Math.random().toString(36).slice(2, 14)}` });
      setPayment(result);
    } catch (cause) { setRequestError(cause instanceof Error ? cause.message : "La demande Ligdi Cash n’a pas pu être initialisée."); }
  }
  async function settlePayment(outcome: "succeeded" | "failed") {
    if (!payment) return;
    try {
      await settleMutation.mutateAsync({ paymentId: payment.id, outcome });
      setPayment(null); setRequestType(null); setAmountInput("");
    } catch (cause) { setRequestError(cause instanceof Error ? cause.message : "La confirmation Ligdi Cash a échoué."); }
  }

  return (
    <View style={tikisStyles.screen}>
      <FlatList
        data={journal}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={<>
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
          <SurfaceCard style={styles.requestModal}>{payment ? <><View style={styles.requestIcon}><MaterialIcons name="verified-user" size={24} color="#007B8B" /></View><Text style={styles.requestTitle}>Validation Ligdi Cash</Text><Text style={styles.requestDescription}>Mode simulation : confirmez le résultat de votre paiement de {formatMoney(payment.amount)}. Votre Wallet ne changera qu’après cette confirmation serveur.</Text><View style={styles.referenceCard}><Text style={styles.referenceLabel}>RÉFÉRENCE SIMULÉE</Text><Text style={styles.referenceValue}>{payment.providerReference}</Text></View>{requestError ? <Text style={styles.requestError}>{requestError}</Text> : <Text style={styles.requestHint}>Aucun moyen de paiement réel n’est débité dans ce mode.</Text>}<View style={styles.requestActions}><TikisButton label="Échouer" variant="secondary" disabled={requestLoading} onPress={() => void settlePayment("failed")} style={styles.requestAction} /><TikisButton label="Simuler réussite" icon="check-circle" loading={requestLoading} disabled={requestLoading} onPress={() => void settlePayment("succeeded")} style={styles.requestAction} /></View></> : <><View style={styles.requestIcon}><MaterialIcons name={requestType === "deposit" ? "add-card" : "account-balance-wallet"} size={24} color="#007B8B" /></View><Text style={styles.requestTitle}>{requestType === "deposit" ? "Dépôt Ligdi Cash" : "Retrait Ligdi Cash"}</Text><Text style={styles.requestDescription}>{requestType === "deposit" ? "Initialisez un dépôt simulé. Le solde ne sera crédité qu’après la confirmation suivante." : "Initialisez un retrait simulé. Le solde ne sera débité qu’après la confirmation suivante."}</Text><View style={styles.amountWrap}><TextInput value={amountInput} onChangeText={(value) => setAmountInput(sanitizeOfferedPriceInput(value))} keyboardType="number-pad" maxLength={8} autoFocus style={styles.amountInput} placeholder="Montant" placeholderTextColor="#9AA5B6" /><Text style={styles.amountCurrency}>FCFA</Text></View>{requestError ? <Text style={styles.requestError}>{requestError}</Text> : <Text style={styles.requestHint}>Le montant et le statut de simulation seront enregistrés dans votre journal financier.</Text>}<View style={styles.requestActions}><TikisButton label="Annuler" variant="secondary" disabled={requestLoading} onPress={() => setRequestType(null)} style={styles.requestAction} /><TikisButton label="Initialiser" loading={requestLoading} disabled={requestLoading} onPress={() => void confirmRequest()} style={styles.requestAction} /></View></>}</SurfaceCard>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const baseStyles = StyleSheet.create({
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
  referenceCard: { marginTop: 16, padding: 12, backgroundColor: "#F1F7F8", borderRadius: 12, borderWidth: 1, borderColor: "#C6E8EB" }, referenceLabel: { color: "#4D7075", fontSize: 10, fontWeight: "900", letterSpacing: 0.6, textAlign: "center" }, referenceValue: { color: "#0B1F3A", fontSize: 12, fontWeight: "900", textAlign: "center", marginTop: 5, letterSpacing: 0.3 },
  guarantees: { gap: 10 },
  guarantee: { flexDirection: "row", gap: 10, alignItems: "flex-start", backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E7ECF2", borderRadius: 15, padding: 13 },
  guaranteeText: { flex: 1, color: "#485569", fontSize: 13, lineHeight: 19 },
});

const styles = StyleSheet.create({
  ...baseStyles,
  list: { ...baseStyles.list, padding: 16, paddingBottom: 98 },
  title: { ...baseStyles.title, marginTop: 2, marginBottom: 13 },
  balanceCard: { ...baseStyles.balanceCard, borderWidth: 0, borderRadius: 10, marginBottom: 20 },
  balanceLabel: { ...baseStyles.balanceLabel, fontWeight: "500" },
  balance: { ...baseStyles.balance, fontWeight: "600" },
  balanceSubValue: { ...baseStyles.balanceSubValue, fontWeight: "600" },
  walletActions: { ...baseStyles.walletActions, gap: 8, marginTop: -14, marginBottom: 17 },
  senderCard: { ...baseStyles.senderCard, marginBottom: 20 },
  senderIcon: { ...baseStyles.senderIcon, borderRadius: 9, backgroundColor: "#EEEDF3", marginBottom: 9 },
  senderTitle: { ...baseStyles.senderTitle, color: "#111111", fontWeight: "600" },
  transaction: { ...baseStyles.transaction, paddingVertical: 11, borderBottomWidth: 0, backgroundColor: "#FFFFFF", borderRadius: 9, paddingHorizontal: 10, marginBottom: 3 },
  transactionIcon: { ...baseStyles.transactionIcon, borderRadius: 8 },
  transactionTitle: { ...baseStyles.transactionTitle, color: "#111111", fontWeight: "600" },
  transactionAmount: { ...baseStyles.transactionAmount, fontWeight: "600" },
  modalOverlay: { ...baseStyles.modalOverlay, backgroundColor: "rgba(0,0,0,0.42)", padding: 16 },
  requestModal: { ...baseStyles.requestModal, borderRadius: 12, padding: 16 },
  requestIcon: { ...baseStyles.requestIcon, borderRadius: 9, backgroundColor: "#E2F3F4" },
  requestTitle: { ...baseStyles.requestTitle, color: "#111111", fontWeight: "600" },
  amountWrap: { ...baseStyles.amountWrap, borderWidth: 0, borderRadius: 9, backgroundColor: "#EEEDF3" },
  amountInput: { ...baseStyles.amountInput, color: "#111111", fontWeight: "500" },
  amountCurrency: { ...baseStyles.amountCurrency, fontWeight: "600" },
  requestError: { ...baseStyles.requestError, fontWeight: "600" },
  referenceCard: { ...baseStyles.referenceCard, borderWidth: 0, borderRadius: 9, backgroundColor: "#EEEDF3" },
  referenceLabel: { ...baseStyles.referenceLabel, fontWeight: "600" },
  referenceValue: { ...baseStyles.referenceValue, color: "#111111", fontWeight: "600" },
  guarantee: { ...baseStyles.guarantee, borderWidth: 0, borderRadius: 10, padding: 12 },
});
