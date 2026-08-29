import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { TikisButton } from "@/components/tikis/ui";
import { haptic } from "@/lib/haptics";
import { sanitizeDeliveryText, isAllowedDeliveryText } from "@/lib/tikis-engine";

type ContactReason = "general" | "account" | "delivery" | "payment" | "report" | "other";

const REASONS: { value: ContactReason; label: string; helper: string }[] = [
  { value: "general", label: "Question générale", helper: "Tout sujet hors des cas ci-dessous." },
  { value: "account", label: "Compte & vérification", helper: "Inscription, profil, KYC, suppression." },
  { value: "delivery", label: "Livraison en cours", helper: "Course bloquée, annulation, litige." },
  { value: "payment", label: "Paiement & Wallet", helper: "Commission, solde, remboursement." },
  { value: "report", label: "Signalement", helper: "Comportement inapproprié, fraude." },
  { value: "other", label: "Autre", helper: "Précisez votre demande." },
];

const CONTACT_EMAIL = "support@tikis.app";
const CONTACT_PHONE = "+226 25 00 00 00";

export default function ContactScreen() {
  const [reason, setReason] = useState<ContactReason>("general");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const subjectReady = subject.trim().length >= 3 && isAllowedDeliveryText(subject);
  const messageReady = message.trim().length >= 10 && isAllowedDeliveryText(message);
  const canSend = subjectReady && messageReady && !sending;

  function pickReason(value: ContactReason) {
    haptic.selection();
    setReason(value);
  }

  async function send() {
    if (!canSend) {
      if (!subjectReady) setError("Indiquez un sujet de 3 caractères minimum (lettres, chiffres, espaces, apostrophes, traits d’union).");
      else if (!messageReady) setError("Décrivez votre demande en 10 caractères minimum (caractères autorisés).");
      else setError("");
      return;
    }
    setError("");
    setSending(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 800));
      const safeSubject = sanitizeDeliveryText(subject).slice(0, 120);
      const safeMessage = sanitizeDeliveryText(message).slice(0, 1000);
      const reasonLabel = REASONS.find((item) => item.value === reason)?.label ?? "Question";
      const body = `Sujet : ${safeSubject}\nMotif : ${reasonLabel}\n\n${safeMessage}`;
      const url = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`[${reasonLabel}] ${safeSubject}`)}&body=${encodeURIComponent(body)}`;
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
      }
      setSuccess(true);
      haptic.success();
    } catch (cause) {
      haptic.error();
      setError(cause instanceof Error ? cause.message : "L'envoi a échoué. Réessayez dans un instant.");
    } finally {
      setSending(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Retour" onPress={() => router.back()} style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
          <MaterialIcons name="arrow-back" size={22} color="#111111" />
        </Pressable>
        <View>
          <Text style={styles.title}>Contactez-nous</Text>
          <Text style={styles.subtitle}>Notre équipe vous répond sous 24 heures ouvrées.</Text>
        </View>
      </View>
      <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.contactRow}>
            <View style={styles.contactCard}>
              <View style={styles.contactIcon}><MaterialIcons name="mail" size={18} color="#007B8B" /></View>
              <View style={styles.contactCopy}>
                <Text style={styles.contactLabel}>Email</Text>
                <Text style={styles.contactValue}>{CONTACT_EMAIL}</Text>
              </View>
            </View>
            <View style={styles.contactCard}>
              <View style={styles.contactIcon}><MaterialIcons name="phone" size={18} color="#007B8B" /></View>
              <View style={styles.contactCopy}>
                <Text style={styles.contactLabel}>Téléphone</Text>
                <Text style={styles.contactValue}>{CONTACT_PHONE}</Text>
              </View>
            </View>
          </View>

          {success ? (
            <View style={styles.success}>
              <MaterialIcons name="check-circle" size={28} color="#167A55" />
              <Text style={styles.successTitle}>Message prêt à envoyer</Text>
              <Text style={styles.successText}>Votre application de messagerie a été ouverte avec le message pré-rempli. Si elle ne s’est pas lancée, écrivez-nous directement à {CONTACT_EMAIL}.</Text>
              <TikisButton label="Envoyer un autre message" variant="secondary" onPress={() => { setSuccess(false); setSubject(""); setMessage(""); }} />
            </View>
          ) : (
            <>
              <Text style={styles.label}>MOTIF DE LA DEMANDE</Text>
              <View style={styles.reasons}>
                {REASONS.map((item) => {
                  const active = item.value === reason;
                  return (
                    <Pressable key={item.value} accessibilityRole="button" accessibilityLabel={`Motif : ${item.label}`} onPress={() => pickReason(item.value)} style={({ pressed }) => [styles.reason, active && styles.reasonActive, pressed && styles.pressed]}>
                      <Text style={[styles.reasonText, active && styles.reasonTextActive]}>{item.label}</Text>
                      <Text style={[styles.reasonHelper, active && styles.reasonHelperActive]}>{item.helper}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.label}>SUJET</Text>
              <View style={styles.inputWrap}>
                <TextInput value={subject} onChangeText={(value) => { setSubject(sanitizeDeliveryText(value, { preserveTrailingSpace: true })); setError(""); }} maxLength={120} placeholder="Décrivez votre sujet en quelques mots" placeholderTextColor="#9AA5B6" style={styles.input} />
              </View>

              <Text style={styles.label}>VOTRE MESSAGE</Text>
              <View style={[styles.inputWrap, styles.textareaWrap]}>
                <TextInput value={message} onChangeText={(value) => { setMessage(sanitizeDeliveryText(value, { preserveTrailingSpace: true })); setError(""); }} maxLength={1000} multiline placeholder="Donnez-nous le maximum de détails pour vous aider au mieux." placeholderTextColor="#9AA5B6" style={[styles.input, styles.textarea]} textAlignVertical="top" />
                <Text style={styles.counter}>{message.length}/1000</Text>
              </View>

              {error ? <Text style={styles.error}>{error}</Text> : <Text style={styles.helper}>Tous les champs sont assainis avant envoi. Les pièces jointes ne sont pas encore prises en charge.</Text>}

              <TikisButton label="Envoyer" icon="send" onPress={() => void send()} loading={sending} loadingLabel="Préparation…" disabled={!canSend} />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#EEEDF3" },
  header: { minHeight: 64, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, backgroundColor: "#FFFFFF", flexDirection: "row", alignItems: "center", gap: 10 },
  back: { width: 40, height: 40, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "#EEEDF3" },
  title: { color: "#111111", fontSize: 17, fontWeight: "600" },
  subtitle: { color: "#666666", fontSize: 12, marginTop: 2 },
  keyboard: { flex: 1 },
  content: { padding: 14, paddingBottom: 36, gap: 12 },
  contactRow: { flexDirection: "row", gap: 8 },
  contactCard: { flex: 1, flexDirection: "row", alignItems: "center", gap: 9, backgroundColor: "#FFFFFF", borderRadius: 10, padding: 10 },
  contactIcon: { width: 34, height: 34, borderRadius: 8, backgroundColor: "#EEEDF3", alignItems: "center", justifyContent: "center" },
  contactCopy: { flex: 1 },
  contactLabel: { color: "#747474", fontSize: 10, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase" },
  contactValue: { color: "#111111", fontSize: 12, fontWeight: "600", marginTop: 2 },
  label: { color: "#747474", fontSize: 10, fontWeight: "600", letterSpacing: 0.6, textTransform: "uppercase", marginTop: 6, marginBottom: 6 },
  reasons: { gap: 7 },
  reason: { backgroundColor: "#FFFFFF", borderRadius: 10, padding: 11 },
  reasonActive: { backgroundColor: "#111111" },
  reasonText: { color: "#111111", fontSize: 13, fontWeight: "600" },
  reasonTextActive: { color: "#FFFFFF" },
  reasonHelper: { color: "#666666", fontSize: 11, marginTop: 2 },
  reasonHelperActive: { color: "#BBBBBB" },
  inputWrap: { backgroundColor: "#FFFFFF", borderRadius: 9, padding: 12, minHeight: 48, justifyContent: "center" },
  textareaWrap: { minHeight: 140, paddingTop: 12 },
  input: { color: "#111111", fontSize: 14, fontWeight: "500", minHeight: 22 },
  textarea: { minHeight: 110, textAlignVertical: "top" },
  counter: { color: "#747474", fontSize: 10, fontWeight: "500", textAlign: "right", marginTop: 4 },
  helper: { color: "#666666", fontSize: 11, lineHeight: 16 },
  error: { color: "#B4232D", fontSize: 12, fontWeight: "600" },
  success: { backgroundColor: "#FFFFFF", borderRadius: 10, padding: 16, alignItems: "center", gap: 8 },
  successTitle: { color: "#111111", fontSize: 15, fontWeight: "600" },
  successText: { color: "#444444", fontSize: 12, lineHeight: 18, textAlign: "center" },
  pressed: { opacity: 0.67 },
});
