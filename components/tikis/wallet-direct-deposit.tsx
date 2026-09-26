import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { TikisButton } from "@/components/tikis/ui";
import { COUNTRIES, countryFlagEmoji, formatLocalPhone, sanitizePhoneInput, type CountrySpec } from "@/lib/registration-rules";
import { trpc } from "@/lib/trpc";
import { useThemeColors } from "@/lib/use-theme-colors";
import { operatorLabel, type YengapayOperatorCode } from "@/shared/yengapay-ussd";
import { useTikisStore } from "@/lib/tikis-store";

/**
 * Paiement Mobile Money direct (in-app, sans redirection web) — Orange Money / Moov Money
 * via YengaPay Direct API.
 *
 * Flow unifié sur une seule page (vs. ancien form/pending en deux étapes) :
 *
 *  1. Page unique de saisie :
 *     - Sélecteur pays (8 UEMOA + Ghana).
 *     - Montant + raccourcis 1k/2,5k/5k/10k/25k.
 *     - Cartes opérateur Orange/Moov (le code USSD du bouton se met à jour live).
 *     - Numéro E.164 (split indicatif + national, maxLength dynamique par pays).
 *     - Code OTP : un seul champ TextInput paste-friendly (vs. 6 cellules manuelles).
 *     - Information claire : YengaPay envoie la demande à l'opérateur et Tikis reste ouvert.
 *     - CTA "Valider le paiement" qui soumet.
 *
 *  2. Page "Validation en cours" :
 *     - Spinner + récap opérateur/numéro/montant/référence.
 *     - Polling 3s sur wallet.checkDirectDepositStatus.
 *     - Bouton de vérification immédiate en complément du polling automatique.
 *     - Annulation persistée côté serveur.
 *
 *  3. Page "Paiement effectué" : gros check vert + récap + bouton Terminer.
 *
 *  4. Page "Paiement échoué" : gros X rouge + cause + Modifier/Fermer.
 *
 * Le serveur crédite réellement le Wallet via webhook YengaPay ou via settleDirectDepositTest
 * (DEV). La confirmation côté client arrive via le polling status.
 */

type Stage = "input" | "waiting" | "success" | "failed";
type Operator = YengapayOperatorCode;

const QUICK_AMOUNTS = [1_000, 2_500, 5_000, 10_000, 25_000];
const POLL_INTERVAL_MS = 3_000;

function createDirectPaymentKey() {
  return `direct_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
}

export type DirectDepositView = {
  transactionId: string;
  providerReference: string;
  ussdCode: string;
  amount: number;
  phone: string;
  operator: Operator;
  countryCode: string;
  expiresAt: string;
  status: "pending" | "succeeded" | "failed" | "cancelled" | "expired";
  mode: "test" | "sandbox" | "live";
};

export function WalletDirectDepositScreen({ visible, onClose, onSuccess, initialDeposit }: { visible: boolean; onClose: () => void; onSuccess?: () => void; initialDeposit?: DirectDepositView | null }) {
  const { colors: theme } = useThemeColors();
  const styles = makeStyles(theme);
  const { profile } = useTikisStore();

  // Pays dérivé du profil : on prend le pays d'enregistrement de l'utilisateur plutôt
  // que de le laisser choisir au moment du paiement. Si profile.countryCode n'est pas
  // reconnu dans COUNTRIES (cas dégénéré), on retombe sur l'index 0.
  const country: CountrySpec = useMemo(() => {
    const fromProfile = COUNTRIES.find((c) => c.id === profile?.countryCode);
    return fromProfile ?? COUNTRIES[0];
  }, [profile?.countryCode]);

  // ===== ÉTAT FORM (page unique) =====
  const [amount, setAmount] = useState<string>("2500");
  const [phoneLocal, setPhoneLocal] = useState<string>("");
  const [operator, setOperator] = useState<Operator>("orange_money");
  const [requestKey, setRequestKey] = useState(createDirectPaymentKey);

  // ===== ÉTAT STAGE =====
  const [stage, setStage] = useState<Stage>("input");
  const [deposit, setDeposit] = useState<DirectDepositView | null>(null);
  const [submitError, setSubmitError] = useState<string>("");
  const [pollError, setPollError] = useState<string>("");

  const requestMutation = trpc.wallet.requestDirectDeposit.useMutation();
  const cancelMutation = trpc.wallet.cancelDirectDeposit.useMutation();
  const statusQuery = trpc.wallet.checkDirectDepositStatus.useQuery(
    { transactionId: deposit?.transactionId ?? "" },
    { enabled: Boolean(deposit?.transactionId) && stage === "waiting", refetchInterval: POLL_INTERVAL_MS },
  );
  const settleTestMutation = trpc.wallet.settleDirectDepositTest.useMutation();

  // ===== Calculs dérivés =====
  const amountNum = useMemo(() => parseInt(amount, 10), [amount]);
  const isAmountValid = Number.isFinite(amountNum) && amountNum >= 100 && amountNum <= 10_000_000;
  const isPhoneValid = phoneLocal.length === country.digits;
  // L'OTP est techniquement optionnel : la vraie confirmation vient du webhook YengaPay.
  // On l'affiche et le rend éditable, mais on ne bloque pas le submit dessus.
  const canSubmit = isAmountValid && isPhoneValid && !requestMutation.isPending;

  // ===== Reset =====
  const reset = useCallback(() => {
    setStage("input");
    setAmount("2500");
    setPhoneLocal("");
    setSubmitError("");
    setPollError("");
    setDeposit(null);
    setOperator("orange_money");
    setRequestKey(createDirectPaymentKey());
  }, []);
  const closeModal = useCallback(() => {
    reset();
    onClose();
  }, [onClose, reset]);

  // Reset quand le modal se ferme
  useEffect(() => {
    if (visible) return;
    const resetTimer = setTimeout(reset, 0);
    return () => clearTimeout(resetTimer);
  }, [visible, reset]);

  // Reprise d'un dépôt en attente (depuis la bannière du wallet)
  // Si le parent passe `initialDeposit`, on saute directement au stage "waiting" avec le
  // deposit pré-rempli — l'USSD a déjà été composé, on attend juste la confirmation PSP.
  // Le setTimeout(0) évite les warnings React "setState during render" si le parent re-render
  // simultanément (cf. fix Manus 433bbe0). cleanup clearTimeout au démontage du composant.
  useEffect(() => {
    if (!visible) return;
    if (!initialDeposit) return;
    const resume = setTimeout(() => {
      setDeposit(initialDeposit);
      setOperator(initialDeposit.operator);
      setStage("waiting");
      setSubmitError("");
      setPollError("");
    }, 0);
    return () => clearTimeout(resume);
  }, [visible, initialDeposit]);

  // ===== Handlers =====

  const onSubmit = useCallback(async () => {
    setSubmitError("");
    if (!isAmountValid) {
      setSubmitError("Le montant doit être compris entre 100 FCFA et 10 000 000 FCFA.");
      return;
    }
    if (!isPhoneValid) {
      setSubmitError(`Le numéro doit contenir ${country.digits} chiffres pour ${country.name}.`);
      return;
    }
    try {
      const result = await requestMutation.mutateAsync({ amount: amountNum, countryCode: country.id, phoneLocal, operator, idempotencyKey: requestKey });
      setDeposit(result);
      setStage("waiting");
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : "La demande de paiement n'a pas pu être créée.");
    }
  }, [amountNum, phoneLocal, country, operator, requestKey, requestMutation, isAmountValid, isPhoneValid]);

  const onCancelWaiting = useCallback(async () => {
    if (!deposit) return;
    try {
      await cancelMutation.mutateAsync({ transactionId: deposit.transactionId });
      setPollError("Paiement annulé. Aucun montant n'a été débité.");
      setStage("failed");
    } catch (cause) {
      setPollError(cause instanceof Error ? cause.message : "Impossible d'annuler le paiement.");
    }
  }, [cancelMutation, deposit]);

  const onDevSettle = useCallback(async (outcome: "succeeded" | "failed") => {
    if (!deposit) return;
    try {
      await settleTestMutation.mutateAsync({ transactionId: deposit.transactionId, outcome });
      // Le polling va ramasser le nouveau statut automatiquement.
    } catch (cause) {
      setPollError(cause instanceof Error ? cause.message : "Action impossible.");
    }
  }, [deposit, settleTestMutation]);

  // ===== Polling =====
  useEffect(() => {
    if (stage !== "waiting" || !deposit) return;
    const data = statusQuery.data;
    if (!data) return;
    if (data.status !== "succeeded" && data.status !== "failed" && data.status !== "cancelled" && data.status !== "expired") return;
    const transition = setTimeout(() => {
      if (data.status === "succeeded") {
        setStage("success");
        onSuccess?.();
        return;
      }
      setPollError(
        data.status === "expired" ? "La demande a expiré avant confirmation."
        : data.status === "cancelled" ? "Le paiement a été annulé."
        : "Le paiement n'a pas pu être confirmé.",
      );
      setStage("failed");
    }, 0);
    return () => clearTimeout(transition);
  }, [statusQuery.data, stage, deposit, onSuccess]);

  const displayedPollError = pollError || (stage === "waiting" && statusQuery.error
    ? "La confirmation YengaPay est momentanément indisponible. La vérification automatique va réessayer."
    : "");

  // ===== Rendu =====
  if (!visible) return null;
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={closeModal} statusBarTranslucent>
      <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={["top", "bottom"]}>
        <View style={[styles.header, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Fermer" onPress={closeModal} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
            <MaterialIcons name="close" size={20} color={theme.foreground} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={[styles.headerTitle, { color: theme.foreground }]} numberOfLines={1}>
              {stage === "input" ? "Dépôt Mobile Money" : stage === "waiting" ? "Validation en cours" : stage === "success" ? "Paiement effectué" : "Paiement échoué"}
            </Text>
          </View>
        </View>

        {stage === "input" ? (
          <InputStage
            theme={theme}
            styles={styles}
            country={country}
            amount={amount}
            phoneLocal={phoneLocal}
            operator={operator}
            submitError={submitError}
            submitting={requestMutation.isPending}
            canSubmit={canSubmit}
            onChangeAmount={setAmount}
            onChangePhone={setPhoneLocal}
            onChangeOperator={setOperator}
            onSubmit={onSubmit}
          />
        ) : null}

        {stage === "waiting" && deposit ? (
          <WaitingStage
            theme={theme}
            styles={styles}
            deposit={deposit}
            pollError={displayedPollError}
            isTest={deposit.mode === "test"}
            settling={settleTestMutation.isPending}
            cancelling={cancelMutation.isPending}
            checking={statusQuery.isFetching}
            onRefresh={() => void statusQuery.refetch()}
            onCancel={() => void onCancelWaiting()}
            onDevSettle={onDevSettle}
          />
        ) : null}

        {stage === "success" && deposit ? (
          <SuccessStage theme={theme} styles={styles} deposit={deposit} onClose={closeModal} />
        ) : null}

        {stage === "failed" ? (
          <FailedStage theme={theme} styles={styles} message={pollError || "Le paiement n'a pas pu être confirmé."} onRetry={() => { setRequestKey(createDirectPaymentKey()); setStage("input"); }} onClose={closeModal} />
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

// =====================================================================
// Page 1 — Saisie unifiée
// =====================================================================

function InputStage(props: {
  theme: ReturnType<typeof useThemeColors>["colors"];
  styles: ReturnType<typeof makeStyles>;
  country: CountrySpec;
  amount: string;
  phoneLocal: string;
  operator: Operator;
  submitError: string;
  submitting: boolean;
  canSubmit: boolean;
  onChangeAmount: (value: string) => void;
  onChangePhone: (value: string) => void;
  onChangeOperator: (op: Operator) => void;
  onSubmit: () => void;
}) {
  const { theme, styles, country, amount, phoneLocal, operator, submitError, submitting, canSubmit, onChangeAmount, onChangePhone, onChangeOperator, onSubmit } = props;
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.label, { color: theme.muted }]}>MONTANT</Text>
          <View style={styles.amountRow}>
            <TextInput value={amount} onChangeText={onChangeAmount} keyboardType="number-pad" maxLength={8} style={[styles.amountInput, { color: theme.foreground, backgroundColor: theme.background, borderColor: theme.border }]} placeholder="2500" placeholderTextColor={theme.muted} />
            <Text style={[styles.amountSuffix, { color: theme.muted }]}>FCFA</Text>
          </View>
          <View style={styles.quickAmounts}>
            {QUICK_AMOUNTS.map((q) => (
              <Pressable key={q} onPress={() => onChangeAmount(String(q))} style={({ pressed }) => [styles.quickAmount, { backgroundColor: theme.background, borderColor: theme.border }, pressed && styles.pressed]}>
                <Text style={[styles.quickAmountText, { color: theme.foreground }]}>{q.toLocaleString("fr-FR")}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.label, { color: theme.muted }]}>OPÉRATEUR</Text>
          <View style={styles.operatorRow}>
            <OperatorCard theme={theme} styles={styles} operator="orange_money" active={operator === "orange_money"} onPress={() => onChangeOperator("orange_money")} />
            <OperatorCard theme={theme} styles={styles} operator="moov_money" active={operator === "moov_money"} onPress={() => onChangeOperator("moov_money")} />
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.label, { color: theme.muted }]}>NUMÉRO MOBILE MONEY</Text>
          <View style={styles.phoneRow}>
            <View style={[styles.dialCodeStatic, { backgroundColor: theme.background, borderColor: theme.border }]}>
              <Text style={styles.flag}>{countryFlagEmoji(country.id)}</Text>
              <Text style={[styles.dialCodeText, { color: theme.foreground }]}>{country.dialCode}</Text>
            </View>
            <TextInput
              value={formatLocalPhone(phoneLocal, country)}
              onChangeText={(raw) => onChangePhone(sanitizePhoneInput(raw, country))}
              keyboardType="number-pad"
              maxLength={country.digits + country.groups.length - 1}
              placeholder={country.groups.map((g) => "0".repeat(g)).join(" ")}
              placeholderTextColor={theme.muted}
              style={[styles.phoneInput, { color: theme.foreground, backgroundColor: theme.background, borderColor: theme.border }]}
            />
          </View>
          <Text style={[styles.hint, { color: theme.muted }]}>{country.name} · {country.digits} chiffres attendus</Text>
        </View>

        <View style={[styles.infoCard, { backgroundColor: theme.background, borderColor: theme.border }]}>
          <MaterialIcons name="verified-user" size={18} color={theme.primary} />
          <Text style={[styles.infoText, { color: theme.muted }]}>YengaPay envoie la demande de validation au numéro saisi. La confirmation est suivie ici automatiquement : vous ne quittez pas Tikis.</Text>
        </View>

        {submitError ? <Text style={[styles.errorText, { color: theme.error, backgroundColor: "#F8E8E9" }]}>{submitError}</Text> : null}

        <TikisButton
          label={submitting ? "Envoi en cours…" : "Valider le paiement"}
          icon="check-circle"
          onPress={onSubmit}
          loading={submitting}
          disabled={!canSubmit}
          style={styles.cta}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function OperatorCard(props: { theme: ReturnType<typeof useThemeColors>["colors"]; styles: ReturnType<typeof makeStyles>; operator: Operator; active: boolean; onPress: () => void }) {
  const { theme, styles, operator, active, onPress } = props;
  const isOM = operator === "orange_money";
  const color = isOM ? "#FF7900" : "#0033A0";
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.operatorCard, { backgroundColor: active ? "#F7EFE5" : theme.surface, borderColor: active ? theme.primary : theme.border }, pressed && styles.pressed]} accessibilityRole="radio" accessibilityState={{ selected: active }}>
      <View style={[styles.operatorLogo, { backgroundColor: color }]}>
        <Text style={styles.operatorLogoText}>{isOM ? "OM" : "MV"}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.operatorName, { color: theme.foreground }]}>{operatorLabel(operator)}</Text>
        <Text style={[styles.operatorFees, { color: theme.muted }]} numberOfLines={1}>{isOM ? "Frais 1,5%" : "Frais 2%"}</Text>
      </View>
      {active ? <MaterialIcons name="check-circle" size={16} color={theme.primary} /> : null}
    </Pressable>
  );
}

// =====================================================================
// Page 2 — Validation en cours (polling + recap)
// =====================================================================

function WaitingStage(props: {
  theme: ReturnType<typeof useThemeColors>["colors"];
  styles: ReturnType<typeof makeStyles>;
  deposit: DirectDepositView;
  pollError: string;
  isTest: boolean;
  settling: boolean;
  cancelling: boolean;
  checking: boolean;
  onRefresh: () => void;
  onCancel: () => void;
  onDevSettle: (outcome: "succeeded" | "failed") => void;
}) {
  const { theme, styles, deposit, pollError, isTest, settling, cancelling, checking, onRefresh, onCancel, onDevSettle } = props;
  return (
    <View style={[styles.waitingStage, { backgroundColor: theme.surface }]}>
      <ActivityIndicator size="large" color={theme.primary} />
      <Text style={[styles.waitingTitle, { color: theme.foreground }]}>Validation en cours</Text>
      <Text style={[styles.waitingSubtitle, { color: theme.muted }]}>Demande envoyée à {operatorLabel(deposit.operator)}. Gardez Tikis ouvert : la confirmation est vérifiée automatiquement.</Text>

      <View style={[styles.recap, { backgroundColor: theme.background }]}>
        <RecapRow theme={theme} styles={styles} label="Opérateur" value={operatorLabel(deposit.operator)} />
        <RecapRow theme={theme} styles={styles} label="Numéro" value={deposit.phone} />
        <RecapRow theme={theme} styles={styles} label="Montant" value={`${deposit.amount.toLocaleString("fr-FR")} FCFA`} />
        <RecapRow theme={theme} styles={styles} label="Référence" value={deposit.providerReference} />
      </View>

      {pollError ? <Text style={[styles.errorText, { color: theme.error, backgroundColor: "#F8E8E9", marginTop: 12 }]}>{pollError}</Text> : null}

      <TikisButton label="Vérifier maintenant" icon="refresh" loading={checking} disabled={checking || cancelling} onPress={onRefresh} style={styles.refreshButton} />

      {isTest ? (
        <View style={[styles.devCard, { backgroundColor: "#F7EFE5", borderColor: theme.primary }]}>
          <Text style={[styles.devLabel, { color: theme.primary }]}>MODE TEST (DEV uniquement)</Text>
          <View style={styles.devActions}>
            <TikisButton label="Forcer succès" icon="check-circle" onPress={() => onDevSettle("succeeded")} loading={settling} style={styles.devBtn} />
            <TikisButton label="Forcer échec" icon="cancel" variant="secondary" onPress={() => onDevSettle("failed")} loading={settling} style={styles.devBtn} />
          </View>
        </View>
      ) : null}

      <Pressable disabled={cancelling || checking} onPress={onCancel} style={({ pressed }) => [styles.cancelBtn, pressed && styles.pressed, (cancelling || checking) && { opacity: 0.45 }]}>
        <Text style={[styles.cancelText, { color: theme.muted }]}>Annuler</Text>
      </Pressable>
    </View>
  );
}

// =====================================================================
// Page 3 & 4 — Résultat
// =====================================================================

function SuccessStage(props: { theme: ReturnType<typeof useThemeColors>["colors"]; styles: ReturnType<typeof makeStyles>; deposit: DirectDepositView; onClose: () => void }) {
  const { theme, styles, deposit, onClose } = props;
  return (
    <View style={[styles.centerStage, { backgroundColor: theme.surface }]}>
      <View style={[styles.bigCheck, { backgroundColor: theme.success }]}>
        <MaterialIcons name="check" size={48} color="#FFFFFF" />
      </View>
      <Text style={[styles.centerTitle, { color: theme.foreground }]}>Paiement effectué</Text>
      <Text style={[styles.centerSubtitle, { color: theme.muted }]}>Votre Wallet Tikis a été crédité. Vous pouvez maintenant utiliser ce solde pour vos livraisons.</Text>
      <View style={[styles.recap, { backgroundColor: theme.background }]}>
        <RecapRow theme={theme} styles={styles} label="Opérateur" value={operatorLabel(deposit.operator)} />
        <RecapRow theme={theme} styles={styles} label="Numéro" value={deposit.phone} />
        <RecapRow theme={theme} styles={styles} label="Montant" value={`${deposit.amount.toLocaleString("fr-FR")} FCFA`} />
        <RecapRow theme={theme} styles={styles} label="Référence" value={deposit.providerReference} />
      </View>
      <TikisButton label="Terminer" icon="check" onPress={onClose} style={styles.cta} />
    </View>
  );
}

function FailedStage(props: { theme: ReturnType<typeof useThemeColors>["colors"]; styles: ReturnType<typeof makeStyles>; message: string; onRetry: () => void; onClose: () => void }) {
  const { theme, styles, message, onRetry, onClose } = props;
  return (
    <View style={[styles.centerStage, { backgroundColor: theme.surface }]}>
      <View style={[styles.bigCheck, { backgroundColor: theme.error }]}>
        <MaterialIcons name="close" size={48} color="#FFFFFF" />
      </View>
      <Text style={[styles.centerTitle, { color: theme.foreground }]}>Paiement échoué</Text>
      <Text style={[styles.centerSubtitle, { color: theme.muted }]}>{message}</Text>
      <View style={styles.failActions}>
        <TikisButton label="Modifier" variant="secondary" onPress={onRetry} style={{ flex: 1 }} />
        <TikisButton label="Fermer" onPress={onClose} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

function RecapRow(props: { theme: ReturnType<typeof useThemeColors>["colors"]; styles: ReturnType<typeof makeStyles>; label: string; value: string }) {
  return (
    <View style={props.styles.recapRow}>
      <Text style={[props.styles.recapLabel, { color: props.theme.muted }]}>{props.label}</Text>
      <Text style={[props.styles.recapValue, { color: props.theme.foreground }]} numberOfLines={1}>{props.value}</Text>
    </View>
  );
}

// =====================================================================
// Styles
// =====================================================================

function makeStyles(theme: ReturnType<typeof useThemeColors>["colors"]) {
  return StyleSheet.create({
    screen: { flex: 1 },
    header: { paddingHorizontal: 16, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: StyleSheet.hairlineWidth },
    headerTitle: { fontSize: 17, fontWeight: "600", letterSpacing: -0.2 },
    iconButton: { width: 40, height: 40, borderRadius: 9, alignItems: "center", justifyContent: "center" },
    pressed: { opacity: 0.7 },
    body: { padding: 16, paddingBottom: 32, gap: 14 },
    card: { padding: 14, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, gap: 10 },
    label: { fontSize: 10.5, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" },
    amountRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    amountInput: { flex: 1, fontSize: 22, fontWeight: "700", paddingHorizontal: 14, height: 46, borderRadius: 9, borderWidth: StyleSheet.hairlineWidth },
    amountSuffix: { fontSize: 13, fontWeight: "600" },
    quickAmounts: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    quickAmount: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
    quickAmountText: { fontSize: 12, fontWeight: "600" },
    operatorRow: { flexDirection: "row", gap: 10 },
    operatorCard: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 10, borderWidth: 2 },
    operatorLogo: { width: 36, height: 36, borderRadius: 8, alignItems: "center", justifyContent: "center" },
    operatorLogoText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
    operatorName: { fontSize: 13, fontWeight: "600" },
    operatorFees: { fontSize: 10.5 },
    phoneRow: { flexDirection: "row", alignItems: "stretch", gap: 8 },
    dialCodeStatic: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, height: 46, borderRadius: 9, borderWidth: StyleSheet.hairlineWidth },
    flag: { fontSize: 18 },
    dialCodeText: { fontSize: 14, fontWeight: "700" },
    phoneInput: { flex: 1, paddingHorizontal: 14, height: 46, borderRadius: 9, borderWidth: StyleSheet.hairlineWidth, fontSize: 16 },
    hint: { fontSize: 11, fontWeight: "500" },
    infoCard: { flexDirection: "row", alignItems: "flex-start", gap: 9, padding: 12, borderRadius: 9, borderWidth: StyleSheet.hairlineWidth },
    infoText: { flex: 1, fontSize: 12, lineHeight: 18 },
    errorText: { padding: 12, borderRadius: 9, fontSize: 13, lineHeight: 18 },
    cta: { marginTop: 8, minHeight: 50 },
    refreshButton: { width: "100%", minHeight: 44 },

    waitingStage: { flex: 1, padding: 24, alignItems: "center", justifyContent: "center", gap: 14 },
    waitingTitle: { fontSize: 18, fontWeight: "700", textAlign: "center", marginTop: 16 },
    waitingSubtitle: { fontSize: 13, textAlign: "center", lineHeight: 19, maxWidth: 280 },

    devCard: { padding: 12, borderRadius: 10, borderWidth: 1, gap: 10, width: "100%", marginTop: 8 },
    devLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 0.7, textTransform: "uppercase" },
    devActions: { flexDirection: "row", gap: 8 },
    devBtn: { flex: 1 },

    cancelBtn: { alignItems: "center", padding: 14, marginTop: 4 },
    cancelText: { fontSize: 14, fontWeight: "600" },

    centerStage: { flex: 1, padding: 24, alignItems: "center", justifyContent: "center", gap: 14 },
    bigCheck: { width: 88, height: 88, borderRadius: 44, alignItems: "center", justifyContent: "center" },
    centerTitle: { fontSize: 22, fontWeight: "700", textAlign: "center", letterSpacing: -0.4 },
    centerSubtitle: { fontSize: 14, textAlign: "center", lineHeight: 20, maxWidth: 280 },
    recap: { width: "100%", padding: 14, borderRadius: 12, gap: 6 },
    recapRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6, gap: 12 },
    recapLabel: { fontSize: 12, fontWeight: "500" },
    recapValue: { fontSize: 13, fontWeight: "700", flexShrink: 1, textAlign: "right" },
    failActions: { flexDirection: "row", gap: 8, width: "100%" },
  });
}
