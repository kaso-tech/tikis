import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useThemeColors } from "@/lib/use-theme-colors";
import { SafeAreaView } from "react-native-safe-area-context";
import { TikisButton } from "@/components/tikis/ui";
import { haptic } from "@/lib/haptics";
import { useTikisLogout } from "@/lib/tikis-logout";
import { sanitizeFullName, validateFullName } from "@/lib/registration-rules";
import { getApiBaseUrl } from "@/constants/oauth";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";
import { availableWalletBalance } from "@/shared/tikis-domain";

export default function ProfileScreen() {
  const { colors: theme } = useThemeColors();
  const { role, profile, notifications, markNotificationsRead, updateProfile } = useTikisStore();
  const { openLogoutConfirmation } = useTikisLogout();
  const updateMutation = trpc.profiles.update.useMutation();
  const deliveriesQuery = trpc.deliveries.list.useQuery(undefined, { enabled: Boolean(profile?.phone) });
  const reviewsQuery = trpc.reviews.list.useQuery(undefined, { enabled: Boolean(profile?.phone) });
  const walletQuery = trpc.wallet.snapshot.useQuery(undefined, { enabled: role === "driver" && Boolean(profile?.phone) });
  const [editorOpen, setEditorOpen] = useState(false);
  const [fullName, setFullName] = useState(profile?.fullName ?? "");
  const [photoBase64, setPhotoBase64] = useState<string | undefined>();
  const [photoMime, setPhotoMime] = useState<"image/jpeg" | "image/png" | "image/webp" | undefined>();
  const [error, setError] = useState("");

  const driver = role === "driver";
  const name = profile?.fullName ?? (driver ? "Antoine Kaboré" : "Aïcha Traoré");
  const initials = name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  const photoUri = profile?.photoUrl ? `${getApiBaseUrl()}${profile.photoUrl}` : undefined;
  const completed = (deliveriesQuery.data ?? []).filter((delivery) => delivery.status === "completed");
  const receivedReviews = useMemo(() => driver ? reviewsQuery.data ?? [] : [], [driver, reviewsQuery.data]);
  const unread = notifications.filter((item) => !item.read).length;
  const driverWallet = walletQuery.data?.wallet;
  const availableBalance = driverWallet ? availableWalletBalance(driverWallet) : 0;

  const driverRating = useMemo(() => {
    if (!driver || receivedReviews.length === 0) return null;
    const sum = receivedReviews.reduce((acc, review) => acc + review.rating, 0);
    return (sum / receivedReviews.length).toFixed(1);
  }, [driver, receivedReviews]);

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

  function openEditor() {
    setFullName(name);
    setPhotoBase64(undefined);
    setPhotoMime(undefined);
    setError("");
    setEditorOpen(true);
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

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <Pressable onPress={openEditor} style={({ pressed }) => [styles.avatarWrap, pressed && styles.pressed]}>
            {photoUri ? (
              <Image source={{ uri: photoUri }} style={styles.avatarImage} />
            ) : (
              <View style={[styles.avatar, driver && styles.avatarDriver]}>
                <Text style={styles.avatarText}>{initials}</Text>
              </View>
            )}
            <View style={styles.verifiedBadge}>
              <MaterialIcons name="check" size={12} color="#FFFFFF" />
            </View>
            <View style={styles.avatarEdit}>
              <MaterialIcons name="photo-camera" size={14} color="#FFFFFF" />
            </View>
          </Pressable>
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.phoneText}>{profile?.phone ?? "+226 70 00 00 00"}</Text>
          <View style={[styles.rolePill, driver && styles.rolePillDriver]}>
            <MaterialIcons name={driver ? "two-wheeler" : "inventory-2"} size={12} color={driver ? "#9A6200" : "#007B8B"} />
            <Text style={[styles.rolePillText, driver && styles.rolePillTextDriver]}>
              {driver ? `LIVREUR VÉRIFIÉ${profile?.vehicles.length ? ` · ${profile.vehicles[0]?.toUpperCase()}` : ""}` : "EXPÉDITEUR VÉRIFIÉ"}
            </Text>
          </View>
        </View>

        <View style={styles.stats}>
          {driver ? (
            <>
              <StatCard icon="local-shipping" color="primary" value={String(completed.length)} label="Courses" />
              <StatCard icon="star" color="amber" value={driverRating ?? "—"} label="Note /5" />
              <StatCard icon="account-balance-wallet" color="dark" value={availableBalance > 0 ? new Intl.NumberFormat("fr-FR").format(availableBalance) : "—"} label="Wallet F" />
            </>
          ) : (
            <>
              <StatCard icon="local-shipping" color="primary" value={String(completed.length)} label="Courses" />
              <StatCard icon="star-outline" color="amber" value="—" label="Note /5" />
              <StatCard icon="check-circle" color="dark" value="OK" label="Actif" />
            </>
          )}
        </View>

        {driver ? (
          <Section title="KYC & engins">
            <MenuRow
              icon="verified-user"
              iconBg="primary"
              label="Vérification d'identité"
              sub={receivedReviews.length > 0 ? "Profil complet · Recto, verso, selfie" : "Soumettez vos documents pour candidater"}
              badge={receivedReviews.length > 0 ? { label: "Validé", tone: "success" } : undefined}
              onPress={() => router.push("/verification" as any)}
            />
            <MenuRow
              icon="two-wheeler"
              iconBg="amber"
              label="Mes engins"
              sub={profile?.vehicles?.join(", ") ?? "À compléter"}
              onPress={() => Alert.alert("Engins", "La gestion des engins se fait depuis votre profil livreur.")}
              last
            />
          </Section>
        ) : null}

        <Section title="Activité">
          <MenuRow
            icon="local-shipping"
            iconBg="primary"
            label="Historique des courses"
            sub={`${completed.length} course${completed.length > 1 ? "s" : ""} terminée${completed.length > 1 ? "s" : ""}`}
            onPress={() => router.push("/history" as any)}
          />
          <MenuRow
            icon="star-outline"
            iconBg="primary"
            label="Mes avis"
            sub={driver ? `${receivedReviews.length} avis reçu${receivedReviews.length > 1 ? "s" : ""}` : "Évaluations envoyées"}
            onPress={() => router.push("/reviews" as any)}
          />
          {driver && profile?.referralCode ? (
            <MenuRow
              icon="group-add"
              iconBg="primary"
              label="Parrainage"
              sub={`Code ${profile.referralCode}`}
              onPress={() => router.push("/referrals" as any)}
            />
          ) : null}
          {!driver ? (
            <MenuRow
              icon="bookmark"
              iconBg="primary"
              label="Adresses enregistrées"
              sub="Vos lieux favoris"
              onPress={() => router.push("/(tabs)/addresses" as any)}
              last
            />
          ) : (
            <MenuRow
              icon="notifications-none"
              iconBg="primary"
              label="Notifications"
              sub={unread ? `${unread} nouvelle${unread > 1 ? "s" : ""}` : "À jour"}
              badge={unread > 0 ? { label: String(unread), tone: "danger" } : undefined}
              onPress={markNotificationsRead}
              last
            />
          )}
        </Section>

        <Pressable onPress={openLogoutConfirmation} style={({ pressed }) => [styles.logout, pressed && styles.pressed]}>
          <MaterialIcons name="logout" size={16} color="#B4232D" />
          <Text style={styles.logoutText}>Se déconnecter</Text>
        </Pressable>
      </ScrollView>

      <Modal visible={editorOpen} transparent animationType="slide" onRequestClose={() => setEditorOpen(false)}>
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setEditorOpen(false)} />
          <View style={styles.sheet}>
            <View style={styles.sheetGrip} />
            <Text style={styles.sheetTitle}>Modifier mon profil</Text>
            <Text style={styles.sheetSubtitle}>Vos informations sont contrôlées avant enregistrement.</Text>
            <Pressable onPress={() => void pickPhoto()} style={({ pressed }) => [styles.photoPicker, pressed && styles.pressed]}>
              <View style={styles.photoPickerIcon}>
                <MaterialIcons name="add-a-photo" size={22} color="#007B8B" />
              </View>
              <Text style={styles.photoPickerText}>{photoBase64 || photoUri ? "Changer la photo" : "Ajouter une photo"}</Text>
              <MaterialIcons name="chevron-right" size={16} color="#007B8B" />
            </Pressable>
            <Text style={styles.fieldLabel}>NOM COMPLET</Text>
            <TextInput
              value={fullName}
              onChangeText={(value) => { setFullName(sanitizeFullName(value, { preserveTrailingSeparator: true })); setError(""); }}
              maxLength={70}
              autoCapitalize="words"
              placeholder="Ex. Mariam ou Mariam Ouédraogo"
              placeholderTextColor="#B48753"
              style={[styles.input, error ? styles.inputError : null]}
            />
            {error ? <Text style={styles.error}>{error}</Text> : <Text style={styles.helper}>Un nom unique est accepté. Les séparateurs successifs sont retirés automatiquement.</Text>}
            <TikisButton label="Enregistrer les modifications" icon="save" onPress={() => void saveProfile()} loading={updateMutation.isPending} style={styles.saveButton} />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function StatCard({ icon, color, value, label }: { icon: React.ComponentProps<typeof MaterialIcons>["name"]; color: "primary" | "amber" | "dark"; value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <View style={[styles.statIcon, color === "amber" ? styles.statIconAmber : color === "dark" ? styles.statIconDark : null]}>
        <MaterialIcons name={icon} size={16} color={color === "primary" ? "#9A6201" : color === "amber" ? "#9A6200" : "#FFFFFF"} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionCard}>{children}</View>
    </View>
  );
}

function MenuRow({ icon, iconBg, label, sub, badge, onPress, last }: { icon: React.ComponentProps<typeof MaterialIcons>["name"]; iconBg: "primary" | "amber" | "dark"; label: string; sub?: string; badge?: { label: string; tone: "danger" | "success" }; onPress: () => void; last?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.menuRow, last && styles.menuRowLast, pressed && styles.pressed]}>
      <View style={[styles.menuIcon, iconBg === "amber" ? styles.menuIconAmber : iconBg === "dark" ? styles.menuIconDark : null]}>
        <MaterialIcons name={icon} size={16} color={iconBg === "primary" ? "#9A6201" : iconBg === "amber" ? "#9A6200" : "#FFFFFF"} />
      </View>
      <View style={styles.menuBody}>
        <Text style={styles.menuLabel}>{label}</Text>
        {sub ? <Text style={styles.menuSub}>{sub}</Text> : null}
      </View>
      {badge ? (
        <View style={[styles.menuBadge, badge.tone === "success" ? styles.menuBadgeSuccess : null]}>
          <Text style={[styles.menuBadgeText, badge.tone === "success" ? styles.menuBadgeTextSuccess : null]}>{badge.label}</Text>
        </View>
      ) : (
        <MaterialIcons name="chevron-right" size={16} color="#747474" />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#EEEDF3" },
  content: { padding: 16, paddingBottom: 40, gap: 12 },

  hero: { alignItems: "center", paddingVertical: 16, gap: 8 },
  avatarWrap: { position: "relative", padding: 4 },
  avatar: { width: 80, height: 80, borderRadius: 24, backgroundColor: "#9A6201", alignItems: "center", justifyContent: "center" },
  avatarDriver: { backgroundColor: "#111111" },
  avatarImage: { width: 80, height: 80, borderRadius: 24 },
  avatarText: { color: "#FFFFFF", fontSize: 26, fontWeight: "700" },
  verifiedBadge: { position: "absolute", top: 0, right: 0, width: 22, height: 22, borderRadius: 11, backgroundColor: "#167A55", alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#EEEDF3" },
  avatarEdit: { position: "absolute", right: -2, bottom: -2, width: 28, height: 28, borderRadius: 14, backgroundColor: "#111111", alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#FFFFFF" },
  name: { color: "#111111", fontSize: 19, fontWeight: "700" },
  phoneText: { color: "#666666", fontSize: 12 },
  rolePill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99, backgroundColor: "#F8F0E5", marginTop: 2 },
  rolePillDriver: { backgroundColor: "#FEF6E2" },
  rolePillText: { color: "#9A6201", fontSize: 10, fontWeight: "700", letterSpacing: 0.4 },
  rolePillTextDriver: { color: "#9A6200" },

  stats: { flexDirection: "row", gap: 8 },
  stat: { flex: 1, backgroundColor: "#FFFFFF", borderRadius: 12, paddingVertical: 12, paddingHorizontal: 8, alignItems: "center", gap: 4 },
  statIcon: { width: 32, height: 32, borderRadius: 8, backgroundColor: "#F8F0E5", alignItems: "center", justifyContent: "center" },
  statIconAmber: { backgroundColor: "#FEF6E2" },
  statIconDark: { backgroundColor: "#111111" },
  statValue: { color: "#111111", fontSize: 16, fontWeight: "700", marginTop: 4 },
  statLabel: { color: "#747474", fontSize: 9, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase" },

  section: { gap: 6 },
  sectionTitle: { color: "#747474", fontSize: 10, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase", paddingHorizontal: 2 },
  sectionCard: { backgroundColor: "#FFFFFF", borderRadius: 12, overflow: "hidden" },
  menuRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: "#ECECEC" },
  menuRowLast: { borderBottomWidth: 0 },
  menuIcon: { width: 32, height: 32, borderRadius: 8, backgroundColor: "#F8F0E5", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  menuIconAmber: { backgroundColor: "#FEF6E2" },
  menuIconDark: { backgroundColor: "#111111" },
  menuBody: { flex: 1, minWidth: 0 },
  menuLabel: { color: "#111111", fontSize: 13, fontWeight: "600" },
  menuSub: { color: "#666666", fontSize: 10, marginTop: 1 },
  menuBadge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 99, backgroundColor: "#B4232D" },
  menuBadgeSuccess: { backgroundColor: "#F8F0E5" },
  menuBadgeText: { color: "#FFFFFF", fontSize: 9, fontWeight: "700" },
  menuBadgeTextSuccess: { color: "#167A55" },

  logout: { flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "center", backgroundColor: "#FFFFFF", borderRadius: 12, paddingVertical: 14, marginTop: 4 },
  logoutText: { color: "#B4232D", fontSize: 13, fontWeight: "600" },

  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.42)" },
  sheet: { backgroundColor: "#FFFFFF", borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, paddingTop: 8, paddingBottom: 24 },
  sheetGrip: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#D5D5DC", alignSelf: "center", marginBottom: 14 },
  sheetTitle: { color: "#111111", fontSize: 17, fontWeight: "600" },
  sheetSubtitle: { color: "#666666", fontSize: 12, marginTop: 4 },

  photoPicker: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, backgroundColor: "#F8F0E5", borderRadius: 10, marginTop: 14 },
  photoPickerIcon: { width: 48, height: 48, borderRadius: 12, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  photoPickerText: { color: "#9A6201", fontSize: 12, fontWeight: "600", flex: 1 },

  fieldLabel: { color: "#747474", fontSize: 10, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase", marginTop: 16, marginBottom: 6 },
  input: { backgroundColor: "#F7EFE5", borderRadius: 9, borderWidth: 1, borderColor: "#E5D2B9", paddingHorizontal: 12, paddingVertical: 12, color: "#9A6201", fontSize: 13, fontWeight: "500" },
  inputError: { borderWidth: 1, borderColor: "#B4232D" },
  helper: { color: "#747474", fontSize: 10, marginTop: 4 },
  error: { color: "#B4232D", fontSize: 11, fontWeight: "600", marginTop: 4 },
  saveButton: { marginTop: 18 },

  pressed: { opacity: 0.7 },
});
