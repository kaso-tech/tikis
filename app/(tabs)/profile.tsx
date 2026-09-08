import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useThemeColors } from "@/lib/use-theme-colors";
import { SafeAreaView } from "react-native-safe-area-context";
import { TikisButton } from "@/components/tikis/ui";
import { LoyaltyProgress } from "@/components/tikis/loyalty-progress";
import { haptic } from "@/lib/haptics";
import { useTikisLogout } from "@/lib/tikis-logout";
import { countryFlagEmoji, sanitizeFullName, validateFullName } from "@/lib/registration-rules";
import { getApiBaseUrl } from "@/constants/oauth";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";
import { availableWalletBalance, formatMoney } from "@/shared/tikis-domain";

const COVER_HEIGHT = 200;

export default function ProfileScreen() {
  const { colors: theme, isDark } = useThemeColors();
  const { role, profile, updateProfile } = useTikisStore();
  const { openLogoutConfirmation } = useTikisLogout();
  const updateMutation = trpc.profiles.update.useMutation();
  const updateVehiclesMutation = trpc.profiles.updateVehicles.useMutation({
    onSuccess: (saved) => {
      updateProfile(saved as any);
      haptic.success();
    },
    onError: (cause) => {
      Alert.alert("Engins", cause.message);
    },
  });
  const deliveriesQuery = trpc.deliveries.list.useQuery(undefined, { enabled: Boolean(profile?.phone) });
  const reviewsQuery = trpc.reviews.list.useQuery(undefined, { enabled: Boolean(profile?.phone) });
  const walletQuery = trpc.wallet.snapshot.useQuery(undefined, { enabled: role === "driver" && Boolean(profile?.phone) });
  const [editorOpen, setEditorOpen] = useState(false);
  const [fullName, setFullName] = useState(profile?.fullName ?? "");
  const [countryEditorOpen, setCountryEditorOpen] = useState(false);
  const [cityEditorOpen, setCityEditorOpen] = useState(false);
  const [citySearch, setCitySearch] = useState("");
  const [locationError, setLocationError] = useState("");
  const [locationSaving, setLocationSaving] = useState<"country" | "city" | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const countriesQuery = trpc.geography.countries.useQuery();
  const citySearchQuery = trpc.geography.searchCities.useQuery(
    { query: citySearch, countryCode: profile?.country ?? "" },
    { enabled: cityEditorOpen && citySearch.trim().length >= 2 && Boolean(profile?.country) },
  );
  const requestDeletionMutation = trpc.profiles.requestDeletion.useMutation();
  const [photoBase64, setPhotoBase64] = useState<string | undefined>();
  const [photoMime, setPhotoMime] = useState<"image/jpeg" | "image/png" | "image/webp" | undefined>();
  const [error, setError] = useState("");
  const [vehiclesPickerOpen, setVehiclesPickerOpen] = useState(false);

  const driver = role === "driver";
  const name = profile?.fullName ?? (driver ? "Antoine Kaboré" : "Aïcha Traoré");
  const initials = name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  const photoUri = profile?.photoUrl ? `${getApiBaseUrl()}${profile.photoUrl}` : undefined;
  const completed = (deliveriesQuery.data ?? []).filter((delivery) => delivery.status === "completed");
  const receivedReviews = useMemo(() => driver ? reviewsQuery.data ?? [] : [], [driver, reviewsQuery.data]);
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

  async function selectCountry(countryId: string) {
    if (!profile) return;
    setLocationError("");
    setLocationSaving("country");
    try {
      const saved = await updateMutation.mutateAsync({ phone: profile.phone, otp: "730512", country: countryId });
      updateProfile({ country: saved.country });
      setCountryEditorOpen(false);
      haptic.success();
    } catch (cause) {
      setLocationError(cause instanceof Error ? cause.message : "La mise à jour a échoué.");
      haptic.error();
    } finally {
      setLocationSaving(null);
    }
  }

  async function selectCity(city: string) {
    if (!profile) return;
    setLocationError("");
    setLocationSaving("city");
    try {
      const saved = await updateMutation.mutateAsync({ phone: profile.phone, otp: "730512", city });
      updateProfile({ city: saved.city });
      setCityEditorOpen(false);
      setCitySearch("");
      haptic.success();
    } catch (cause) {
      setLocationError(cause instanceof Error ? cause.message : "La mise à jour a échoué.");
      haptic.error();
    } finally {
      setLocationSaving(null);
    }
  }

  async function confirmAccountDeletion() {
    setDeleteError("");
    try {
      const saved = await requestDeletionMutation.mutateAsync();
      updateProfile({ deletionRequestedAt: saved.deletionRequestedAt, deletionScheduledAt: saved.deletionScheduledAt });
      setDeleteConfirmOpen(false);
      haptic.success();
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : "La demande n’a pas pu être enregistrée.");
      haptic.error();
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* HERO (style 2 — sans cover) */}
        <View style={[styles.hero, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={styles.heroBand} />
          <Pressable onPress={openEditor} style={({ pressed }) => [styles.heroAvatarWrap, pressed && styles.pressed]} accessibilityLabel="Modifier la photo de profil">
            {photoUri ? (
              <Image source={{ uri: photoUri }} style={styles.heroAvatarImage} />
            ) : (
              <View style={[styles.heroAvatar, driver ? styles.avatarDriver : styles.avatarSender]}>
                <Text style={styles.heroAvatarText}>{initials}</Text>
              </View>
            )}
            <View style={[styles.heroAvatarEdit, { backgroundColor: theme.primary }]}>
              <MaterialIcons name="photo-camera" size={12} color="#FFFFFF" />
            </View>
          </Pressable>
          <Text style={[styles.heroName, { color: theme.foreground }]} numberOfLines={1}>{name}</Text>
          <Text style={[styles.heroPhone, { color: theme.muted }]} numberOfLines={1}>{profile?.phone ?? ""}</Text>
          <View style={styles.heroBadges}>
            <View style={[styles.badge, { backgroundColor: isDark ? theme.pressed : "#F7EFE5" }]}>
              <MaterialIcons name={driver ? "two-wheeler" : "inventory-2"} size={11} color={theme.primary} />
              <Text style={[styles.badgeText, { color: theme.primary }]}>
                {driver ? `Livreur · ${(profile?.vehicles ?? []).join(" · ") || "Moto"}` : "Expéditeur"}
              </Text>
            </View>
            <View style={[styles.badge, { backgroundColor: isDark ? theme.tealSoft ?? theme.pressed : "#E5F6F7" }]}>
              <MaterialIcons name="verified" size={11} color={theme.success} />
              <Text style={[styles.badgeText, { color: theme.success }]}>Identité vérifiée</Text>
            </View>
          </View>
        </View>

        {/* STATS (3 KPIs) */}
        <View style={styles.statsRow}>
          {driver ? (
            <>
              <StatBox label="Note" value={driverRating ? driverRating.toString() : "—"} color={theme.primary} />
              <StatBox label="Courses" value={completed.length.toString()} color={theme.success} />
              <StatBox label="Ancienneté" value={memberSince} color={theme.muted} small />
            </>
          ) : (
            <>
              <StatBox label="Envoyées" value={senderDelivered.toString()} color={theme.success} />
              <StatBox label="Membre" value={memberSince} color={theme.muted} small />
              <StatBox label="Compte" value="OK" color={theme.success} />
            </>
          )}
        </View>

        {/* QUICK CTAs */}
        <View style={styles.ctaRow}>
          <CtaTile
            icon="lock-outline"
            label="Sessions"
            meta="2 appareils"
            onPress={() => router.push("/sessions" as any)}
          />
          {driver && profile?.referralCode ? (
            <CtaTile
              icon="group-add"
              label="Parrainage"
              meta={`Code ${profile.referralCode}`}
              onPress={() => router.push("/referrals" as any)}
            />
          ) : (
            <CtaTile
              icon="bookmark"
              label="Adresses"
              meta="Vos lieux favoris"
              onPress={() => router.push("/(tabs)/addresses" as any)}
            />
          )}
        </View>

        {/* CARD: Identité */}
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={styles.cardHeader}>
            <View style={[styles.cardEmoji, { backgroundColor: isDark ? theme.pressed : "#F7EFE5" }]}>
              <Text style={styles.cardEmojiText}>👤</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.cardTitle, { color: theme.foreground }]}>Identité</Text>
              <Text style={[styles.cardSubtitle, { color: theme.muted }]}>Vos informations de profil</Text>
            </View>
            <Pressable onPress={openEditor} hitSlop={8} style={({ pressed }) => [styles.cardEditBtn, pressed && { opacity: 0.7 }]} accessibilityLabel="Modifier le profil">
              <MaterialIcons name="edit" size={14} color={theme.primary} />
            </Pressable>
          </View>
          <View style={styles.cardBody}>
            <InfoRow label="Nom complet" value={name} theme={theme} />
            <InfoRow label="Téléphone" value={profile?.phone ?? "—"} theme={theme} />
            <InfoRow label="E-mail" value={(profile as { email?: string | null } | null)?.email ?? "Non renseigné"} theme={theme} />
            <InfoRow label="Ville" value={profile?.city ?? "Non renseignée"} theme={theme} />
            <InfoRow
              label="Pays"
              value={countriesQuery.data?.find((c) => c.id === profile?.country)?.name ?? "Non renseigné"}
              theme={theme}
              last
            />
          </View>
        </View>

        {/* CARD: Activité (driver uniquement — wallet + gains + fidélité) */}
        {driver ? (
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <View style={styles.cardHeader}>
              <View style={[styles.cardEmoji, { backgroundColor: isDark ? theme.pressed : "#F7EFE5" }]}>
                <Text style={styles.cardEmojiText}>📊</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.cardTitle, { color: theme.foreground }]}>Activité</Text>
                <Text style={[styles.cardSubtitle, { color: theme.muted }]}>Vos performances sur Tikis</Text>
              </View>
            </View>
            <View style={styles.cardBody}>
              <InfoRow label="Gains totaux" value={formatMoney(availableBalance)} theme={theme} />
              <InfoRow label="Courses terminées" value={completed.length.toString()} theme={theme} />
              <InfoRow label="Avis reçus" value={`${receivedReviews.length}`} theme={theme} last />
            </View>
          </View>
        ) : null}

        {/* CARD: KYC + engins (driver) */}
        {driver ? (
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <View style={styles.cardHeader}>
              <View style={[styles.cardEmoji, { backgroundColor: isDark ? theme.pressed : "#F7EFE5" }]}>
                <Text style={styles.cardEmojiText}>🛡️</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.cardTitle, { color: theme.foreground }]}>KYC &amp; engins</Text>
                <Text style={[styles.cardSubtitle, { color: theme.muted }]}>Documents et véhicules</Text>
              </View>
            </View>
            <View style={styles.cardBody}>
              <Pressable
                onPress={() => router.push("/verification" as any)}
                style={({ pressed }) => [styles.actionRow, pressed && { backgroundColor: theme.pressed }]}
              >
                <View style={[styles.actionIcon, { backgroundColor: theme.background }]}>
                  <MaterialIcons name="verified-user" size={16} color={theme.primary} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.actionText, { color: theme.foreground }]}>Vérification d'identité</Text>
                  <Text style={[styles.actionMeta, { color: theme.muted }]} numberOfLines={1}>
                    {receivedReviews.length > 0 ? "Profil complet · Recto, verso, selfie" : "Soumettez vos documents pour candidater"}
                  </Text>
                </View>
                {receivedReviews.length > 0 ? (
                  <View style={[styles.menuBadge, { backgroundColor: isDark ? theme.pressed : "#E6F4ED" }]}>
                    <Text style={[styles.menuBadgeText, { color: theme.success }]}>Validé</Text>
                  </View>
                ) : (
                  <MaterialIcons name="chevron-right" size={16} color={theme.muted} />
                )}
              </Pressable>
              <Pressable
                onPress={() => setVehiclesPickerOpen(true)}
                style={({ pressed }) => [styles.actionRow, styles.actionRowLast, pressed && { backgroundColor: theme.pressed }]}
              >
                <View style={[styles.actionIcon, { backgroundColor: theme.background }]}>
                  <MaterialIcons name="two-wheeler" size={16} color={theme.primary} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.actionText, { color: theme.foreground }]}>Mes engins</Text>
                  <Text style={[styles.actionMeta, { color: theme.muted }]} numberOfLines={1}>
                    {profile?.vehicles?.length ? profile.vehicles.join(", ") : "Sélectionnez vos engins"}
                  </Text>
                </View>
                <MaterialIcons name="chevron-right" size={16} color={theme.muted} />
              </Pressable>
            </View>
          </View>
        ) : null}

        {/* CARD: Historique + Avis (toujours) */}
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={styles.cardHeader}>
            <View style={[styles.cardEmoji, { backgroundColor: isDark ? theme.pressed : "#F7EFE5" }]}>
              <Text style={styles.cardEmojiText}>📋</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.cardTitle, { color: theme.foreground }]}>Activité</Text>
              <Text style={[styles.cardSubtitle, { color: theme.muted }]}>Courses et avis</Text>
            </View>
          </View>
          <View style={styles.cardBody}>
            <Pressable
              onPress={() => router.push("/history" as any)}
              style={({ pressed }) => [styles.actionRow, pressed && { backgroundColor: theme.pressed }]}
            >
              <View style={[styles.actionIcon, { backgroundColor: theme.background }]}>
                <MaterialIcons name="local-shipping" size={16} color={theme.primary} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.actionText, { color: theme.foreground }]}>Historique des courses</Text>
                <Text style={[styles.actionMeta, { color: theme.muted }]} numberOfLines={1}>
                  {`${completed.length} course${completed.length > 1 ? "s" : ""} terminée${completed.length > 1 ? "s" : ""}`}
                </Text>
              </View>
              <MaterialIcons name="chevron-right" size={16} color={theme.muted} />
            </Pressable>
            <Pressable
              onPress={() => router.push("/reviews" as any)}
              style={({ pressed }) => [styles.actionRow, styles.actionRowLast, pressed && { backgroundColor: theme.pressed }]}
            >
              <View style={[styles.actionIcon, { backgroundColor: theme.background }]}>
                <MaterialIcons name="star-outline" size={16} color={theme.primary} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.actionText, { color: theme.foreground }]}>Mes avis</Text>
                <Text style={[styles.actionMeta, { color: theme.muted }]} numberOfLines={1}>
                  {driver ? `${receivedReviews.length} avis reçu${receivedReviews.length > 1 ? "s" : ""}` : "Évaluations envoyées"}
                </Text>
              </View>
              <MaterialIcons name="chevron-right" size={16} color={theme.muted} />
            </Pressable>
          </View>
        </View>

        {/* CARD: Fidélité (driver) */}
        {driver ? (
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <View style={styles.cardHeader}>
              <View style={[styles.cardEmoji, { backgroundColor: isDark ? theme.pressed : "#F7EFE5" }]}>
                <Text style={styles.cardEmojiText}>🎁</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.cardTitle, { color: theme.foreground }]}>Programme de fidélité</Text>
                <Text style={[styles.cardSubtitle, { color: theme.muted }]}>Bonus et progression</Text>
              </View>
            </View>
            <View style={styles.cardBody}>
              <LoyaltyProgress phone={profile?.phone ?? null} />
            </View>
          </View>
        ) : null}

        {/* CARD: Préférences */}
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Pressable
            onPress={() => router.push("/sessions" as any)}
            style={({ pressed }) => [styles.actionRow, pressed && { backgroundColor: theme.pressed }]}
          >
            <View style={[styles.actionIcon, { backgroundColor: theme.background }]}>
              <MaterialIcons name="devices" size={16} color={theme.primary} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.actionText, { color: theme.foreground }]}>Sessions actives</Text>
              <Text style={[styles.actionMeta, { color: theme.muted }]} numberOfLines={1}>Tous vos appareils connectés</Text>
            </View>
            <MaterialIcons name="chevron-right" size={16} color={theme.muted} />
          </Pressable>
          <Pressable
            onPress={() => router.push("/help" as any)}
            style={({ pressed }) => [styles.actionRow, pressed && { backgroundColor: theme.pressed }]}
          >
            <View style={[styles.actionIcon, { backgroundColor: theme.background }]}>
              <MaterialIcons name="help-outline" size={16} color={theme.primary} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.actionText, { color: theme.foreground }]}>Aide &amp; support</Text>
            </View>
            <MaterialIcons name="chevron-right" size={16} color={theme.muted} />
          </Pressable>
          <Pressable
            onPress={() => router.push("/legal" as any)}
            style={({ pressed }) => [styles.actionRow, pressed && { backgroundColor: theme.pressed }]}
          >
            <View style={[styles.actionIcon, { backgroundColor: theme.background }]}>
              <MaterialIcons name="description" size={16} color={theme.primary} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.actionText, { color: theme.foreground }]}>Conditions d'utilisation</Text>
            </View>
            <MaterialIcons name="chevron-right" size={16} color={theme.muted} />
          </Pressable>
          <Pressable
            onPress={() => router.push("/privacy" as any)}
            style={({ pressed }) => [styles.actionRow, styles.actionRowLast, pressed && { backgroundColor: theme.pressed }]}
          >
            <View style={[styles.actionIcon, { backgroundColor: theme.background }]}>
              <MaterialIcons name="privacy-tip" size={16} color={theme.primary} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.actionText, { color: theme.foreground }]}>Politique de confidentialité</Text>
            </View>
            <MaterialIcons name="chevron-right" size={16} color={theme.muted} />
          </Pressable>
        </View>

        {/* CARD: Zone sensible */}
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Pressable
            onPress={() => { setDeleteError(""); setDeleteConfirmOpen(true); }}
            style={({ pressed }) => [styles.actionRow, styles.actionRowLast, pressed && { backgroundColor: theme.pressed }]}
          >
            <View style={[styles.actionIcon, { backgroundColor: isDark ? theme.pressed : "#FDECEA" }]}>
              <MaterialIcons name="delete-forever" size={16} color={theme.error} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.actionText, { color: theme.error }]}>Supprimer mon compte</Text>
              <Text style={[styles.actionMeta, { color: theme.muted }]} numberOfLines={1}>
                {profile?.deletionRequestedAt ? "Suppression déjà en cours" : "Suppression différée de 30 jours, annulable"}
              </Text>
            </View>
            {profile?.deletionRequestedAt ? (
              <View style={[styles.menuBadge, { backgroundColor: theme.error }]}>
                <Text style={[styles.menuBadgeText, { color: "#FFFFFF" }]}>En cours</Text>
              </View>
            ) : (
              <MaterialIcons name="chevron-right" size={16} color={theme.muted} />
            )}
          </Pressable>
        </View>

        <Pressable onPress={openLogoutConfirmation} style={({ pressed }) => [styles.logout, pressed && styles.pressed]}>
          <MaterialIcons name="logout" size={16} color={theme.error} />
          <Text style={[styles.logoutText, { color: theme.error }]}>Se déconnecter</Text>
        </Pressable>

        <Text style={[styles.version, { color: theme.muted }]}>Tikis v1.2.4 · build 2026-09-08</Text>
      </ScrollView>

      <Modal visible={vehiclesPickerOpen} transparent animationType="slide" onRequestClose={() => !updateVehiclesMutation.isPending && setVehiclesPickerOpen(false)}>
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => !updateVehiclesMutation.isPending && setVehiclesPickerOpen(false)} />
          <View style={[styles.sheet, isDark && { backgroundColor: theme.surface }]}>
            <View style={styles.sheetGrip} />
            <Text style={[styles.sheetTitle, isDark && { color: theme.foreground }]}>Mes engins</Text>
            <Text style={[styles.sheetSubtitle, isDark && { color: theme.muted }]}>Sélectionnez les engins que vous utilisez pour les livraisons (au moins un).</Text>
            <View style={styles.vehiclesList}>
              {(["Vélo", "Moto", "Tricycle", "Voiture"] as const).map((option) => {
                const checked = profile?.vehicles?.includes(option) ?? false;
                return (
                  <Pressable
                    key={option}
                    onPress={() => {
                      if (updateVehiclesMutation.isPending) return;
                      const current = (profile?.vehicles ?? []) as Array<"Vélo" | "Moto" | "Tricycle" | "Voiture" | "Fourgonnette">;
                      const next = current.includes(option) ? current.filter((v) => v !== option) : [...current, option];
                      if (next.length === 0) {
                        Alert.alert("Engins", "Sélectionnez au moins un engin pour candidater aux livraisons.");
                        return;
                      }
                      updateVehiclesMutation.mutate({ vehicles: next as Array<"Vélo" | "Moto" | "Tricycle" | "Voiture" | "Fourgonnette"> });
                    }}
                    disabled={updateVehiclesMutation.isPending}
                    style={({ pressed }) => [styles.vehicleRow, { borderColor: theme.border, backgroundColor: theme.background }, pressed && { backgroundColor: theme.pressed }]}
                  >
                    <View style={[styles.vehicleCheckbox, { borderColor: theme.border, backgroundColor: checked ? theme.primary : "transparent" }]}>
                      {checked ? <MaterialIcons name="check" size={14} color="#FFFFFF" /> : null}
                    </View>
                    <Text style={[styles.vehicleLabel, { color: theme.foreground }]}>{option}</Text>
                    <MaterialIcons name={option === "Vélo" ? "directions-bike" : option === "Moto" ? "two-wheeler" : option === "Tricycle" ? "electric-rickshaw" : "directions-car"} size={20} color={theme.muted} />
                  </Pressable>
                );
              })}
            </View>
            {updateVehiclesMutation.isPending ? <Text style={[styles.sheetSubtitle, { color: theme.muted, textAlign: "center", marginTop: 8 }]}>Enregistrement…</Text> : null}
            <Pressable onPress={() => setVehiclesPickerOpen(false)} style={({ pressed }) => [styles.photoPicker, pressed && styles.pressed]}>
              <Text style={[styles.photoPickerText, { color: theme.muted }]}>Fermer</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={countryEditorOpen} transparent animationType="slide" onRequestClose={() => !locationSaving && setCountryEditorOpen(false)}>
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => !locationSaving && setCountryEditorOpen(false)} />
          <View style={[styles.sheet, isDark && { backgroundColor: theme.surface }]}>
            <View style={styles.sheetGrip} />
            <Text style={[styles.sheetTitle, isDark && { color: theme.foreground }]}>Choisir un pays</Text>
            <Text style={[styles.sheetSubtitle, isDark && { color: theme.muted }]}>Votre pays reste inchangé jusqu’à ce que vous en choisissiez un autre ici.</Text>
            {locationError ? <Text style={styles.error}>{locationError}</Text> : null}
            <ScrollView style={{ maxHeight: 380, marginTop: 8 }}>
              {(countriesQuery.data ?? []).map((c) => (
                <Pressable key={c.id} onPress={() => void selectCountry(c.id)} disabled={Boolean(locationSaving)} style={({ pressed }) => [styles.countryRow, { borderColor: theme.border }, c.id === profile?.country && { borderColor: theme.primary, backgroundColor: isDark ? theme.pressed : "#E5F6F7" }, pressed && { opacity: 0.8 }]}>
                  <Text style={styles.countryRowFlag}>{countryFlagEmoji(c.id)}</Text>
                  <Text style={[styles.countryOptionText, { color: theme.foreground, flex: 1 }, c.id === profile?.country && { color: theme.primary, fontWeight: "800" }]}>{c.name}</Text>
                  {locationSaving === "country" ? null : c.id === profile?.country ? <MaterialIcons name="check-circle" size={20} color={theme.primary} /> : null}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={cityEditorOpen} transparent animationType="slide" onRequestClose={() => !locationSaving && setCityEditorOpen(false)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => !locationSaving && setCityEditorOpen(false)} />
          <View style={[styles.sheet, isDark && { backgroundColor: theme.surface }]}>
            <View style={styles.sheetGrip} />
            <Text style={[styles.sheetTitle, isDark && { color: theme.foreground }]}>Choisir une ville</Text>
            <Text style={[styles.sheetSubtitle, isDark && { color: theme.muted }]}>Résultats limités à {countriesQuery.data?.find((c) => c.id === profile?.country)?.name ?? "votre pays"}.</Text>
            <TextInput
              autoFocus
              value={citySearch}
              onChangeText={setCitySearch}
              maxLength={80}
              placeholder="Rechercher une ville…"
              placeholderTextColor={theme.muted}
              style={[styles.input, { color: theme.foreground, borderColor: theme.border, backgroundColor: theme.background, marginTop: 8 }]}
            />
            {locationError ? <Text style={styles.error}>{locationError}</Text> : null}
            <ScrollView style={{ maxHeight: 320, marginTop: 8 }} keyboardShouldPersistTaps="handled">
              {citySearchQuery.isFetching ? <Text style={[styles.helper, { textAlign: "center", marginTop: 10 }]}>Recherche…</Text> : null}
              {!citySearchQuery.isFetching && citySearch.trim().length >= 2 && (citySearchQuery.data ?? []).length === 0 ? <Text style={[styles.helper, { textAlign: "center", marginTop: 10 }]}>Aucune ville trouvée.</Text> : null}
              {(citySearchQuery.data ?? []).map((cityName) => (
                <Pressable key={cityName} onPress={() => void selectCity(cityName)} disabled={Boolean(locationSaving)} style={({ pressed }) => [styles.countryRow, { borderColor: theme.border }, pressed && { opacity: 0.8 }]}>
                  <MaterialIcons name="location-city" size={18} color={theme.muted} />
                  <Text style={[styles.countryOptionText, { color: theme.foreground, flex: 1 }]}>{cityName}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={deleteConfirmOpen} transparent animationType="fade" onRequestClose={() => !requestDeletionMutation.isPending && setDeleteConfirmOpen(false)}>
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => !requestDeletionMutation.isPending && setDeleteConfirmOpen(false)} />
          <View style={[styles.sheet, isDark && { backgroundColor: theme.surface }]}>
            <View style={styles.sheetGrip} />
            <View style={styles.deleteIconWrap}><MaterialIcons name="delete-forever" size={26} color="#B4232D" /></View>
            <Text style={[styles.sheetTitle, isDark && { color: theme.foreground }]}>Supprimer votre compte ?</Text>
            <Text style={[styles.sheetSubtitle, isDark && { color: theme.muted }]}>
              Vous aurez 30 jours pour changer d’avis. Pendant ce délai, votre compte sera bloqué et vous pourrez annuler la suppression à tout moment. Passé ce délai, vos données personnelles seront définitivement supprimées.
            </Text>
            {deleteError ? <Text style={styles.error}>{deleteError}</Text> : null}
            <TikisButton label="Confirmer la suppression" icon="delete-forever" variant="danger" onPress={() => void confirmAccountDeletion()} loading={requestDeletionMutation.isPending} style={styles.saveButton} />
            <Pressable onPress={() => setDeleteConfirmOpen(false)} disabled={requestDeletionMutation.isPending} style={({ pressed }) => [styles.photoPicker, pressed && styles.pressed]}>
              <Text style={[styles.photoPickerText, { color: theme.muted }]}>Annuler</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={editorOpen} transparent animationType="slide" onRequestClose={() => setEditorOpen(false)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === "ios" ? "padding" : "height"}>
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
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function StatBox({ label, value, color, small }: { label: string; value: string; color: string; small?: boolean }) {
  const { colors: theme } = useThemeColors();
  return (
    <View style={[styles.statBox, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Text style={[styles.statValue, small && { fontSize: 13 }]} numberOfLines={1}>{value}</Text>
      <Text style={[styles.statLabel, { color }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

function CtaTile({ icon, label, meta, onPress }: { icon: React.ComponentProps<typeof MaterialIcons>["name"]; label: string; meta: string; onPress: () => void }) {
  const { colors: theme } = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.ctaTile, { backgroundColor: theme.surface, borderColor: theme.border }, pressed && { backgroundColor: theme.pressed }]}
    >
      <View style={[styles.ctaIcon, { backgroundColor: theme.background }]}>
        <MaterialIcons name={icon} size={18} color={theme.primary} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.ctaLabel, { color: theme.foreground }]} numberOfLines={1}>{label}</Text>
        <Text style={[styles.ctaMeta, { color: theme.muted }]} numberOfLines={1}>{meta}</Text>
      </View>
      <MaterialIcons name="chevron-right" size={16} color={theme.muted} />
    </Pressable>
  );
}

function InfoRow({ label, value, theme, last }: { label: string; value: string; theme: ReturnType<typeof useThemeColors>["colors"]; last?: boolean }) {
  return (
    <View style={[styles.infoRow, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border }]}>
      <Text style={[styles.infoLabel, { color: theme.muted }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: theme.foreground }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingBottom: 40, paddingHorizontal: 14, paddingTop: 12, gap: 10 },

  // Hero (sans cover — juste un mini bandeau dégradé + avatar par-dessus)
  hero: { borderRadius: 16, padding: 20, paddingTop: 28, alignItems: "center", borderWidth: StyleSheet.hairlineWidth, position: "relative", overflow: "hidden" },
  heroBand: { position: "absolute", top: 0, left: 0, right: 0, height: 50, backgroundColor: "#9A6201" },
  heroAvatarWrap: { position: "relative", marginTop: 4, marginBottom: 10 },
  heroAvatar: { width: 88, height: 88, borderRadius: 44, alignItems: "center", justifyContent: "center", borderWidth: 4 },
  avatarDriver: { backgroundColor: "#111111" },
  avatarSender: { backgroundColor: "#007B8B" },
  heroAvatarImage: { width: 88, height: 88, borderRadius: 44, borderWidth: 4, borderColor: "#FFFFFF" },
  heroAvatarText: { color: "#FFFFFF", fontSize: 28, fontWeight: "700" },
  heroAvatarEdit: { position: "absolute", right: -2, bottom: -2, width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: "#FFFFFF" },
  heroName: { fontSize: 20, fontWeight: "700" },
  heroPhone: { fontSize: 13, marginTop: 4 },
  heroBadges: { flexDirection: "row", gap: 6, flexWrap: "wrap", justifyContent: "center", marginTop: 10 },
  badge: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  badgeText: { fontSize: 11, fontWeight: "600" },

  // Stats row (3 KPIs)
  statsRow: { flexDirection: "row", gap: 8 },
  statBox: { flex: 1, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 10, alignItems: "center", gap: 4, borderWidth: StyleSheet.hairlineWidth },
  statValue: { fontSize: 18, fontWeight: "700", fontVariantNumeric: "tabular-nums", color: "#111111" },
  statLabel: { fontSize: 10.5, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase" },

  // Quick CTAs (2 tiles)
  ctaRow: { flexDirection: "row", gap: 8 },
  ctaTile: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  ctaIcon: { width: 36, height: 36, borderRadius: 8, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  ctaLabel: { fontSize: 13, fontWeight: "600" },
  ctaMeta: { fontSize: 11, marginTop: 2 },

  // Cards (thématiques)
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, paddingBottom: 8 },
  cardEmoji: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  cardEmojiText: { fontSize: 16 },
  cardTitle: { fontSize: 14, fontWeight: "700" },
  cardSubtitle: { fontSize: 11.5, marginTop: 2 },
  cardEditBtn: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  cardBody: { paddingHorizontal: 14, paddingBottom: 4 },

  // Info rows (clé-valeur dans les cards Identité/Activité)
  infoRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10, gap: 12 },
  infoLabel: { fontSize: 12, flexShrink: 0 },
  infoValue: { fontSize: 13, fontWeight: "600", textAlign: "right", flexShrink: 1 },

  // Action rows (les presses dans les cards Préférences/KYC)
  actionRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, paddingHorizontal: 14 },
  actionRowLast: { paddingBottom: 14 },
  actionIcon: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  actionText: { fontSize: 13, fontWeight: "600" },
  actionMeta: { fontSize: 11, marginTop: 2 },
  menuBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99 },
  menuBadgeText: { fontSize: 10, fontWeight: "700" },

  // Logout
  logout: { flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "center", borderRadius: 12, paddingVertical: 14, marginTop: 6, borderWidth: 1 },
  logoutText: { fontSize: 13, fontWeight: "600" },

  // Version
  version: { textAlign: "center", fontSize: 11, marginTop: 14 },

  // Modals (inchangés)
  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.42)" },
  sheet: { backgroundColor: "#FFFFFF", borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, paddingTop: 8, paddingBottom: 24 },
  sheetGrip: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#D5D5DC", alignSelf: "center", marginBottom: 14 },
  sheetTitle: { color: "#111111", fontSize: 17, fontWeight: "600" },
  sheetSubtitle: { color: "#666666", fontSize: 12, marginTop: 4 },

  photoPicker: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, backgroundColor: "#F8F0E5", borderRadius: 10, marginTop: 14 },
  photoPickerIcon: { width: 48, height: 48, borderRadius: 12, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  photoPickerText: { color: "#9A6201", fontSize: 12, fontWeight: "600" },
  photoPickerSub: { color: "#747474", fontSize: 10, marginTop: 2 },

  vehiclesList: { gap: 2, marginTop: 12 },
  vehicleRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, paddingHorizontal: 12, borderWidth: 1, borderRadius: 10, marginBottom: 2 },
  vehicleCheckbox: { width: 22, height: 22, borderRadius: 5, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  vehicleLabel: { fontSize: 14, fontWeight: "600", flex: 1 },

  fieldLabel: { color: "#747474", fontSize: 10, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase", marginTop: 16, marginBottom: 6 },
  input: { backgroundColor: "#F7EFE5", borderRadius: 9, borderWidth: 1, borderColor: "#E5D2B9", paddingHorizontal: 12, paddingVertical: 12, color: "#9A6201", fontSize: 13, fontWeight: "500" },
  countryOptionText: { fontSize: 13, fontWeight: "600" },
  countryRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 11, borderRadius: 10, borderWidth: 1, marginBottom: 8 },
  countryRowFlag: { fontSize: 20 },
  deleteIconWrap: { width: 48, height: 48, borderRadius: 16, backgroundColor: "#FDECEA", alignItems: "center", justifyContent: "center", alignSelf: "center", marginBottom: 4 },
  inputError: { borderWidth: 1, borderColor: "#B4232D" },
  helper: { color: "#747474", fontSize: 10, marginTop: 4 },
  error: { color: "#B4232D", fontSize: 11, fontWeight: "600", marginTop: 4 },
  saveButton: { marginTop: 18 },

  pressed: { opacity: 0.7 },
});
