import { useState } from "react";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useThemeColors } from "@/lib/use-theme-colors";
import { SafeAreaView } from "react-native-safe-area-context";
import { TikisButton } from "@/components/tikis/ui";
import { offeredPriceError, parseOfferedPrice, sanitizeOfferedPriceInput } from "@/lib/delivery-price";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";
import { deliveryMetricsForDay } from "@/lib/wallet-metrics";
import { availableWalletBalance, formatMoney, formatRelativeDate, type WalletOperation } from "@/shared/tikis-domain";

type Tone = "primary" | "success" | "warning" | "error" | "neutral";

const operationMeta: Record<WalletOperation, { label: string; icon: React.ComponentProps<typeof MaterialIcons>["name"]; tone: Tone }> = {
  block: { label: "Commission bloquée", icon: "lock-clock", tone: "warning" },
  unblock: { label: "Commission débloquée", icon: "lock-open", tone: "primary" },
  debit: { label: "Retrait", icon: "north-east", tone: "error" },
  commission_debit: { label: "Commission prélevée", icon: "north-east", tone: "error" },
  compensation: { label: "Compensation", icon: "sync-alt", tone: "primary" },
  credit: { label: "Crédit", icon: "south-west", tone: "success" },
  refund: { label: "Remboursement", icon: "replay", tone: "success" },
  deposit_request: { label: "Dépôt en attente", icon: "add-card", tone: "warning" },
  withdrawal_request: { label: "Retrait en attente", icon: "account-balance-wallet", tone: "warning" },
  bonus: { label: "Bonus", icon: "redeem", tone: "success" },
  penalty: { label: "Pénalité", icon: "remove-circle-outline", tone: "error" },
};

const TONE_COLOR: Record<Tone, string> = {
  primary: "#007B8B",
  success: "#167A55",
  warning: "#9A6200",
  error: "#B4232D",
  neutral: "#666666",
};

export default function WalletScreen() {
  const { colors: theme } = useThemeColors();
  const { role, profile } = useTikisStore();
  const utilities = trpc.useUtils();
  const walletQuery = trpc.wallet.snapshot.useQuery(undefined, { enabled: Boolean(profile?.phone), refetchInterval: 12_000, refetchOnMount: "always", refetchOnWindowFocus: true });
  const wallet = walletQuery.data?.wallet;
  const journal = walletQuery.data?.journal ?? [];
  const initiateMutation = trpc.wallet.initiateYengaPayTest.useMutation();
  const settleMutation = trpc.wallet.settleYengaPayTest.useMutation();
  const [requestType, setRequestType] = useState<"deposit" | "withdrawal" | null>(null);
  const [amountInput, setAmountInput] = useState("");
  const [requestError, setRequestError] = useState("");
  const [payment, setPayment] = useState<{ id: string; type: "deposit" | "withdrawal"; amount: number; providerReference: string } | null>(null);
  const requestLoading = initiateMutation.isPending || settleMutation.isPending;
  const isDriver = role === "driver";
  const available = wallet ? availableWalletBalance(wallet) : null;
  const displayWalletAmount = (amount: number | null) => {
    if (walletQuery.isLoading) return "Chargement…";
    if (walletQuery.error || amount === null || !Number.isFinite(amount)) return "Indisponible";
    return formatMoney(amount);
  };
  const recentJournal = [...journal]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, 20);
  const deliveryMetrics = deliveryMetricsForDay(journal);
  const todaysCount = deliveryMetrics.activityCount;
  const currentMonthSpending = journal
    .filter((entry) => {
      const date = new Date(entry.createdAt);
      const now = new Date();
      return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && entry.operation === "commission_debit";
    })
    .reduce((sum, entry) => sum + entry.amount, 0);

  function openRequest(type: "deposit" | "withdrawal") { setRequestError(""); setAmountInput(""); setPayment(null); setRequestType(type); }
  async function confirmRequest() {
    const amount = parseOfferedPrice(amountInput);
    const error = offeredPriceError(amountInput) ?? (!amount || amount < 100 ? "Saisissez au moins 100 FCFA." : "");
    if (error || !amount) { setRequestError(error || "Montant invalide."); return; }
    try {
      const result = await initiateMutation.mutateAsync({ type: requestType!, amount, idempotencyKey: `yengapay-test-${Date.now()}-${Math.random().toString(36).slice(2, 14)}` });
      setPayment(result);
    } catch (cause) { setRequestError(cause instanceof Error ? cause.message : "La demande YengaPay n’a pas pu être initialisée."); }
  }
  async function settlePayment(outcome: "succeeded" | "failed") {
    if (!payment) return;
    try {
      const settled = await settleMutation.mutateAsync({ paymentId: payment.id, outcome });
      utilities.wallet.snapshot.setData(undefined, (current) => current ? { ...current, wallet: settled.wallet } : current);
      await Promise.all([
        utilities.wallet.snapshot.invalidate(),
        utilities.deliveries.list.invalidate(),
        utilities.notifications.list.invalidate(),
      ]);
      await walletQuery.refetch();
      setPayment(null); setRequestType(null); setAmountInput("");
    } catch (cause) { setRequestError(cause instanceof Error ? cause.message : "La confirmation YengaPay a échoué."); }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={[styles.balanceCard, isDriver ? styles.balanceCardDriver : styles.balanceCardSender]}>
          <View style={styles.balanceGradient} pointerEvents="none" />
          <Text style={[styles.balanceEyebrow, isDriver && styles.balanceEyebrowLight]}>
            {isDriver ? "SOLDE DISPONIBLE" : "VOTRE WALLET EXPÉDITEUR"}
          </Text>
          <View style={styles.balanceValueRow}>
            <Text style={styles.balanceValue}>{displayWalletAmount(available)}</Text>
            {isDriver ? (
              <View style={styles.trendPill}>
                <MaterialIcons name="verified" size={11} color="#48B889" />
                <Text style={styles.trendText}>Disponible</Text>
              </View>
            ) : (
              <View style={styles.trendPillLight}>
                <MaterialIcons name="inventory-2" size={11} color="#FFFFFF" />
                <Text style={styles.trendTextLight}>{todaysCount || 0} course{todaysCount > 1 ? "s" : ""}</Text>
              </View>
            )}
          </View>
          <View style={[styles.balanceDivider, isDriver && styles.balanceDividerLight]} />
          <View style={styles.balanceRows}>
            {isDriver ? (
              <>
                <View style={styles.balanceCol}>
                  <Text style={[styles.balanceLabel, isDriver && styles.balanceLabelLight]}>Solde total</Text>
                  <Text style={styles.balanceSub}>{displayWalletAmount(wallet?.total ?? null)}</Text>
                </View>
                <View style={styles.balanceCol}>
                  <Text style={[styles.balanceLabel, isDriver && styles.balanceLabelLight]}>Bloquée</Text>
                  <Text style={styles.balanceSub}>{displayWalletAmount(wallet?.blocked ?? null)}</Text>
                </View>
                <View style={styles.balanceCol}>
                  <Text style={[styles.balanceLabel, isDriver && styles.balanceLabelLight]}>En attente</Text>
                  <Text style={[styles.balanceSub, styles.balanceSubPending]}>0 F</Text>
                </View>
              </>
            ) : (
              <>
                <View style={styles.balanceCol}>
                  <Text style={[styles.balanceLabel, isDriver && styles.balanceLabelLight]}>Engagées</Text>
                  <Text style={styles.balanceSub}>{journal.filter((e) => e.operation === "block").length} courses</Text>
                </View>
                <View style={styles.balanceCol}>
                  <Text style={[styles.balanceLabel, isDriver && styles.balanceLabelLight]}>Ce mois</Text>
                  <Text style={styles.balanceSub}>{displayWalletAmount(currentMonthSpending)}</Text>
                </View>
              </>
            )}
          </View>
        </View>

        <View style={styles.actionsRow}>
          <Pressable onPress={() => openRequest("deposit")} style={({ pressed }) => [styles.actionCardFull, { backgroundColor: theme.surface, borderColor: theme.border }, pressed && styles.pressed]}>
            <View style={[styles.actionIcon, { backgroundColor: theme.background }]}><MaterialIcons name="add-card" size={15} color={theme.primary} /></View>
            <View style={styles.actionText}>
              <Text style={[styles.actionLabel, { color: theme.foreground }]}>Recharger mon compte</Text>
              <Text style={[styles.actionSub, { color: theme.muted }]}>YengaPay · test</Text>
            </View>
          </Pressable>
        </View>

        {isDriver ? null : (
          <View style={[styles.senderInfo, { backgroundColor: theme.background, borderColor: theme.border }]}>
            <View style={[styles.senderInfoIcon, { backgroundColor: theme.primary }]}><MaterialIcons name="handshake" size={16} color="#FFFFFF" /></View>
            <Text style={[styles.senderInfoText, { color: theme.foreground }]}>
              <Text style={[styles.senderInfoTextBold, { color: theme.foreground }]}>Paiement direct au livreur. </Text>
              Le règlement de la course se fait à la remise. Les mouvements Tikis sont réservés aux règles de mise en relation.
            </Text>
          </View>
        )}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{isDriver ? "Transactions récentes" : "Activité financière"}</Text>
          <Text style={styles.sectionAction}>{recentJournal.length} mouvement{recentJournal.length > 1 ? "s" : ""}</Text>
        </View>

        {walletQuery.isLoading ? (
          <View style={[styles.listCard, { backgroundColor: theme.surface }]}><Text style={[styles.emptyText, { color: theme.muted }]}>Chargement sécurisé de vos opérations…</Text></View>
        ) : walletQuery.error ? (
          <View style={[styles.listCard, { backgroundColor: theme.surface }]}><Text style={[styles.emptyText, { color: theme.muted }]}>Le journal financier est momentanément indisponible.</Text></View>
        ) : recentJournal.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}><MaterialIcons name="savings" size={26} color="#747474" /></View>
            <Text style={styles.emptyTitle}>Aucun mouvement enregistré</Text>
            <Text style={styles.emptySub}>Vos premières opérations apparaîtront ici après votre premier dépôt ou votre première course.</Text>
          </View>
        ) : (
          <View style={[styles.listCard, { backgroundColor: theme.surface }]}>
            {recentJournal.map((entry, idx) => {
              const meta = operationMeta[entry.operation];
              const isLast = idx === recentJournal.length - 1;
              const isCredit = entry.operation === "credit" || entry.operation === "refund" || entry.operation === "unblock" || entry.operation === "compensation" || entry.operation === "bonus";
              const isPending = entry.operation === "block" || entry.operation === "deposit_request" || entry.operation === "withdrawal_request";
              const amountColor = isCredit ? { color: theme.success } : isPending ? { color: theme.warning } : { color: theme.error };
              const amountPrefix = isCredit ? "+" : isPending ? "" : "-";
              return (
                <View key={entry.id} style={[styles.txRow, !isLast && { borderBottomColor: theme.border }]}>
                  <View style={[styles.txIcon, iconBgForTone(meta.tone, theme)]}>
                    <MaterialIcons name={meta.icon} size={16} color={TONE_COLOR[meta.tone]} />
                  </View>
                  <View style={styles.txBody}>
                    <View style={styles.txLine1}>
                      <Text style={[styles.txLabel, { color: theme.foreground }]} numberOfLines={1}>{meta.label}</Text>
                      <Text style={[styles.txTime, { color: theme.muted }]}>{formatRelativeDate(entry.createdAt)}</Text>
                    </View>
                    <Text style={[styles.txReason, { color: theme.muted }]} numberOfLines={2}>{entry.reason} · Solde après opération : {formatMoney(entry.balanceAfter)}</Text>
                  </View>
                  <Text style={[styles.txAmount, amountColor]}>{amountPrefix}{formatMoney(entry.amount)}</Text>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      <Modal visible={requestType !== null} transparent animationType="slide" onRequestClose={() => !requestLoading && setRequestType(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => !requestLoading && setRequestType(null)} />
          <View style={styles.modalSheet}>
            <View style={styles.sheetGrip} />
            {payment ? (
              <>
                <View style={styles.modalIcon}><MaterialIcons name="verified-user" size={22} color="#9A6201" /></View>
                <Text style={styles.modalTitle}>Validation YengaPay</Text>
                <Text style={styles.modalSub}>Mode test : confirmez le résultat de votre paiement de {formatMoney(payment.amount)}. Votre Wallet ne changera qu’après cette confirmation serveur.</Text>
                <View style={styles.referenceCard}>
                  <Text style={styles.referenceLabel}>RÉFÉRENCE YENGAPAY TEST</Text>
                  <Text style={styles.referenceValue}>{payment.providerReference}</Text>
                </View>
                {requestError ? <Text style={styles.requestError}>{requestError}</Text> : <Text style={styles.modalHint}>Aucun moyen de paiement réel n’est débité dans ce mode.</Text>}
                <View style={styles.modalActions}>
                  <TikisButton label="Échouer" variant="secondary" disabled={requestLoading} onPress={() => void settlePayment("failed")} style={styles.modalAction} />
                  <TikisButton label="Simuler réussite" icon="check-circle" loading={requestLoading} disabled={requestLoading} onPress={() => void settlePayment("succeeded")} style={styles.modalAction} />
                </View>
              </>
            ) : (
              <>
                <View style={styles.modalIcon}><MaterialIcons name={requestType === "deposit" ? "add-card" : "account-balance-wallet"} size={22} color="#9A6201" /></View>
                <Text style={styles.modalTitle}>Recharger mon compte</Text>
                <Text style={styles.modalSub}>{requestType === "deposit" ? "Initialisez un dépôt de test. Le solde ne sera crédité qu'après la confirmation suivante." : "Initialisez un retrait de test. Le solde ne sera débité qu'après la confirmation suivante."}</Text>
                <View style={styles.amountWrap}>
                  <TextInput value={amountInput} onChangeText={(value) => setAmountInput(sanitizeOfferedPriceInput(value))} keyboardType="number-pad" maxLength={8} autoFocus style={styles.amountInput} placeholder="Montant" placeholderTextColor="#B48753" />
                  <Text style={styles.amountCurrency}>FCFA</Text>
                </View>
                {requestError ? <Text style={styles.requestError}>{requestError}</Text> : <Text style={styles.modalHint}>Le montant et le statut de test seront enregistrés dans votre journal financier.</Text>}
                <View style={styles.modalActions}>
                  <TikisButton label="Annuler" variant="secondary" disabled={requestLoading} onPress={() => setRequestType(null)} style={styles.modalAction} />
                  <TikisButton label="Initialiser" loading={requestLoading} disabled={requestLoading} onPress={() => void confirmRequest()} style={styles.modalAction} />
                </View>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function iconBgForTone(tone: Tone, theme: any) {
  if (tone === "success") return { backgroundColor: theme.success + "22" };
  if (tone === "warning") return { backgroundColor: theme.warning + "22" };
  if (tone === "error") return { backgroundColor: theme.error + "22" };
  if (tone === "primary") return { backgroundColor: theme.primary + "22" };
  return { backgroundColor: theme.background };
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#EEEDF3" },

  pressed: { opacity: 0.7 },

  scroll: { padding: 8, paddingBottom: 24, gap: 12 },

  balanceCard: { padding: 18, borderRadius: 14, gap: 10, backgroundColor: "#9A6201", position: "relative", overflow: "hidden" },
  balanceCardDriver: { padding: 18, borderRadius: 14, gap: 10, backgroundColor: "#9A6201", borderWidth: 0, overflow: "hidden" },
  balanceCardSender: { padding: 18, borderRadius: 14, gap: 10, backgroundColor: "#007B8B", borderWidth: 0, overflow: "hidden" },
  balanceGradient: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#D7A447", opacity: 0.25, borderRadius: 14 },
  balanceEyebrow: { color: "rgba(255,255,255,0.6)", fontSize: 10, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase" },
  balanceEyebrowLight: { color: "rgba(255,255,255,0.7)" },
  balanceValueRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  balanceValue: { color: "#FFFFFF", fontSize: 28, fontWeight: "700", lineHeight: 34, includeFontPadding: false },
  trendPill: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: "rgba(22,122,85,0.25)", borderRadius: 99 },
  trendText: { color: "#48B889", fontSize: 10, fontWeight: "700" },
  trendPillLight: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 99 },
  trendTextLight: { color: "#FFFFFF", fontSize: 10, fontWeight: "700" },
  balanceDivider: { height: 1, backgroundColor: "rgba(255,255,255,0.12)" },
  balanceDividerLight: { backgroundColor: "rgba(255,255,255,0.18)" },
  balanceRows: { flexDirection: "row", gap: 12 },
  balanceCol: { flex: 1 },
  balanceLabel: { color: "rgba(255,255,255,0.55)", fontSize: 10, fontWeight: "600" },
  balanceLabelLight: { color: "rgba(255,255,255,0.7)" },
  balanceSub: { color: "#FFFFFF", fontSize: 12, fontWeight: "600", marginTop: 2 },
  balanceSubPending: { color: "#FBBF24" },

  actionsRow: { flexDirection: "row", gap: 8, paddingHorizontal: 8, marginTop: 6 },
  actionCard: { flex: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1 },
  actionCardFull: { flex: 1, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1 },
  actionIcon: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  actionIconAlt: {},
  actionText: { flex: 1 },
  actionLabel: { fontSize: 12, fontWeight: "600" },
  actionSub: { fontSize: 9, fontWeight: "500" },

  quickStats: { flexDirection: "row", gap: 8, paddingHorizontal: 8 },
  quickStat: { flex: 1, backgroundColor: "#FFFFFF", borderRadius: 10, paddingVertical: 10, alignItems: "center", gap: 4 },
  quickStatIcon: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  quickStatIconPrimary: { backgroundColor: "#F8F0E5" },
  quickStatIconSuccess: { backgroundColor: "#E2F3F4" },
  quickStatIconAmber: { backgroundColor: "#FEF6E2" },
  quickStatValue: { color: "#111111", fontSize: 13, fontWeight: "700" },
  quickStatLabel: { color: "#747474", fontSize: 9, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase" },

  senderInfo: { marginHorizontal: 8, padding: 12, backgroundColor: "#F8F0E5", borderRadius: 10, flexDirection: "row", gap: 10, alignItems: "center" },
  senderInfoIcon: { width: 32, height: 32, borderRadius: 8, backgroundColor: "#9A6201", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  senderInfoText: { flex: 1, color: "#9A6201", fontSize: 11, lineHeight: 16 },
  senderInfoTextBold: { fontWeight: "700" },

  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 10, marginTop: 6 },
  sectionTitle: { color: "#747474", fontSize: 10, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" },
  sectionAction: { color: "#9A6201", fontSize: 11, fontWeight: "600" },

  listCard: { borderRadius: 12, overflow: "hidden" },
  txRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, paddingHorizontal: 12 },
  txRowDivider: { borderBottomWidth: 1 },
  txIcon: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  iconBgPrimary: {},
  iconBgSuccess: {},
  iconBgWarning: {},
  iconBgError: {},
  iconBgNeutral: {},
  txBody: { flex: 1, minWidth: 0 },
  txLine1: { flexDirection: "row", alignItems: "center", gap: 6 },
  txLabel: { fontSize: 12, fontWeight: "600", flex: 1 },
  txTime: { fontSize: 10, flexShrink: 0 },
  txReason: { fontSize: 11, marginTop: 2 },
  txAmount: { fontSize: 12, fontWeight: "700", flexShrink: 0 },
  amountCredit: {},
  amountDebit: {},
  amountPending: {},

  empty: { alignItems: "center", paddingVertical: 30, paddingHorizontal: 24, gap: 8 },
  emptyIcon: { width: 56, height: 56, borderRadius: 14, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  emptyTitle: { color: "#111111", fontSize: 14, fontWeight: "600" },
  emptySub: { color: "#666666", fontSize: 12, textAlign: "center", lineHeight: 18, maxWidth: 240 },
  emptyText: { color: "#666666", fontSize: 12, textAlign: "center", padding: 24 },

  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.42)" },
  modalSheet: { backgroundColor: "#FFFFFF", borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, paddingTop: 8, paddingBottom: 24 },
  sheetGrip: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#D5D5DC", alignSelf: "center", marginBottom: 14 },
  modalIcon: { width: 44, height: 44, borderRadius: 9, backgroundColor: "#F8F0E5", alignSelf: "center", alignItems: "center", justifyContent: "center", marginBottom: 12 },
  modalTitle: { color: "#111111", fontSize: 17, fontWeight: "600", textAlign: "center" },
  modalSub: { color: "#666666", fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 4 },
  modalHint: { color: "#666666", fontSize: 10, lineHeight: 14, textAlign: "center", marginTop: 6 },
  referenceCard: { backgroundColor: "#EEEDF3", borderRadius: 9, padding: 12, marginTop: 14 },
  referenceLabel: { color: "#666666", fontSize: 9, fontWeight: "700", letterSpacing: 0.5, textAlign: "center" },
  referenceValue: { color: "#111111", fontSize: 12, fontWeight: "600", textAlign: "center", marginTop: 4, letterSpacing: 0.3 },
  requestError: { color: "#B4232D", fontSize: 11, fontWeight: "600", textAlign: "center", marginTop: 6 },
  amountWrap: { flexDirection: "row", alignItems: "center", backgroundColor: "#F7EFE5", borderRadius: 9, borderWidth: 1, borderColor: "#E5D2B9", paddingHorizontal: 12, marginTop: 14 },
  amountInput: { flex: 1, color: "#9A6201", fontSize: 15, fontWeight: "500", minHeight: 46 },
  amountCurrency: { color: "#9A6201", fontSize: 11, fontWeight: "600" },
  modalActions: { flexDirection: "row", gap: 8, marginTop: 16 },
  modalAction: { flex: 1, minHeight: 42 },
});
