import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MOBILE_MONEY_LOGOS } from "@/components/tikisse/mobile-money-logos";
import { TikisseButton } from "@/components/tikisse/ui";
import { COUNTRIES, countryFlagEmoji, formatLocalPhone, sanitizePhoneInput, type CountrySpec } from "@/lib/registration-rules";
import { trpc } from "@/lib/trpc";
import { useDarkTone } from "@/lib/themed-styles";
import { useThemeColors } from "@/lib/use-theme-colors";
import { buildUssdCode } from "@/shared/yengapay-ussd";
import { mobileMoneyAmountError, mobileMoneyOperatorLabel as operatorLabel, mobileMoneyOperatorsFor, type MobileMoneyOperator, type MobileMoneyOperatorId } from "@/shared/mobile-money-operators";
import { useTikisseStore } from "@/lib/tikisse-store";

/**
 * Paiement Mobile Money direct (in-app, sans redirection web) — Orange Money / Moov Money
 * via YengaPay Direct API.
 *
 * Flow en deux étapes :
 *
 *  1. Formulaire de demande :
 *     - Sélecteur pays (8 UEMOA + Ghana).
 *     - Montant + raccourcis 500/1k/5k/10k/25k.
 *     - Cartes opérateur Orange/Moov.
 *     - Numéro E.164 (split indicatif + national, maxLength dynamique par pays).
 *     - CTA de création de demande.
 *
 *  2. Confirmation : récapitulatif, USSD, OTP à six cellules, modification et annulation.
 *
 *  3. Page "Paiement effectué" : gros check vert + récap + bouton Terminer.
 *
 *  4. Page "Paiement échoué" : gros X rouge + cause + Modifier/Fermer.
 *
 * Le serveur crédite réellement le Wallet via webhook YengaPay ou via settleDirectDepositTest
 * (DEV). La confirmation côté client arrive via le polling status.
 */

type Stage = "request" | "confirmation" | "success" | "failed";
type Operator = MobileMoneyOperatorId;

/** Code USSD d'Orange/Moov via YengaPay, quand le serveur n'en a pas fourni. */
function fallbackUssd(operator: Operator, amount: number) {
  return operator === "orange_money" || operator === "moov_money" ? buildUssdCode(operator, amount) : "";
}

const QUICK_AMOUNTS = [1_000, 5_000, 10_000, 25_000];
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
  requiresOtp?: boolean;
  /** PUSH : pas de code, l'opérateur demande au client de valider sur son téléphone (Moov via LigdiCash). */
  flow?: "ONE_STEP" | "TWO_STEP" | "TEST" | "PUSH" | "GUIDED" | "REDIRECT";
  /** Page de paiement de l'opérateur à ouvrir (flux REDIRECT : Orange Mali, Wave Sénégal). */
  checkoutUrl?: string;
  otpInstructions?: string;
  provider?: "yengapay" | "ligdicash";
};

export function WalletDirectDepositScreen({ visible, onClose, onSuccess, initialDeposit }: { visible: boolean; onClose: () => void; onSuccess?: () => void; initialDeposit?: DirectDepositView | null }) {
  const { colors: theme } = useThemeColors();
  const styles = makeStyles(theme);
  const { profile } = useTikisseStore();

  const profileStatusQuery = trpc.profiles.status.useQuery(undefined, {
    enabled: visible && Boolean(profile?.phone),
    staleTime: 0,
    refetchOnMount: "always",
  });
  const profileCountry = profileStatusQuery.data?.country ?? profile?.country;

  // Le pays du paiement provient du pays enregistré sur le profil, jamais du code
  // pays du téléphone. La requête de statut resynchronise le profil à chaque ouverture.
  const country: CountrySpec = useMemo(() => {
    const fromProfile = COUNTRIES.find((c) => c.id === profileCountry);
    return fromProfile ?? COUNTRIES[0];
  }, [profileCountry]);

  // Opérateurs du pays du profil, chez le prestataire actif (shared/mobile-money-operators.ts).
  const paymentOptionsQuery = trpc.wallet.paymentOptions.useQuery(undefined, { enabled: visible, staleTime: 5 * 60_000 });
  const operators = useMemo(
    () => mobileMoneyOperatorsFor(paymentOptionsQuery.data?.directProvider ?? "yengapay", country.id),
    [paymentOptionsQuery.data?.directProvider, country.id],
  );

  // ===== ÉTAT FORMULAIRE =====
  const [amount, setAmount] = useState<string>("");
  const [phoneLocal, setPhoneLocal] = useState<string>("");
  const [operator, setOperator] = useState<Operator>("orange_money");
  const [requestKey, setRequestKey] = useState(createDirectPaymentKey);
  const [otpCells, setOtpCells] = useState<string[]>(() => Array.from({ length: 6 }, () => ""));
  const otp = otpCells.join("");

  // ===== ÉTAT STAGE =====
  const [stage, setStage] = useState<Stage>("request");
  const [deposit, setDeposit] = useState<DirectDepositView | null>(null);
  const [submitError, setSubmitError] = useState<string>("");
  const [pollError, setPollError] = useState<string>("");
  const [modifying, setModifying] = useState(false);

  const requestMutation = trpc.wallet.requestDirectDeposit.useMutation();
  const payMutation = trpc.wallet.payDirectDeposit.useMutation();
  const resendOtpMutation = trpc.wallet.resendDirectDepositOtp.useMutation();
  const cancelMutation = trpc.wallet.cancelDirectDeposit.useMutation();
  const statusQuery = trpc.wallet.checkDirectDepositStatus.useQuery(
    { transactionId: deposit?.transactionId ?? "" },
    { enabled: Boolean(deposit?.transactionId) && stage === "confirmation", refetchInterval: POLL_INTERVAL_MS },
  );
  const settleTestMutation = trpc.wallet.settleDirectDepositTest.useMutation();

  // ===== Calculs dérivés =====
  const amountNum = useMemo(() => parseInt(amount, 10), [amount]);
  const isPhoneValid = phoneLocal.length === country.digits;
  // L'opérateur choisi doit exister dans le pays : sinon, le premier proposé.
  const selectedOperator: Operator = operators.some((item) => item.id === operator) ? operator : operators[0]?.id ?? operator;
  // Limites de Tikisse, resserrées par celles de l'opérateur (ex. 2 000 000 FCFA au plus avec Orange Burkina).
  const amountError = mobileMoneyAmountError(operators.find((item) => item.id === selectedOperator) ?? null, amountNum);
  const isAmountValid = amountError === null;
  const canSubmit = isAmountValid && isPhoneValid && operators.some((item) => item.id === selectedOperator) && !requestMutation.isPending;

  // ===== Reset =====
  const reset = useCallback(() => {
    setStage("request");
    setAmount("");
    setPhoneLocal("");
    setSubmitError("");
    setPollError("");
    setOtpCells(Array.from({ length: 6 }, () => ""));
    setDeposit(null);
    setModifying(false);
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

  useEffect(() => {
    if (!visible || !profile?.phone) return;
    void profileStatusQuery.refetch();
  }, [visible, profile?.phone, profileStatusQuery.refetch]);

  // Reprise d'un dépôt en attente depuis la bannière du Wallet.
  // Le setTimeout(0) évite les warnings React "setState during render" si le parent re-render
  // simultanément (cf. correctif 433bbe0). cleanup clearTimeout au démontage du composant.
  useEffect(() => {
    if (!visible) return;
    if (!initialDeposit) return;
    const resume = setTimeout(() => {
      setDeposit(initialDeposit);
      setOperator(initialDeposit.operator);
      setAmount(String(initialDeposit.amount));
      const normalizedPhone = initialDeposit.phone.replace(/^\+/, "");
      const dialDigits = country.dialCode.replace(/^\+/, "");
      setPhoneLocal(normalizedPhone.startsWith(dialDigits) ? normalizedPhone.slice(dialDigits.length) : normalizedPhone);
      setStage("confirmation");
      setSubmitError("");
      setPollError("");
      setOtpCells(Array.from({ length: 6 }, () => ""));
    }, 0);
    return () => clearTimeout(resume);
  }, [country.dialCode, visible, initialDeposit]);

  // ===== Handlers =====

  const onSubmit = useCallback(async () => {
    setSubmitError("");
    if (!isAmountValid) {
      setSubmitError(amountError ?? "Montant invalide.");
      return;
    }
    if (!isPhoneValid) {
      setSubmitError(`Le numéro doit contenir ${country.digits} chiffres pour ${country.name}.`);
      return;
    }
    try {
      const result = await requestMutation.mutateAsync({ amount: amountNum, countryCode: country.id, phoneLocal, operator: selectedOperator, idempotencyKey: requestKey });
      setDeposit(result);
      setStage("confirmation");
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : "La demande de paiement n'a pas pu être créée.");
    }
  }, [amountNum, amountError, phoneLocal, country, selectedOperator, requestKey, requestMutation, isAmountValid, isPhoneValid]);

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

  const onModify = useCallback(async () => {
    if (!deposit || modifying) return;
    setModifying(true);
    setPollError("");
    try {
      await cancelMutation.mutateAsync({ transactionId: deposit.transactionId });
      setDeposit(null);
      setOtpCells(Array.from({ length: 6 }, () => ""));
      setRequestKey(createDirectPaymentKey());
      setSubmitError("");
      setStage("request");
    } catch (cause) {
      setPollError(cause instanceof Error ? cause.message : "Impossible d'annuler l'ancienne demande.");
    } finally {
      setModifying(false);
    }
  }, [cancelMutation, deposit, modifying]);

  const onPay = useCallback(async () => {
    if (!deposit || !/^\d{6}$/.test(otp)) {
      setPollError("Saisissez les 6 chiffres du code OTP reçu ou généré par votre opérateur.");
      return;
    }
    setPollError("");
    try {
      const result = await payMutation.mutateAsync({ transactionId: deposit.transactionId, otp });
      setDeposit(result);
      if (result.status === "succeeded") {
        setStage("success");
        onSuccess?.();
      } else if (result.status === "failed" || result.status === "cancelled" || result.status === "expired") {
        setPollError(result.status === "expired" ? "La demande a expiré avant confirmation." : "Le paiement n'a pas pu être confirmé.");
        setStage("failed");
      }
    } catch (cause) {
      setPollError(cause instanceof Error ? cause.message : "Le paiement direct n'a pas pu être confirmé.");
    }
  }, [deposit, onSuccess, otp, payMutation]);

  const onResendOtp = useCallback(async () => {
    if (!deposit) return;
    setPollError("");
    try {
      await resendOtpMutation.mutateAsync({ transactionId: deposit.transactionId });
    } catch (cause) {
      setPollError(cause instanceof Error ? cause.message : "Le code OTP n'a pas pu être renvoyé.");
    }
  }, [deposit, resendOtpMutation]);

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
    if (stage !== "confirmation" || !deposit) return;
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

  const displayedPollError = pollError || (stage === "confirmation" && statusQuery.error
    ? "La confirmation du paiement est momentanément indisponible. La vérification automatique va réessayer."
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
              {stage === "request" ? "Dépôt Mobile Money" : stage === "confirmation" ? "Confirmer le paiement" : stage === "success" ? "Paiement effectué" : "Paiement échoué"}
            </Text>
          </View>
        </View>

        {stage === "request" || stage === "confirmation" ? (
          <InputStage
            theme={theme}
            styles={styles}
            country={country}
            amount={amount}
            amountHint={amount.trim() ? amountError ?? "" : ""}
            phoneLocal={phoneLocal}
            operator={selectedOperator}
            operators={operators}
            submitError={submitError}
            deposit={deposit}
            otpCells={otpCells}
            submitting={requestMutation.isPending}
            confirming={payMutation.isPending}
            resendingOtp={resendOtpMutation.isPending}
            cancelling={cancelMutation.isPending}
            settling={settleTestMutation.isPending}
            modifying={modifying}
            pollError={displayedPollError}
            canSubmit={deposit ? otpCells.every(Boolean) : canSubmit}
            onChangeAmount={setAmount}
            onChangePhone={setPhoneLocal}
            onChangeOperator={setOperator}
            onChangeOtpCell={(index, value) => setOtpCells((current) => current.map((cell, cellIndex) => cellIndex === index ? value : cell))}
            onModify={() => void onModify()}
            onSubmit={deposit ? () => void onPay() : () => void onSubmit()}
            onOpenUssd={async () => {
              const code = deposit?.ussdCode || fallbackUssd(selectedOperator, Number.parseInt(amount, 10));
              if (!code) return;
              try {
                await Linking.openURL(`tel:${code.replace("#", "%23")}`);
              } catch {
                setSubmitError("Impossible d'ouvrir l'application téléphone sur cet appareil.");
              }
            }}
            onResendOtp={() => void onResendOtp()}
            onCancel={() => void onCancelWaiting()}
            onDevSettle={onDevSettle}
          />
        ) : null}

        {stage === "success" && deposit ? (
          <SuccessStage theme={theme} styles={styles} deposit={deposit} onClose={closeModal} />
        ) : null}

        {stage === "failed" ? (
          <FailedStage theme={theme} styles={styles} message={pollError || "Le paiement n'a pas pu être confirmé."} onRetry={() => { setRequestKey(createDirectPaymentKey()); setDeposit(null); setOtpCells(Array.from({ length: 6 }, () => "")); setPollError(""); setSubmitError(""); setStage("request"); }} onClose={closeModal} />
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

// =====================================================================
// Écran de demande et de confirmation
// =====================================================================

function InputStage(props: {
  theme: ReturnType<typeof useThemeColors>["colors"];
  styles: ReturnType<typeof makeStyles>;
  country: CountrySpec;
  amount: string;
  /** Montant saisi refusé par l'opérateur choisi (limites). */
  amountHint: string;
  phoneLocal: string;
  operator: Operator;
  operators: readonly MobileMoneyOperator[];
  submitError: string;
  deposit: DirectDepositView | null;
  otpCells: string[];
  submitting: boolean;
  confirming: boolean;
  resendingOtp: boolean;
  cancelling: boolean;
  settling: boolean;
  modifying: boolean;
  pollError: string;
  canSubmit: boolean;
  onChangeAmount: (value: string) => void;
  onChangePhone: (value: string) => void;
  onChangeOperator: (op: Operator) => void;
  onChangeOtpCell: (index: number, value: string) => void;
  onSubmit: () => void;
  onOpenUssd: () => void;
  onModify: () => void;
  onResendOtp: () => void;
  onCancel: () => void;
  onDevSettle: (outcome: "succeeded" | "failed") => void;
}) {
  const { theme, styles, country, amount, amountHint, phoneLocal, operator, operators, submitError, deposit, otpCells, submitting, confirming, resendingOtp, cancelling, settling, modifying, pollError, canSubmit, onChangeAmount, onChangePhone, onChangeOperator, onChangeOtpCell, onSubmit, onOpenUssd, onModify, onResendOtp, onCancel, onDevSettle } = props;

  if (deposit) {
    return <ConfirmationStage
      theme={theme}
      styles={styles}
      deposit={deposit}
      otpCells={otpCells}
      confirming={confirming}
      resendingOtp={resendingOtp}
      cancelling={cancelling}
      settling={settling}
      modifying={modifying}
      pollError={pollError}
      onSubmit={onSubmit}
      onOpenUssd={onOpenUssd}
      onModify={onModify}
      onResendOtp={onResendOtp}
      onCancel={onCancel}
      onChangeOtpCell={onChangeOtpCell}
      onDevSettle={onDevSettle}
    />;
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}>
      <ScrollView contentContainerStyle={styles.keyboardBody} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}>
        <Text style={[styles.stepLabel, { color: theme.muted }]}>ÉTAPE 1 SUR 2 · INFORMATIONS DE LA DEMANDE</Text>
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.label, { color: theme.muted }]}>MONTANT</Text>
          <View style={styles.amountRow}>
            <TextInput value={amount} editable={!submitting} onChangeText={onChangeAmount} keyboardType="number-pad" maxLength={8} style={[styles.amountInput, { color: theme.foreground, backgroundColor: theme.background, borderColor: theme.border }]} placeholder="Ex: 2500" placeholderTextColor={theme.muted} />
            <Text style={[styles.amountSuffix, { color: theme.muted }]}>FCFA</Text>
          </View>
          {amountHint ? <Text style={[styles.amountHint, { color: theme.muted }]}>{amountHint}</Text> : null}
          <View style={styles.quickAmounts}>
            <Pressable key={500} disabled={submitting} onPress={() => onChangeAmount("500")} style={({ pressed }) => [styles.quickAmount, { backgroundColor: theme.background, borderColor: theme.border }, submitting && { opacity: 0.45 }, pressed && styles.pressed]}>
              <Text style={[styles.quickAmountText, { color: theme.foreground }]}>500</Text>
            </Pressable>
            {QUICK_AMOUNTS.map((q) => (
              <Pressable key={q} disabled={submitting} onPress={() => onChangeAmount(String(q))} style={({ pressed }) => [styles.quickAmount, { backgroundColor: theme.background, borderColor: theme.border }, submitting && { opacity: 0.45 }, pressed && styles.pressed]}>
                <Text style={[styles.quickAmountText, { color: theme.foreground }]}>{q.toLocaleString("fr-FR")}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.label, { color: theme.muted }]}>OPÉRATEUR</Text>
          {operators.length === 0 ? (
            <Text style={[styles.otpHint, { color: theme.muted }]}>Le rechargement par Mobile Money n’est pas encore disponible au {country.name}. Il le sera dès qu’un opérateur y sera ouvert.</Text>
          ) : (
            <View style={[styles.operatorRow, { flexWrap: "wrap" }]}>
              {operators.map((item) => <OperatorCard key={item.id} theme={theme} styles={styles} operator={item} active={operator === item.id} disabled={submitting} onPress={() => onChangeOperator(item.id)} />)}
            </View>
          )}
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
              editable={!submitting}
              onChangeText={(raw) => onChangePhone(sanitizePhoneInput(raw, country))}
              keyboardType="number-pad"
              maxLength={country.digits + country.groups.length - 1}
              placeholder={country.groups.map((g) => "0".repeat(g)).join(" ")}
              placeholderTextColor={theme.muted}
              style={[styles.phoneInput, { color: theme.foreground, backgroundColor: theme.background, borderColor: theme.border }]}
            />
          </View>
        </View>

        {submitError ? <Text style={[styles.errorText, { color: theme.error, backgroundColor: "#F9E8E4" }]}>{submitError}</Text> : null}
        <TikisseButton label="Valider les informations" icon="arrow-forward" loading={submitting} disabled={!canSubmit} onPress={onSubmit} style={styles.cta} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function ConfirmationStage(props: {
  theme: ReturnType<typeof useThemeColors>["colors"];
  styles: ReturnType<typeof makeStyles>;
  deposit: DirectDepositView;
  otpCells: string[];
  confirming: boolean;
  resendingOtp: boolean;
  cancelling: boolean;
  settling: boolean;
  modifying: boolean;
  pollError: string;
  onSubmit: () => void;
  onOpenUssd: () => void;
  onModify: () => void;
  onResendOtp: () => void;
  onCancel: () => void;
  onChangeOtpCell: (index: number, value: string) => void;
  onDevSettle: (outcome: "succeeded" | "failed") => void;
}) {
  const { theme, styles, deposit, otpCells, confirming, resendingOtp, cancelling, settling, modifying, pollError, onSubmit, onOpenUssd, onModify, onResendOtp, onCancel, onChangeOtpCell, onDevSettle } = props;
  const isTest = deposit.mode === "test";
  const requiresOtp = Boolean(!isTest && deposit.requiresOtp !== false);
  const ussdCode = deposit.ussdCode || (deposit.provider === "ligdicash" ? "" : fallbackUssd(deposit.operator, deposit.amount));

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}>
      <ScrollView contentContainerStyle={styles.keyboardBody} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}>
        <Text style={[styles.stepLabel, { color: theme.muted }]}>ÉTAPE 2 SUR 2 · CONFIRMATION DU PAIEMENT</Text>
        <View style={[styles.paymentCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={styles.paymentStatusRow}>
            <View style={[styles.statusIndicator, { backgroundColor: theme.primary }]} />
            <Text style={[styles.paymentStatus, { color: theme.foreground }]}>Demande créée · validation en cours</Text>
          </View>
          <RecapRow theme={theme} styles={styles} label="Montant" value={`${deposit.amount.toLocaleString("fr-FR")} FCFA`} />
          <RecapRow theme={theme} styles={styles} label="Opérateur" value={operatorLabel(deposit.operator)} />
          <RecapRow theme={theme} styles={styles} label="Numéro" value={deposit.phone} />
        </View>

        {pollError ? <Text style={[styles.errorText, { color: theme.error, backgroundColor: "#F9E8E4" }]}>{pollError}</Text> : null}

        {requiresOtp ? (
          <View style={[styles.otpCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.label, { color: theme.muted }]}>CONFIRMATION OTP</Text>
            <Text style={[styles.otpHint, { color: theme.muted }]}>{deposit.otpInstructions ?? "Composez le code ci-dessous sur votre téléphone pour obtenir le code OTP :"}</Text>
            <TikisseButton label={ussdCode || "Code USSD indisponible"} icon="phone" variant="secondary" disabled={!ussdCode || confirming} onPress={onOpenUssd} style={styles.ussdButton} />
            <OtpCells theme={theme} styles={styles} values={otpCells} disabled={confirming} onChange={onChangeOtpCell} />
            <TikisseButton label="Confirmer le paiement" icon="lock-open" loading={confirming} disabled={confirming || otpCells.some((cell) => !cell)} onPress={onSubmit} style={styles.cta} />
            {deposit.operator === "moov_money" && deposit.provider !== "ligdicash" ? <TikisseButton label="Renvoyer le code OTP" loading={resendingOtp} disabled={resendingOtp || confirming} onPress={onResendOtp} variant="ghost" style={styles.refreshButton} /> : null}
          </View>
        ) : !isTest && deposit.otpInstructions ? (
          // Pas de code à saisir : validation sur le téléphone (Moov), ou code déjà envoyé (Orange).
          <View style={[styles.otpCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.label, { color: theme.muted }]}>{deposit.flow === "PUSH" ? "VALIDEZ SUR VOTRE TÉLÉPHONE" : deposit.flow === "GUIDED" ? "SUIVEZ LE SMS DE VOTRE OPÉRATEUR" : deposit.flow === "REDIRECT" ? "PAGE DE PAIEMENT" : "PAIEMENT EN COURS"}</Text>
            <Text style={[styles.otpHint, { color: theme.foreground }]}>{deposit.otpInstructions}</Text>
            {deposit.flow === "REDIRECT" && deposit.checkoutUrl ? (
              <TikisseButton label={`Ouvrir la page ${operatorLabel(deposit.operator)}`} icon="open-in-new" onPress={() => { void Linking.openURL(deposit.checkoutUrl!).catch(() => undefined); }} style={styles.cta} />
            ) : null}
            <Text style={[styles.otpHint, { color: theme.muted }]}>Cet écran se met à jour tout seul dès que l’opérateur confirme le paiement.</Text>
          </View>
        ) : null}

        {isTest ? <View style={[styles.devCard, { backgroundColor: "#FFF0D8", borderColor: theme.primary }]}><Text style={[styles.devLabel, { color: theme.primary }]}>MODE TEST (DEV uniquement)</Text><View style={styles.devActions}><TikisseButton label="Forcer succès" icon="check-circle" onPress={() => onDevSettle("succeeded")} loading={settling} style={styles.devBtn} /><TikisseButton label="Forcer échec" icon="cancel" variant="secondary" onPress={() => onDevSettle("failed")} loading={settling} style={styles.devBtn} /></View></View> : null}
        <View style={styles.confirmationActions}>
          <TikisseButton label="Modifier" icon="edit" compact variant="secondary" loading={modifying} disabled={modifying || cancelling || confirming} onPress={onModify} style={styles.actionButton} />
          <TikisseButton label="Annuler" icon="close" compact variant="ghost" loading={cancelling} disabled={modifying || cancelling || confirming} onPress={onCancel} style={styles.actionButton} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function OtpCells(props: { theme: ReturnType<typeof useThemeColors>["colors"]; styles: ReturnType<typeof makeStyles>; values: string[]; disabled: boolean; onChange: (index: number, value: string) => void }) {
  const { theme, styles, values, disabled, onChange } = props;
  const inputRefs = useRef<(TextInput | null)[]>([]);
  return <View style={styles.otpCells} accessibilityLabel="Code OTP à six chiffres">
    {values.map((value, index) => <TextInput
      key={index}
      ref={(ref) => { inputRefs.current[index] = ref; }}
      value={value}
      editable={!disabled}
      selectTextOnFocus
      maxLength={1}
      keyboardType="number-pad"
      inputMode="numeric"
      textContentType="oneTimeCode"
      autoComplete="one-time-code"
      onChangeText={(raw) => {
        const digits = raw.replace(/[^0-9]/g, "").slice(0, values.length - index);
        if (!digits) { onChange(index, ""); return; }
        digits.split("").forEach((digit, offset) => onChange(index + offset, digit));
        inputRefs.current[Math.min(values.length - 1, index + digits.length)]?.focus();
      }}
      onKeyPress={({ nativeEvent }) => {
        if (nativeEvent.key === "Backspace" && !value && index > 0) inputRefs.current[index - 1]?.focus();
      }}
      style={[styles.otpCell, { color: theme.foreground, backgroundColor: theme.background, borderColor: value ? theme.primary : theme.border }]}
      selectionColor={theme.primary}
      accessibilityLabel={`Chiffre OTP ${index + 1} sur 6`}
    />)}
  </View>;
}

function OperatorCard(props: { theme: ReturnType<typeof useThemeColors>["colors"]; styles: ReturnType<typeof makeStyles>; operator: MobileMoneyOperator; active: boolean; disabled?: boolean; onPress: () => void }) {
  const { theme, styles, operator, active, disabled = false, onPress } = props;
  const color = operator.color;
  const logo = MOBILE_MONEY_LOGOS[operator.id];
  const hue = useDarkTone();
  return (
    <Pressable disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.operatorCard, { backgroundColor: active ? hue("#FFF0D8", "surface") : theme.surface, borderColor: active ? theme.primary : theme.border }, disabled && { opacity: 0.55 }, pressed && styles.pressed]} accessibilityRole="radio" accessibilityState={{ selected: active, disabled }}>
      {logo
        ? <Image source={logo} style={styles.operatorLogo} resizeMode="cover" accessibilityIgnoresInvertColors />
        : <View style={[styles.operatorLogo, { backgroundColor: color }]}>
          <Text style={styles.operatorLogoText}>{operator.short}</Text>
        </View>}
      <View style={{ flex: 1 }}>
        <Text style={[styles.operatorName, { color: theme.foreground }]}>{operator.label}</Text>
      </View>
      {active ? <MaterialIcons name="check-circle" size={16} color={theme.primary} /> : null}
    </Pressable>
  );
}

// =====================================================================
// Résultats
// =====================================================================


// =====================================================================

function SuccessStage(props: { theme: ReturnType<typeof useThemeColors>["colors"]; styles: ReturnType<typeof makeStyles>; deposit: DirectDepositView; onClose: () => void }) {
  const { theme, styles, deposit, onClose } = props;
  return (
    <View style={[styles.centerStage, { backgroundColor: theme.surface }]}>
      <View style={[styles.bigCheck, { backgroundColor: theme.success }]}>
        <MaterialIcons name="check" size={48} color="#FFFFFF" />
      </View>
      <Text style={[styles.centerTitle, { color: theme.foreground }]}>Paiement effectué</Text>
      <Text style={[styles.centerSubtitle, { color: theme.muted }]}>Votre Wallet Tikisse a été crédité. Vous pouvez maintenant utiliser ce solde pour vos livraisons.</Text>
      <View style={[styles.recap, { backgroundColor: theme.background }]}>
        <RecapRow theme={theme} styles={styles} label="Opérateur" value={operatorLabel(deposit.operator)} />
        <RecapRow theme={theme} styles={styles} label="Numéro" value={deposit.phone} />
        <RecapRow theme={theme} styles={styles} label="Montant" value={`${deposit.amount.toLocaleString("fr-FR")} FCFA`} />
        <RecapRow theme={theme} styles={styles} label="Référence" value={deposit.providerReference} />
      </View>
      <TikisseButton label="Terminer" icon="check" onPress={onClose} style={styles.cta} />
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
        <TikisseButton label="Modifier" variant="secondary" onPress={onRetry} style={{ flex: 1 }} />
        <TikisseButton label="Fermer" onPress={onClose} style={{ flex: 1 }} />
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
    stepLabel: { fontSize: 10.5, fontWeight: "600", letterSpacing: 0.6, textTransform: "uppercase" },
    amountRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    amountInput: { flex: 1, fontSize: 22, fontWeight: "700", paddingHorizontal: 14, height: 46, borderRadius: 9, borderWidth: StyleSheet.hairlineWidth },
    amountSuffix: { fontSize: 13, fontWeight: "600" },
    amountHint: { fontSize: 12, marginTop: 6 },
    lockedInput: { opacity: 0.65 },
    quickAmounts: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    quickAmount: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
    quickAmountText: { fontSize: 12, fontWeight: "600" },
    operatorRow: { flexDirection: "row", gap: 10 },
    operatorCard: { flex: 1, minWidth: 140, flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 10, borderWidth: 2 },
    operatorLogo: { width: 36, height: 36, borderRadius: 8, overflow: "hidden", alignItems: "center", justifyContent: "center" },
    operatorLogoText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
    operatorName: { fontSize: 13, fontWeight: "600" },
    phoneRow: { flexDirection: "row", alignItems: "stretch", gap: 8 },
    dialCodeStatic: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, height: 46, borderRadius: 9, borderWidth: StyleSheet.hairlineWidth },
    flag: { fontSize: 18 },
    dialCodeText: { fontSize: 14, fontWeight: "700" },
    phoneInput: { flex: 1, paddingHorizontal: 14, height: 46, borderRadius: 9, borderWidth: StyleSheet.hairlineWidth, fontSize: 16 },
    errorText: { padding: 12, borderRadius: 9, fontSize: 13, lineHeight: 18 },
    cta: { marginTop: 8, minHeight: 50 },
    refreshButton: { width: "100%", minHeight: 44 },
    confirmationActions: { flexDirection: "row", gap: 8, width: "100%", marginTop: 2 },
    actionButton: { flex: 1, minHeight: 40 },
    keyboardBody: { padding: 16, paddingBottom: 120, gap: 14 },
    paymentCard: { width: "100%", padding: 14, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, gap: 4 },
    paymentStatusRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
    statusIndicator: { width: 8, height: 8, borderRadius: 4 },
    paymentStatus: { fontSize: 13, fontWeight: "600" },
    otpCard: { width: "100%", padding: 14, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, gap: 10 },
    otpHint: { fontSize: 12, lineHeight: 18 },
    ussdButton: { width: "100%", minHeight: 46 },
    otpCells: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
    otpCell: { flex: 1, minWidth: 42, height: 52, borderRadius: 9, borderWidth: 1.5, textAlign: "center", fontSize: 22, fontWeight: "700" },

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
