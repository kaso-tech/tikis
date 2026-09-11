import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Image, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { TikisButton } from "@/components/tikis/ui";
import { haptic } from "@/lib/haptics";
import { OTP_MAX_ATTEMPTS, verifySimulationOtp } from "@/lib/otp-simulator";
import { COUNTRIES, countryFlagEmoji, createRegisteredProfile, detectCountry, findSimulatedAccount, formatLocalPhone, isValidInternationalPhone, normalizedInternationalPhone, sanitizeFullName, sanitizePhoneInput, validateFullName, type CountrySpec } from "@/lib/registration-rules";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";
import { setTikisSessionToken } from "@/lib/tikis-session";
import { isSupabasePhoneAuthEnabled, requestSupabasePhoneOtp, verifySupabasePhoneOtp } from "@/lib/supabase-tracking";
import type { UserRole, VehicleType } from "@/shared/tikis-domain";
import { SIMULATION_OTP } from "@/shared/tikis-domain";
import { useThemeColors, type ThemedColors } from "@/lib/use-theme-colors";

type Stage = "welcome" | "phone" | "otp" | "role" | "vehicles" | "name";
type Language = "fr" | "en";

const RESEND_SECONDS = 20;
const VEHICLES: { type: VehicleType; icon: React.ComponentProps<typeof MaterialIcons>["name"]; description: string }[] = [
  { type: "Vélo", icon: "pedal-bike", description: "Courses légères" },
  { type: "Moto", icon: "two-wheeler", description: "Rapide en ville" },
  { type: "Tricycle", icon: "electric-rickshaw", description: "Volumes moyens" },
  { type: "Voiture", icon: "directions-car", description: "Confort et capacité" },
];

const welcomeCopy = {
  fr: { eyebrow: "Bienvenue sur Tikis", title: "Livrez et expédiez en toute confiance.", subtitle: "Une plateforme professionnelle qui relie les expéditeurs à des livreurs vérifiés, au bon moment.", continue: "Accepter et continuer", legal: "En continuant, vous acceptez nos conditions d’utilisation et notre politique de confidentialité." },
  en: { eyebrow: "Welcome to Tikis", title: "Deliver and ship with confidence.", subtitle: "A professional platform connecting senders with verified couriers at the right time.", continue: "Accept and continue", legal: "By continuing, you accept our terms of use and privacy policy." },
};

function profileLookupErrorMessage(error: unknown, provider: "simulation" | "supabase") {
  const message = error instanceof Error ? error.message : "";
  if (/service des profils|base de données/i.test(message)) return "Le service des profils est temporairement indisponible. Réessayez dans quelques instants.";
  if (/session Supabase|vérification Supabase|Supabase Auth/i.test(message)) return provider === "supabase" ? "Votre session SMS a expiré ou ne correspond plus à ce numéro. Demandez un nouveau code." : "La vérification sécurisée est indisponible. Réessayez dans quelques instants.";
  if (/session Tikis|signature de session|jeton de session/i.test(message)) return "Votre connexion sécurisée ne peut pas être créée pour le moment. Réessayez dans quelques instants.";
  return "Impossible de vérifier votre profil existant pour le moment. Réessayez sans poursuivre l’inscription.";
}

type Palette = ThemedColors;

export function AuthFlow() {
  const { colors: theme } = useThemeColors();
  const { signInProfile, registerProfile } = useTikisStore();
  const lookupProfileMutation = trpc.profiles.lookup.useMutation();
  const registerProfileMutation = trpc.profiles.register.useMutation();
  const lookupSupabaseProfileMutation = trpc.profiles.lookupSupabase.useMutation();
  const registerSupabaseProfileMutation = trpc.profiles.registerSupabase.useMutation();
  const [stage, setStage] = useState<Stage>("welcome");
  const [language, setLanguage] = useState<Language>("fr");
  const [country, setCountry] = useState<CountrySpec>(() => detectCountry());
  const countriesQuery = trpc.geography.countries.useQuery(undefined, { staleTime: 10 * 60_000 });
  const availableCountries = countriesQuery.data && countriesQuery.data.length > 0 ? countriesQuery.data : COUNTRIES;

  useEffect(() => {
    if (!countriesQuery.data || countriesQuery.data.length === 0) return;
    const stillEnabled = countriesQuery.data.some((c) => c.id === country.id);
    if (!stillEnabled) setCountry(countriesQuery.data[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countriesQuery.data]);
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
  const [referralCode, setReferralCode] = useState("");
  const [referralFieldOpen, setReferralFieldOpen] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const inputs = useRef<(TextInput | null)[]>([]);
  const copy = welcomeCopy[language];
  const phone = useMemo(() => normalizedInternationalPhone(phoneInput, country), [country, phoneInput]);
  const otp = digits.join("");
  const onboardingStep = stage === "phone" ? 1 : stage === "otp" ? 2 : stage === "role" ? 3 : stage === "vehicles" ? 4 : 5;

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

  async function requestOtp() {
    if (!isValidInternationalPhone(phoneInput, country)) {
      setPhoneError(`Saisissez un numéro valide à ${country.digits} chiffres pour ${country.name}.`);
      haptic.error();
      return;
    }
    setPhoneError("");
    setSending(true);
    if (isSupabasePhoneAuthEnabled()) {
      try {
        await requestSupabasePhoneOtp(phone);
        setOtpProvider("supabase");
      } catch {
        setOtpProvider("simulation");
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
        await setTikisSessionToken(existingProfile.sessionToken);
        signInProfile(existingProfile.profile);
        router.replace("/(tabs)");
        return;
      }
      if (demoProfile && !accessToken) {
        try {
          const persistedDemoProfile = await registerProfileMutation.mutateAsync({ phone: demoProfile.phone, fullName: demoProfile.fullName, countryCode: demoProfile.countryCode, role: demoProfile.role, vehicles: demoProfile.vehicles, otp: otp as "730512" });
          await setTikisSessionToken(persistedDemoProfile.sessionToken);
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
      try { await requestSupabasePhoneOtp(phone); } catch { setOtpProvider("simulation"); }
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
    setFinishing(true);
    await new Promise((resolve) => setTimeout(resolve, 550));
    const localProfile = createRegisteredProfile({ fullName: validatedName, phone, countryCode: country.id, role: selectedRole, vehicles: selectedVehicles });
    const sanitizedReferralCode = referralCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    const referredByCode = sanitizedReferralCode.length >= 4 ? sanitizedReferralCode : undefined;
    try {
      const persistedProfile = supabaseAccessToken ? await registerSupabaseProfileMutation.mutateAsync({ phone: localProfile.phone, fullName: localProfile.fullName, countryCode: localProfile.countryCode, role: localProfile.role, vehicles: localProfile.vehicles, accessToken: supabaseAccessToken, referredByCode }) : await registerProfileMutation.mutateAsync({ phone: localProfile.phone, fullName: localProfile.fullName, countryCode: localProfile.countryCode, role: localProfile.role, vehicles: localProfile.vehicles, otp: otp as "730512", referredByCode });
      await setTikisSessionToken(persistedProfile.sessionToken);
      registerProfile(persistedProfile.profile);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setFinishing(false);
      setNameError(message && message.length < 180 ? message : "Impossible d’enregistrer votre profil de façon sécurisée. Vérifiez votre connexion puis réessayez.");
      haptic.error();
      return;
    }
    haptic.success();
    router.replace("/(tabs)");
  }

  const top = stage !== "welcome";

  return <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]} edges={["top", "bottom"]}><KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === "ios" ? "padding" : undefined}><ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">{top ? <OnboardingTop step={onboardingStep} theme={theme} onBack={() => { if (stage === "phone") setStage("welcome"); else if (stage === "otp") setStage("phone"); else if (stage === "role") setStage("phone"); else if (stage === "vehicles") setStage("role"); else setStage(selectedRole === "driver" ? "vehicles" : "role"); }} /> : null}{stage === "welcome" ? <WelcomeScreen language={language} onLanguageChange={setLanguage} onContinue={() => setStage("phone")} copy={copy} theme={theme} /> : null}{stage === "phone" ? <PhoneScreen country={country} value={phoneInput} error={phoneError} loading={sending} onCountryPress={() => setCountryPickerOpen(true)} onChange={(value) => { setPhoneInput(sanitizePhoneInput(value, country)); setPhoneError(""); }} onContinue={() => void requestOtp()} theme={theme} /> : null}{stage === "otp" ? <OtpScreen phone={phone} digits={digits} error={otpError} verifying={verifying} secondsLeft={secondsLeft} provider={otpProvider} onChangeDigit={updateDigit} onKeyPress={handleKeyPress} inputRefs={inputs} onResend={() => void resendOtp()} onSubmit={() => void submitOtp()} theme={theme} /> : null}{stage === "role" ? <RoleScreen selectedRole={selectedRole} onSelect={setSelectedRole} onContinue={continueRole} theme={theme} /> : null}{stage === "vehicles" ? <VehiclesScreen selected={selectedVehicles} onToggle={toggleVehicle} onContinue={continueVehicles} theme={theme} /> : null}{stage === "name" ? <NameScreen role={selectedRole} value={fullName} error={nameError} loading={finishing} onChange={(value) => { setFullName(sanitizeFullName(value, { preserveTrailingSeparator: true })); setNameError(""); }} onContinue={() => void finishRegistration()} referralCode={referralCode} referralFieldOpen={referralFieldOpen} onReferralFieldOpen={() => setReferralFieldOpen(true)} onReferralCodeChange={setReferralCode} theme={theme} /> : null}</ScrollView><CountryPicker visible={isCountryPickerOpen} selected={country} countries={availableCountries} onClose={() => setCountryPickerOpen(false)} onSelect={selectCountry} theme={theme} /></KeyboardAvoidingView></SafeAreaView>;
}

function OnboardingTop({ step, onBack, theme }: { step: number; onBack: () => void; theme: Palette }) { return <View style={styles.top}><Pressable accessibilityRole="button" accessibilityLabel="Étape précédente" onPress={onBack} style={({ pressed }) => [styles.backButton, { backgroundColor: theme.surface, borderColor: theme.border }, pressed && styles.pressed]}><MaterialIcons name="arrow-back" size={21} color={theme.foreground} /></Pressable><View style={styles.stepInfo}><Text style={[styles.stepLabel, { color: theme.primary }]}>INSCRIPTION</Text><Text style={[styles.stepCount, { color: theme.foreground }]}>Étape {step} sur 5</Text></View><View style={styles.stepDots}>{[1, 2, 3, 4, 5].map((item) => <View key={item} style={[styles.stepDot, { backgroundColor: theme.border }, item <= step && { backgroundColor: theme.primary }]} />)}</View></View>; }

function WelcomeScreen({ language, onLanguageChange, onContinue, copy, theme }: { language: Language; onLanguageChange: (language: Language) => void; onContinue: () => void; copy: (typeof welcomeCopy)[Language]; theme: Palette }) { const isFrench = language === "fr"; return <View style={styles.welcome}><View style={styles.brandArea}><Image source={require("@/assets/images/icon.png")} style={styles.logo} accessibilityLabel="Logo Tikis" /><View style={[styles.brandChip, { backgroundColor: theme.surface, borderColor: theme.border }]}><View style={[styles.brandStatus, { backgroundColor: theme.success }]} /><Text style={[styles.brandChipText, { color: theme.primary }]}>PLATEFORME DE LIVRAISON</Text></View></View><View style={styles.welcomeBody}><Text style={[styles.welcomeEyebrow, { color: theme.primary }]}>{copy.eyebrow}</Text><Text style={[styles.welcomeTitle, { color: theme.foreground }]}>{copy.title}</Text><Text style={[styles.welcomeSubtitle, { color: theme.muted }]}>{copy.subtitle}</Text><Text style={[styles.languageLabel, { color: theme.muted }]}>LANGUE</Text><View style={[styles.languageSwitch, { backgroundColor: theme.background, borderColor: theme.border }]}><Pressable onPress={() => onLanguageChange("fr")} style={({ pressed }) => [styles.languageOption, language === "fr" && { backgroundColor: theme.surface, borderColor: theme.primary }, pressed && styles.pressed]}><Text style={[styles.languageText, { color: theme.muted }, language === "fr" && { color: theme.primary }]}>Français</Text></Pressable><Pressable onPress={() => onLanguageChange("en")} style={({ pressed }) => [styles.languageOption, language === "en" && { backgroundColor: theme.surface, borderColor: theme.primary }, pressed && styles.pressed]}><Text style={[styles.languageText, { color: theme.muted }, language === "en" && { color: theme.primary }]}>English</Text></Pressable></View><View style={styles.trustList}><TrustRow icon="verified-user" title="Livreurs vérifiés" text="Chaque livreur passe par une validation manuelle avant de pouvoir proposer ses services." theme={theme} /><TrustRow icon="lock" title="Suivi de A à Z" text="Suivez votre livraison en temps réel, du ramassage à la remise en main propre." theme={theme} /><TrustRow icon="shield" title="Paiement sécurisé" text="Le prix est préautorisé sur votre wallet Tikis, libéré à la confirmation." theme={theme} /></View></View><View><TikisButton authStyle label={copy.continue} icon="arrow-forward" onPress={onContinue} style={styles.welcomeButton} /><Text style={[styles.legal, { color: theme.muted }]}><Text style={[styles.legalLink, { color: theme.primary }]} onPress={() => router.push("/legal/terms" as any)}>{isFrench ? "Conditions d'utilisation" : "Terms of use"}</Text>{isFrench ? " et " : " and "}<Text style={[styles.legalLink, { color: theme.primary }]} onPress={() => router.push("/privacy" as any)}>{isFrench ? "politique de confidentialité" : "privacy policy"}</Text></Text></View></View>; }

function TrustRow({ icon, title, text, theme }: { icon: React.ComponentProps<typeof MaterialIcons>["name"]; title: string; text: string; theme: Palette }) { return <View style={[styles.trustRow, { backgroundColor: theme.surface, borderColor: theme.border }]}><View style={[styles.trustIcon, { backgroundColor: theme.background }]}><MaterialIcons name={icon} size={19} color={theme.primary} /></View><View style={styles.trustInfo}><Text style={[styles.trustTitle, { color: theme.foreground }]}>{title}</Text><Text style={[styles.trustText, { color: theme.muted }]}>{text}</Text></View></View>; }

function PhoneScreen({ country, value, error, loading, onCountryPress, onChange, onContinue, theme }: { country: CountrySpec; value: string; error: string; loading: boolean; onCountryPress: () => void; onChange: (value: string) => void; onContinue: () => void; theme: Palette }) { return <View style={styles.form}><View style={[styles.heroIcon, { backgroundColor: theme.surface, borderColor: theme.border }]}><MaterialIcons name="phone-iphone" size={30} color={theme.primary} /></View><Text style={[styles.title, { color: theme.foreground }]}>Quel est votre numéro ?</Text><Text style={[styles.subtitle, { color: theme.muted }]}>Nous l’utiliserons pour sécuriser votre compte et vous connecter à Tikis.</Text><Text style={[styles.fieldLabel, { color: theme.muted }]}>PAYS / RÉGION</Text><Pressable accessibilityRole="button" onPress={onCountryPress} style={({ pressed }) => [styles.countryField, { backgroundColor: theme.surface, borderColor: theme.border }, pressed && styles.pressed]}><View style={[styles.countryBadge, { backgroundColor: theme.background }]}><Text style={styles.countryFlag}>{countryFlagEmoji(country.id)}</Text></View><View style={styles.countryInfo}><Text style={[styles.countryName, { color: theme.foreground }]}>{country.name}</Text><Text style={[styles.countryHint, { color: theme.muted }]}>{country.dialCode} · {country.digits} chiffres</Text></View><MaterialIcons name="keyboard-arrow-down" size={24} color={theme.muted} /></Pressable><Text style={[styles.fieldLabel, { color: theme.muted }]}>NUMÉRO DE TÉLÉPHONE</Text><View style={[styles.phoneField, { backgroundColor: theme.surface, borderColor: theme.border }, error && { borderColor: theme.error }]}><View style={[styles.dialCode, { borderColor: theme.border }]}><Text style={[styles.dialCodeText, { color: theme.foreground }]}>{country.dialCode}</Text></View><TextInput accessibilityLabel="Numéro de téléphone" keyboardType="phone-pad" placeholder={country.groups.map((size) => "0".repeat(size)).join(" ")} placeholderTextColor={theme.muted} value={formatLocalPhone(value, country)} onChangeText={onChange} style={[styles.phoneInput, { color: theme.foreground }]} returnKeyType="done" onSubmitEditing={onContinue} /></View>{error ? <Text style={[styles.error, { color: theme.error }]}>{error}</Text> : <Text style={[styles.helper, { color: theme.muted }]}>Les espaces sont ajoutés automatiquement selon le format de votre pays.</Text>}<TikisButton authStyle label="Recevoir mon code" icon="sms" onPress={onContinue} loading={loading} style={styles.actionButton} /></View>; }

function OtpScreen({ phone, digits, error, verifying, secondsLeft, provider, onChangeDigit, onKeyPress, inputRefs, onResend, onSubmit, theme }: { phone: string; digits: string[]; error: string; verifying: boolean; secondsLeft: number; provider: "simulation" | "supabase"; onChangeDigit: (index: number, value: string) => void; onKeyPress: (index: number, key: string) => void; inputRefs: React.MutableRefObject<(TextInput | null)[]>; onResend: () => void; onSubmit: () => void; theme: Palette }) { return <View style={styles.form}><View style={[styles.heroIcon, { backgroundColor: theme.surface, borderColor: theme.border }]}><MaterialIcons name="mark-unread-chat-alt" size={30} color={theme.primary} /></View><Text style={[styles.title, { color: theme.foreground }]}>Confirmez votre numéro</Text><Text style={[styles.subtitle, { color: theme.muted }]}>Saisissez le code à 6 chiffres envoyé au <Text style={[styles.phoneHighlight, { color: theme.primary }]}>{phone}</Text>.</Text><View style={[styles.simulationNotice, { backgroundColor: theme.surface, borderColor: theme.border }]}><MaterialIcons name={provider === "supabase" ? "verified-user" : "science"} size={18} color={theme.primary} /><Text style={[styles.simulationText, { color: theme.muted }]}>{provider === "supabase" ? "Code SMS sécurisé envoyé par Supabase Auth." : <>Mode simulation : utilisez le code <Text style={[styles.simulationCode, { color: theme.primary }]}>{SIMULATION_OTP}</Text>.</>}</Text></View><View style={styles.otpRow}>{digits.map((digit, index) => <TextInput key={index} ref={(node) => { inputRefs.current[index] = node; }} accessibilityLabel={`Chiffre ${index + 1} du code`} keyboardType="number-pad" maxLength={6} value={digit} onChangeText={(value) => onChangeDigit(index, value)} onKeyPress={({ nativeEvent }) => onKeyPress(index, nativeEvent.key)} style={[styles.otpInput, { backgroundColor: theme.surface, borderColor: theme.border, color: theme.foreground }, error && { borderColor: theme.error }]} textAlign="center" />)}</View>{error ? <Text style={[styles.error, { color: theme.error }]}>{error}</Text> : null}<TikisButton authStyle label="Vérifier le code" icon="verified" onPress={onSubmit} loading={verifying} disabled={digits.join("").length !== 6} style={styles.actionButton} /><Pressable disabled={secondsLeft > 0} onPress={onResend} style={({ pressed }) => [styles.resend, (pressed || secondsLeft > 0) && styles.pressed]}><Text style={[styles.resendText, { color: theme.primary }, secondsLeft > 0 && { color: theme.muted }]}>{secondsLeft > 0 ? `Renvoyer le code dans ${secondsLeft}s` : "Renvoyer le code"}</Text></Pressable></View>; }

function RoleScreen({ selectedRole, onSelect, onContinue, theme }: { selectedRole: UserRole | null; onSelect: (role: UserRole) => void; onContinue: () => void; theme: Palette }) { return <View style={styles.form}><View style={[styles.heroIcon, { backgroundColor: theme.surface, borderColor: theme.border }]}><MaterialIcons name="account-tree" size={30} color={theme.primary} /></View><Text style={[styles.title, { color: theme.foreground }]}>Comment utiliserez-vous Tikis ?</Text><Text style={[styles.subtitle, { color: theme.muted }]}>Choisissez votre type de compte. Ce choix sera définitif après la création de votre compte.</Text><RoleChoice role="sender" selected={selectedRole === "sender"} icon="inventory-2" title="Je suis expéditeur" text="Je publie des livraisons et choisis un livreur." onPress={() => onSelect("sender")} theme={theme} /><RoleChoice role="driver" selected={selectedRole === "driver"} icon="two-wheeler" title="Je suis livreur" text="Je propose mes services sur les courses compatibles." onPress={() => onSelect("driver")} theme={theme} /><TikisButton authStyle label="Continuer" icon="arrow-forward" onPress={onContinue} disabled={!selectedRole} style={styles.actionButton} /></View>; }

function RoleChoice({ selected, icon, title, text, onPress, theme }: { role: UserRole; selected: boolean; icon: React.ComponentProps<typeof MaterialIcons>["name"]; title: string; text: string; onPress: () => void; theme: Palette }) { return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.roleChoice, { backgroundColor: theme.surface, borderColor: theme.border }, selected && { borderColor: theme.primary, backgroundColor: theme.surface }, pressed && styles.pressed]}><View style={[styles.roleChoiceIcon, { backgroundColor: theme.background }, selected && { backgroundColor: theme.primary }]}><MaterialIcons name={icon} size={27} color={selected ? theme.surface : theme.primary} /></View><View style={styles.roleChoiceInfo}><Text style={[styles.roleChoiceTitle, { color: theme.foreground }]}>{title}</Text><Text style={[styles.roleChoiceText, { color: theme.muted }]}>{text}</Text></View><View style={[styles.radio, { borderColor: theme.border }, selected && { borderColor: theme.primary }]}>{selected ? <View style={[styles.radioInner, { backgroundColor: theme.primary }]} /> : null}</View></Pressable>; }

function VehiclesScreen({ selected, onToggle, onContinue, theme }: { selected: VehicleType[]; onToggle: (vehicle: VehicleType) => void; onContinue: () => void; theme: Palette }) { return <View style={styles.form}><View style={[styles.heroIcon, { backgroundColor: theme.surface, borderColor: theme.border }]}><MaterialIcons name="two-wheeler" size={30} color={theme.primary} /></View><Text style={[styles.title, { color: theme.foreground }]}>Avec quels engins livrez-vous ?</Text><Text style={[styles.subtitle, { color: theme.muted }]}>Sélectionnez un ou plusieurs engins. Nous vous proposerons uniquement les courses compatibles.</Text><View style={styles.vehicleGrid}>{VEHICLES.map((vehicle) => <Pressable key={vehicle.type} onPress={() => onToggle(vehicle.type)} style={({ pressed }) => [styles.vehicleCard, { backgroundColor: theme.surface, borderColor: theme.border }, selected.includes(vehicle.type) && { backgroundColor: theme.primary, borderColor: theme.primary }, pressed && styles.pressed]}><MaterialIcons name={vehicle.icon} size={27} color={selected.includes(vehicle.type) ? theme.surface : theme.primary} /><Text style={[styles.vehicleTitle, { color: theme.foreground }, selected.includes(vehicle.type) && { color: theme.surface }]}>{vehicle.type}</Text><Text style={[styles.vehicleText, { color: theme.muted }, selected.includes(vehicle.type) && { color: theme.surface, opacity: 0.85 }]}>{vehicle.description}</Text><View style={[styles.vehicleCheck, { borderColor: theme.border, backgroundColor: theme.surface }, selected.includes(vehicle.type) && { backgroundColor: theme.success, borderColor: theme.success }]}>{selected.includes(vehicle.type) ? <MaterialIcons name="check" size={14} color={theme.surface} /> : null}</View></Pressable>)}</View><TikisButton authStyle label="Continuer" icon="arrow-forward" onPress={onContinue} disabled={selected.length === 0} style={styles.actionButton} /></View>; }

function NameScreen({ role, value, error, loading, onChange, onContinue, referralCode, referralFieldOpen, onReferralFieldOpen, onReferralCodeChange, theme }: { role: UserRole | null; value: string; error: string; loading: boolean; onChange: (value: string) => void; onContinue: () => void; referralCode: string; referralFieldOpen: boolean; onReferralFieldOpen: () => void; onReferralCodeChange: (value: string) => void; theme: Palette }) { return <View style={styles.form}><View style={[styles.heroIcon, { backgroundColor: theme.surface, borderColor: theme.border }]}><MaterialIcons name="badge" size={30} color={theme.primary} /></View><Text style={[styles.title, { color: theme.foreground }]}>Comment devons-nous vous appeler ?</Text><Text style={[styles.subtitle, { color: theme.muted }]}>{role === "driver" ? "Votre nom sera visible par les expéditeurs après confirmation d’une mission." : "Votre nom sera partagé avec le livreur uniquement après l’attribution d’une course."}</Text><Text style={[styles.fieldLabel, { color: theme.muted }]}>NOM</Text><TextInput accessibilityLabel="Nom" autoCapitalize="words" autoComplete="name" maxLength={70} placeholder="Ex. Mariam ou Mariam Ouédraogo" placeholderTextColor={theme.muted} value={value} onChangeText={onChange} style={[styles.nameInput, { backgroundColor: theme.surface, borderColor: theme.border, color: theme.foreground }, error && { borderColor: theme.error }]} returnKeyType={referralFieldOpen ? "next" : "done"} onSubmitEditing={referralFieldOpen ? undefined : onContinue} />{error ? <Text style={[styles.error, { color: theme.error }]}>{error}</Text> : <Text style={[styles.helper, { color: theme.muted }]}>Un nom unique est accepté. Seuls les lettres, espaces, apostrophes et traits d’union sont autorisés.</Text>}{referralFieldOpen ? <><Text style={[styles.fieldLabel, { color: theme.muted }]}>CODE DE PARRAINAGE (FACULTATIF)</Text><TextInput accessibilityLabel="Code de parrainage" autoCapitalize="characters" autoCorrect={false} maxLength={8} placeholder="Ex. MARIA42" placeholderTextColor={theme.muted} value={referralCode} onChangeText={(text) => onReferralCodeChange(text.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))} style={[styles.nameInput, { backgroundColor: theme.surface, borderColor: theme.border, color: theme.foreground }]} returnKeyType="done" onSubmitEditing={onContinue} /><Text style={[styles.helper, { color: theme.muted }]}>Un ami vous a parrainé ? Saisissez son code ici.</Text></> : <Pressable accessibilityRole="button" onPress={onReferralFieldOpen} style={({ pressed }) => [styles.referralToggle, pressed && styles.pressed]}><MaterialIcons name="card-giftcard" size={16} color={theme.primary} /><Text style={[styles.referralToggleText, { color: theme.primary }]}>J’ai un code de parrainage</Text></Pressable>}<View style={[styles.lockedRole, { backgroundColor: theme.surface, borderColor: theme.border }]}><MaterialIcons name="lock" size={17} color={theme.primary} /><Text style={[styles.lockedRoleText, { color: theme.muted }]}>Votre compte {role === "driver" ? "livreur" : "expéditeur"} sera verrouillé après inscription.</Text></View><TikisButton authStyle label="Créer mon compte" icon="check-circle" onPress={onContinue} loading={loading} style={styles.actionButton} /></View>; }

function CountryPicker({ visible, selected, countries, onClose, onSelect, theme }: { visible: boolean; selected: CountrySpec; countries: CountrySpec[]; onClose: () => void; onSelect: (country: CountrySpec) => void; theme: Palette }) { return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}><View style={styles.modal}><Pressable style={styles.modalScrim} onPress={onClose} /><View style={[styles.countrySheet, { backgroundColor: theme.surface }]}><View style={[styles.sheetHandle, { backgroundColor: theme.border }]} /><View style={styles.sheetTop}><View><Text style={[styles.sheetTitle, { color: theme.foreground }]}>Choisir un pays</Text><Text style={[styles.sheetSubtitle, { color: theme.muted }]}>L’indicatif et le format du numéro seront adaptés.</Text></View><Pressable onPress={onClose} style={[styles.sheetClose, { backgroundColor: theme.background }]}><MaterialIcons name="close" size={20} color={theme.foreground} /></Pressable></View>{countries.map((country) => <Pressable key={country.id} onPress={() => onSelect(country)} style={({ pressed }) => [styles.countryRow, { backgroundColor: theme.surface }, country.id === selected.id && { backgroundColor: theme.background, borderColor: theme.primary }, pressed && styles.pressed]}><View style={[styles.countryBadge, { backgroundColor: theme.background }]}><Text style={styles.countryFlag}>{countryFlagEmoji(country.id)}</Text></View><View style={styles.countryInfo}><Text style={[styles.countryName, { color: theme.foreground }]}>{country.name}</Text><Text style={[styles.countryHint, { color: theme.muted }]}>{country.dialCode} · {country.digits} chiffres</Text></View>{country.id === selected.id ? <MaterialIcons name="check-circle" size={21} color={theme.success} /> : null}</Pressable>)}</View></View></Modal>; }

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  keyboard: { flex: 1 },
  scroll: { flexGrow: 1, padding: 16, paddingBottom: 28 },

  welcome: { flex: 1, justifyContent: "space-between" },
  brandArea: { alignItems: "center", paddingTop: 18 },
  logo: { width: 80, height: 80, borderRadius: 14 },
  brandChip: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 8, paddingHorizontal: 10, height: 28, marginTop: 12, borderWidth: StyleSheet.hairlineWidth },
  brandStatus: { width: 6, height: 6, borderRadius: 3 },
  brandChipText: { fontSize: 10.5, fontWeight: "600", letterSpacing: 0.6 },
  welcomeBody: { marginTop: 24 },
  welcomeEyebrow: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.8 },
  welcomeTitle: { fontSize: 28, lineHeight: 34, fontWeight: "700", letterSpacing: -0.5, marginTop: 8 },
  welcomeSubtitle: { fontSize: 15, lineHeight: 22, marginTop: 10 },
  languageLabel: { fontSize: 11, fontWeight: "600", letterSpacing: 0.7, marginTop: 20, marginBottom: 8 },
  languageSwitch: { flexDirection: "row", borderRadius: 9, padding: 4, gap: 4, borderWidth: StyleSheet.hairlineWidth },
  languageOption: { flex: 1, height: 40, borderRadius: 7, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth, borderColor: "transparent" },
  languageText: { fontSize: 13, fontWeight: "600" },
  trustList: { marginTop: 18, gap: 8 },
  trustRow: { flexDirection: "row", gap: 11, padding: 12, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth },
  trustIcon: { width: 36, height: 36, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  trustInfo: { flex: 1 },
  trustTitle: { fontSize: 13, fontWeight: "600" },
  trustText: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  welcomeButton: { marginTop: 24 },
  legal: { fontSize: 11, lineHeight: 17, textAlign: "center", marginTop: 14, paddingHorizontal: 12 },
  legalLink: { fontWeight: "600" },

  top: { flexDirection: "row", alignItems: "center", marginBottom: 18 },
  backButton: { width: 40, height: 40, borderRadius: 9, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth },
  stepInfo: { flex: 1, marginLeft: 10 },
  stepLabel: { fontSize: 10, fontWeight: "600", letterSpacing: 0.7 },
  stepCount: { fontSize: 13, fontWeight: "600", marginTop: 2 },
  stepDots: { flexDirection: "row", gap: 4 },
  stepDot: { width: 7, height: 7, borderRadius: 4 },

  form: { flex: 1, paddingTop: 5 },
  heroIcon: { width: 64, height: 64, borderRadius: 12, alignItems: "center", justifyContent: "center", marginBottom: 18, borderWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 24, lineHeight: 30, fontWeight: "700", letterSpacing: -0.4 },
  subtitle: { fontSize: 14, lineHeight: 20, marginTop: 8 },

  fieldLabel: { fontSize: 11, fontWeight: "600", letterSpacing: 0.7, marginTop: 20, marginBottom: 8 },
  countryField: { minHeight: 58, borderRadius: 10, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", borderWidth: StyleSheet.hairlineWidth },
  countryBadge: { width: 36, height: 36, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  countryFlag: { fontSize: 18 },
  countryInfo: { flex: 1, marginLeft: 11 },
  countryName: { fontSize: 14, fontWeight: "600" },
  countryHint: { fontSize: 11, marginTop: 2 },

  phoneField: { height: 58, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", paddingHorizontal: 14 },
  dialCode: { paddingRight: 12, borderRightWidth: StyleSheet.hairlineWidth },
  dialCodeText: { fontSize: 15, fontWeight: "600" },
  phoneInput: { flex: 1, fontSize: 17, fontWeight: "500", marginLeft: 12, letterSpacing: 0.4 },

  helper: { fontSize: 12, lineHeight: 18, marginTop: 8 },
  error: { fontSize: 12, lineHeight: 18, marginTop: 8, fontWeight: "600" },
  actionButton: { marginTop: 24 },

  simulationNotice: { flexDirection: "row", gap: 9, padding: 12, borderRadius: 10, marginTop: 18, borderWidth: StyleSheet.hairlineWidth },
  simulationText: { flex: 1, fontSize: 12, lineHeight: 18 },
  simulationCode: { fontWeight: "700" },
  phoneHighlight: { fontWeight: "700" },

  otpRow: { flexDirection: "row", justifyContent: "space-between", gap: 8, marginTop: 22 },
  otpInput: { flex: 1, height: 54, borderRadius: 9, borderWidth: StyleSheet.hairlineWidth, fontSize: 22, fontWeight: "700" },

  resend: { alignItems: "center", paddingVertical: 14 },
  resendText: { fontSize: 13, fontWeight: "600" },

  roleChoice: { marginTop: 12, padding: 13, minHeight: 96, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", gap: 12 },
  roleChoiceIcon: { width: 48, height: 48, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  roleChoiceInfo: { flex: 1 },
  roleChoiceTitle: { fontSize: 15, fontWeight: "600" },
  roleChoiceText: { fontSize: 12, lineHeight: 17, marginTop: 3 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  radioInner: { width: 11, height: 11, borderRadius: 6 },

  vehicleGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 18 },
  vehicleCard: { width: "48.5%", minHeight: 116, borderRadius: 10, padding: 12, borderWidth: StyleSheet.hairlineWidth },
  vehicleTitle: { fontSize: 14, fontWeight: "600", marginTop: 10 },
  vehicleText: { fontSize: 11, marginTop: 3 },
  vehicleCheck: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", position: "absolute", right: 10, top: 10 },

  nameInput: { minHeight: 56, paddingHorizontal: 14, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, fontSize: 16, fontWeight: "500" },
  referralToggle: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 18, alignSelf: "flex-start" },
  referralToggleText: { fontSize: 13, fontWeight: "600" },
  lockedRole: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, borderRadius: 10, marginTop: 14, borderWidth: StyleSheet.hairlineWidth },
  lockedRoleText: { flex: 1, fontSize: 12, lineHeight: 18 },

  modal: { flex: 1, justifyContent: "flex-end" },
  modalScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.42)" },
  countrySheet: { borderTopLeftRadius: 14, borderTopRightRadius: 14, padding: 16, paddingBottom: 24 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 16 },
  sheetTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 },
  sheetTitle: { fontSize: 18, fontWeight: "700" },
  sheetSubtitle: { fontSize: 12, marginTop: 3 },
  sheetClose: { width: 36, height: 36, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  countryRow: { minHeight: 58, flexDirection: "row", alignItems: "center", paddingHorizontal: 8, borderRadius: 10, marginTop: 4, borderWidth: StyleSheet.hairlineWidth, borderColor: "transparent" },
  countryRowActive: { },

  pressed: { opacity: 0.7 },
});
