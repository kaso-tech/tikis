import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as Linking from "expo-linking";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { TikisButton } from "@/components/tikis/ui";
import { COUNTRIES, countryFlagEmoji, type CountrySpec } from "@/lib/registration-rules";
import { formatMoney } from "@/shared/tikis-domain";
import { trpc } from "@/lib/trpc";
import { useThemeColors } from "@/lib/use-theme-colors";

/**
 * Paiement Mobile Money direct (in-app) : Orange Money / Moov Money via YengaPay Direct API.
 *
 * Flow :
 *  1. L'utilisateur saisit le montant + opérateur + numéro (sélecteur de pays comme à l'auth).
 *  2. Soumission -> mutation tRPC wallet.requestDirectDeposit
 *  3. Le serveur crée un payment intent YengaPay + un code USSD
 *  4. Le client compose le code via Linking.openURL("tel:*144*4*6*<montant>#")
 *     qui ouvre l'app téléphone pré-rempli avec le code USSD.
 *  5. L'utilisateur saisit son code secret OM/MM sur son téléphone -> USSD envoyé.
 *  6. SMS OTP envoyé au numéro -> l'utilisateur le saisit dans les 6 cellules.
 *  7. Polling toutes les 3s : wallet.checkDirectDepositStatus
 *  8. Webhook YengaPay -> serveur crédite le Wallet.
 *  9. Client reçoit status='succeeded' -> écran de succès.
 *
 * En mode test, l'utilisateur final peut forcer le succès/échec via les boutons
 * __DEV__ dans le footer de l'écran pending (wallet.settleDirectDepositTest).
 */

type Operator = "orange_money" | "moov_money";
type Stage = "form" | "pending" | "success" | "failed";

const QUICK_AMOUNTS = [1_000, 2_500, 5_000, 10_000, 25_000];
const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 5 * 60_000;

type DirectDepositView = {
  transactionId: string;
  providerReference: string;
  ussdCode: string;
  amount: number;
  phone: string;
  operator: Operator;
  expiresAt: string;
  status: "pending" | "succeeded" | "failed" | "cancelled" | "expired";
  mode: "test" | "sandbox" | "live";
};

function formatUSSDForDisplay(ussd: string): string {
  return ussd.replace(/\*/g, "*");
}

function buildOtpLabel(operator: Operator): string {
  return operator === "orange_money" ? "Orange Money" : "Moov Money";
}

export function WalletDirectDepositScreen({ visible, onClose, onSuccess }: { visible: boolean; onClose: () => void; onSuccess?: () => void }) {
  const { colors: theme } = useThemeColors();
  const styles = makeStyles(theme);

  // ===== ÉTAT FORM =====
  const [countryIndex, setCountryIndex] = useState(0);
  const country: CountrySpec = COUNTRIES[countryIndex];
  const [amount, setAmount] = useState<string>("2500");
  const [phoneLocal, setPhoneLocal] = useState<string>("");
  const [operator, setOperator] = useState<Operator>("orange_money");
  const [otpDigits, setOtpDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [stage, setStage] = useState<Stage>("form");
  const [submitError, setSubmitError] = useState<string>("");
  const [pollError, setPollError] = useState<string>("");
  const [secondsLeft, setSecondsLeft] = useState<number>(POLL_TIMEOUT_MS / 1000);
  const [deposit, setDeposit] = useState<DirectDepositView | null>(null);

  const requestMutation = trpc.wallet.requestDirectDeposit.useMutation();
  const statusQuery = trpc.wallet.checkDirectDepositStatus.useQuery(
    { transactionId: deposit?.transactionId ?? "" },
    { enabled: Boolean(deposit?.transactionId) && stage === "pending", refetchInterval: POLL_INTERVAL_MS },
  );
  const settleTestMutation = trpc.wallet.settleDirectDepositTest.useMutation();

  // ===== Soumission =====
  const onSubmit = useCallback(async () => {
    setSubmitError("");
    const amountNum = parseInt(amount, 10);
    if (!Number.isFinite(amountNum) || amountNum < 100 || amountNum > 10_000_000) {
      setSubmitError("Le montant doit être compris entre 100 FCFA et 10 000 000 FCFA.");
      return;
    }
    if (phoneLocal.length !== country.digits) {
      setSubmitError(`Le numéro doit contenir ${country.digits} chiffres pour ${country.name}.`);
      return;
    }
    try {
      const result = await requestMutation.mutateAsync({ amount: amountNum, countryCode: country.id, phoneLocal, operator });
      setDeposit(result);
      setStage("pending");
      setSecondsLeft(Math.max(0, Math.round((new Date(result.expiresAt).getTime() - Date.now()) / 1000)));
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : "La demande de paiement n'a pas pu être créée.");
    }
  }, [amount, phoneLocal, country, operator, requestMutation]);

  // ===== Polling =====
  useEffect(() => {
    if (stage !== "pending" || !deposit) return;
    const data = statusQuery.data;
    if (!data) return;
    if (data.status === "succeeded") { setStage("success"); onSuccess?.(); }
    else if (data.status === "failed" || data.status === "cancelled") setStage("failed");
    else if (data.status === "expired") setStage("failed");
  }, [statusQuery.data, stage, deposit, onSuccess]);

  useEffect(() => {
    if (stage !== "pending") return;
    const id = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [stage]);

  useEffect(() => {
    if (stage !== "pending") return;
    if (secondsLeft <= 0) { setStage("failed"); setPollError("La demande a expiré avant confirmation."); }
  }, [secondsLeft, stage]);

  useEffect(() => {
    if (!visible) {
      // reset quand on ferme
      setStage("form");
      setAmount("2500");
      setPhoneLocal("");
      setOtpDigits(["", "", "", "", "", ""]);
      setSubmitError("");
      setPollError("");
      setDeposit(null);
      setOperator("orange_money");
      setCountryIndex(0);
    }
  }, [visible]);

  // ===== Téléphone : USSD =====
  const onCallUSSD = useCallback(async () => {
    if (!deposit) return;
    const telUri = `tel:${encodeURIComponent(deposit.ussdCode)}`;
    try {
      const supported = await Linking.canOpenURL(telUri).catch(() => true);
      if (!supported) {
        Alert.alert("App téléphone indisponible", "Impossible d'ouvrir l'application téléphone sur cet appareil.");
        return;
      }
      await Linking.openURL(telUri);
    } catch (cause) {
      Alert.alert("Erreur", cause instanceof Error ? cause.message : "Impossible d'ouvrir l'application téléphone.");
    }
  }, [deposit]);

  // ===== OTP cells =====
  const onOtpChange = useCallback((index: number, value: string) => {
    setOtpDigits((prev) => {
      const next = [...prev];
      next[index] = value.slice(-1);
      return next;
    });
  }, []);

  const onOtpKeyDown = useCallback((index: number, key: string) => {
    if (key === "Backspace" && index > 0) setOtpDigits((prev) => {
      const next = [...prev];
      next[index - 1] = "";
      return next;
    });
  }, []);

  const onOtpSubmit = useCallback(() => {
    const code = otpDigits.join("");
    if (code.length !== 6) {
      Alert.alert("Code incomplet", "Saisissez les 6 chiffres de l'OTP.");
      return;
    }
    // L'OTP est saisi côté téléphone (USSD), pas dans l'app. Ce code n'est utile que pour
    // confirmer visuellement à l'utilisateur qu'il a bien reçu et noté le code. La confirmation
    // réelle passe par le webhook YengaPay + le polling status.
    Alert.alert("Code noté", "Si l'OTP est correct, votre paiement sera confirmé automatiquement dans quelques secondes.");
  }, [otpDigits]);

  // ===== Test helpers (DEV) =====
  const onDevSettle = useCallback(async (outcome: "succeeded" | "failed") => {
    if (!deposit) return;
    try {
      await settleTestMutation.mutateAsync({ transactionId: deposit.transactionId, outcome });
      // Le polling va ramasser le nouveau statut automatiquement.
    } catch (cause) {
      setPollError(cause instanceof Error ? cause.message : "Action impossible.");
    }
  }, [deposit, settleTestMutation]);

  const onChangeCountry = useCallback(() => {
    setCountryIndex((idx) => (idx + 1) % COUNTRIES.length);
    setPhoneLocal("");
  }, []);

  // ===== Render =====
  if (!visible) return null;
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={["top", "bottom"]}>
        <View style={[styles.header, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Fermer" onPress={onClose} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
            <MaterialIcons name="close" size={20} color={theme.foreground} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={[styles.headerTitle, { color: theme.foreground }]}>
              {stage === "form" ? "Dépôt Mobile Money" : stage === "pending" ? `Confirmation ${buildOtpLabel(operator)}` : stage === "success" ? "Dépôt réussi" : "Paiement échoué"}
            </Text>
          </View>
        </View>

        {stage === "form" ? (
          <FormStage
            theme={theme}
            styles={styles}
            country={country}
            amount={amount}
            phoneLocal={phoneLocal}
            operator={operator}
            submitError={submitError}
            submitting={requestMutation.isPending}
            onChangeCountry={onChangeCountry}
            onChangeAmount={setAmount}
            onChangePhone={setPhoneLocal}
            onChangeOperator={setOperator}
            onSubmit={onSubmit}
          />
        ) : null}

        {stage === "pending" && deposit ? (
          <PendingStage
            theme={theme}
            styles={styles}
            deposit={deposit}
            otpDigits={otpDigits}
            secondsLeft={secondsLeft}
            pollError={pollError}
            isTest={deposit.mode === "test"}
            settling={settleTestMutation.isPending}
            onOtpChange={onOtpChange}
            onOtpKeyDown={onOtpKeyDown}
            onOtpSubmit={onOtpSubmit}
            onCallUSSD={onCallUSSD}
            onCancel={() => setStage("failed")}
            onDevSettle={onDevSettle}
          />
        ) : null}

        {stage === "success" && deposit ? (
          <SuccessStage theme={theme} styles={styles} deposit={deposit} onClose={onClose} />
        ) : null}

        {stage === "failed" ? (
          <FailedStage theme={theme} styles={styles} message={pollError || "Le paiement n'a pas pu être confirmé."} onRetry={() => setStage("form")} onClose={onClose} />
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

// =====================================================================
// Stages
// =====================================================================

function FormStage(props: {
  theme: ReturnType<typeof useThemeColors>["colors"];
  styles: ReturnType<typeof makeStyles>;
  country: CountrySpec;
  amount: string;
  phoneLocal: string;
  operator: Operator;
  submitError: string;
  submitting: boolean;
  onChangeCountry: () => void;
  onChangeAmount: (value: string) => void;
  onChangePhone: (value: string) => void;
  onChangeOperator: (op: Operator) => void;
  onSubmit: () => void;
}) {
  const { theme, styles, country, amount, phoneLocal, operator, submitError, submitting, onChangeCountry, onChangeAmount, onChangePhone, onChangeOperator, onSubmit } = props;
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.label, { color: theme.muted }]}>PAYS</Text>
          <Pressable onPress={onChangeCountry} style={({ pressed }) => [styles.countryPicker, { backgroundColor: theme.background, borderColor: theme.border }, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel="Changer de pays">
            <Text style={styles.flag}>{countryFlagEmoji(country.id)}</Text>
            <Text style={[styles.countryCode, { color: theme.foreground }]}>{country.dialCode}</Text>
            <Text style={[styles.countryName, { color: theme.muted }]}>{country.name}</Text>
            <MaterialIcons name="unfold-more" size={18} color={theme.muted} />
          </Pressable>
        </View>

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
              <Text style={[styles.dialCodeText, { color: theme.foreground }]}>{country.dialCode}</Text>
            </View>
            <TextInput
              value={phoneLocal}
              onChangeText={onChangePhone}
              keyboardType="number-pad"
              maxLength={country.digits}
              placeholder={"0".repeat(country.digits)}
              placeholderTextColor={theme.muted}
              style={[styles.phoneInput, { color: theme.foreground, backgroundColor: theme.background, borderColor: theme.border }]}
            />
          </View>
          <Text style={[styles.hint, { color: theme.muted }]}>{country.name} · {country.digits} chiffres attendus</Text>
        </View>

        {submitError ? <Text style={[styles.errorText, { color: theme.error, backgroundColor: "#F8E8E9" }]}>{submitError}</Text> : null}

        <TikisButton label={submitting ? "Création du paiement…" : `Payer ${formatMoney(parseInt(amount, 10) || 0)}`} icon="send" onPress={onSubmit} loading={submitting} style={styles.cta} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function OperatorCard(props: { theme: ReturnType<typeof useThemeColors>["colors"]; styles: ReturnType<typeof makeStyles>; operator: Operator; active: boolean; onPress: () => void }) {
  const { theme, styles, operator, active, onPress } = props;
  const isOM = operator === "orange_money";
  const color = isOM ? "#FF7900" : "#0033A0";
  const label = isOM ? "Orange Money" : "Moov Money";
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.operatorCard, { backgroundColor: active ? "#F7EFE5" : theme.surface, borderColor: active ? theme.primary : theme.border }, pressed && styles.pressed]} accessibilityRole="radio" accessibilityState={{ selected: active }}>
      <View style={[styles.operatorLogo, { backgroundColor: color }]}>
        <Text style={styles.operatorLogoText}>{isOM ? "OM" : "MV"}</Text>
      </View>
      <Text style={[styles.operatorName, { color: theme.foreground }]}>{label}</Text>
      <Text style={[styles.operatorFees, { color: theme.muted }]}>{isOM ? "Frais 1,5%" : "Frais 2%"}</Text>
    </Pressable>
  );
}

function PendingStage(props: {
  theme: ReturnType<typeof useThemeColors>["colors"];
  styles: ReturnType<typeof makeStyles>;
  deposit: DirectDepositView;
  otpDigits: string[];
  secondsLeft: number;
  pollError: string;
  isTest: boolean;
  settling: boolean;
  onOtpChange: (index: number, value: string) => void;
  onOtpKeyDown: (index: number, key: string) => void;
  onOtpSubmit: () => void;
  onCallUSSD: () => void;
  onCancel: () => void;
  onDevSettle: (outcome: "succeeded" | "failed") => void;
}) {
  const { theme, styles, deposit, otpDigits, secondsLeft, pollError, isTest, settling, onOtpChange, onOtpKeyDown, onOtpSubmit, onCallUSSD, onCancel, onDevSettle } = props;
  return (
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <View style={styles.ussdPulse}>
        <View style={[styles.ussdPulseCircle, { backgroundColor: "#DDEFE7" }]}>
          <MaterialIcons name="phone-in-talk" size={36} color="#176C52" />
        </View>
      </View>

      <Text style={[styles.pendingTitle, { color: theme.foreground }]}>Confirmez sur votre téléphone</Text>
      <Text style={[styles.pendingSubtitle, { color: theme.muted }]}>Composez le code ci-dessous sur votre numéro {buildOtpLabel(deposit.operator)}. Vous recevrez un OTP par SMS à saisir sur votre téléphone.</Text>

      <View style={[styles.ussdCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text style={[styles.label, { color: theme.muted, marginBottom: 10 }]}>CODE USSD À COMPOSER</Text>
        <Text style={[styles.ussdCode, { color: theme.foreground }]}>{formatUSSDForDisplay(deposit.ussdCode)}</Text>
        <TikisButton label="Appeler maintenant" icon="phone" onPress={onCallUSSD} style={{ marginTop: 14 }} />
        <Text style={[styles.ussdHint, { color: theme.muted }]}>L'application téléphone s'ouvre avec le code pré-rempli. Validez avec votre code secret {buildOtpLabel(deposit.operator)}.</Text>
      </View>

      <Text style={[styles.label, { color: theme.muted, marginTop: 22, marginBottom: 10 }]}>CODE OTP REÇU PAR SMS (optionnel)</Text>
      <View style={styles.otpRow}>
        {otpDigits.map((digit, idx) => (
          <TextInput
            key={idx}
            value={digit}
            onChangeText={(v) => onOtpChange(idx, v)}
            onKeyPress={({ nativeEvent }) => onOtpKeyDown(idx, nativeEvent.key)}
            keyboardType="number-pad"
            maxLength={1}
            style={[styles.otpCell, { color: theme.foreground, backgroundColor: theme.surface, borderColor: theme.border }]}
            accessibilityLabel={`Chiffre ${idx + 1} du code OTP`}
            returnKeyType={idx === 5 ? "done" : "next"}
            onSubmitEditing={idx === 5 ? onOtpSubmit : undefined}
          />
        ))}
      </View>
      <Text style={[styles.hint, { color: theme.muted, marginTop: 6 }]}>Saisissez les 6 chiffres reçus par SMS (confirmation visuelle uniquement — la confirmation réelle passe par YengaPay).</Text>

      <Text style={[styles.timer, { color: theme.muted }]}>
        Expire dans <Text style={{ color: theme.foreground, fontWeight: "700" }}>{Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}</Text>
      </Text>

      {pollError ? <Text style={[styles.errorText, { color: theme.error, backgroundColor: "#F8E8E9" }]}>{pollError}</Text> : null}

      {isTest ? (
        <View style={[styles.devCard, { backgroundColor: "#F7EFE5", borderColor: theme.primary }]}>
          <Text style={[styles.devLabel, { color: theme.primary }]}>MODE TEST (DEV uniquement)</Text>
          <View style={styles.devActions}>
            <TikisButton label="Forcer succès" icon="check-circle" onPress={() => onDevSettle("succeeded")} loading={settling} style={styles.devBtn} />
            <TikisButton label="Forcer échec" icon="cancel" variant="secondary" onPress={() => onDevSettle("failed")} loading={settling} style={styles.devBtn} />
          </View>
        </View>
      ) : null}

      <Pressable onPress={onCancel} style={({ pressed }) => [styles.cancelBtn, pressed && styles.pressed]}>
        <Text style={[styles.cancelText, { color: theme.muted }]}>Annuler</Text>
      </Pressable>
    </ScrollView>
  );
}

function SuccessStage(props: { theme: ReturnType<typeof useThemeColors>["colors"]; styles: ReturnType<typeof makeStyles>; deposit: DirectDepositView; onClose: () => void }) {
  const { theme, styles, deposit, onClose } = props;
  return (
    <View style={[styles.centerStage, { backgroundColor: theme.surface }]}>
      <View style={[styles.bigCheck, { backgroundColor: theme.success }]}>
        <MaterialIcons name="check" size={48} color="#FFFFFF" />
      </View>
      <Text style={[styles.centerTitle, { color: theme.foreground }]}>Dépôt réussi</Text>
      <Text style={[styles.centerSubtitle, { color: theme.muted }]}>Votre Wallet Tikis a été crédité. Vous pouvez maintenant utiliser ce solde pour vos livraisons.</Text>
      <View style={[styles.recap, { backgroundColor: theme.background }]}>
        <RecapRow theme={theme} label="Opérateur" value={buildOtpLabel(deposit.operator)} />
        <RecapRow theme={theme} label="Numéro" value={deposit.phone} />
        <RecapRow theme={theme} label="Montant" value={`${deposit.amount.toLocaleString("fr-FR")} FCFA`} />
        <RecapRow theme={theme} label="Référence" value={deposit.providerReference} />
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

function RecapRow(props: { theme: ReturnType<typeof useThemeColors>["colors"]; label: string; value: string }) {
  return (
    <View style={styles.recapRow}>
      <Text style={[styles.recapLabel, { color: props.theme.muted }]}>{props.label}</Text>
      <Text style={[styles.recapValue, { color: props.theme.foreground }]}>{props.value}</Text>
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
    countryPicker: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 9, borderWidth: StyleSheet.hairlineWidth },
    flag: { fontSize: 22 },
    countryCode: { fontSize: 15, fontWeight: "700" },
    countryName: { fontSize: 12, fontWeight: "500", flex: 1 },
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
    dialCodeStatic: { paddingHorizontal: 14, height: 46, borderRadius: 9, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
    dialCodeText: { fontSize: 14, fontWeight: "700" },
    phoneInput: { flex: 1, paddingHorizontal: 14, height: 46, borderRadius: 9, borderWidth: StyleSheet.hairlineWidth, fontSize: 16 },
    hint: { fontSize: 11, fontWeight: "500" },
    errorText: { padding: 12, borderRadius: 9, fontSize: 13, lineHeight: 18 },
    cta: { marginTop: 8, minHeight: 50 },

    ussdPulse: { alignItems: "center", marginTop: 18, marginBottom: 14 },
    ussdPulseCircle: { width: 96, height: 96, borderRadius: 48, alignItems: "center", justifyContent: "center" },
    pendingTitle: { fontSize: 18, fontWeight: "700", textAlign: "center", marginBottom: 6 },
    pendingSubtitle: { fontSize: 13, textAlign: "center", lineHeight: 19, marginBottom: 18, paddingHorizontal: 12 },
    ussdCard: { padding: 16, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
    ussdCode: { fontSize: 20, fontWeight: "700", textAlign: "center", letterSpacing: 0.4, fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }) },
    ussdHint: { fontSize: 11, textAlign: "center", marginTop: 10, lineHeight: 16 },

    otpRow: { flexDirection: "row", gap: 8, justifyContent: "center" },
    otpCell: { width: 44, height: 50, borderRadius: 9, borderWidth: StyleSheet.hairlineWidth, fontSize: 22, fontWeight: "700", textAlign: "center" },

    timer: { fontSize: 12, textAlign: "center", marginTop: 14 },

    devCard: { padding: 12, borderRadius: 10, borderWidth: 1, gap: 10 },
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
    recapRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6 },
    recapLabel: { fontSize: 12, fontWeight: "500" },
    recapValue: { fontSize: 13, fontWeight: "700" },
    failActions: { flexDirection: "row", gap: 8, width: "100%" },
  });
}
