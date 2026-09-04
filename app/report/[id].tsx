import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import * as ImagePicker from "expo-image-picker";
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { TikisButton } from "@/components/tikis/ui";
import { isAllowedDeliveryText } from "@/lib/tikis-engine";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";

type AttachmentMime = "image/jpeg" | "image/png" | "image/webp";

const REASONS: { label: string; value: "comportement" | "sécurité" | "paiement" | "objet_endommagé" | "retard" | "autre" }[] = [
  { label: "Retard important", value: "retard" },
  { label: "Comportement inapproprié", value: "comportement" },
  { label: "Problème de sécurité", value: "sécurité" },
  { label: "Problème de paiement", value: "paiement" },
  { label: "Objet endommagé", value: "objet_endommagé" },
  { label: "Autre", value: "autre" },
];

export default function ReportDeliveryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useTikisStore();
  const deliveryQuery = trpc.deliveries.get.useQuery({ id: id ?? "00000000-0000-4000-8000-000000000000" }, { enabled: Boolean(id && profile?.phone) });
  const delivery = deliveryQuery.data;
  const [reason, setReason] = useState(REASONS[0].value);
  const [description, setDescription] = useState("");
  const [attachment, setAttachment] = useState<{ base64: string; mime: AttachmentMime; previewUri: string } | null>(null);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const reportMutation = trpc.reports.create.useMutation();

  async function pickAttachment() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.5, base64: true });
    if (result.canceled || !result.assets[0]?.base64) return;
    const mime = result.assets[0].mimeType;
    if (mime !== "image/jpeg" && mime !== "image/png" && mime !== "image/webp") {
      setError("Choisissez une image JPEG, PNG ou WebP.");
      return;
    }
    setAttachment({ base64: result.assets[0].base64, mime, previewUri: result.assets[0].uri });
    setError("");
  }

  async function send() {
    if (!id) return;
    if (description.trim().length < 10) { setError("Décrivez le problème en quelques mots (10 caractères minimum)."); return; }
    if (!isAllowedDeliveryText(description)) { setError("Caractères non autorisés"); return; }
    setError("");
    try {
      await reportMutation.mutateAsync({
        deliveryId: id,
        reason,
        description: description.trim(),
        ...(attachment ? { attachmentBase64: attachment.base64, attachmentMime: attachment.mime } : {}),
      });
      setSent(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Le signalement n’a pas pu être envoyé. Réessayez.");
    }
  }

  return <SafeAreaView style={styles.safe} edges={["top", "bottom"]}><KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === "ios" ? "padding" : undefined}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"><View style={styles.topBar}><Pressable onPress={() => router.back()} style={({ pressed }) => [styles.back, pressed && styles.pressed]}><MaterialIcons name="arrow-back" size={22} color="#111111" /></Pressable><Text style={styles.topTitle}>Signaler</Text><View style={styles.space} /></View>{sent ? <View style={styles.success}><View style={styles.successIcon}><MaterialIcons name="check-circle" size={32} color="#167A55" /></View><Text style={styles.successTitle}>Signalement envoyé</Text><Text style={styles.successText}>Merci. Votre signalement concernant « {delivery?.title ?? "cette livraison"} » a été transmis à l’administration Tikis et sera conservé dans la chronologie.</Text><TikisButton label="Retour à la livraison" onPress={() => router.back()} style={styles.successButton} /></View> : <><Text style={styles.title}>Aidez-nous à comprendre.</Text><Text style={styles.subtitle}>Votre signalement est traité de manière confidentielle par l’équipe Tikis.</Text><Text style={styles.label}>MOTIF</Text><View style={styles.reasons}>{REASONS.map((item) => <Pressable key={item.value} onPress={() => setReason(item.value)} style={({ pressed }) => [styles.reason, reason === item.value && styles.reasonActive, pressed && styles.pressed]}><Text style={[styles.reasonText, reason === item.value && styles.reasonTextActive]}>{item.label}</Text></Pressable>)}</View><Text style={styles.label}>DÉCRIVEZ LA SITUATION</Text><TextInput value={description} onChangeText={(value) => { setDescription(value); setError(""); }} placeholder="Expliquez ce qui s’est passé…" placeholderTextColor="#B48753" multiline textAlignVertical="top" style={styles.textarea} />{error ? <Text style={styles.error}>{error}</Text> : null}{attachment ? <View style={styles.attach}><Image source={{ uri: attachment.previewUri }} style={styles.attachPreview} /><View style={styles.attachTextWrap}><Text style={styles.attachTitle}>Photo jointe</Text><Text style={styles.attachText}>Elle sera transmise à l’administration avec votre signalement.</Text></View><Pressable onPress={() => setAttachment(null)} accessibilityLabel="Retirer la photo" style={({ pressed }) => [styles.attachRemove, pressed && styles.pressed]}><MaterialIcons name="close" size={16} color="#697386" /></Pressable></View> : <Pressable onPress={() => void pickAttachment()} style={({ pressed }) => [styles.attach, pressed && styles.pressed]}><MaterialIcons name="attach-file" size={20} color="#007B8B" /><View style={styles.attachTextWrap}><Text style={styles.attachTitle}>Ajouter une photo (facultatif)</Text><Text style={styles.attachText}>Une capture d’écran ou une photo peut aider l’équipe Tikis à comprendre la situation.</Text></View></Pressable>}<TikisButton label="Envoyer le signalement" icon="send" onPress={() => void send()} loading={reportMutation.isPending} style={styles.submit} /></>}</ScrollView></KeyboardAvoidingView></SafeAreaView>;
}

const baseStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F6F8FC" }, keyboard: { flex: 1 }, content: { padding: 20, paddingBottom: 40 }, topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 25 }, back: { width: 42, height: 42, borderRadius: 21, backgroundColor: "#FFFFFF", borderColor: "#E7ECF2", borderWidth: 1, alignItems: "center", justifyContent: "center" }, topTitle: { color: "#0B1F3A", fontSize: 16, fontWeight: "900" }, space: { width: 42 }, title: { color: "#0B1F3A", fontSize: 27, fontWeight: "900", letterSpacing: -0.4 }, subtitle: { color: "#697386", fontSize: 14, lineHeight: 21, marginTop: 8 }, label: { color: "#8A96A8", fontSize: 11, fontWeight: "900", letterSpacing: 0.8, marginTop: 28, marginBottom: 10 }, reasons: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, reason: { paddingHorizontal: 13, paddingVertical: 10, backgroundColor: "#FFFFFF", borderRadius: 13, borderColor: "#DDE5ED", borderWidth: 1 }, reasonActive: { backgroundColor: "#F7EFE5", borderColor: "#E5D2B9" }, reasonText: { color: "#697386", fontWeight: "800", fontSize: 12 }, reasonTextActive: { color: "#9A6201" }, textarea: { minHeight: 130, backgroundColor: "#F7EFE5", borderRadius: 16, borderColor: "#E5D2B9", borderWidth: 1, padding: 14, color: "#9A6201", fontSize: 14, lineHeight: 21 }, error: { color: "#C23B45", fontSize: 13, fontWeight: "800", marginTop: 8 }, attach: { marginTop: 14, padding: 13, backgroundColor: "#E5F6F7", borderRadius: 15, borderColor: "#CDE4E7", borderWidth: 1, flexDirection: "row", alignItems: "center", gap: 10 }, attachTextWrap: { flex: 1 }, attachTitle: { color: "#006572", fontSize: 13, fontWeight: "900" }, attachText: { color: "#4D7075", fontSize: 12, lineHeight: 17, marginTop: 2 }, attachPreview: { width: 40, height: 40, borderRadius: 8 }, attachRemove: { width: 30, height: 30, borderRadius: 15, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" }, submit: { marginTop: 24 }, success: { alignItems: "center", paddingTop: 58, paddingHorizontal: 15 }, successIcon: { width: 66, height: 66, borderRadius: 24, backgroundColor: "#DCFCE7", alignItems: "center", justifyContent: "center" }, successTitle: { color: "#0B1F3A", fontSize: 23, fontWeight: "900", marginTop: 18 }, successText: { color: "#697386", fontSize: 14, lineHeight: 21, textAlign: "center", marginTop: 8 }, successButton: { alignSelf: "stretch", marginTop: 26 }, pressed: { opacity: 0.67 },
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
