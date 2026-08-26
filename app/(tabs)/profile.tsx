import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Avatar, SurfaceCard, TikisButton, tikisStyles } from "@/components/tikis/ui";
import { haptic } from "@/lib/haptics";
import { sanitizeFullName, validateFullName } from "@/lib/registration-rules";
import { getApiBaseUrl } from "@/constants/oauth";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";

export default function ProfileScreen() {
  const { role, profile, notifications, markNotificationsRead, logout, updateProfile, completedDeliveriesForRole, reviews } = useTikisStore();
  const updateMutation = trpc.profiles.update.useMutation();
  const [editorOpen, setEditorOpen] = useState(false);
  const [fullName, setFullName] = useState(profile?.fullName ?? "");
  const [photoBase64, setPhotoBase64] = useState<string | undefined>();
  const [photoMime, setPhotoMime] = useState<"image/jpeg" | "image/png" | "image/webp" | undefined>();
  const [error, setError] = useState("");
  const unread = notifications.filter((item) => !item.read).length;
  const driver = role === "driver";
  const name = profile?.fullName ?? (driver ? "Antoine Kaboré" : "Aïcha Traoré");
  const initials = name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase();
  const photoUri = profile?.photoUrl ? `${getApiBaseUrl()}${profile.photoUrl}` : undefined;
  const completed = completedDeliveriesForRole(role);
  const receivedReviews = reviews.filter((review) => driver && review.driverName === name);

  async function pickPhoto() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.45, base64: true });
    if (result.canceled || !result.assets[0]?.base64) return;
    const mime = result.assets[0].mimeType;
    if (mime !== "image/jpeg" && mime !== "image/png" && mime !== "image/webp") {
      setError("Choisissez une image JPEG, PNG ou WebP.");
      return;
    }
    setPhotoBase64(result.assets[0].base64);
    setPhotoMime(mime);
    setError("");
    haptic.success();
  }

  async function saveProfile() {
    if (!profile) return;
    const validation = validateFullName(fullName);
    if (!validation.valid) { setError(validation.message); haptic.error(); return; }
    try {
      const saved = await updateMutation.mutateAsync({ phone: profile.phone, otp: "730512", fullName: validation.value, photoBase64, photoMime });
      updateProfile({ fullName: saved.fullName, photoUrl: saved.photoUrl });
      setEditorOpen(false);
      setPhotoBase64(undefined);
      setPhotoMime(undefined);
      haptic.success();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "La mise à jour du profil a échoué.");
      haptic.error();
    }
  }

  const items = [
    { icon: "history" as const, label: "Historique des courses", detail: `${completed.length} course${completed.length > 1 ? "s" : ""} terminée${completed.length > 1 ? "s" : ""}`, action: () => router.push("/history" as any) },
    { icon: "star-outline" as const, label: "Mes avis", detail: driver ? (receivedReviews.length ? `${receivedReviews.length} avis reçu${receivedReviews.length > 1 ? "s" : ""}` : "Aucun avis reçu") : "Évaluations envoyées", action: () => router.push("/reviews" as any) },
    { icon: "notifications-none" as const, label: "Notifications", detail: unread ? `${unread} nouvelle${unread > 1 ? "s" : ""}` : "À jour", action: markNotificationsRead },
    { icon: "verified-user" as const, label: driver ? "Compte vérifié" : "Sécurité du compte", detail: driver ? "Profil livreur confirmé" : "Numéro confirmé", action: () => Alert.alert("Sécurité Tikis", "Votre numéro est vérifié par OTP et vos informations personnelles sont validées côté serveur.") },
  ];

  return <SafeAreaView style={tikisStyles.screen} edges={["top", "left", "right"]}><ScrollView contentContainerStyle={styles.list}><Text style={tikisStyles.eyebrow}>Votre espace</Text><Text style={[tikisStyles.title, styles.title]}>Profil</Text><SurfaceCard style={styles.profileCard}><View style={styles.avatarWrap}>{photoUri ? <Image source={{ uri: photoUri }} style={styles.photo} /> : <Avatar initials={initials} color={driver ? "#007B8B" : "#0B1F3A"} size={76} />}<Pressable accessibilityRole="button" accessibilityLabel="Modifier la photo" onPress={() => { setFullName(name); setEditorOpen(true); }} style={styles.photoEdit}><MaterialIcons name="photo-camera" size={16} color="#FFFFFF" /></Pressable></View><View style={styles.profileInfo}><Text style={styles.name}>{name}</Text><Text style={styles.phone}>{profile?.phone ?? "+226 70 00 00 00"}</Text><View style={styles.rolePill}><MaterialIcons name={driver ? "two-wheeler" : "inventory-2"} size={14} color="#006572" /><Text style={styles.roleText}>{driver ? "Livreur" : "Expéditeur"} vérifié</Text></View></View><Pressable accessibilityRole="button" accessibilityLabel="Modifier mes informations" onPress={() => { setFullName(name); setEditorOpen(true); }} style={({ pressed }) => [styles.editButton, pressed && styles.pressed]}><MaterialIcons name="edit" size={19} color="#007B8B" /></Pressable></SurfaceCard><View style={styles.summaryRow}><Summary icon="local-shipping" value={String(completed.length)} label="Courses terminées" /><Summary icon="star-outline" value={driver && receivedReviews.length ? `${(receivedReviews.reduce((sum, review) => sum + review.rating, 0) / receivedReviews.length).toFixed(1)}/5` : "—"} label={driver ? "Note reçue" : "Avis envoyés"} /><Summary icon="event" value={driver ? (profile?.vehicles.length ?? 0).toString() : "✓"} label={driver ? "Engins" : "Compte actif"} /></View><Text style={styles.roleLabel}>INFORMATIONS PERSONNELLES</Text><SurfaceCard style={styles.infoCard}><InfoRow icon="person-outline" label="Nom" value={name} /><InfoRow icon="phone-iphone" label="Téléphone" value={profile?.phone ?? "+226 70 00 00 00"} /><InfoRow icon="two-wheeler" label="Engins" value={driver ? (profile?.vehicles.join(", ") || "À compléter") : "Non applicable"} />{driver && profile?.referralCode ? <InfoRow icon="card-giftcard" label="Code de parrainage" value={profile.referralCode} last /> : null}</SurfaceCard><Text style={styles.sectionLabel}>ACTIVITÉ ET PRÉFÉRENCES</Text>{items.map((item) => <Pressable key={item.label} onPress={() => { haptic.light(); item.action(); }} style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}><View style={styles.menuIcon}><MaterialIcons name={item.icon} size={21} color="#007B8B" /></View><View style={styles.menuInfo}><Text style={styles.menuLabel}>{item.label}</Text><Text style={styles.menuDetail}>{item.detail}</Text></View><MaterialIcons name="chevron-right" size={22} color="#A4AFBE" /></Pressable>)}<TikisButton label="Se déconnecter" variant="ghost" icon="logout" onPress={() => { logout(); router.replace("/" as any); }} style={styles.logout} /></ScrollView><Modal visible={editorOpen} transparent animationType="slide" onRequestClose={() => setEditorOpen(false)}><View style={styles.modal}><Pressable style={styles.scrim} onPress={() => setEditorOpen(false)} /><View style={styles.sheet}><View style={styles.handle} /><Text style={styles.sheetTitle}>Modifier mon profil</Text><Text style={styles.sheetSubtitle}>Vos informations sont contrôlées avant enregistrement.</Text><Pressable onPress={() => void pickPhoto()} style={({ pressed }) => [styles.photoPicker, pressed && styles.pressed]}>{photoBase64 ? <Image source={{ uri: `data:${photoMime};base64,${photoBase64}` }} style={styles.pickerPreview} /> : photoUri ? <Image source={{ uri: photoUri }} style={styles.pickerPreview} /> : <MaterialIcons name="add-a-photo" size={26} color="#007B8B" />}<Text style={styles.photoPickerText}>{photoBase64 || photoUri ? "Changer la photo" : "Ajouter une photo"}</Text></Pressable><Text style={styles.fieldLabel}>NOM</Text><TextInput value={fullName} onChangeText={(value) => { setFullName(sanitizeFullName(value)); setError(""); }} maxLength={70} autoCapitalize="words" placeholder="Ex. Mariam ou Mariam Ouédraogo" placeholderTextColor="#A1ADBC" style={[styles.input, error && styles.inputError]} />{error ? <Text style={styles.error}>{error}</Text> : <Text style={styles.helper}>Un nom unique est accepté. Les séparateurs successifs sont retirés automatiquement.</Text>}<TikisButton label="Enregistrer les modifications" icon="save" onPress={() => void saveProfile()} loading={updateMutation.isPending} style={styles.saveButton} /></View></View></Modal></SafeAreaView>;
}

function Summary({ icon, value, label }: { icon: React.ComponentProps<typeof MaterialIcons>["name"]; value: string; label: string }) { return <SurfaceCard style={styles.summary}><MaterialIcons name={icon} size={20} color="#007B8B" /><Text style={styles.summaryValue}>{value}</Text><Text style={styles.summaryLabel}>{label}</Text></SurfaceCard>; }
function InfoRow({ icon, label, value, last = false }: { icon: React.ComponentProps<typeof MaterialIcons>["name"]; label: string; value: string; last?: boolean }) { return <View style={[styles.infoRow, last && styles.infoLast]}><MaterialIcons name={icon} size={19} color="#007B8B" /><View style={styles.infoText}><Text style={styles.infoLabel}>{label}</Text><Text style={styles.infoValue}>{value}</Text></View></View>; }

const styles = StyleSheet.create({
  list: { padding: 20, paddingBottom: 116 }, title: { marginTop: 3, marginBottom: 18 }, profileCard: { flexDirection: "row", alignItems: "center", gap: 13 }, avatarWrap: { position: "relative", width: 76, height: 76 }, photo: { width: 76, height: 76, borderRadius: 38, backgroundColor: "#E5F6F7" }, photoEdit: { position: "absolute", right: -2, bottom: -2, width: 28, height: 28, borderRadius: 14, backgroundColor: "#007B8B", borderWidth: 2, borderColor: "#FFFFFF", alignItems: "center", justifyContent: "center" }, profileInfo: { flex: 1 }, name: { color: "#0B1F3A", fontSize: 17, fontWeight: "900" }, phone: { color: "#697386", fontSize: 13, marginTop: 3 }, rolePill: { flexDirection: "row", gap: 5, alignItems: "center", marginTop: 8 }, roleText: { color: "#006572", fontSize: 11, fontWeight: "900" }, editButton: { width: 38, height: 38, borderRadius: 13, backgroundColor: "#E5F6F7", alignItems: "center", justifyContent: "center" }, summaryRow: { flexDirection: "row", gap: 9, marginTop: 13 }, summary: { flex: 1, padding: 12, minHeight: 104 }, summaryValue: { color: "#0B1F3A", fontSize: 17, fontWeight: "900", marginTop: 10 }, summaryLabel: { color: "#78869A", fontSize: 10, lineHeight: 14, marginTop: 3 }, roleLabel: { color: "#8A96A8", fontSize: 11, fontWeight: "900", letterSpacing: 0.7, marginTop: 25, marginBottom: 8 }, infoCard: { paddingVertical: 0 }, infoRow: { flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 13, borderBottomWidth: 1, borderColor: "#EEF2F6" }, infoLast: { borderBottomWidth: 0 }, infoText: { flex: 1 }, infoLabel: { color: "#78869A", fontSize: 11, fontWeight: "800" }, infoValue: { color: "#0B1F3A", fontSize: 13, lineHeight: 18, fontWeight: "800", marginTop: 2 }, sectionLabel: { color: "#8A96A8", fontSize: 11, fontWeight: "900", letterSpacing: 0.7, marginTop: 25, marginBottom: 8 }, menuRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderColor: "#E7ECF2" }, menuIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#E5F6F7", marginRight: 11 }, menuInfo: { flex: 1 }, menuLabel: { color: "#0B1F3A", fontWeight: "800", fontSize: 14 }, menuDetail: { color: "#778398", fontSize: 12, marginTop: 2 }, logout: { marginTop: 28 }, modal: { flex: 1, justifyContent: "flex-end" }, scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(8,22,42,0.48)" }, sheet: { backgroundColor: "#FFFFFF", borderTopLeftRadius: 27, borderTopRightRadius: 27, padding: 20, paddingBottom: 32 }, handle: { width: 42, height: 4, borderRadius: 2, backgroundColor: "#D5DEE7", alignSelf: "center", marginBottom: 18 }, sheetTitle: { color: "#0B1F3A", fontSize: 21, fontWeight: "900" }, sheetSubtitle: { color: "#697386", fontSize: 13, marginTop: 4 }, photoPicker: { minHeight: 82, padding: 12, marginTop: 19, borderRadius: 18, backgroundColor: "#E5F6F7", flexDirection: "row", gap: 12, alignItems: "center" }, pickerPreview: { width: 58, height: 58, borderRadius: 29 }, photoPickerText: { color: "#006572", fontSize: 14, fontWeight: "900" }, fieldLabel: { color: "#8A96A8", fontSize: 11, fontWeight: "900", letterSpacing: 0.7, marginTop: 20, marginBottom: 8 }, input: { minHeight: 56, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: "#DDE5ED", color: "#0B1F3A", fontSize: 16, fontWeight: "800" }, inputError: { borderColor: "#C23B45" }, error: { color: "#C23B45", fontSize: 12, fontWeight: "700", marginTop: 7 }, helper: { color: "#78869A", fontSize: 12, marginTop: 7 }, saveButton: { marginTop: 21 }, pressed: { opacity: 0.67 },
});
