import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { TikisButton } from "@/components/tikis/ui";
import { isAllowedDeliveryText } from "@/lib/tikis-engine";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";

const REASONS = ["Retard important", "Comportement inapproprié", "Problème de livraison", "Autre"];

export default function ReportDeliveryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useTikisStore();
  const deliveryQuery = trpc.deliveries.get.useQuery({ id: id ?? "00000000-0000-4000-8000-000000000000" }, { enabled: Boolean(id && profile?.phone) });
  const delivery = deliveryQuery.data;
  const [reason, setReason] = useState(REASONS[0]);
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  function send() {
    if (!description.trim()) { setError("Décrivez le problème pour aider l’équipe Tikis."); return; }
    if (!isAllowedDeliveryText(description)) { setError("Caractères non autorisés"); return; }
    setError("");
    setSent(true);
  }

  return <SafeAreaView style={styles.safe} edges={["top", "bottom"]}><KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === "ios" ? "padding" : undefined}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"><View style={styles.topBar}><Pressable onPress={() => router.back()} style={({ pressed }) => [styles.back, pressed && styles.pressed]}><MaterialIcons name="arrow-back" size={22} color="#111111" /></Pressable><Text style={styles.topTitle}>Signaler</Text><View style={styles.space} /></View>{sent ? <View style={styles.success}><View style={styles.successIcon}><MaterialIcons name="check-circle" size={32} color="#167A55" /></View><Text style={styles.successTitle}>Signalement envoyé</Text><Text style={styles.successText}>Merci. Votre signalement concernant « {delivery?.title ?? "cette livraison"} » a été transmis à l’administration Tikis et sera conservé dans la chronologie.</Text><TikisButton label="Retour à la livraison" onPress={() => router.back()} style={styles.successButton} /></View> : <><Text style={styles.title}>Aidez-nous à comprendre.</Text><Text style={styles.subtitle}>Votre signalement est traité de manière confidentielle par l’équipe Tikis.</Text><Text style={styles.label}>MOTIF</Text><View style={styles.reasons}>{REASONS.map((item) => <Pressable key={item} onPress={() => setReason(item)} style={({ pressed }) => [styles.reason, reason === item && styles.reasonActive, pressed && styles.pressed]}><Text style={[styles.reasonText, reason === item && styles.reasonTextActive]}>{item}</Text></Pressable>)}</View><Text style={styles.label}>DÉCRIVEZ LA SITUATION</Text><TextInput value={description} onChangeText={(value) => { setDescription(value); setError(""); }} placeholder="Expliquez ce qui s’est passé…" placeholderTextColor="#B48753" multiline textAlignVertical="top" style={styles.textarea} />{error ? <Text style={styles.error}>{error}</Text> : null}<View style={styles.attach}><MaterialIcons name="attach-file" size={20} color="#007B8B" /><View style={styles.attachTextWrap}><Text style={styles.attachTitle}>Pièces jointes</Text><Text style={styles.attachText}>Vous pourrez ajouter des photos ou documents lors de l’intégration serveur.</Text></View></View><TikisButton label="Envoyer le signalement" icon="send" onPress={send} style={styles.submit} /></>}</ScrollView></KeyboardAvoidingView></SafeAreaView>;
}

const baseStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F6F8FC" }, keyboard: { flex: 1 }, content: { padding: 20, paddingBottom: 40 }, topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 25 }, back: { width: 42, height: 42, borderRadius: 21, backgroundColor: "#FFFFFF", borderColor: "#E7ECF2", borderWidth: 1, alignItems: "center", justifyContent: "center" }, topTitle: { color: "#0B1F3A", fontSize: 16, fontWeight: "900" }, space: { width: 42 }, title: { color: "#0B1F3A", fontSize: 27, fontWeight: "900", letterSpacing: -0.4 }, subtitle: { color: "#697386", fontSize: 14, lineHeight: 21, marginTop: 8 }, label: { color: "#8A96A8", fontSize: 11, fontWeight: "900", letterSpacing: 0.8, marginTop: 28, marginBottom: 10 }, reasons: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, reason: { paddingHorizontal: 13, paddingVertical: 10, backgroundColor: "#FFFFFF", borderRadius: 13, borderColor: "#DDE5ED", borderWidth: 1 }, reasonActive: { backgroundColor: "#F7EFE5", borderColor: "#E5D2B9" }, reasonText: { color: "#697386", fontWeight: "800", fontSize: 12 }, reasonTextActive: { color: "#9A6201" }, textarea: { minHeight: 130, backgroundColor: "#F7EFE5", borderRadius: 16, borderColor: "#E5D2B9", borderWidth: 1, padding: 14, color: "#9A6201", fontSize: 14, lineHeight: 21 }, error: { color: "#C23B45", fontSize: 13, fontWeight: "800", marginTop: 8 }, attach: { marginTop: 14, padding: 13, backgroundColor: "#E5F6F7", borderRadius: 15, borderColor: "#CDE4E7", borderWidth: 1, flexDirection: "row", gap: 10 }, attachTextWrap: { flex: 1 }, attachTitle: { color: "#006572", fontSize: 13, fontWeight: "900" }, attachText: { color: "#4D7075", fontSize: 12, lineHeight: 17, marginTop: 2 }, submit: { marginTop: 24 }, success: { alignItems: "center", paddingTop: 58, paddingHorizontal: 15 }, successIcon: { width: 66, height: 66, borderRadius: 24, backgroundColor: "#DCFCE7", alignItems: "center", justifyContent: "center" }, successTitle: { color: "#0B1F3A", fontSize: 23, fontWeight: "900", marginTop: 18 }, successText: { color: "#697386", fontSize: 14, lineHeight: 21, textAlign: "center", marginTop: 8 }, successButton: { alignSelf: "stretch", marginTop: 26 }, pressed: { opacity: 0.67 },
});

const styles = StyleSheet.create({
  ...baseStyles,
  safe: { ...baseStyles.safe, backgroundColor: "#EEEDF3" },
  content: { ...baseStyles.content, padding: 16, paddingBottom: 28 },
  topBar: { ...baseStyles.topBar, marginBottom: 17 },
  back: { ...baseStyles.back, borderRadius: 8, borderWidth: 0 },
  topTitle: { ...baseStyles.topTitle, color: "#111111", fontWeight: "600" },
  title: { ...baseStyles.title, color: "#111111", fontWeight: "600", fontSize: 25 },
  label: { ...baseStyles.label, fontWeight: "600", marginTop: 20, marginBottom: 8 },
  reasons: { ...baseStyles.reasons, gap: 7 },
  reason: { ...baseStyles.reason, borderRadius: 8, borderWidth: 0, paddingHorizontal: 11, paddingVertical: 9 },
  reasonActive: { ...baseStyles.reasonActive, borderWidth: 1, borderColor: "#E5D2B9" },
  reasonText: { ...baseStyles.reasonText, fontWeight: "600" },
  textarea: { ...baseStyles.textarea, borderRadius: 10, borderWidth: 1, borderColor: "#E5D2B9", padding: 13, color: "#9A6201" },
  error: { ...baseStyles.error, fontWeight: "600" },
  attach: { ...baseStyles.attach, borderRadius: 10, borderWidth: 0, backgroundColor: "#E2F3F4", padding: 12 },
  attachTitle: { ...baseStyles.attachTitle, fontWeight: "600" },
  submit: { ...baseStyles.submit, marginTop: 18 },
  successIcon: { ...baseStyles.successIcon, borderRadius: 12 },
  successTitle: { ...baseStyles.successTitle, color: "#111111", fontWeight: "600", marginTop: 14 },
});
