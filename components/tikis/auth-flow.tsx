import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { TikisButton } from "@/components/tikis/ui";
import { haptic } from "@/lib/haptics";
import {
  isValidPhone,
  maskPhone,
  normalizePhone,
  OTP_MAX_ATTEMPTS,
  verifySimulationOtp,
} from "@/lib/otp-simulator";
import { SIMULATION_OTP } from "@/shared/tikis-domain";

type Stage = "phone" | "otp";

const COUNTRY_CODE = "+226";
const RESEND_SECONDS = 20;

export function AuthFlow() {
  const [stage, setStage] = useState<Stage>("phone");
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [sending, setSending] = useState(false);
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [otpError, setOtpError] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(RESEND_SECONDS);
  const inputs = useRef<(TextInput | null)[]>([]);

  const phone = normalizePhone(COUNTRY_CODE, phoneInput);
  const otp = digits.join("");

  useEffect(() => {
    if (stage !== "otp" || secondsLeft === 0) return;
    const timer = setInterval(() => setSecondsLeft((current) => Math.max(0, current - 1)), 1000);
    return () => clearInterval(timer);
  }, [secondsLeft, stage]);

  useEffect(() => {
    if (stage !== "otp" || otp.length !== 6 || verifying || attempts >= OTP_MAX_ATTEMPTS) return;
    void submitOtp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otp]);

  async function requestOtp() {
    if (!isValidPhone(COUNTRY_CODE, phoneInput)) {
      setPhoneError("Saisissez un numéro de téléphone valide.");
      haptic.error();
      return;
    }

    setPhoneError("");
    setSending(true);
    await new Promise((resolve) => setTimeout(resolve, 550));
    setSending(false);
    setStage("otp");
    setSecondsLeft(RESEND_SECONDS);
    setTimeout(() => inputs.current[0]?.focus(), 120);
  }

  function updateDigit(index: number, rawValue: string) {
    const cleanValue = rawValue.replace(/\D/g, "");
    const next = [...digits];
    const toApply = cleanValue.slice(0, 6 - index).split("");

    if (toApply.length > 1) {
      toApply.forEach((digit, offset) => {
        next[index + offset] = digit;
      });
      setDigits(next);
      const nextFocus = Math.min(index + toApply.length, 5);
      inputs.current[nextFocus]?.focus();
      return;
    }

    next[index] = cleanValue;
    setDigits(next);
    setOtpError("");
    if (cleanValue && index < 5) inputs.current[index + 1]?.focus();
  }

  function handleKeyPress(index: number, key: string) {
    if (key === "Backspace" && !digits[index] && index > 0) {
      inputs.current[index - 1]?.focus();
    }
  }

  async function submitOtp() {
    if (otp.length !== 6 || verifying) return;
    Keyboard.dismiss();
    setVerifying(true);
    await new Promise((resolve) => setTimeout(resolve, 650));

    if (verifySimulationOtp(otp)) {
      haptic.success();
      router.replace("/(tabs)");
      return;
    }

    const nextAttempts = attempts + 1;
    setAttempts(nextAttempts);
    setVerifying(false);
    setDigits(["", "", "", "", "", ""]);
    setOtpError(
      nextAttempts >= OTP_MAX_ATTEMPTS
        ? "Nombre maximal de tentatives atteint. Demandez un nouveau code."
        : `Code incorrect. Il reste ${OTP_MAX_ATTEMPTS - nextAttempts} tentative${OTP_MAX_ATTEMPTS - nextAttempts > 1 ? "s" : ""}.`,
    );
    haptic.error();
    setTimeout(() => inputs.current[0]?.focus(), 80);
  }

  function resendOtp() {
    if (secondsLeft > 0) return;
    setDigits(["", "", "", "", "", ""]);
    setOtpError("");
    setAttempts(0);
    setSecondsLeft(RESEND_SECONDS);
    haptic.success();
    setTimeout(() => inputs.current[0]?.focus(), 80);
  }

  if (stage === "phone") {
    return (
      <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
        <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.phoneScreen}>
            <View style={styles.brandBlock}>
              <Image source={require("@/assets/images/icon.png")} style={styles.logo} accessibilityLabel="Logo Tikis" />
              <Text style={styles.brand}>tIKIS</Text>
              <Text style={styles.tagline}>La livraison, en toute confiance.</Text>
            </View>

            <View style={styles.formBlock}>
              <Text style={styles.title}>Votre numéro, votre accès.</Text>
              <Text style={styles.subtitle}>
                Nous utilisons votre numéro pour sécuriser votre compte et faciliter la mise en relation.
              </Text>

              <Text style={styles.fieldLabel}>Numéro de téléphone</Text>
              <View style={[styles.phoneField, phoneError ? styles.fieldError : null]}>
                <View style={styles.countryCode}>
                  <Text style={styles.countryFlag}>BF</Text>
                  <Text style={styles.countryText}>{COUNTRY_CODE}</Text>
                </View>
                <TextInput
                  accessibilityLabel="Numéro de téléphone"
                  autoFocus
                  keyboardType="phone-pad"
                  maxLength={12}
                  placeholder="70 00 00 00"
                  placeholderTextColor="#9AA5B6"
                  value={phoneInput}
                  onChangeText={(value) => {
                    setPhoneInput(value.replace(/\D/g, "").slice(0, 10));
                    setPhoneError("");
                  }}
                  style={styles.phoneInput}
                  returnKeyType="done"
                  onSubmitEditing={() => void requestOtp()}
                />
              </View>
              {phoneError ? <Text style={styles.errorText}>{phoneError}</Text> : null}

              <TikisButton label="Recevoir mon code" icon="sms" onPress={() => void requestOtp()} loading={sending} style={styles.primaryButton} />

              <Text style={styles.legal}>
                En continuant, vous acceptez nos <Text style={styles.legalLink}>conditions d’utilisation</Text> et notre{" "}
                <Text style={styles.legalLink}>politique de confidentialité</Text>.
              </Text>
            </View>

            <View style={styles.securityLine}>
              <MaterialIcons name="verified-user" size={17} color="#007B8B" />
              <Text style={styles.securityText}>Un accès simple, sans mot de passe.</Text>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.otpScreen}>
          <Pressable accessibilityRole="button" accessibilityLabel="Modifier le numéro" onPress={() => setStage("phone")} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
            <MaterialIcons name="arrow-back" size={22} color="#0B1F3A" />
          </Pressable>

          <View style={styles.otpHero}>
            <View style={styles.smsBadge}>
              <MaterialIcons name="mark-unread-chat-alt" size={30} color="#007B8B" />
            </View>
            <Text style={styles.title}>Vérifiez votre numéro</Text>
            <Text style={[styles.subtitle, styles.centered]}>
              Saisissez le code à 6 chiffres envoyé au{`\n`}<Text style={styles.phoneHighlight}>{maskPhone(phone)}</Text>
            </Text>
          </View>

          <View style={styles.simulationNotice}>
            <View style={styles.simulationIcon}><MaterialIcons name="science" size={18} color="#006572" /></View>
            <View style={styles.simulationTextWrap}>
              <Text style={styles.simulationLabel}>MODE SIMULATION</Text>
              <Text style={styles.simulationText}>Utilisez le code <Text style={styles.simulationCode}>{SIMULATION_OTP}</Text> pour poursuivre.</Text>
            </View>
          </View>

          <View style={styles.otpRow}>
            {digits.map((digit, index) => (
              <TextInput
                key={index}
                ref={(node) => { inputs.current[index] = node; }}
                accessibilityLabel={`Chiffre ${index + 1} du code`}
                value={digit}
                maxLength={index === 0 ? 6 : 1}
                keyboardType="number-pad"
                onChangeText={(value) => updateDigit(index, value)}
                onKeyPress={({ nativeEvent }) => handleKeyPress(index, nativeEvent.key)}
                style={[styles.otpBox, digit ? styles.otpBoxFilled : null, otpError ? styles.otpBoxError : null]}
                textContentType="oneTimeCode"
                autoComplete={index === 0 ? "one-time-code" : "off"}
                selectTextOnFocus
              />
            ))}
          </View>

          <View style={styles.otpFeedback}>
            {verifying ? <ActivityIndicator color="#007B8B" /> : otpError ? <Text style={styles.errorText}>{otpError}</Text> : <Text style={styles.hintText}>La vérification démarre automatiquement après le 6e chiffre.</Text>}
          </View>

          <View style={styles.resendBlock}>
            <Text style={styles.resendQuestion}>Vous n’avez pas reçu de code ?</Text>
            <Pressable disabled={secondsLeft > 0} onPress={resendOtp} style={({ pressed }) => [styles.resendButton, (pressed || secondsLeft > 0) && styles.pressed]}>
              <Text style={[styles.resendText, secondsLeft > 0 && styles.resendDisabled]}>
                {secondsLeft > 0 ? `Renvoyer dans ${secondsLeft} s` : "Renvoyer un code"}
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#F6F8FC" },
  keyboard: { flex: 1 },
  phoneScreen: { flex: 1, paddingHorizontal: 24, justifyContent: "space-between", paddingVertical: 24 },
  brandBlock: { alignItems: "center", paddingTop: 12 },
  logo: { width: 74, height: 74, borderRadius: 20, marginBottom: 13 },
  brand: { color: "#0B1F3A", fontSize: 28, fontWeight: "900", letterSpacing: 1.1 },
  tagline: { color: "#697386", fontSize: 14, marginTop: 5 },
  formBlock: { marginTop: 12 },
  title: { color: "#0B1F3A", fontSize: 29, lineHeight: 36, fontWeight: "900", letterSpacing: -0.55 },
  subtitle: { color: "#697386", fontSize: 15, lineHeight: 22, marginTop: 10 },
  centered: { textAlign: "center" },
  fieldLabel: { color: "#354052", fontSize: 13, fontWeight: "800", marginTop: 27, marginBottom: 9 },
  phoneField: { height: 58, borderWidth: 1.5, borderColor: "#D9E0EA", borderRadius: 16, backgroundColor: "#FFFFFF", flexDirection: "row", alignItems: "center" },
  fieldError: { borderColor: "#C23B45" },
  countryCode: { height: 36, borderRightWidth: 1, borderRightColor: "#E7ECF2", paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 7 },
  countryFlag: { color: "#007B8B", fontSize: 11, fontWeight: "900", paddingHorizontal: 5, paddingVertical: 3, borderRadius: 5, backgroundColor: "#E5F6F7" },
  countryText: { color: "#0B1F3A", fontSize: 15, fontWeight: "800" },
  phoneInput: { flex: 1, height: "100%", color: "#0B1F3A", fontSize: 17, fontWeight: "700", paddingHorizontal: 13 },
  errorText: { color: "#C23B45", textAlign: "center", fontSize: 13, lineHeight: 18, fontWeight: "700" },
  primaryButton: { marginTop: 21 },
  legal: { color: "#778398", fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 20, paddingHorizontal: 8 },
  legalLink: { color: "#007B8B", fontWeight: "800" },
  securityLine: { alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 7, paddingBottom: 5 },
  securityText: { color: "#697386", fontSize: 13, fontWeight: "700" },
  otpScreen: { flex: 1, paddingHorizontal: 24, paddingVertical: 18 },
  backButton: { width: 42, height: 42, justifyContent: "center", alignItems: "center", borderRadius: 21, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E7ECF2" },
  otpHero: { alignItems: "center", marginTop: 34 },
  smsBadge: { width: 70, height: 70, borderRadius: 24, backgroundColor: "#E5F6F7", alignItems: "center", justifyContent: "center", marginBottom: 21 },
  phoneHighlight: { color: "#0B1F3A", fontWeight: "800" },
  simulationNotice: { backgroundColor: "#E5F6F7", borderRadius: 16, padding: 14, marginTop: 34, flexDirection: "row", gap: 11, alignItems: "center", borderWidth: 1, borderColor: "#CDE4E7" },
  simulationIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  simulationTextWrap: { flex: 1 },
  simulationLabel: { color: "#006572", fontSize: 10, fontWeight: "900", letterSpacing: 0.9 },
  simulationText: { color: "#2C5D64", fontSize: 13, lineHeight: 19, marginTop: 2 },
  simulationCode: { color: "#006572", fontWeight: "900", letterSpacing: 1 },
  otpRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 32, gap: 8 },
  otpBox: { flex: 1, height: 54, backgroundColor: "#FFFFFF", borderRadius: 14, borderWidth: 1.5, borderColor: "#D9E0EA", textAlign: "center", color: "#0B1F3A", fontSize: 22, fontWeight: "900" },
  otpBoxFilled: { borderColor: "#007B8B", backgroundColor: "#F4FBFC" },
  otpBoxError: { borderColor: "#C23B45" },
  otpFeedback: { minHeight: 52, paddingTop: 14, alignItems: "center", justifyContent: "flex-start" },
  hintText: { color: "#778398", fontSize: 12, textAlign: "center", lineHeight: 18 },
  resendBlock: { alignItems: "center", marginTop: 22 },
  resendQuestion: { color: "#697386", fontSize: 14 },
  resendButton: { paddingHorizontal: 12, paddingVertical: 11, marginTop: 2 },
  resendText: { color: "#007B8B", fontSize: 14, fontWeight: "900" },
  resendDisabled: { color: "#9AA5B6" },
  pressed: { opacity: 0.65 },
});
