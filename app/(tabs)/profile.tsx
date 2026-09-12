import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useThemeColors } from "@/lib/use-theme-colors";
import { SafeAreaView } from "react-native-safe-area-context";
import { TikisButton } from "@/components/tikis/ui";
import { ContactSection } from "@/components/tikis/contact-section";
import { LoyaltyProgress } from "@/components/tikis/loyalty-progress";
import { SessionsSection } from "@/components/tikis/sessions-section";
import { haptic } from "@/lib/haptics";
import { useTikisLogout } from "@/lib/tikis-logout";
import { countryFlagEmoji, sanitizeFullName, validateFullName } from "@/lib/registration-rules";
import { getApiBaseUrl } from "@/constants/oauth";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";
import { availableWalletBalance, formatMoney } from "@/shared/tikis-domain";
import { describePerimeter } from "@/shared/driver-perimeter";

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
        <View style={styles.coverWrap}>
          <View style={[styles.cover, isDark && styles.coverDark]}>
            <View style={styles.coverPattern}>
              <View style={styles.coverOrbPrimary} />
              <View style={styles.coverOrbSecondary} />
              <View style={styles.coverOrbTertiary} />
            </View>
            <View style={styles.coverOverlay} pointerEvents="none" />
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

        <LoyaltyProgress phone={profile?.phone ?? null} />

        <SessionsSection />

        <ContactSection />

        <Section title="Localisation">
          <MenuRow
            icon="public"
            iconBg="primary"
            label="Pays"
            sub={countriesQuery.data?.find((c) => c.id === profile?.country)?.name ?? "Non renseigné"}
            onPress={() => { setLocationError(""); setCountryEditorOpen(true); }}
          />
          <MenuRow
            icon="location-city"
            iconBg="primary"
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
              sub={profile?.vehicles?.length ? profile.vehicles.join(", ") : "Sélectionnez vos engins"}
              onPress={() => setVehiclesPickerOpen(true)}
            />
            <MenuRow
              icon="notifications-active"
              iconBg="primary"
              label="Alertes & périmètre"
              sub={perimeterSummary}
              onPress={() => router.push("/driver-alerts" as any)}
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
          ) : null}
        </Section>

        <Section title="Zone sensible">
          <MenuRow
            icon="delete-forever"
            iconBg="dark"
            label="Supprimer mon compte"
            sub={profile?.deletionRequestedAt ? "Suppression déjà en cours" : "Suppression différée de 30 jours, annulable"}
            badge={profile?.deletionRequestedAt ? { label: "En cours", tone: "danger" } : undefined}
            onPress={() => { setDeleteError(""); setDeleteConfirmOpen(true); }}
            last
          />
        </Section>

        <Pressable onPress={openLogoutConfirmation} style={({ pressed }) => [styles.logout, pressed && styles.pressed]}>
          <MaterialIcons name="logout" size={16} color="#B4232D" />
          <Text style={styles.logoutText}>Se déconnecter</Text>
        </Pressable>
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

function CoverAction({ icon, label, onPress, primary }: { icon: React.ComponentProps<typeof MaterialIcons>["name"]; label: string; onPress: () => void; primary?: boolean }) {
  return null;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { colors: theme } = useThemeColors();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: theme.muted }]}>{title}</Text>
      <View style={[styles.sectionCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>{children}</View>
    </View>
  );
}

function MenuRow({ icon, iconBg, label, sub, badge, onPress, last }: { icon: React.ComponentProps<typeof MaterialIcons>["name"]; iconBg: "primary" | "amber" | "dark"; label: string; sub?: string; badge?: { label: string; tone: "danger" | "success" }; onPress: () => void; last?: boolean }) {
  const { colors: theme } = useThemeColors();
  const iconBgColor = iconBg === "amber" ? theme.warning + "22" : iconBg === "dark" ? "#111111" : theme.primary + "22";
  const iconColor = iconBg === "primary" ? theme.primary : iconBg === "amber" ? theme.warning : "#FFFFFF";
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.menuRow, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border }, pressed && { backgroundColor: theme.pressed }]}>
      <View style={[styles.menuIcon, { backgroundColor: iconBgColor }]}>
        <MaterialIcons name={icon} size={16} color={iconColor} />
      </View>
      <View style={styles.menuBody}>
        <Text style={[styles.menuLabel, { color: theme.foreground }]}>{label}</Text>
        {sub ? <Text style={[styles.menuSub, { color: theme.muted }]}>{sub}</Text> : null}
      </View>
      {badge ? (
        <View style={[styles.menuBadge, { backgroundColor: badge.tone === "success" ? theme.success + "22" : theme.error }, badge.tone === "danger" && { backgroundColor: theme.error }]}>
          <Text style={[styles.menuBadgeText, { color: badge.tone === "success" ? theme.success : "#FFFFFF" }]}>{badge.label}</Text>
        </View>
      ) : (
        <MaterialIcons name="chevron-right" size={16} color={theme.muted} />
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
  coverPattern: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#9A6201" },
  coverOrbPrimary: { position: "absolute", width: 260, height: 260, borderRadius: 130, top: -90, right: -60, backgroundColor: "#D7A447", opacity: 0.45 },
  coverOrbSecondary: { position: "absolute", width: 180, height: 180, borderRadius: 90, bottom: -50, left: -40, backgroundColor: "#007B8B", opacity: 0.25 },
  coverOrbTertiary: { position: "absolute", width: 120, height: 120, borderRadius: 60, top: 60, left: 80, backgroundColor: "#FFFFFF", opacity: 0.08 },
  coverOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.10)" },

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
  sectionCard: { borderRadius: 12, overflow: "hidden", borderWidth: 1 },
  menuRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11, paddingHorizontal: 12 },
  menuRowLast: {},
  menuIcon: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  menuIconAmber: {},
  menuIconDark: {},
  menuBody: { flex: 1, minWidth: 0 },
  menuLabel: { fontSize: 13, fontWeight: "600" },
  menuSub: { fontSize: 10, marginTop: 1 },
  menuBadge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 99 },
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
