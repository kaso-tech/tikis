import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Image, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { TikisseButton } from "@/components/tikisse/ui";
import { haptic } from "@/lib/haptics";
import { OTP_MAX_ATTEMPTS, verifySimulationOtp } from "@/lib/otp-simulator";
import { COUNTRIES, countryFlagEmoji, createRegisteredProfile, detectCountry, findSimulatedAccount, formatLocalPhone, isValidInternationalPhone, normalizedInternationalPhone, sanitizeFullName, sanitizePhoneInput, validateFullName, type CountrySpec } from "@/lib/registration-rules";
import { useTikisseStore } from "@/lib/tikisse-store";
import { trpc } from "@/lib/trpc";
import { setTikisseSessionToken } from "@/lib/tikisse-session";
import { isSupabasePhoneAuthEnabled, requestSupabasePhoneOtp, verifySupabasePhoneOtp } from "@/lib/supabase-tracking";
import type { UserRole, VehicleType } from "@/shared/tikisse-domain";
import { SIMULATION_OTP } from "@/shared/tikisse-domain";
import { useThemeColors } from "@/lib/use-theme-colors";

/** Palette dédiée à l'écran d'authentification (design chaud, distinct du reste de l'app), alignée
 *  sur les tons sombres déjà utilisés ailleurs (tiroir de navigation) pour rester cohérente. */
const AUTH_DARK = { bg: "#401000", surface: "#581E08", input: "#401000", border: "#7A4A2D", text: "#FFF9F2", muted: "#D7B79C", accent: "#F8A008", chip: "#2B0D02" };

type Stage = "welcome" | "phone" | "otp" | "role" | "vehicles" | "name";

const RESEND_SECONDS = 20;
const VEHICLES: { type: VehicleType; icon: React.ComponentProps<typeof MaterialIcons>["name"]; description: string }[] = [
  { type: "Vélo", icon: "pedal-bike", description: "Courses légères" },
  { type: "Moto", icon: "two-wheeler", description: "Rapide en ville" },
  { type: "Tricycle", icon: "electric-rickshaw", description: "Volumes moyens" },
  { type: "Voiture", icon: "directions-car", description: "Confort et capacité" },
];

function profileLookupErrorMessage(error: unknown, provider: "simulation" | "supabase") {
  const message = error instanceof Error ? error.message : "";
  if (/service des profils|base de données/i.test(message)) return "Le service des profils est temporairement indisponible. Réessayez dans quelques instants.";
  if (/session Supabase|vérification Supabase|Supabase Auth/i.test(message)) return provider === "supabase" ? "Votre session SMS a expiré ou ne correspond plus à ce numéro. Demandez un nouveau code." : "La vérification sécurisée est indisponible. Réessayez dans quelques instants.";
  if (/session Tikisse|signature de session|jeton de session/i.test(message)) return "Votre connexion sécurisée ne peut pas être créée pour le moment. Réessayez dans quelques instants.";
  return "Impossible de vérifier votre profil existant pour le moment. Réessayez sans poursuivre l’inscription.";
}

export function AuthFlow() {
  const { isDark } = useThemeColors();
  const { signInProfile, registerProfile } = useTikisseStore();
  const lookupProfileMutation = trpc.profiles.lookup.useMutation();
  const registerProfileMutation = trpc.profiles.register.useMutation();
  const lookupSupabaseProfileMutation = trpc.profiles.lookupSupabase.useMutation();
  const registerSupabaseProfileMutation = trpc.profiles.registerSupabase.useMutation();
  const [stage, setStage] = useState<Stage>("welcome");
  const [country, setCountry] = useState<CountrySpec>(() => detectCountry());
  const countriesQuery = trpc.geography.countries.useQuery(undefined, { staleTime: 10 * 60_000 });
  const availableCountries = countriesQuery.data && countriesQuery.data.length > 0 ? countriesQuery.data : COUNTRIES;

  // Sécurité : si le pays pré-sélectionné localement a été désactivé depuis la console admin,
  // on ne le laisse jamais soumis par défaut — on bascule sur le premier pays réellement actif.
  // Ajustement pendant le rendu, pas dans un effet : la donnée est déjà disponible ici, et la
  // condition s'arrête d'elle-même une fois `country` de nouveau valide, sans jamais boucler.
  if (countriesQuery.data && countriesQuery.data.length > 0 && !countriesQuery.data.some((c) => c.id === country.id)) {
    setCountry(countriesQuery.data[0]);
  }
  const [isCountryPickerOpen, setCountryPickerOpen] = useState(false);
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [sending, setSending] = useState(false);
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [otpError, setOtpError] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [otpProvider, setOtpProvider] = useState<"simulation" | "supabase">("simulation");
  const [supabaseAccessToken, setSupabaseAccessToken] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(RESEND_SECONDS);
  const [selectedRole, setSelectedRole] = useState<UserRole | null>(null);
  const [selectedVehicles, setSelectedVehicles] = useState<VehicleType[]>([]);
  const [fullName, setFullName] = useState("");
  const [nameError, setNameError] = useState("");
  const [phoneConfirmOpen, setPhoneConfirmOpen] = useState(false);
  // Ville de l'utilisateur, dans le pays choisi au début : texte saisi, et nom retenu dans les suggestions.
  const [cityInput, setCityInput] = useState("");
  const [selectedCity, setSelectedCity] = useState("");
  const [cityQuery, setCityQuery] = useState("");
  const [cityError, setCityError] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [referralFieldOpen, setReferralFieldOpen] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const inputs = useRef<(TextInput | null)[]>([]);
  const phone = useMemo(() => normalizedInternationalPhone(phoneInput, country), [country, phoneInput]);
  const otp = digits.join("");
  useEffect(() => {
    const query = cityInput.trim();
    const timer = setTimeout(() => setCityQuery(query.length >= 2 && query !== selectedCity ? query : ""), 300);
    return () => clearTimeout(timer);
  }, [cityInput, selectedCity]);
  const citySuggestionsQuery = trpc.geography.signupCities.useQuery(
    { query: cityQuery, countryCode: country.id },
    { enabled: stage === "name" && cityQuery.length >= 2, retry: false, staleTime: 5 * 60_000 },
  );
  const citySuggestions = cityQuery && !selectedCity ? citySuggestionsQuery.data ?? [] : [];
  /**
   * Le bandeau annonçait « INSCRIPTION · Étape n sur 5 » dès le premier écran,
   * à quelqu'un qui se connectait comme à quelqu'un qui s'inscrivait — on ne
   * sait qu'après le code lequel des deux. Et l'étape 4, celle des engins,
   * n'existe pas pour un expéditeur : son compteur sautait de 3 à 5.
   *
   * Tant que le numéro n'est pas vérifié, il n'y a donc rien à compter. Ensuite,
   * le total suit le rôle : rôle, engins et nom pour un livreur ; rôle et nom
   * pour un expéditeur.
   */
  const creating = stage === "role" || stage === "vehicles" || stage === "name";
  // Sur l'écran du rôle, tant que rien n'est coché, le total dépend d'une
  // réponse qui n'est pas encore donnée : on annonce l'étape sans le promettre.
  // Il apparaît dès que le rôle est coché, avant même de continuer.
  const creationTotal = selectedRole === null ? null : selectedRole === "driver" ? 3 : 2;
  const creationStep = stage === "role" ? 1 : stage === "vehicles" ? 2 : selectedRole === "driver" ? 3 : 2;

  useEffect(() => {
    if (stage !== "otp" || secondsLeft === 0) return;
    const timer = setInterval(() => setSecondsLeft((current) => Math.max(0, current - 1)), 1000);
    return () => clearInterval(timer);
  }, [secondsLeft, stage]);

  useEffect(() => {
    if (stage !== "otp" || otp.length !== 6 || verifying || attempts >= OTP_MAX_ATTEMPTS) return;
    void submitOtp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otp]);

  function selectCountry(nextCountry: CountrySpec) {
    setCountry(nextCountry);
    setPhoneInput("");
    setPhoneError("");
    setCountryPickerOpen(false);
  }

  /** Avant tout envoi : le numéro est relu par la personne (chaque SMS est facturé, un numéro mal saisi
   *  enverrait le code à un inconnu). Le code ne part qu'après « Envoyer le code ». */
  function confirmPhone() {
    if (!isValidInternationalPhone(phoneInput, country)) {
      setPhoneError(`Saisissez un numéro valide à ${country.digits} chiffres pour ${country.name}.`);
      haptic.error();
      return;
    }
    setPhoneError("");
    Keyboard.dismiss();
    setPhoneConfirmOpen(true);
  }

  async function requestOtp() {
    setPhoneConfirmOpen(false);
    if (!isValidInternationalPhone(phoneInput, country)) return;
    setPhoneError("");
    setSending(true);
    if (isSupabasePhoneAuthEnabled()) {
      // Pas de repli silencieux sur la simulation : avec les vrais SMS, le serveur refuse le code simulé ;
      // la personne verrait un code qui ne marche pas. On reste sur l'écran du numéro, avec la raison.
      try {
        await requestSupabasePhoneOtp(phone);
        setOtpProvider("supabase");
      } catch {
        setSending(false);
        setPhoneError("Le SMS n’a pas pu être envoyé. Vérifiez le numéro et réessayez dans un instant.");
        haptic.error();
        return;
      }
    } else {
      setOtpProvider("simulation");
    }
    setSending(false);
    setStage("otp");
    setSecondsLeft(RESEND_SECONDS);
    setTimeout(() => inputs.current[0]?.focus(), 120);
  }

  function updateDigit(index: number, rawValue: string) {
    const cleanValue = rawValue.replace(/\D/g, "");
    const next = [...digits];
    const toApply = cleanValue.slice(0, 6 - index).split("");
    if (toApply.length > 1) {
      toApply.forEach((digit, offset) => { next[index + offset] = digit; });
      setDigits(next);
      inputs.current[Math.min(index + toApply.length, 5)]?.focus();
      return;
    }
    next[index] = cleanValue;
    setDigits(next);
    setOtpError("");
    if (cleanValue && index < 5) inputs.current[index + 1]?.focus();
  }

  function handleKeyPress(index: number, key: string) {
    if (key === "Backspace" && !digits[index] && index > 0) inputs.current[index - 1]?.focus();
  }

  async function submitOtp() {
    if (otp.length !== 6 || verifying) return;
    Keyboard.dismiss();
    setVerifying(true);
    let accessToken: string | null = null;
    try {
      if (otpProvider === "supabase") accessToken = (await verifySupabasePhoneOtp(phone, otp)).access_token;
      else if (!verifySimulationOtp(otp)) throw new Error("Code incorrect");
      const existingProfile = accessToken ? await lookupSupabaseProfileMutation.mutateAsync({ phone, accessToken }) : await lookupProfileMutation.mutateAsync({ phone, otp: otp as "730512" });
      setSupabaseAccessToken(accessToken);
      const demoProfile = findSimulatedAccount(phone);
      haptic.success();
      if (existingProfile) {
        await setTikisseSessionToken(existingProfile.sessionToken);
        signInProfile(existingProfile.profile);
        router.replace("/(tabs)");
        return;
      }
      if (demoProfile && !accessToken) {
        try {
          const persistedDemoProfile = await registerProfileMutation.mutateAsync({ phone: demoProfile.phone, fullName: demoProfile.fullName, countryCode: demoProfile.countryCode, role: demoProfile.role, vehicles: demoProfile.vehicles, otp: otp as "730512" });
          await setTikisseSessionToken(persistedDemoProfile.sessionToken);
          signInProfile(persistedDemoProfile.profile);
        } catch {
          signInProfile(demoProfile);
        }
        router.replace("/(tabs)");
        return;
      }
      setVerifying(false);
      setStage("role");
      return;
    } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message && !/code incorrect|code sms/i.test(message)) {
      setVerifying(false);
      setOtpError(profileLookupErrorMessage(error, otpProvider));
      haptic.error();
      return;
    }
    const nextAttempts = attempts + 1;
    setAttempts(nextAttempts);
    setVerifying(false);
    setDigits(["", "", "", "", "", ""]);
    setOtpError(nextAttempts >= OTP_MAX_ATTEMPTS ? "Nombre maximal de tentatives atteint. Demandez un nouveau code." : `Code incorrect. Il reste ${OTP_MAX_ATTEMPTS - nextAttempts} tentative${OTP_MAX_ATTEMPTS - nextAttempts > 1 ? "s" : ""}.`);
    haptic.error();
    setTimeout(() => inputs.current[0]?.focus(), 80);
    }
  }

  async function resendOtp() {
    if (secondsLeft > 0) return;
    if (otpProvider === "supabase") {
      try { await requestSupabasePhoneOtp(phone); } catch {
        setOtpError("Le SMS n’a pas pu être renvoyé. Réessayez dans un instant.");
        haptic.error();
        return;
      }
    }
    setDigits(["", "", "", "", "", ""]);
    setOtpError("");
    setAttempts(0);
    setSecondsLeft(RESEND_SECONDS);
    haptic.success();
    setTimeout(() => inputs.current[0]?.focus(), 80);
  }

  function continueRole() {
    if (!selectedRole) return;
    setStage(selectedRole === "driver" ? "vehicles" : "name");
  }

  function toggleVehicle(vehicle: VehicleType) {
    setSelectedVehicles((current) => current.includes(vehicle) ? current.filter((item) => item !== vehicle) : [...current, vehicle]);
  }

  function continueVehicles() {
    if (selectedVehicles.length === 0) return;
    setStage("name");
  }

  async function finishRegistration() {
    if (finishing) return;
    const validation = validateFullName(fullName);
    if (!selectedRole) {
      setNameError("Sélectionnez un type de compte.");
      haptic.error();
      return;
    }
    if (!validation.valid) {
      setNameError(validation.message);
      haptic.error();
      return;
    }
    const validatedName = sanitizeFullName(fullName);
    if (selectedRole === "driver" && selectedVehicles.length === 0) {
      setNameError("Sélectionnez au moins un engin pour votre compte livreur.");
      return;
    }
    // Ville choisie dans la liste ; à défaut (service de cartes muet), le texte saisi, vérifié par le serveur.
    const city = selectedCity || cityInput.trim();
    if (city.length < 2) {
      setCityError(`Indiquez votre ville au ${country.name}.`);
      haptic.error();
      return;
    }
    if (!selectedCity && citySuggestions.length > 0) {
      setCityError("Choisissez votre ville dans la liste proposée.");
      haptic.error();
      return;
    }
    setFinishing(true);
    await new Promise((resolve) => setTimeout(resolve, 550));
    const localProfile = createRegisteredProfile({ fullName: validatedName, phone, countryCode: country.id, role: selectedRole, vehicles: selectedVehicles });
    const sanitizedReferralCode = referralCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    const referredByCode = sanitizedReferralCode.length >= 4 ? sanitizedReferralCode : undefined;
    try {
      const persistedProfile = supabaseAccessToken ? await registerSupabaseProfileMutation.mutateAsync({ phone: localProfile.phone, fullName: localProfile.fullName, countryCode: localProfile.countryCode, role: localProfile.role, vehicles: localProfile.vehicles, accessToken: supabaseAccessToken, referredByCode, city }) : await registerProfileMutation.mutateAsync({ phone: localProfile.phone, fullName: localProfile.fullName, countryCode: localProfile.countryCode, role: localProfile.role, vehicles: localProfile.vehicles, otp: otp as "730512", referredByCode, city });
      await setTikisseSessionToken(persistedProfile.sessionToken);
      registerProfile(persistedProfile.profile);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setFinishing(false);
      setNameError(message && message.length < 180 ? message : "Impossible d’enregistrer votre profil de façon sécurisée. Vérifiez votre connexion puis réessayez.");
      haptic.error();
      return;
    }
    haptic.success();
    setFinishing(false);
    router.replace("/(tabs)");
  }

  return <SafeAreaView style={[styles.safeArea, isDark && { backgroundColor: AUTH_DARK.bg }]} edges={["top", "bottom"]}><KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === "ios" ? "padding" : undefined}><ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">{stage === "welcome" ? null : <FlowHeader creating={creating} step={creationStep} total={creationTotal} isDark={isDark} onBack={() => { if (stage === "phone") setStage("welcome"); else if (stage === "otp") setStage("phone"); else if (stage === "role") setStage("phone"); else if (stage === "vehicles") setStage("role"); else setStage(selectedRole === "driver" ? "vehicles" : "role"); }} />}{stage === "welcome" ? <WelcomeScreen onContinue={() => setStage("phone")} isDark={isDark} /> : null}{stage === "phone" ? <PhoneScreen country={country} value={phoneInput} error={phoneError} loading={sending} onCountryPress={() => setCountryPickerOpen(true)} onChange={(value) => { setPhoneInput(sanitizePhoneInput(value, country)); setPhoneError(""); }} onContinue={confirmPhone} isDark={isDark} /> : null}{stage === "otp" ? <OtpScreen phone={phone} digits={digits} error={otpError} verifying={verifying} secondsLeft={secondsLeft} provider={otpProvider} onChangeDigit={updateDigit} onKeyPress={handleKeyPress} inputRefs={inputs} onResend={() => void resendOtp()} onSubmit={() => void submitOtp()} isDark={isDark} /> : null}{stage === "role" ? <RoleScreen selectedRole={selectedRole} onSelect={setSelectedRole} onContinue={continueRole} isDark={isDark} /> : null}{stage === "vehicles" ? <VehiclesScreen selected={selectedVehicles} onToggle={toggleVehicle} onContinue={continueVehicles} isDark={isDark} /> : null}{stage === "name" ? <NameScreen role={selectedRole} phone={phone} vehicles={selectedVehicles} value={fullName} error={nameError} loading={finishing} onChange={(value) => { setFullName(sanitizeFullName(value, { preserveTrailingSeparator: true })); setNameError(""); }} onContinue={() => void finishRegistration()} onEditRole={() => setStage("role")} onEditVehicles={() => setStage("vehicles")} referralCode={referralCode} referralFieldOpen={referralFieldOpen} onReferralFieldOpen={() => setReferralFieldOpen(true)} onReferralCodeChange={setReferralCode} countryName={country.name} cityInput={cityInput} cityError={cityError} citySuggestions={citySuggestions} citySearching={citySuggestionsQuery.isFetching} selectedCity={selectedCity} onCityChange={(value) => { setCityInput(value); setSelectedCity(""); setCityError(""); }} onSelectCity={(value) => { setSelectedCity(value); setCityInput(value); setCityError(""); Keyboard.dismiss(); }} isDark={isDark} /> : null}</ScrollView></KeyboardAvoidingView><PhoneConfirmDialog visible={phoneConfirmOpen} phone={`${country.dialCode} ${formatLocalPhone(phoneInput, country)}`} countryName={country.name} onEdit={() => setPhoneConfirmOpen(false)} onConfirm={() => void requestOtp()} isDark={isDark} /><CountryPicker visible={isCountryPickerOpen} selected={country} countries={availableCountries} onClose={() => setCountryPickerOpen(false)} onSelect={selectCountry} isDark={isDark} /></SafeAreaView>;
}

/**
 * Le bandeau du haut. Il ne prétend plus savoir ce qui se passe avant de le
 * savoir : tant que le numéro n'est pas vérifié, il annonce une vérification,
 * sans compteur. Ensuite seulement il compte, et sur le bon total.
 */
function FlowHeader({ creating, step, total, onBack, isDark }: { creating: boolean; step: number; total: number | null; onBack: () => void; isDark: boolean }) {
  return <View style={styles.top}>
    <Pressable accessibilityRole="button" accessibilityLabel="Étape précédente" onPress={onBack} style={({ pressed }) => [styles.backButton, isDark && { backgroundColor: AUTH_DARK.surface }, pressed && styles.pressed]}>
      <MaterialIcons name="arrow-back" size={21} color={isDark ? AUTH_DARK.text : "#241510"} />
    </Pressable>
    <View style={styles.stepInfo}>
      <Text style={[styles.stepLabel, isDark && { color: AUTH_DARK.muted }]}>{creating ? "CRÉATION DU COMPTE" : "VÉRIFICATION DU NUMÉRO"}</Text>
      <Text style={[styles.stepCount, isDark && { color: AUTH_DARK.text }]}>{creating ? (total ? `Étape ${step} sur ${total}` : `Étape ${step}`) : "Connexion ou inscription"}</Text>
    </View>
    {creating && total ? (
      <View style={styles.stepDots}>
        {Array.from({ length: total }, (_, index) => <View key={index} style={[styles.stepDot, isDark && { backgroundColor: AUTH_DARK.border }, index < step && styles.stepDotActive]} />)}
      </View>
    ) : null}
  </View>;
}

function TrustRow({ icon, title, isDark }: { icon: React.ComponentProps<typeof MaterialIcons>["name"]; title: string; isDark: boolean }) { return <View style={[styles.trustRow, isDark && { backgroundColor: AUTH_DARK.surface, borderWidth: 0 }]}><View style={[styles.trustIcon, isDark && { backgroundColor: AUTH_DARK.input }]}><MaterialIcons name={icon} size={17} color={isDark ? AUTH_DARK.muted : "#76665E"} /></View><Text style={[styles.trustTitle, isDark && { color: AUTH_DARK.text }]}>{title}</Text></View>; }

/**
 * L'écran d'accueil : la marque, ce que fait Tikisse, et le consentement.
 *
 * Il posait sa marque en haut et tout le reste en bas (`justifyContent:
 * "space-between"`), ce qui creusait environ 250 px de vide au milieu ; le
 * contenu occupe désormais la colonne dans l'ordre normal. Le sélecteur de
 * langue n'est pas rétabli : il ne traduisait que les quatre chaînes de cet
 * écran-ci, et laissait les cinq suivants en français — une promesse que rien
 * ne tenait. Une troisième ligne de réassurance prend sa place, qui, elle, dit
 * quelque chose de vrai du produit.
 */
function WelcomeScreen({ onContinue, isDark }: { onContinue: () => void; isDark: boolean }) {
  return <View style={styles.form}>
    <View style={styles.brandRow}>
      <Image source={require("@/assets/images/tikisse-logo.png")} style={styles.brandLogo} accessibilityLabel="Logo Tikisse" />
      <View style={styles.brandInfo}>
        <Text style={[styles.brandName, isDark && { color: AUTH_DARK.text }]}>Tikisse</Text>
        <View style={styles.brandChipRow}>
          <View style={styles.brandStatus} />
          <Text style={[styles.brandChipText, isDark && { color: AUTH_DARK.muted }]}>PLATEFORME DE LIVRAISON</Text>
        </View>
      </View>
    </View>

    <Text style={[styles.welcomeEyebrow, isDark && { color: AUTH_DARK.muted }]}>BIENVENUE SUR TIKISSE</Text>
    <Text style={[styles.title, styles.phoneTitle, isDark && { color: AUTH_DARK.text }]}>Livrez et expédiez en toute confiance.</Text>
    <Text style={[styles.subtitle, isDark && { color: AUTH_DARK.muted }]}>Une plateforme qui relie les expéditeurs à des livreurs vérifiés, au bon moment.</Text>

    <View style={styles.trustList}>
      <TrustRow icon="verified-user" title="Compte sécurisé par SMS" isDark={isDark} />
      <TrustRow icon="handshake" title="Coordonnées partagées après attribution" isDark={isDark} />
      <TrustRow icon="payments" title="Vous fixez votre prix" isDark={isDark} />
    </View>

    <TikisseButton label="Commencer" icon="arrow-forward" onPress={onContinue} style={styles.actionButton} />
    <Text style={[styles.legal, isDark && { color: AUTH_DARK.muted }]}>En continuant, vous acceptez nos <Text onPress={() => router.push("/legal/terms" as any)} style={[styles.legalLink, isDark && { color: AUTH_DARK.text }]}>conditions d’utilisation</Text> et notre <Text onPress={() => router.push("/legal/privacy" as any)} style={[styles.legalLink, isDark && { color: AUTH_DARK.text }]}>politique de confidentialité</Text>.</Text>
  </View>;
}

/**
 * La saisie du numéro. L'accueil la précède avec la marque, la promesse et le
 * texte légal : cet écran-ci ne porte donc que la question qu'il pose.
 */
function PhoneScreen({ country, value, error, loading, onCountryPress, onChange, onContinue, isDark }: { country: CountrySpec; value: string; error: string; loading: boolean; onCountryPress: () => void; onChange: (value: string) => void; onContinue: () => void; isDark: boolean }) {
  return <View style={styles.form}>
    <View style={[styles.heroIcon, isDark && { backgroundColor: AUTH_DARK.surface }]}><MaterialIcons name="smartphone" size={30} color={isDark ? AUTH_DARK.accent : "#A95000"} /></View>
    <Text style={[styles.title, styles.phoneTitle, isDark && { color: AUTH_DARK.text }]}>Votre numéro suffit.</Text>
    <Text style={[styles.subtitle, isDark && { color: AUTH_DARK.muted }]}>Un code par SMS, et vous êtes chez vous — que vous ayez déjà un compte ou non.</Text>

    <Text style={[styles.fieldLabel, isDark && { color: AUTH_DARK.muted }]}>PAYS</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={`Pays : ${country.name}. Changer`} onPress={onCountryPress} style={({ pressed }) => [styles.countryField, isDark && { backgroundColor: AUTH_DARK.input, borderColor: AUTH_DARK.border }, pressed && styles.pressed]}>
      <View style={[styles.countryBadge, isDark && { backgroundColor: AUTH_DARK.surface }]}><Text style={styles.countryFlag}>{countryFlagEmoji(country.id)}</Text></View>
      <View style={styles.countryInfo}>
        <Text style={[styles.countryName, isDark && { color: AUTH_DARK.text }]}>{country.name}</Text>
      </View>
      <MaterialIcons name="keyboard-arrow-down" size={24} color={isDark ? AUTH_DARK.muted : "#76665E"} />
    </Pressable>

    <Text style={[styles.fieldLabel, isDark && { color: AUTH_DARK.muted }]}>NUMÉRO DE TÉLÉPHONE</Text>
    <View style={[styles.phoneField, isDark && { backgroundColor: AUTH_DARK.input, borderColor: AUTH_DARK.border }, error && styles.fieldError]}>
      <View style={[styles.dialCode, isDark && { borderColor: AUTH_DARK.border }]}><Text style={[styles.dialCodeText, isDark && { color: AUTH_DARK.text }]}>{country.dialCode}</Text></View>
      <TextInput accessibilityLabel="Numéro de téléphone" keyboardType="phone-pad" placeholder={country.groups.map((size) => "0".repeat(size)).join(" ")} placeholderTextColor={isDark ? AUTH_DARK.muted : "#9B8478"} value={formatLocalPhone(value, country)} onChangeText={onChange} style={[styles.phoneInput, isDark && { color: AUTH_DARK.text }]} returnKeyType="done" onSubmitEditing={onContinue} />
    </View>
    {error ? <Text style={styles.error}>{error}</Text> : null}

    <TikisseButton label="Recevoir mon code" icon="sms" onPress={onContinue} loading={loading} style={styles.actionButton} />
  </View>;
}

function OtpScreen({ phone, digits, error, verifying, secondsLeft, provider, onChangeDigit, onKeyPress, inputRefs, onResend, onSubmit, isDark }: { phone: string; digits: string[]; error: string; verifying: boolean; secondsLeft: number; provider: "simulation" | "supabase"; onChangeDigit: (index: number, value: string) => void; onKeyPress: (index: number, key: string) => void; inputRefs: React.MutableRefObject<(TextInput | null)[]>; onResend: () => void; onSubmit: () => void; isDark: boolean }) { return <View style={styles.form}><View style={[styles.heroIcon, isDark && { backgroundColor: AUTH_DARK.surface }]}><MaterialIcons name="mark-unread-chat-alt" size={30} color={isDark ? AUTH_DARK.accent : "#A95000"} /></View><Text style={[styles.title, isDark && { color: AUTH_DARK.text }]}>Confirmez votre numéro</Text><Text style={[styles.subtitle, isDark && { color: AUTH_DARK.muted }]}>Saisissez le code à 6 chiffres envoyé au <Text style={[styles.phoneHighlight, isDark && { color: AUTH_DARK.text }]}>{phone}</Text>.</Text>{/* Le mode simulation accepte un code public : il ne doit pas se lire comme
        une information de routine. La bascule depuis Supabase étant silencieuse,
        ce bandeau est le seul endroit où elle se voit. */}
    <View style={[styles.simulationNotice, provider !== "supabase" && styles.simulationWarning, isDark && { backgroundColor: AUTH_DARK.surface }]}><MaterialIcons name={provider === "supabase" ? "verified-user" : "warning-amber"} size={18} color={provider === "supabase" ? (isDark ? AUTH_DARK.muted : "#76665E") : "#8D362B"} /><Text style={[styles.simulationText, provider !== "supabase" && styles.simulationWarningText, isDark && { color: AUTH_DARK.muted }]}>{provider === "supabase" ? "Code SMS sécurisé envoyé par Supabase Auth." : <>Mode simulation : aucun SMS n’est envoyé, le code <Text style={[styles.simulationCode, styles.simulationWarningText, isDark && { color: AUTH_DARK.text }]}>{SIMULATION_OTP}</Text> est accepté.</>}</Text></View><View style={styles.otpRow}>{digits.map((digit, index) => <TextInput key={index} ref={(node) => { inputRefs.current[index] = node; }} accessibilityLabel={`Chiffre ${index + 1} du code`} keyboardType="number-pad" maxLength={6} value={digit} onChangeText={(value) => onChangeDigit(index, value)} onKeyPress={({ nativeEvent }) => onKeyPress(index, nativeEvent.key)} style={[styles.otpInput, isDark && { backgroundColor: AUTH_DARK.input, borderColor: AUTH_DARK.border, color: AUTH_DARK.text }, error && styles.otpError]} textAlign="center" />)}</View>{error ? <Text style={styles.error}>{error}</Text> : null}<TikisseButton label="Vérifier le code" icon="verified" onPress={onSubmit} loading={verifying} disabled={digits.join("").length !== 6} style={styles.actionButton} /><Pressable disabled={secondsLeft > 0} onPress={onResend} style={({ pressed }) => [styles.resend, (pressed || secondsLeft > 0) && styles.pressed]}><Text style={[styles.resendText, isDark && { color: AUTH_DARK.text }, secondsLeft > 0 && styles.resendDisabled]}>{secondsLeft > 0 ? `Renvoyer le code dans ${secondsLeft}s` : "Renvoyer le code"}</Text></Pressable></View>; }

function RoleScreen({ selectedRole, onSelect, onContinue, isDark }: { selectedRole: UserRole | null; onSelect: (role: UserRole) => void; onContinue: () => void; isDark: boolean }) { return <View style={styles.form}><View style={[styles.heroIcon, isDark && { backgroundColor: AUTH_DARK.surface }]}><MaterialIcons name="account-tree" size={30} color={isDark ? AUTH_DARK.accent : "#A95000"} /></View><Text style={[styles.title, isDark && { color: AUTH_DARK.text }]}>Comment utiliserez-vous Tikisse ?</Text><Text style={[styles.subtitle, isDark && { color: AUTH_DARK.muted }]}>Ce choix sera définitif après la création de votre compte.</Text><RoleChoice role="sender" selected={selectedRole === "sender"} icon="inventory-2" title="Je suis expéditeur" text="Je publie des livraisons et choisis un livreur." onPress={() => onSelect("sender")} isDark={isDark} /><RoleChoice role="driver" selected={selectedRole === "driver"} icon="two-wheeler" title="Je suis livreur" text="Je propose mes services sur les courses compatibles." onPress={() => onSelect("driver")} isDark={isDark} /><TikisseButton label="Continuer" icon="arrow-forward" onPress={onContinue} disabled={!selectedRole} style={styles.actionButton} /></View>; }

function RoleChoice({ selected, icon, title, text, onPress, isDark }: { role: UserRole; selected: boolean; icon: React.ComponentProps<typeof MaterialIcons>["name"]; title: string; text: string; onPress: () => void; isDark: boolean }) { return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.roleChoice, isDark && { backgroundColor: AUTH_DARK.surface, borderColor: AUTH_DARK.border }, selected && (isDark ? { borderColor: AUTH_DARK.accent, backgroundColor: AUTH_DARK.input } : styles.roleChoiceActive), pressed && styles.pressed]}><View style={[styles.roleChoiceIcon, isDark && { backgroundColor: AUTH_DARK.input }, selected && styles.roleChoiceIconActive]}><MaterialIcons name={icon} size={27} color={selected ? "#FFFFFF" : (isDark ? AUTH_DARK.accent : "#A95000")} /></View><View style={styles.roleChoiceInfo}><Text style={[styles.roleChoiceTitle, isDark && { color: AUTH_DARK.text }]}>{title}</Text><Text style={[styles.roleChoiceText, isDark && { color: AUTH_DARK.muted }]}>{text}</Text></View><View style={[styles.radio, isDark && { borderColor: AUTH_DARK.border }, selected && (isDark ? { borderColor: AUTH_DARK.accent } : styles.radioActive)]}>{selected ? <View style={[styles.radioInner, isDark && { backgroundColor: AUTH_DARK.accent }]} /> : null}</View></Pressable>; }

function VehiclesScreen({ selected, onToggle, onContinue, isDark }: { selected: VehicleType[]; onToggle: (vehicle: VehicleType) => void; onContinue: () => void; isDark: boolean }) { return <View style={styles.form}><View style={[styles.heroIcon, isDark && { backgroundColor: AUTH_DARK.surface }]}><MaterialIcons name="two-wheeler" size={30} color={isDark ? AUTH_DARK.accent : "#A95000"} /></View><Text style={[styles.title, isDark && { color: AUTH_DARK.text }]}>Avec quels engins livrez-vous ?</Text><View style={styles.vehicleGrid}>{VEHICLES.map((vehicle) => <Pressable key={vehicle.type} onPress={() => onToggle(vehicle.type)} style={({ pressed }) => [styles.vehicleCard, isDark && { backgroundColor: AUTH_DARK.surface, borderColor: AUTH_DARK.border }, selected.includes(vehicle.type) && styles.vehicleCardActive, pressed && styles.pressed]}><MaterialIcons name={vehicle.icon} size={27} color={selected.includes(vehicle.type) ? "#FFFFFF" : (isDark ? AUTH_DARK.accent : "#A95000")} /><Text style={[styles.vehicleTitle, isDark && { color: AUTH_DARK.text }, selected.includes(vehicle.type) && styles.vehicleTitleActive]}>{vehicle.type}</Text><Text style={[styles.vehicleText, isDark && { color: AUTH_DARK.muted }, selected.includes(vehicle.type) && styles.vehicleTextActive]}>{vehicle.description}</Text><View style={[styles.vehicleCheck, isDark && { borderColor: AUTH_DARK.border }, selected.includes(vehicle.type) && styles.vehicleCheckActive]}>{selected.includes(vehicle.type) ? <MaterialIcons name="check" size={14} color="#FFFFFF" /> : null}</View></Pressable>)}</View><TikisseButton label="Continuer" icon="arrow-forward" onPress={onContinue} disabled={selected.length === 0} style={styles.actionButton} /></View>; }

/**
 * Le dernier écran. Il demandait un nom et créait le compte, sans jamais
 * remontrer ce qui allait être créé : le rôle, définitif, n'était annoncé que
 * sur l'écran d'avant. Le récapitulatif le remet sous les yeux, et rend chaque
 * ligne corrigeable sans revenir en arrière à l'aveugle.
 */
function NameScreen({ role, phone, vehicles, value, error, loading, onChange, onContinue, onEditRole, onEditVehicles, referralCode, referralFieldOpen, onReferralFieldOpen, onReferralCodeChange, countryName, cityInput, cityError, citySuggestions, citySearching, selectedCity, onCityChange, onSelectCity, isDark }: { role: UserRole | null; phone: string; vehicles: VehicleType[]; value: string; error: string; loading: boolean; onChange: (value: string) => void; onContinue: () => void; onEditRole: () => void; onEditVehicles: () => void; referralCode: string; referralFieldOpen: boolean; onReferralFieldOpen: () => void; onReferralCodeChange: (value: string) => void; countryName: string; cityInput: string; cityError: string; citySuggestions: string[]; citySearching: boolean; selectedCity: string; onCityChange: (value: string) => void; onSelectCity: (value: string) => void; isDark: boolean }) {
  return <View style={styles.form}>
    <View style={[styles.heroIcon, isDark && { backgroundColor: AUTH_DARK.surface }]}><MaterialIcons name="badge" size={30} color={isDark ? AUTH_DARK.accent : "#A95000"} /></View>
    <Text style={[styles.title, isDark && { color: AUTH_DARK.text }]}>Comment devons-nous vous appeler ?</Text>

    <Text style={[styles.fieldLabel, isDark && { color: AUTH_DARK.muted }]}>NOM</Text>
    <TextInput accessibilityLabel="Nom" autoCapitalize="words" autoComplete="name" maxLength={70} placeholder="Ex. Mariam ou Mariam Ouédraogo" placeholderTextColor={isDark ? AUTH_DARK.muted : "#9B8478"} value={value} onChangeText={onChange} style={[styles.nameInput, isDark && { backgroundColor: AUTH_DARK.input, color: AUTH_DARK.text }, error && styles.fieldError]} returnKeyType={referralFieldOpen ? "next" : "done"} onSubmitEditing={referralFieldOpen ? undefined : onContinue} />
    {error ? <Text style={styles.error}>{error}</Text> : null}

    <Text style={[styles.fieldLabel, isDark && { color: AUTH_DARK.muted }]}>VILLE</Text>
    <TextInput accessibilityLabel="Ville" autoCapitalize="words" autoCorrect={false} autoComplete="off" maxLength={80} placeholder={`Votre ville au ${countryName}`} placeholderTextColor={isDark ? AUTH_DARK.muted : "#9B8478"} value={cityInput} onChangeText={onCityChange} style={[styles.nameInput, isDark && { backgroundColor: AUTH_DARK.input, color: AUTH_DARK.text }, cityError && styles.fieldError]} returnKeyType="done" />
    {citySearching && !selectedCity ? <Text style={[styles.helper, isDark && { color: AUTH_DARK.muted }]}>Recherche…</Text> : null}
    {citySuggestions.length > 0 ? <View style={[styles.citySuggestions, isDark && { backgroundColor: AUTH_DARK.surface, borderColor: AUTH_DARK.border }]}>
      {citySuggestions.map((name) => (
        <Pressable key={name} accessibilityRole="button" accessibilityLabel={`Choisir ${name}`} onPress={() => onSelectCity(name)} style={({ pressed }) => [styles.cityOption, pressed && styles.pressed]}>
          <MaterialIcons name="location-city" size={17} color={isDark ? AUTH_DARK.muted : "#76665E"} />
          <Text style={[styles.cityOptionText, isDark && { color: AUTH_DARK.text }]}>{name}</Text>
        </Pressable>
      ))}
    </View> : null}
    {selectedCity ? <Text style={[styles.helper, isDark && { color: AUTH_DARK.muted }]}>Ville retenue : {selectedCity}, {countryName}.</Text> : null}
    {cityError ? <Text style={styles.error}>{cityError}</Text> : null}

    {referralFieldOpen ? <>
      <Text style={[styles.fieldLabel, isDark && { color: AUTH_DARK.muted }]}>CODE DE PARRAINAGE (FACULTATIF)</Text>
      <TextInput accessibilityLabel="Code de parrainage" autoCapitalize="characters" autoCorrect={false} maxLength={8} placeholder="Ex. MARIA42" placeholderTextColor={isDark ? AUTH_DARK.muted : "#9B8478"} value={referralCode} onChangeText={(text) => onReferralCodeChange(text.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))} style={[styles.nameInput, isDark && { backgroundColor: AUTH_DARK.input, color: AUTH_DARK.text }]} returnKeyType="done" onSubmitEditing={onContinue} />
    </> : (
      <Pressable accessibilityRole="button" onPress={onReferralFieldOpen} style={({ pressed }) => [styles.referralToggle, pressed && styles.pressed]}>
        <MaterialIcons name="card-giftcard" size={16} color={isDark ? AUTH_DARK.muted : "#76665E"} />
        <Text style={[styles.referralToggleText, isDark && { color: AUTH_DARK.text }]}>J’ai un code de parrainage</Text>
      </Pressable>
    )}

    <View style={[styles.recap, isDark && { backgroundColor: AUTH_DARK.surface, borderColor: AUTH_DARK.border }]}>
      <Text style={[styles.recapTitle, isDark && { color: AUTH_DARK.muted }]}>VOTRE COMPTE</Text>
      <View style={[styles.recapRow, styles.recapRowBorder, isDark && { borderBottomColor: AUTH_DARK.border }]}>
        <MaterialIcons name="phone" size={17} color={isDark ? AUTH_DARK.muted : "#76665E"} />
        <View style={styles.recapBody}>
          <Text style={[styles.recapLabel, isDark && { color: AUTH_DARK.muted }]}>NUMÉRO VÉRIFIÉ</Text>
          <Text style={[styles.recapValue, isDark && { color: AUTH_DARK.text }]} numberOfLines={1}>{phone}</Text>
        </View>
        <MaterialIcons name="check-circle" size={18} color="#367552" />
      </View>
      <View style={[styles.recapRow, role === "driver" && styles.recapRowBorder, isDark && { borderBottomColor: AUTH_DARK.border }]}>
        <MaterialIcons name={role === "driver" ? "two-wheeler" : "inventory-2"} size={17} color={isDark ? AUTH_DARK.muted : "#76665E"} />
        <View style={styles.recapBody}>
          <Text style={[styles.recapLabel, isDark && { color: AUTH_DARK.muted }]}>TYPE DE COMPTE — DÉFINITIF</Text>
          <Text style={[styles.recapValue, isDark && { color: AUTH_DARK.text }]}>{role === "driver" ? "Livreur" : "Expéditeur"}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Modifier le type de compte" onPress={onEditRole} hitSlop={8} style={({ pressed }) => [pressed && styles.pressed]}>
          <Text style={[styles.recapEdit, isDark && { color: AUTH_DARK.text }]}>Modifier</Text>
        </Pressable>
      </View>
      {role === "driver" ? (
        <View style={styles.recapRow}>
          <MaterialIcons name="local-shipping" size={17} color={isDark ? AUTH_DARK.muted : "#76665E"} />
          <View style={styles.recapBody}>
            <Text style={[styles.recapLabel, isDark && { color: AUTH_DARK.muted }]}>ENGINS</Text>
            <Text style={[styles.recapValue, isDark && { color: AUTH_DARK.text }]} numberOfLines={1}>{vehicles.join(", ") || "Aucun"}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Modifier les engins" onPress={onEditVehicles} hitSlop={8} style={({ pressed }) => [pressed && styles.pressed]}>
            <Text style={[styles.recapEdit, isDark && { color: AUTH_DARK.text }]}>Modifier</Text>
          </Pressable>
        </View>
      ) : null}
    </View>

    <TikisseButton label={role === "driver" ? "Créer mon compte livreur" : "Créer mon compte expéditeur"} icon="check-circle" onPress={onContinue} loading={loading} style={styles.actionButton} />
  </View>;
}

function PhoneConfirmDialog({ visible, phone, countryName, onEdit, onConfirm, isDark }: { visible: boolean; phone: string; countryName: string; onEdit: () => void; onConfirm: () => void; isDark: boolean }) {
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onEdit}>
    <View style={styles.confirmBackdrop}>
      <Pressable style={styles.modalScrim} onPress={onEdit} accessibilityLabel="Fermer" />
      <View accessibilityRole="alert" style={[styles.confirmCard, isDark && { backgroundColor: AUTH_DARK.surface }]}>
        <Text style={[styles.confirmTitle, isDark && { color: AUTH_DARK.text }]}>Ce numéro est-il correct ?</Text>
        <Text style={[styles.confirmPhone, isDark && { color: AUTH_DARK.text }]}>{phone}</Text>
        <Text style={[styles.confirmText, isDark && { color: AUTH_DARK.muted }]}>Le code de connexion sera envoyé par SMS à ce numéro ({countryName}). Vérifiez chaque chiffre avant l’envoi.</Text>
        <TikisseButton label="Envoyer le code" icon="sms" onPress={onConfirm} style={styles.confirmPrimary} />
        <Pressable accessibilityRole="button" onPress={onEdit} style={({ pressed }) => [styles.confirmSecondary, pressed && styles.pressed]}>
          <Text style={[styles.confirmSecondaryText, isDark && { color: AUTH_DARK.text }]}>Modifier le numéro</Text>
        </Pressable>
      </View>
    </View>
  </Modal>;
}

function CountryPicker({ visible, selected, countries, onClose, onSelect, isDark }: { visible: boolean; selected: CountrySpec; countries: CountrySpec[]; onClose: () => void; onSelect: (country: CountrySpec) => void; isDark: boolean }) { return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}><View style={styles.modal}><Pressable style={styles.modalScrim} onPress={onClose} /><View style={[styles.countrySheet, isDark && { backgroundColor: AUTH_DARK.surface }]}><View style={[styles.sheetHandle, isDark && { backgroundColor: AUTH_DARK.border }]} /><View style={styles.sheetTop}><Text style={[styles.sheetTitle, isDark && { color: AUTH_DARK.text }]}>Choisir un pays</Text><Pressable onPress={onClose} style={[styles.sheetClose, isDark && { backgroundColor: AUTH_DARK.input }]}><MaterialIcons name="close" size={20} color={isDark ? AUTH_DARK.text : "#241510"} /></Pressable></View>{countries.map((country) => <Pressable key={country.id} onPress={() => onSelect(country)} style={({ pressed }) => [styles.countryRow, isDark && country.id === selected.id && { backgroundColor: AUTH_DARK.input }, !isDark && country.id === selected.id && styles.countryRowActive, pressed && styles.pressed]}><View style={[styles.countryBadge, isDark && { backgroundColor: AUTH_DARK.input }]}><Text style={styles.countryFlag}>{countryFlagEmoji(country.id)}</Text></View><View style={styles.countryInfo}><Text style={[styles.countryName, isDark && { color: AUTH_DARK.text }]}>{country.name}</Text></View>{country.id === selected.id ? <MaterialIcons name="check-circle" size={21} color="#367552" /> : null}</Pressable>)}</View></View></Modal>; }

const baseStyles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#EEEDF3" }, keyboard: { flex: 1 }, scroll: { flexGrow: 1, padding: 20, paddingBottom: 35 }, brandRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 26 }, brandLogo: { width: 52, height: 52, borderRadius: 16 }, brandInfo: { flex: 1, minWidth: 0 }, brandName: { color: "#2B0D02", fontSize: 17, fontWeight: "900", letterSpacing: -0.2 }, brandChipRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 }, phoneTitle: { fontSize: 26, lineHeight: 33 }, welcomeEyebrow: { color: "#76665E", fontSize: 12, fontWeight: "900", letterSpacing: 0.7, marginBottom: 7 }, recap: { marginTop: 20, borderRadius: 16, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#EEEDF3", paddingHorizontal: 13, paddingBottom: 4 }, recapTitle: { color: "#76665E", fontSize: 10, fontWeight: "900", letterSpacing: 0.7, paddingTop: 12, paddingBottom: 4 }, recapRow: { flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 11 }, recapRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#EEEDF3" }, recapBody: { flex: 1, minWidth: 0 }, recapLabel: { color: "#76665E", fontSize: 9.5, fontWeight: "900", letterSpacing: 0.6 }, recapValue: { color: "#2B0D02", fontSize: 14, fontWeight: "800", marginTop: 2 }, recapEdit: { color: "#241510", fontSize: 12, fontWeight: "800" }, brandStatus: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#3C8B60" }, brandChipText: { color: "#76665E", fontSize: 10, fontWeight: "900", letterSpacing: 0.45 }, trustList: { marginTop: 22, gap: 8 }, trustRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, paddingHorizontal: 12, backgroundColor: "#FFFFFF", borderRadius: 14, borderWidth: 1, borderColor: "#EEEDF3" }, trustIcon: { width: 30, height: 30, borderRadius: 10, backgroundColor: "#EEEDF3", alignItems: "center", justifyContent: "center" }, trustTitle: { flex: 1, color: "#2B0D02", fontSize: 12.5, fontWeight: "800" }, legal: { color: "#76665E", fontSize: 11, lineHeight: 17, textAlign: "center", marginTop: 14, paddingHorizontal: 12 }, legalLink: { color: "#241510", fontWeight: "900" }, top: { height: 49, flexDirection: "row", alignItems: "center", marginBottom: 25 }, backButton: { width: 42, height: 42, borderRadius: 15, backgroundColor: "#FFFFFF", borderColor: "#EEEDF3", borderWidth: 1, alignItems: "center", justifyContent: "center" }, stepInfo: { flex: 1, marginLeft: 10 }, stepLabel: { color: "#76665E", fontSize: 10, fontWeight: "900", letterSpacing: 0.8 }, stepCount: { color: "#2B0D02", fontSize: 13, fontWeight: "900", marginTop: 2 }, stepDots: { flexDirection: "row", gap: 4 }, stepDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#E2D4CB" }, stepDotActive: { backgroundColor: "#A95000" }, form: { flex: 1, paddingTop: 5 }, heroIcon: { width: 64, height: 64, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "#EEEDF3", marginBottom: 20 }, title: { color: "#2B0D02", fontSize: 28, lineHeight: 34, fontWeight: "900", letterSpacing: -0.5 }, subtitle: { color: "#76665E", fontSize: 14, lineHeight: 21, marginTop: 8 }, fieldLabel: { color: "#76665E", fontSize: 11, fontWeight: "900", letterSpacing: 0.75, marginTop: 25, marginBottom: 8 }, countryField: { minHeight: 60, borderRadius: 16, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#E7D9CF", borderWidth: 1 }, countryBadge: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF" }, countryFlag: { color: "#76665E", fontWeight: "900", fontSize: 11 }, countryInfo: { flex: 1, marginLeft: 10 }, countryName: { color: "#241510", fontSize: 14, fontWeight: "900" }, countryHint: { color: "#76665E", fontSize: 11, marginTop: 2 }, phoneField: { height: 58, borderRadius: 16, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E7D9CF", flexDirection: "row", alignItems: "center", paddingHorizontal: 14 }, fieldError: { borderColor: "#C75145" }, dialCode: { paddingRight: 12, borderRightWidth: 1, borderColor: "#EEEDF3" }, dialCodeText: { color: "#241510", fontWeight: "900", fontSize: 15 }, phoneInput: { flex: 1, color: "#241510", fontSize: 17, fontWeight: "800", marginLeft: 12, letterSpacing: 0.5 }, helper: { color: "#76665E", fontSize: 12, lineHeight: 18, marginTop: 8 }, error: { color: "#A43F32", fontSize: 12, lineHeight: 18, marginTop: 8, fontWeight: "700" }, actionButton: { marginTop: 25 }, simulationNotice: { flexDirection: "row", gap: 9, padding: 12, borderRadius: 15, backgroundColor: "#EEEDF3", marginTop: 22 }, simulationWarning: { backgroundColor: "#F9E7E2", borderWidth: 1, borderColor: "#E9B8AF" }, simulationText: { flex: 1, color: "#76665E", fontSize: 12, lineHeight: 18 }, simulationWarningText: { color: "#8D362B" }, simulationCode: { color: "#241510", fontWeight: "900" }, phoneHighlight: { color: "#241510", fontWeight: "900" }, otpRow: { flexDirection: "row", justifyContent: "space-between", gap: 8, marginTop: 27 }, otpInput: { flex: 1, minWidth: 0, height: 54, backgroundColor: "#FFFFFF", borderRadius: 14, borderWidth: 1, borderColor: "#E7D9CF", color: "#241510", fontSize: 21, fontWeight: "900" }, otpError: { borderColor: "#C75145" }, resend: { alignItems: "center", paddingVertical: 17 }, resendText: { color: "#241510", fontSize: 13, fontWeight: "900" }, resendDisabled: { color: "#76665E" }, roleChoice: { marginTop: 17, padding: 15, minHeight: 103, borderRadius: 19, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#EEEDF3", flexDirection: "row", alignItems: "center", gap: 12 }, roleChoiceActive: { borderColor: "#A95000", backgroundColor: "#EEEDF3" }, roleChoiceIcon: { width: 51, height: 51, borderRadius: 17, backgroundColor: "#EEEDF3", alignItems: "center", justifyContent: "center" }, roleChoiceIconActive: { backgroundColor: "#A95000" }, roleChoiceInfo: { flex: 1 }, roleChoiceTitle: { color: "#2B0D02", fontSize: 16, fontWeight: "900" }, roleChoiceText: { color: "#76665E", fontSize: 12, lineHeight: 17, marginTop: 4 }, radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: "#EEEDF3", alignItems: "center", justifyContent: "center" }, radioActive: { borderColor: "#A95000" }, radioInner: { width: 11, height: 11, borderRadius: 6, backgroundColor: "#A95000" }, vehicleGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 22 }, vehicleCard: { width: "48.5%", minHeight: 130, borderRadius: 18, padding: 13, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#EEEDF3" }, vehicleCardActive: { backgroundColor: "#A95000", borderColor: "#A95000" }, vehicleTitle: { color: "#2B0D02", fontSize: 15, fontWeight: "900", marginTop: 11 }, vehicleTitleActive: { color: "#FFFFFF" }, vehicleText: { color: "#76665E", fontSize: 11, marginTop: 3 }, vehicleTextActive: { color: "#EEEDF3" }, vehicleCheck: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: "#EEEDF3", alignItems: "center", justifyContent: "center", position: "absolute", right: 10, top: 10 }, vehicleCheckActive: { backgroundColor: "#3C8B60", borderColor: "#3C8B60" }, nameInput: { minHeight: 58, paddingHorizontal: 15, borderRadius: 16, borderWidth: 1, borderColor: "#E7D9CF", backgroundColor: "#FFFFFF", color: "#241510", fontSize: 16, fontWeight: "800" }, referralToggle: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 20, alignSelf: "flex-start" }, referralToggleText: { color: "#241510", fontSize: 13, fontWeight: "800" }, lockedRole: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, borderRadius: 14, backgroundColor: "#EEEDF3", marginTop: 18 }, lockedRoleText: { flex: 1, color: "#76665E", fontSize: 12, lineHeight: 18 }, modal: { flex: 1, justifyContent: "flex-end" }, modalScrim: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(11,31,58,0.46)" }, countrySheet: { backgroundColor: "#FFFFFF", borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 20, paddingBottom: 30 }, sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#EEEDF3", alignSelf: "center", marginBottom: 18 }, sheetTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }, sheetTitle: { color: "#2B0D02", fontSize: 20, fontWeight: "900" }, sheetClose: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF" }, countryRow: { minHeight: 58, flexDirection: "row", alignItems: "center", paddingHorizontal: 8, borderRadius: 15, marginTop: 4 }, countryRowActive: { backgroundColor: "#FFFFFF" }, pressed: { opacity: 0.68 },
});

const styles = StyleSheet.create({
  ...baseStyles,
  safeArea: { ...baseStyles.safeArea, backgroundColor: "#EEEDF3" },
  scroll: { ...baseStyles.scroll, padding: 16, paddingBottom: 28 },
  brandChipText: { ...baseStyles.brandChipText, color: "#76665E", fontWeight: "600" },
  trustList: { ...baseStyles.trustList, marginTop: 18, gap: 8 },
  trustRow: { ...baseStyles.trustRow, borderRadius: 10, borderWidth: 0, padding: 11 },
  trustIcon: { ...baseStyles.trustIcon, borderRadius: 8, backgroundColor: "#FFFFFF" },
  trustTitle: { ...baseStyles.trustTitle, fontWeight: "600" },
  legalLink: { ...baseStyles.legalLink, color: "#241510", fontWeight: "600" },
  top: { ...baseStyles.top, marginBottom: 18 },
  backButton: { ...baseStyles.backButton, borderRadius: 9, borderWidth: 0, backgroundColor: "#FFFFFF" },
  stepLabel: { ...baseStyles.stepLabel, color: "#76665E", fontWeight: "600" },
  stepDotActive: { ...baseStyles.stepDotActive, backgroundColor: "#A95000" },
  stepCount: { ...baseStyles.stepCount, fontWeight: "600" },
  heroIcon: { ...baseStyles.heroIcon, borderRadius: 12, backgroundColor: "#FFFFFF", marginBottom: 16 },
  title: { ...baseStyles.title, fontWeight: "600", fontSize: 26, lineHeight: 32 },
  fieldLabel: { ...baseStyles.fieldLabel, fontWeight: "600", marginTop: 20 },
  countryField: { ...baseStyles.countryField, borderRadius: 10, borderWidth: 0 },
  countryBadge: { ...baseStyles.countryBadge, borderRadius: 8, backgroundColor: "#EEEDF3" },
  countryFlag: { ...baseStyles.countryFlag, fontWeight: "600" },
  countryName: { ...baseStyles.countryName, fontWeight: "600" },
  phoneField: { ...baseStyles.phoneField, borderRadius: 10, borderWidth: 0 },
  dialCodeText: { ...baseStyles.dialCodeText, fontWeight: "600" },
  phoneInput: { ...baseStyles.phoneInput, fontWeight: "500" },
  error: { ...baseStyles.error, fontWeight: "600" },
  simulationNotice: { ...baseStyles.simulationNotice, borderRadius: 10, backgroundColor: "#FFFFFF", marginTop: 18 },
  simulationCode: { ...baseStyles.simulationCode, fontWeight: "600" },
  phoneHighlight: { ...baseStyles.phoneHighlight, color: "#241510", fontWeight: "600" },
  otpRow: { ...baseStyles.otpRow, marginTop: 22 },
  otpInput: { ...baseStyles.otpInput, borderRadius: 9, fontWeight: "600" },
  resendText: { ...baseStyles.resendText, color: "#241510", fontWeight: "600" },
  roleChoice: { ...baseStyles.roleChoice, borderRadius: 10, borderWidth: 0, marginTop: 12, padding: 13 },
  roleChoiceActive: { ...baseStyles.roleChoiceActive, borderColor: "#A95000", borderWidth: 0, backgroundColor: "#FFFFFF" },
  roleChoiceIcon: { ...baseStyles.roleChoiceIcon, borderRadius: 10, backgroundColor: "#FFFFFF" },
  roleChoiceIconActive: { ...baseStyles.roleChoiceIconActive, backgroundColor: "#A95000" },
  radioActive: { ...baseStyles.radioActive, borderColor: "#A95000" },
  radioInner: { ...baseStyles.radioInner, backgroundColor: "#A95000" },
  roleChoiceTitle: { ...baseStyles.roleChoiceTitle, fontWeight: "600" },
  vehicleGrid: { ...baseStyles.vehicleGrid, gap: 8, marginTop: 18 },
  vehicleCard: { ...baseStyles.vehicleCard, borderRadius: 10, borderWidth: 0, minHeight: 122 },
  vehicleCardActive: { ...baseStyles.vehicleCardActive, backgroundColor: "#A95000", borderWidth: 0 },
  vehicleTitle: { ...baseStyles.vehicleTitle, fontWeight: "600" },
  nameInput: { ...baseStyles.nameInput, borderRadius: 10, borderWidth: 0, fontWeight: "500" },
  confirmBackdrop: { flex: 1, justifyContent: "center", padding: 24 },
  confirmCard: { backgroundColor: "#FFFFFF", borderRadius: 16, padding: 22 },
  confirmTitle: { color: "#2B0D02", fontSize: 18, fontWeight: "700" },
  confirmPhone: { color: "#241510", fontSize: 26, fontWeight: "800", letterSpacing: 0.5, marginTop: 14 },
  confirmText: { color: "#76665E", fontSize: 13, lineHeight: 19, marginTop: 10 },
  confirmPrimary: { marginTop: 20 },
  confirmSecondary: { alignItems: "center", paddingVertical: 14, marginTop: 4 },
  confirmSecondaryText: { color: "#241510", fontSize: 14, fontWeight: "700" },
  citySuggestions: { marginTop: 6, borderRadius: 10, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E7D9CF", overflow: "hidden" },
  cityOption: { minHeight: 46, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14 },
  cityOptionText: { flex: 1, color: "#241510", fontSize: 15, fontWeight: "500" },
  lockedRole: { ...baseStyles.lockedRole, borderRadius: 10, marginTop: 14 },
  countrySheet: { ...baseStyles.countrySheet, borderTopLeftRadius: 14, borderTopRightRadius: 14, padding: 16, paddingBottom: 24 },
  sheetTitle: { ...baseStyles.sheetTitle, fontWeight: "600" },
  sheetClose: { ...baseStyles.sheetClose, borderRadius: 8, backgroundColor: "#EEEDF3" },
});
