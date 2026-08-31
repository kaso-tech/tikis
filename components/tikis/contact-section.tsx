import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useEffect, useRef, useState } from "react";
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { TikisButton } from "@/components/tikis/ui";
import { haptic } from "@/lib/haptics";
import { useThemeColors } from "@/lib/use-theme-colors";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";
import { sanitizeFullName } from "@/lib/registration-rules";

type ContactKind = "phone" | "email";

const PHONE_REGEX = /^\+?[0-9 ]{8,20}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEMO_OTP = "123456";
const OTP_LENGTH = 6;

export function ContactSection() {
  const { colors: theme } = useThemeColors();
  const { profile, updateProfile } = useTikisStore();
  const requestOtp = trpc.profiles.requestContactOtp.useMutation();
  const updateContact = trpc.profiles.updateContact.useMutation();
  const [active, setActive] = useState<ContactKind | null>(null);
  const [draft, setDraft] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [stage, setStage] = useState<"draft" | "otp" | "verifying">("draft");
  const [sending, setSending] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (resendIn <= 0) {
      if (timer.current) { clearInterval(timer.current); timer.current = null; }
      return;
    }
    timer.current = setInterval(() => setResendIn((value) => Math.max(0, value - 1)), 1000);
    return () => {
      if (timer.current) { clearInterval(timer.current); timer.current = null; }
    };
  }, [resendIn]);

  function open(kind: ContactKind) {
    setActive(kind);
    setDraft(kind === "phone" ? (profile?.phone ?? "") : (profile?.email ?? ""));
    setOtp("");
    setError("");
    setStage("draft");
    setResendIn(0);
  }

  function close() {
    setActive(null);
    setDraft("");
    setOtp("");
    setError("");
    setStage("draft");
  }

  function isDraftValid(kind: ContactKind, value: string) {
    const trimmed = value.trim();
    if (kind === "phone") return PHONE_REGEX.test(trimmed);
    return EMAIL_REGEX.test(trimmed);
  }

  async function sendOtp() {
    if (!active) return;
    if (!isDraftValid(active, draft)) {
      setError(active === "phone" ? "Numéro de téléphone invalide." : "Adresse e-mail invalide.");
      return;
    }
    setError("");
    setSending(true);
    try {
      await requestOtp.mutateAsync({ kind: active, value: draft.trim() });
      haptic.success();
      setStage("otp");
      setResendIn(45);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "L'envoi du code a échoué.");
      haptic.error();
    } finally {
      setSending(false);
    }
  }

  async function verifyOtp() {
    if (!active) return;
    if (otp.trim().length !== OTP_LENGTH) {
      setError(`Saisissez les ${OTP_LENGTH} chiffres du code reçu.`);
      return;
    }
    if (otp.trim() !== DEMO_OTP) {
      setError("Code invalide. Vérifiez les chiffres reçus par SMS ou e-mail.");
      haptic.error();
      return;
    }
    setStage("verifying");
    setError("");
    try {
      const saved = await updateContact.mutateAsync({ kind: active, value: draft.trim(), otp: otp.trim() });
      updateProfile(saved as any);
      haptic.success();
      Alert.alert(active === "phone" ? "Téléphone mis à jour" : "E-mail mis à jour", active === "phone" ? "Votre numéro a été mis à jour. Les livreurs et expéditeurs vous contacteront sur ce numéro." : "Votre e-mail a été enregistré. Il vous servira pour la récupération du compte et les notifications.");
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "La mise à jour a échoué.");
      haptic.error();
      setStage("otp");
    }
  }

  const phoneLabel = profile?.phone ?? "Non renseigné";
  const emailLabel = profile?.email ?? "Non renseignée";
  const phoneVerified = Boolean(profile?.phoneVerified);
  const emailVerified = Boolean(profile?.emailVerified);

  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: theme.muted }]}>Informations personnelles</Text>
      <View style={[styles.sectionCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <ContactRow
          icon="phone"
          iconBg="primary"
          label="Téléphone"
          value={phoneLabel}
          verified={phoneVerified}
          verifiedLabel="Vérifié"
          onPress={() => open("phone")}
          theme={theme}
        />
        <ContactRow
          icon="mail"
          iconBg="amber"
          label="Adresse e-mail"
          value={emailLabel}
          verified={emailVerified}
          verifiedLabel="Vérifiée"
          onPress={() => open("email")}
          last
          theme={theme}
        />
      </View>
      <Text style={[styles.helper, { color: theme.muted }]}>
        Chaque modification est confirmée par un code OTP reçu par SMS (téléphone) ou par e-mail. L'e-mail sert à la récupération du compte.
      </Text>

      <Modal visible={active !== null} transparent animationType="slide" onRequestClose={close}>
        <View style={[styles.overlay, { backgroundColor: "rgba(0,0,0,0.42)" }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} />
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.kb}>
            <View style={[styles.sheet, { backgroundColor: theme.surface }]}>
              <View style={[styles.handle, { backgroundColor: theme.border }]} />
              <View style={[styles.iconWrap, { backgroundColor: theme.background }]}>
                <MaterialIcons name={active === "email" ? "mail" : "phone"} size={22} color={theme.primary} />
              </View>
              <Text style={[styles.title, { color: theme.foreground }]}>
                {active === "email" ? "Modifier l'adresse e-mail" : "Modifier le numéro de téléphone"}
              </Text>
              <Text style={[styles.subtitle, { color: theme.muted }]}>
                {stage === "draft" ? "Saisissez la nouvelle valeur. Un code de confirmation vous sera envoyé." : "Saisissez le code à 6 chiffres reçu pour confirmer la modification."}
              </Text>

              {stage === "draft" ? (
                <>
                  <Text style={[styles.fieldLabel, { color: theme.muted }]}>{active === "email" ? "ADRESSE E-MAIL" : "NUMÉRO DE TÉLÉPHONE"}</Text>
                  <View style={[styles.inputWrap, { backgroundColor: theme.background, borderColor: theme.border }]}>
                    <TextInput
                      value={draft}
                      onChangeText={(value) => { setDraft(active === "email" ? value : sanitizeFullName(value, { preserveTrailingSeparator: true })); setError(""); }}
                      autoCapitalize={active === "email" ? "none" : "sentences"}
                      keyboardType={active === "email" ? "email-address" : "phone-pad"}
                      autoCorrect={false}
                      placeholder={active === "email" ? "nom@exemple.com" : "+226 70 00 00 00"}
                      placeholderTextColor={theme.muted}
                      style={[styles.input, { color: theme.foreground }]}
                    />
                  </View>
                  {error ? <Text style={[styles.error, { color: theme.error }]}>{error}</Text> : null}
                  <TikisButton label={active === "email" ? "Envoyer le code par e-mail" : "Envoyer le code par SMS"} icon="send" onPress={() => void sendOtp()} loading={sending} loadingLabel="Envoi en cours…" style={styles.confirm} />
                </>
              ) : (
                <>
                  <Text style={[styles.fieldLabel, { color: theme.muted }]}>CODE DE CONFIRMATION</Text>
                  <View style={[styles.inputWrap, { backgroundColor: theme.background, borderColor: theme.border }]}>
                    <TextInput
                      value={otp}
                      onChangeText={(value) => { setOtp(value.replace(/\D/g, "").slice(0, OTP_LENGTH)); setError(""); }}
                      keyboardType="number-pad"
                      placeholder="• • • • • •"
                      placeholderTextColor={theme.muted}
                      style={[styles.input, styles.otpInput, { color: theme.foreground }]}
                      maxLength={OTP_LENGTH}
                      autoFocus
                    />
                  </View>
                  <Text style={[styles.otpHint, { color: theme.muted }]}>
                    Code de démonstration : <Text style={[styles.otpDemo, { color: theme.primary }]}>{DEMO_OTP}</Text>
                  </Text>
                  {error ? <Text style={[styles.error, { color: theme.error }]}>{error}</Text> : null}
                  <TikisButton label="Confirmer" icon="check" onPress={() => void verifyOtp()} loading={stage === "verifying"} loadingLabel="Vérification…" style={styles.confirm} />
                  <Pressable disabled={resendIn > 0 || stage === "verifying"} onPress={() => { setOtp(""); void sendOtp(); }} style={({ pressed }) => [styles.resend, (resendIn > 0 || stage === "verifying") && styles.resendDisabled, pressed && { opacity: 0.7 }]}>
                    <Text style={[styles.resendText, { color: resendIn > 0 ? theme.muted : theme.primary }]}>
                      {resendIn > 0 ? `Renvoyer dans ${resendIn} s` : "Renvoyer le code"}
                    </Text>
                  </Pressable>
                </>
              )}

              <Pressable onPress={close} style={({ pressed }) => [styles.cancel, pressed && { opacity: 0.7 }]}>
                <Text style={[styles.cancelText, { color: theme.muted }]}>Annuler</Text>
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

function ContactRow({ icon, iconBg, label, value, verified, verifiedLabel, onPress, last, theme }: { icon: React.ComponentProps<typeof MaterialIcons>["name"]; iconBg: "primary" | "amber"; label: string; value: string; verified: boolean; verifiedLabel: string; onPress: () => void; last?: boolean; theme: any }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border }, pressed && { backgroundColor: theme.pressed }]} accessibilityRole="button" accessibilityLabel={`Modifier ${label}`}>
      <View style={[styles.icon, { backgroundColor: iconBg === "amber" ? theme.warning + "22" : theme.primary + "22" }]}>
        <MaterialIcons name={icon} size={16} color={iconBg === "amber" ? theme.warning : theme.primary} />
      </View>
      <View style={styles.rowBody}>
        <Text style={[styles.rowLabel, { color: theme.foreground }]}>{label}</Text>
        <Text style={[styles.rowValue, { color: theme.muted }]} numberOfLines={1}>{value}</Text>
      </View>
      {verified ? (
        <View style={[styles.badge, { backgroundColor: theme.background }]}>
          <MaterialIcons name="check-circle" size={11} color={theme.success} />
          <Text style={[styles.badgeText, { color: theme.success }]}>{verifiedLabel}</Text>
        </View>
      ) : (
        <View style={[styles.badge, { backgroundColor: theme.background }]}>
          <MaterialIcons name="edit" size={11} color={theme.muted} />
          <Text style={[styles.badgeText, { color: theme.muted }]}>Modifier</Text>
        </View>
      )}
      <MaterialIcons name="chevron-right" size={16} color={theme.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { gap: 6, paddingHorizontal: 14, marginTop: 4 },
  sectionTitle: { fontSize: 10, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase", paddingHorizontal: 2 },
  sectionCard: { borderRadius: 12, overflow: "hidden", borderWidth: 1 },
  helper: { fontSize: 10, lineHeight: 15, paddingHorizontal: 4, marginTop: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11, paddingHorizontal: 12 },
  icon: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  rowBody: { flex: 1, minWidth: 0 },
  rowLabel: { fontSize: 13, fontWeight: "600" },
  rowValue: { fontSize: 10, marginTop: 1 },
  badge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 99 },
  badgeText: { fontSize: 9, fontWeight: "700" },

  overlay: { flex: 1, justifyContent: "flex-end" },
  kb: { width: "100%" },
  sheet: { borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, paddingTop: 8, paddingBottom: 24 },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 14 },
  iconWrap: { width: 44, height: 44, borderRadius: 10, alignItems: "center", justifyContent: "center", alignSelf: "center", marginBottom: 12 },
  title: { fontSize: 17, fontWeight: "600", textAlign: "center" },
  subtitle: { fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 4 },
  fieldLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase", marginTop: 16, marginBottom: 6 },
  inputWrap: { flexDirection: "row", alignItems: "center", borderRadius: 9, borderWidth: 1, paddingHorizontal: 12 },
  input: { flex: 1, fontSize: 15, fontWeight: "500", paddingVertical: 12 },
  otpInput: { fontSize: 22, fontWeight: "700", letterSpacing: 6, textAlign: "center" },
  otpHint: { fontSize: 11, marginTop: 6, textAlign: "center" },
  otpDemo: { fontWeight: "700" },
  error: { fontSize: 11, fontWeight: "600", marginTop: 6 },
  confirm: { marginTop: 14 },
  resend: { alignItems: "center", paddingVertical: 10 },
  resendDisabled: { opacity: 0.5 },
  resendText: { fontSize: 12, fontWeight: "600" },
  cancel: { alignItems: "center", paddingVertical: 12 },
  cancelText: { fontSize: 13, fontWeight: "600" },
});
