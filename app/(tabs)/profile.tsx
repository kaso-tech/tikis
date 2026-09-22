import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useThemeColors } from "@/lib/use-theme-colors";
import { SafeAreaView } from "react-native-safe-area-context";
import { TikisButton } from "@/components/tikis/ui";
import { ContactSection } from "@/components/tikis/contact-section";
import { LoyaltyProgress } from "@/components/tikis/loyalty-progress";
import { haptic } from "@/lib/haptics";
import { useTikisLogout } from "@/lib/tikis-logout";
import { countryFlagEmoji, sanitizeFullName, validateFullName } from "@/lib/registration-rules";
import { getApiBaseUrl } from "@/constants/oauth";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";
import { describePerimeter } from "@/shared/driver-perimeter";
import { profileVerification } from "@/lib/profile-verification";

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
  const perimeterQuery = trpc.driverPerimeter.get.useQuery(undefined, { enabled: role === "driver" && Boolean(profile?.phone) });
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
  const perimeterSummary = perimeterQuery.data
    ? `${perimeterQuery.data.opportunityPushEnabled ? "Alertes activées" : "Alertes désactivées"} · ${describePerimeter(perimeterQuery.data.discoveryRadiusKm, perimeterQuery.data.city)}`
    : "Notifications de nouvelles courses et rayon";
  const name = profile?.fullName ?? (driver ? "Antoine Kaboré" : "Aïcha Traoré");
  const initials = name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  const photoUri = profile?.photoUrl ? `${getApiBaseUrl()}${profile.photoUrl}` : undefined;
  const completed = (deliveriesQuery.data ?? []).filter((delivery) => delivery.status === "completed");
  const receivedReviews = useMemo(() => driver ? reviewsQuery.data ?? [] : [], [driver, reviewsQuery.data]);
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

  const kycQuery = trpc.kyc.status.useQuery(undefined, { enabled: driver && Boolean(profile?.phone) });
  /**
   * L'état affiché vient du dossier KYC, pas d'une pastille écrite en dur ni du
   * nombre d'avis reçus — les deux sources que la page lisait jusqu'ici.
   */
  const verification = useMemo(() => profileVerification({
    role: driver ? "driver" : "sender",
    hasPhoto: Boolean(profile?.photoUrl),
    kycStatus: kycQuery.data?.status ?? null,
    submittedAt: kycQuery.data?.submittedAt ?? null,
    rejectionReason: kycQuery.data?.rejectionReason ?? null,
  }), [driver, profile?.photoUrl, kycQuery.data]);
  const roleLine = `${driver ? "Livreur" : "Expéditeur"}${memberSince === "—" ? "" : ` · membre depuis ${memberSince}`}`;
  const publishedCount = (deliveriesQuery.data ?? []).length;

  const driverRating = useMemo(() => {
    if (!driver || receivedReviews.length === 0) return null;
    const sum = receivedReviews.reduce((acc, review) => acc + review.rating, 0);
    return Number((sum / receivedReviews.length).toFixed(1));
  }, [driver, receivedReviews]);

  async function pickPhoto() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.45, base64: true });
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
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        <View style={styles.header}>
          <View style={styles.headerRow}>
            <Pressable onPress={openEditor} style={({ pressed }) => [styles.avatarWrap, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel="Modifier ma photo de profil">
              {photoUri ? (
                <Image source={{ uri: photoUri }} style={styles.avatarImage} />
              ) : (
                <View style={styles.avatar}><Text style={styles.avatarText}>{initials}</Text></View>
              )}
              <View style={styles.avatarEdit}>
                <MaterialIcons name="photo-camera" size={12} color="#9A6201" />
              </View>
            </Pressable>
            <View style={styles.headerIdentity}>
              <Text style={styles.name} numberOfLines={1}>{name}</Text>
              <Text style={styles.roleLine} numberOfLines={1}>{roleLine}</Text>
            </View>
            <Pressable onPress={openEditor} style={({ pressed }) => [styles.editBtn, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel="Modifier mon profil">
              <MaterialIcons name="edit" size={16} color="#9A6201" />
            </Pressable>
          </View>

          {verification ? (
            <Pressable
              // Une photo manquante se répare dans l'éditeur de profil, pas sur
              // l'écran des pièces d'identité.
              onPress={() => { if (verification.target === "photo") openEditor(); else router.push("/verification" as any); }}
              accessibilityRole="button"
              accessibilityLabel={`${verification.title}${verification.detail ? `. ${verification.detail}` : ""}${verification.action ? `. ${verification.action}` : ""}`}
              style={({ pressed }) => [styles.verifyBand, { backgroundColor: VERIFY_TONE[verification.tone].background }, pressed && styles.pressed]}
            >
              <MaterialIcons name={VERIFY_TONE[verification.tone].icon} size={17} color={VERIFY_TONE[verification.tone].color} />
              <View style={styles.verifyBody}>
                <Text style={[styles.verifyTitle, { color: VERIFY_TONE[verification.tone].color }]} numberOfLines={1}>{verification.title}</Text>
                {verification.detail ? <Text style={styles.verifyDetail}>{verification.detail}</Text> : null}
              </View>
              {verification.action ? (
                <Text style={[styles.verifyAction, { color: VERIFY_TONE[verification.tone].color }]} numberOfLines={1}>{verification.action}</Text>
              ) : (
                <MaterialIcons name="chevron-right" size={16} color={VERIFY_TONE[verification.tone].color} />
              )}
            </Pressable>
          ) : null}

          <View style={styles.statRow}>
            {driver ? (
              <>
                <StatTile icon="star" value={driverRating ? driverRating.toLocaleString("fr-FR") : "—"} label={receivedReviews.length > 0 ? `sur ${receivedReviews.length} avis reçu${receivedReviews.length > 1 ? "s" : ""}` : "aucun avis reçu"} />
                <StatTile icon="local-shipping" value={String(completed.length)} label={`course${completed.length > 1 ? "s" : ""} terminée${completed.length > 1 ? "s" : ""}`} />
              </>
            ) : (
              <>
                <StatTile icon="publish" value={String(publishedCount)} label={`course${publishedCount > 1 ? "s" : ""} publiée${publishedCount > 1 ? "s" : ""}`} />
                <StatTile icon="check-circle" value={String(senderDelivered)} label={`livrée${senderDelivered > 1 ? "s" : ""}`} />
              </>
            )}
          </View>
        </View>

        <View style={styles.body}>
          <LoyaltyProgress phone={profile?.phone ?? null} compact />

          <Section title="Mon compte">
            <ContactSection embedded />
            <MenuRow
              icon="public"
              label="Pays"
              sub={countriesQuery.data?.find((c) => c.id === profile?.country)?.name ?? "Non renseigné"}
              onPress={() => { setLocationError(""); setCountryEditorOpen(true); }}
            />
            <MenuRow
              icon="location-city"
              label="Ville"
              sub={profile?.city || "Non renseignée"}
              onPress={() => {
                if (!profile?.country) { Alert.alert("Sélectionnez d’abord un pays", "Le pays doit être renseigné avant de choisir une ville."); return; }
                setLocationError(""); setCitySearch(""); setCityEditorOpen(true);
              }}
              last
            />
          </Section>

          {driver ? (
            <Section title="Mon travail">
              <MenuRow
                icon="two-wheeler"
                label="Mes engins"
                sub={profile?.vehicles?.length ? profile.vehicles.join(", ") : "Sélectionnez vos engins"}
                onPress={() => setVehiclesPickerOpen(true)}
              />
              <MenuRow
                icon="notifications-active"
                label="Alertes et périmètre"
                sub={perimeterSummary}
                onPress={() => router.push("/driver-alerts" as any)}
              />
              <MenuRow
                icon="receipt-long"
                label="Historique des courses"
                sub={`${completed.length} terminée${completed.length > 1 ? "s" : ""}`}
                onPress={() => router.push("/history" as any)}
              />
              <MenuRow
                icon="star-outline"
                label="Mes avis"
                sub={`${receivedReviews.length} avis reçu${receivedReviews.length > 1 ? "s" : ""}`}
                onPress={() => router.push("/reviews" as any)}
                last={!profile?.referralCode}
              />
              {profile?.referralCode ? (
                <MenuRow
                  icon="group-add"
                  label="Parrainage"
                  sub={`Code ${profile.referralCode}`}
                  onPress={() => router.push("/referrals" as any)}
                  last
                />
              ) : null}
            </Section>
          ) : (
            <Section title="Mon activité">
              <MenuRow
                icon="receipt-long"
                label="Historique des courses"
                sub={`${senderDelivered} livrée${senderDelivered > 1 ? "s" : ""}`}
                onPress={() => router.push("/history" as any)}
              />
              <MenuRow
                icon="star-outline"
                label="Mes avis"
                sub="Évaluations envoyées"
                onPress={() => router.push("/reviews" as any)}
              />
              <MenuRow
                icon="bookmark"
                label="Adresses enregistrées"
                sub="Vos lieux favoris"
                onPress={() => router.push("/(tabs)/addresses" as any)}
                last
              />
            </Section>
          )}

          <Section title="Sécurité">
            <MenuRow
              icon="notifications"
              label="Notifications"
              sub="Gérer les notifications de cet appareil"
              onPress={() => router.push("/notification-settings" as any)}
            />
            <MenuRow
              icon="devices"
              label="Appareils connectés"
              sub="Voir et déconnecter vos sessions"
              onPress={() => router.push("/sessions" as any)}
            />
            <MenuRow
              icon="logout"
              label="Se déconnecter"
              tone="danger"
              onPress={openLogoutConfirmation}
              last
            />
          </Section>

          <Pressable
            onPress={() => { setDeleteError(""); setDeleteConfirmOpen(true); }}
            hitSlop={8}
            accessibilityRole="button"
            style={({ pressed }) => [styles.deleteLink, pressed && styles.pressed]}
          >
            <Text style={styles.deleteLinkText}>
              {profile?.deletionRequestedAt ? "Suppression de compte en cours — voir" : "Supprimer mon compte"}
            </Text>
          </Pressable>
        </View>
      </ScrollView>

      <Modal visible={vehiclesPickerOpen} transparent animationType="slide" onRequestClose={() => !updateVehiclesMutation.isPending && setVehiclesPickerOpen(false)}>
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => !updateVehiclesMutation.isPending && setVehiclesPickerOpen(false)} />
          <View style={[styles.sheet, isDark && { backgroundColor: theme.surface }]}>
            <View style={styles.sheetGrip} />
            <Text style={[styles.sheetTitle, isDark && { color: theme.foreground }]}>Mes engins</Text>
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
            {locationError ? <Text style={styles.error}>{locationError}</Text> : null}
            <ScrollView style={{ maxHeight: 380, marginTop: 8 }}>
              {(countriesQuery.data ?? []).map((c) => (
                <Pressable key={c.id} onPress={() => void selectCountry(c.id)} disabled={Boolean(locationSaving)} style={({ pressed }) => [styles.countryRow, { borderColor: theme.border }, c.id === profile?.country && { borderColor: theme.primary, backgroundColor: isDark ? theme.pressed : "#F0F3F8" }, pressed && { opacity: 0.8 }]}>
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
            <View style={styles.deleteIconWrap}><MaterialIcons name="delete-forever" size={26} color="#A43740" /></View>
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
              placeholderTextColor={theme.placeholder}
              style={[styles.input, error ? styles.inputError : null, isDark && { backgroundColor: theme.background, color: theme.foreground, borderColor: theme.border }]}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <TikisButton label="Enregistrer les modifications" icon="save" onPress={() => void saveProfile()} loading={updateMutation.isPending} style={styles.saveButton} />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const VERIFY_TONE = {
  verified: { color: "#145C45", background: "#E7F2EC", icon: "verified-user" },
  pending: { color: "#6B4600", background: "#F6EFE3", icon: "hourglass-empty" },
  blocked: { color: "#8C2F37", background: "#F7EAEB", icon: "error-outline" },
} as const satisfies Record<string, { color: string; background: string; icon: React.ComponentProps<typeof MaterialIcons>["name"] }>;

/** Un chiffre que le rôle a gagné, avec ce qu'il compte écrit dessous. */
function StatTile({ icon, value, label }: { icon: React.ComponentProps<typeof MaterialIcons>["name"]; value: string; label: string }) {
  return (
    <View style={styles.statTile}>
      <View style={styles.statHead}>
        <MaterialIcons name={icon} size={14} color="#9A6201" />
        <Text style={styles.statValue} numberOfLines={1}>{value}</Text>
      </View>
      <Text style={styles.statLabel} numberOfLines={1}>{label}</Text>
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

function MenuRow({ icon, label, sub, tone = "default", onPress, last }: { icon: React.ComponentProps<typeof MaterialIcons>["name"]; label: string; sub?: string; tone?: "default" | "danger"; onPress: () => void; last?: boolean }) {
  const danger = tone === "danger";
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={sub ? `${label}. ${sub}` : label}
      style={({ pressed }) => [styles.menuRow, !last && styles.menuRowBorder, pressed && styles.pressed]}
    >
      <View style={[styles.menuIcon, danger && styles.menuIconDanger]}>
        <MaterialIcons name={icon} size={15} color={danger ? "#A43740" : "#9A6201"} />
      </View>
      <View style={styles.menuBody}>
        <Text style={[styles.menuLabel, danger && styles.menuLabelDanger]} numberOfLines={1}>{label}</Text>
        {sub ? <Text style={styles.menuSub} numberOfLines={1}>{sub}</Text> : null}
      </View>
      {danger ? null : <MaterialIcons name="chevron-right" size={16} color="#667085" />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#FAFAFA" },
  content: { paddingBottom: 32 },

  header: { backgroundColor: "#FFFFFF", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#E8ECF2", paddingHorizontal: 16, paddingTop: 14, paddingBottom: 14, gap: 13 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 13 },
  headerIdentity: { flex: 1, minWidth: 0 },
  avatarWrap: { position: "relative" },
  avatar: { width: 58, height: 58, borderRadius: 29, backgroundColor: "#9A6201", alignItems: "center", justifyContent: "center" },
  avatarImage: { width: 58, height: 58, borderRadius: 29 },
  avatarText: { color: "#FFFFFF", fontSize: 19, fontWeight: "700" },
  avatarEdit: { position: "absolute", right: -2, bottom: -2, width: 22, height: 22, borderRadius: 11, backgroundColor: "#FFFFFF", borderWidth: StyleSheet.hairlineWidth, borderColor: "#E8ECF2", alignItems: "center", justifyContent: "center" },
  name: { color: "#111111", fontSize: 18, fontWeight: "700", letterSpacing: -0.2 },
  roleLine: { color: "#667085", fontSize: 12, marginTop: 3 },
  editBtn: { width: 38, height: 38, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: "#E8ECF2", backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },

  verifyBand: { flexDirection: "row", alignItems: "center", gap: 9, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 9, minHeight: 44 },
  verifyBody: { flex: 1, minWidth: 0 },
  verifyTitle: { fontSize: 12.5, fontWeight: "700" },
  verifyDetail: { color: "#5B6472", fontSize: 11, lineHeight: 15, marginTop: 2 },
  verifyAction: { fontSize: 11.5, fontWeight: "700" },

  statRow: { flexDirection: "row", gap: 9 },
  statTile: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, borderWidth: StyleSheet.hairlineWidth, borderColor: "#E8ECF2", borderRadius: 11, paddingHorizontal: 12, paddingVertical: 10 },
  statHead: { flexDirection: "row", alignItems: "center", gap: 5 },
  statValue: { color: "#111111", fontSize: 17, fontWeight: "800", flexShrink: 1 },
  statLabel: { color: "#667085", fontSize: 11, marginTop: 2 },

  body: { paddingHorizontal: 16, paddingTop: 14, gap: 16 },

  section: { gap: 8 },
  sectionTitle: { color: "#667085", fontSize: 10, fontWeight: "700", letterSpacing: 0.9, textTransform: "uppercase", paddingHorizontal: 2 },
  sectionCard: { backgroundColor: "#FFFFFF", borderRadius: 14, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth, borderColor: "#E8ECF2" },
  menuRow: { flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 13, paddingVertical: 12, minHeight: 52 },
  menuRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#F0F3F8" },
  menuIcon: { width: 28, height: 28, borderRadius: 9, backgroundColor: "#F6EFE3", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  menuIconDanger: { backgroundColor: "#F7EAEB" },
  menuBody: { flex: 1, minWidth: 0 },
  menuLabel: { color: "#111111", fontSize: 13.5, fontWeight: "600" },
  menuLabelDanger: { color: "#A43740" },
  menuSub: { color: "#667085", fontSize: 11, marginTop: 2 },

  deleteLink: { alignSelf: "flex-start", paddingHorizontal: 2, paddingVertical: 8 },
  deleteLinkText: { color: "#98A2B3", fontSize: 12.5, fontWeight: "600", textDecorationLine: "underline" },

  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.42)" },
  sheet: { backgroundColor: "#FFFFFF", borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, paddingTop: 8, paddingBottom: 24 },
  sheetGrip: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E3E3E3", alignSelf: "center", marginBottom: 14 },
  sheetTitle: { color: "#111111", fontSize: 17, fontWeight: "600" },
  sheetSubtitle: { color: "#667085", fontSize: 12, marginTop: 4 },

  photoPicker: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, backgroundColor: "#FFFFFF", borderRadius: 10, marginTop: 14 },
  photoPickerIcon: { width: 48, height: 48, borderRadius: 12, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  photoPickerText: { color: "#9A6201", fontSize: 12, fontWeight: "600" },
  photoPickerSub: { color: "#667085", fontSize: 10, marginTop: 2 },

  vehiclesList: { gap: 2, marginTop: 12 },
  vehicleRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, paddingHorizontal: 12, borderWidth: 1, borderRadius: 10, marginBottom: 2 },
  vehicleCheckbox: { width: 22, height: 22, borderRadius: 5, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  vehicleLabel: { fontSize: 14, fontWeight: "600", flex: 1 },

  fieldLabel: { color: "#667085", fontSize: 10, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase", marginTop: 16, marginBottom: 6 },
  input: { backgroundColor: "#FFFFFF", borderRadius: 9, borderWidth: 1, borderColor: "#E3E3E3", paddingHorizontal: 12, paddingVertical: 12, color: "#9A6201", fontSize: 13, fontWeight: "500" },
  countryOptionText: { fontSize: 13, fontWeight: "600" },
  countryRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 11, borderRadius: 10, borderWidth: 1, marginBottom: 8 },
  countryRowFlag: { fontSize: 20 },
  deleteIconWrap: { width: 48, height: 48, borderRadius: 16, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", alignSelf: "center", marginBottom: 4 },
  inputError: { borderWidth: 1, borderColor: "#A43740" },
  helper: { color: "#667085", fontSize: 10, marginTop: 4 },
  error: { color: "#A43740", fontSize: 11, fontWeight: "600", marginTop: 4 },
  saveButton: { marginTop: 18 },

  pressed: { opacity: 0.7 },
});
