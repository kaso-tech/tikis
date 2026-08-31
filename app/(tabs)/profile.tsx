import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useThemeColors } from "@/lib/use-theme-colors";
import { SafeAreaView } from "react-native-safe-area-context";
import { TikisButton } from "@/components/tikis/ui";
import { haptic } from "@/lib/haptics";
import { useTikisLogout } from "@/lib/tikis-logout";
import { sanitizeFullName, validateFullName } from "@/lib/registration-rules";
import { clearProfileCover, loadProfileCover, saveProfileCover } from "@/lib/profile-cover";
import { getApiBaseUrl } from "@/constants/oauth";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";
import { availableWalletBalance, formatMoney } from "@/shared/tikis-domain";

const COVER_HEIGHT = 200;
const COVER_ASPECT = [21, 9] as [number, number];

export default function ProfileScreen() {
  const { colors: theme, isDark } = useThemeColors();
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
  const [coverBase64, setCoverBase64] = useState<string | undefined>();
  const [coverMime, setCoverMime] = useState<"image/jpeg" | "image/png" | "image/webp" | undefined>();

  const driver = role === "driver";
  const name = profile?.fullName ?? (driver ? "Antoine Kaboré" : "Aïcha Traoré");
  const initials = name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  const photoUri = profile?.photoUrl ? `${getApiBaseUrl()}${profile.photoUrl}` : undefined;
  const coverUri = coverBase64 ? `data:${coverMime ?? "image/jpeg"};base64,${coverBase64}` : undefined;
  const completed = (deliveriesQuery.data ?? []).filter((delivery) => delivery.status === "completed");
  const receivedReviews = useMemo(() => driver ? reviewsQuery.data ?? [] : [], [driver, reviewsQuery.data]);
  const unread = notifications.filter((item) => !item.read).length;
  const driverWallet = walletQuery.data?.wallet;
  const availableBalance = driverWallet ? availableWalletBalance(driverWallet) : 0;
  const senderDelivered = (deliveriesQuery.data ?? []).filter((delivery) => delivery.status === "completed").length;
  const memberSince = useMemo(() => {
    const joinedAt = (profile as { joinedAt?: string | Date | null } | null)?.joinedAt;
    if (!joinedAt) return "—";
    try {
      return new Date(joinedAt).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
    } catch {
      return "—";
    }
  }, [profile]);

  const driverRating = useMemo(() => {
    if (!driver || receivedReviews.length === 0) return null;
    const sum = receivedReviews.reduce((acc, review) => acc + review.rating, 0);
    return Number((sum / receivedReviews.length).toFixed(1));
  }, [driver, receivedReviews]);

  useEffect(() => {
    if (!profile?.phone) return;
    let active = true;
    (async () => {
      const stored = await loadProfileCover(profile.phone);
      if (!active) return;
      if (stored) {
        setCoverBase64(stored.base64);
        setCoverMime(stored.mime);
      }
    })();
    return () => { active = false; };
  }, [profile?.phone]);

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

  async function pickCover() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: COVER_ASPECT, quality: 0.6, base64: true });
    if (result.canceled || !result.assets[0]?.base64) return;
    const mime = result.assets[0].mimeType;
    if (mime !== "image/jpeg" && mime !== "image/png" && mime !== "image/webp") {
      Alert.alert("Format non supporté", "Choisissez une image JPEG, PNG ou WebP pour la couverture.");
      return;
    }
    if (!profile?.phone) return;
    setCoverBase64(result.assets[0].base64);
    setCoverMime(mime);
    await saveProfileCover(profile.phone, { base64: result.assets[0].base64, mime, updatedAt: new Date().toISOString() });
    haptic.success();
  }

  async function removeCover() {
    if (!profile?.phone) return;
    Alert.alert("Retirer la couverture ?", "La bannière reviendra au style par défaut Tikis.", [
      { text: "Annuler", style: "cancel" },
      { text: "Retirer", style: "destructive", onPress: async () => {
        await clearProfileCover(profile.phone);
        setCoverBase64(undefined);
        setCoverMime(undefined);
        haptic.success();
      } },
    ]);
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
        <View style={styles.coverWrap}>
          <View style={[styles.cover, isDark && styles.coverDark]}>
            {coverUri ? (
              <Image source={{ uri: coverUri }} style={styles.coverImage} resizeMode="cover" />
            ) : (
              <View style={styles.coverPattern}>
                <View style={styles.coverOrbPrimary} />
                <View style={styles.coverOrbSecondary} />
                <View style={styles.coverOrbTertiary} />
              </View>
            )}
            <View style={styles.coverOverlay} pointerEvents="none" />
          </View>
          <View style={styles.coverActions}>
            {coverUri ? (
              <CoverAction icon="delete-outline" label="Retirer" onPress={() => void removeCover()} />
            ) : null}
            <CoverAction icon="add-a-photo" label={coverUri ? "Changer" : "Ajouter une couverture"} onPress={() => void pickCover()} primary />
          </View>
        </View>

        <View style={[styles.identityCard, isDark && { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={styles.avatarRow}>
            <Pressable onPress={openEditor} style={({ pressed }) => [styles.avatarWrap, pressed && styles.pressed]} accessibilityLabel="Modifier la photo de profil">
              {photoUri ? (
                <Image source={{ uri: photoUri }} style={styles.avatarImage} />
              ) : (
                <View style={[styles.avatar, driver ? styles.avatarDriver : styles.avatarSender]}>
                  <Text style={styles.avatarText}>{initials}</Text>
                </View>
              )}
              <View style={styles.avatarEdit}>
                <MaterialIcons name="photo-camera" size={12} color="#FFFFFF" />
              </View>
            </Pressable>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.name, isDark && { color: theme.foreground }]} numberOfLines={1}>{name}</Text>
              <Text style={[styles.phoneText, isDark && { color: theme.muted }]} numberOfLines={1}>{profile?.phone ?? "+226 70 00 00 00"}</Text>
              <View style={[styles.rolePill, driver ? styles.rolePillDriver : styles.rolePillSender]}>
                <MaterialIcons name={driver ? "two-wheeler" : "inventory-2"} size={11} color={driver ? "#9A6200" : "#007B8B"} />
                <Text style={[styles.rolePillText, driver ? styles.rolePillTextDriver : styles.rolePillTextSender]}>
                  {driver ? "LIVREUR VÉRIFIÉ" : "EXPÉDITEUR VÉRIFIÉ"}
                </Text>
              </View>
            </View>
            <Pressable onPress={openEditor} style={({ pressed }) => [styles.editButton, pressed && styles.pressed]} accessibilityLabel="Modifier le profil">
              <MaterialIcons name="edit" size={14} color="#9A6201" />
              <Text style={styles.editButtonText}>Modifier</Text>
            </Pressable>
          </View>

          {driver ? (
            <View style={styles.ratingStrip}>
              <View style={styles.ratingStripItem}>
                <MaterialIcons name="star" size={16} color="#9A6200" />
                <Text style={[styles.ratingValue, isDark && { color: theme.foreground }]}>{driverRating ?? "—"}</Text>
                <Text style={styles.ratingLabel}>Note</Text>
              </View>
              <View style={styles.ratingDivider} />
              <View style={styles.ratingStripItem}>
                <MaterialIcons name="local-shipping" size={16} color="#007B8B" />
                <Text style={[styles.ratingValue, isDark && { color: theme.foreground }]}>{completed.length}</Text>
                <Text style={styles.ratingLabel}>Courses</Text>
              </View>
              <View style={styles.ratingDivider} />
              <View style={styles.ratingStripItem}>
                <MaterialIcons name="account-balance-wallet" size={16} color="#167A55" />
                <Text style={[styles.ratingValue, isDark && { color: theme.foreground }]} numberOfLines={1}>{formatMoney(availableBalance)}</Text>
                <Text style={styles.ratingLabel}>Wallet</Text>
              </View>
              <View style={styles.ratingDivider} />
              <View style={styles.ratingStripItem}>
                <MaterialIcons name="event" size={16} color="#747474" />
                <Text style={[styles.ratingValue, isDark && { color: theme.foreground }]} numberOfLines={1}>{memberSince}</Text>
                <Text style={styles.ratingLabel}>Membre</Text>
              </View>
            </View>
          ) : (
            <View style={styles.ratingStrip}>
              <View style={styles.ratingStripItem}>
                <MaterialIcons name="local-shipping" size={16} color="#007B8B" />
                <Text style={[styles.ratingValue, isDark && { color: theme.foreground }]}>{senderDelivered}</Text>
                <Text style={styles.ratingLabel}>Envoyées</Text>
              </View>
              <View style={styles.ratingDivider} />
              <View style={styles.ratingStripItem}>
                <MaterialIcons name="check-circle" size={16} color="#167A55" />
                <Text style={[styles.ratingValue, isDark && { color: theme.foreground }]}>OK</Text>
                <Text style={styles.ratingLabel}>Compte</Text>
              </View>
              <View style={styles.ratingDivider} />
              <View style={styles.ratingStripItem}>
                <MaterialIcons name="event" size={16} color="#747474" />
                <Text style={[styles.ratingValue, isDark && { color: theme.foreground }]} numberOfLines={1}>{memberSince}</Text>
                <Text style={styles.ratingLabel}>Membre</Text>
              </View>
            </View>
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
          <View style={[styles.sheet, isDark && { backgroundColor: theme.surface }]}>
            <View style={styles.sheetGrip} />
            <Text style={[styles.sheetTitle, isDark && { color: theme.foreground }]}>Modifier mon profil</Text>
            <Text style={[styles.sheetSubtitle, isDark && { color: theme.muted }]}>Vos informations sont contrôlées avant enregistrement.</Text>
            <Pressable onPress={() => void pickPhoto()} style={({ pressed }) => [styles.photoPicker, pressed && styles.pressed]}>
              <View style={styles.photoPickerIcon}>
                <MaterialIcons name="add-a-photo" size={22} color="#9A6201" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.photoPickerText}>{photoBase64 || photoUri ? "Changer la photo" : "Ajouter une photo"}</Text>
                <Text style={styles.photoPickerSub}>Format carré, JPEG/PNG/WebP</Text>
              </View>
              <MaterialIcons name="chevron-right" size={16} color="#9A6201" />
            </Pressable>
            <Text style={[styles.fieldLabel, isDark && { color: theme.muted }]}>NOM COMPLET</Text>
            <TextInput
              value={fullName}
              onChangeText={(value) => { setFullName(sanitizeFullName(value, { preserveTrailingSeparator: true })); setError(""); }}
              maxLength={70}
              autoCapitalize="words"
              placeholder="Ex. Mariam ou Mariam Ouédraogo"
              placeholderTextColor="#B48753"
              style={[styles.input, error ? styles.inputError : null, isDark && { backgroundColor: theme.background, color: theme.foreground, borderColor: theme.border }]}
            />
            {error ? <Text style={styles.error}>{error}</Text> : <Text style={[styles.helper, isDark && { color: theme.muted }]}>Un nom unique est accepté. Les séparateurs successifs sont retirés automatiquement.</Text>}
            <TikisButton label="Enregistrer les modifications" icon="save" onPress={() => void saveProfile()} loading={updateMutation.isPending} style={styles.saveButton} />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function CoverAction({ icon, label, onPress, primary }: { icon: React.ComponentProps<typeof MaterialIcons>["name"]; label: string; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.coverAction, primary && styles.coverActionPrimary, pressed && styles.pressed]} accessibilityLabel={label}>
      <MaterialIcons name={icon} size={13} color={primary ? "#FFFFFF" : "#FFFFFF"} />
      <Text style={styles.coverActionText}>{label}</Text>
    </Pressable>
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
  content: { paddingBottom: 40, gap: 12 },

  coverWrap: { position: "relative", marginBottom: -36 },
  cover: { width: "100%", height: COVER_HEIGHT, backgroundColor: "#9A6201", overflow: "hidden", position: "relative" },
  coverDark: { backgroundColor: "#1F1206" },
  coverImage: { width: "100%", height: "100%" },
  coverPattern: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#9A6201" },
  coverOrbPrimary: { position: "absolute", width: 260, height: 260, borderRadius: 130, top: -90, right: -60, backgroundColor: "#D7A447", opacity: 0.45 },
  coverOrbSecondary: { position: "absolute", width: 180, height: 180, borderRadius: 90, bottom: -50, left: -40, backgroundColor: "#007B8B", opacity: 0.25 },
  coverOrbTertiary: { position: "absolute", width: 120, height: 120, borderRadius: 60, top: 60, left: 80, backgroundColor: "#FFFFFF", opacity: 0.08 },
  coverOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.10)" },
  coverActions: { position: "absolute", bottom: 12, right: 12, flexDirection: "row", gap: 6 },
  coverAction: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 99, backgroundColor: "rgba(0,0,0,0.35)" },
  coverActionPrimary: { backgroundColor: "#9A6201" },
  coverActionText: { color: "#FFFFFF", fontSize: 10, fontWeight: "700", letterSpacing: 0.3 },

  identityCard: { marginHorizontal: 14, backgroundColor: "#FFFFFF", borderRadius: 14, padding: 14, paddingTop: 0, gap: 12, borderWidth: 1, borderColor: "#ECECEC" },
  avatarRow: { flexDirection: "row", alignItems: "flex-end", gap: 12, marginTop: -36 },
  avatarWrap: { position: "relative" },
  avatar: { width: 76, height: 76, borderRadius: 38, backgroundColor: "#9A6201", alignItems: "center", justifyContent: "center", borderWidth: 4, borderColor: "#FFFFFF" },
  avatarDriver: { backgroundColor: "#111111" },
  avatarSender: { backgroundColor: "#007B8B" },
  avatarImage: { width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: "#FFFFFF" },
  avatarText: { color: "#FFFFFF", fontSize: 24, fontWeight: "700" },
  avatarEdit: { position: "absolute", right: -2, bottom: -2, width: 24, height: 24, borderRadius: 12, backgroundColor: "#9A6201", alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#FFFFFF" },

  name: { color: "#111111", fontSize: 18, fontWeight: "700", marginTop: 6 },
  phoneText: { color: "#666666", fontSize: 12, marginTop: 2 },
  rolePill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99, backgroundColor: "#F8F0E5", marginTop: 6, alignSelf: "flex-start" },
  rolePillDriver: { backgroundColor: "#FEF6E2" },
  rolePillSender: { backgroundColor: "#E2F3F4" },
  rolePillText: { color: "#9A6201", fontSize: 9, fontWeight: "700", letterSpacing: 0.4 },
  rolePillTextDriver: { color: "#9A6200" },
  rolePillTextSender: { color: "#007B8B" },

  editButton: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 7, backgroundColor: "#F7EFE5", borderWidth: 1, borderColor: "#E5D2B9", alignSelf: "flex-start" },
  editButtonText: { color: "#9A6201", fontSize: 11, fontWeight: "700" },

  ratingStrip: { flexDirection: "row", alignItems: "center", backgroundColor: "#FAF7F2", borderRadius: 10, paddingVertical: 10, paddingHorizontal: 4, gap: 4 },
  ratingStripItem: { flex: 1, alignItems: "center", gap: 2, paddingHorizontal: 4 },
  ratingValue: { color: "#111111", fontSize: 12, fontWeight: "700", marginTop: 1 },
  ratingLabel: { color: "#747474", fontSize: 9, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase" },
  ratingDivider: { width: 1, alignSelf: "stretch", backgroundColor: "#ECECEC", marginVertical: 4 },

  section: { gap: 6, paddingHorizontal: 14 },
  sectionTitle: { color: "#747474", fontSize: 10, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase", paddingHorizontal: 2 },
  sectionCard: { backgroundColor: "#FFFFFF", borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: "#ECECEC" },
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

  logout: { flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "center", backgroundColor: "#FFFFFF", borderRadius: 12, paddingVertical: 14, marginTop: 4, marginHorizontal: 14, borderWidth: 1, borderColor: "#ECECEC" },
  logoutText: { color: "#B4232D", fontSize: 13, fontWeight: "600" },

  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.42)" },
  sheet: { backgroundColor: "#FFFFFF", borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, paddingTop: 8, paddingBottom: 24 },
  sheetGrip: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#D5D5DC", alignSelf: "center", marginBottom: 14 },
  sheetTitle: { color: "#111111", fontSize: 17, fontWeight: "600" },
  sheetSubtitle: { color: "#666666", fontSize: 12, marginTop: 4 },

  photoPicker: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, backgroundColor: "#F8F0E5", borderRadius: 10, marginTop: 14 },
  photoPickerIcon: { width: 48, height: 48, borderRadius: 12, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  photoPickerText: { color: "#9A6201", fontSize: 12, fontWeight: "600" },
  photoPickerSub: { color: "#747474", fontSize: 10, marginTop: 2 },

  fieldLabel: { color: "#747474", fontSize: 10, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase", marginTop: 16, marginBottom: 6 },
  input: { backgroundColor: "#F7EFE5", borderRadius: 9, borderWidth: 1, borderColor: "#E5D2B9", paddingHorizontal: 12, paddingVertical: 12, color: "#9A6201", fontSize: 13, fontWeight: "500" },
  inputError: { borderWidth: 1, borderColor: "#B4232D" },
  helper: { color: "#747474", fontSize: 10, marginTop: 4 },
  error: { color: "#B4232D", fontSize: 11, fontWeight: "600", marginTop: 4 },
  saveButton: { marginTop: 18 },

  pressed: { opacity: 0.7 },
});
