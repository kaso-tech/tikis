import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Image, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { TikisButton } from "@/components/tikis/ui";
import { haptic } from "@/lib/haptics";
import { OTP_MAX_ATTEMPTS, verifySimulationOtp } from "@/lib/otp-simulator";
import { COUNTRIES, createRegisteredProfile, detectCountry, findSimulatedAccount, formatLocalPhone, isValidInternationalPhone, normalizedInternationalPhone, sanitizeFullName, sanitizePhoneInput, validateFullName, type CountrySpec } from "@/lib/registration-rules";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";
import type { UserRole, VehicleType } from "@/shared/tikis-domain";
import { SIMULATION_OTP } from "@/shared/tikis-domain";

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

export function AuthFlow() {
  const { signInProfile, registerProfile } = useTikisStore();
  const lookupProfileMutation = trpc.profiles.lookup.useMutation();
  const registerProfileMutation = trpc.profiles.register.useMutation();
  const [stage, setStage] = useState<Stage>("welcome");
  const [language, setLanguage] = useState<Language>("fr");
  const [country, setCountry] = useState<CountrySpec>(() => detectCountry());
  const [isCountryPickerOpen, setCountryPickerOpen] = useState(false);
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [sending, setSending] = useState(false);
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [otpError, setOtpError] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(RESEND_SECONDS);
  const [selectedRole, setSelectedRole] = useState<UserRole | null>(null);
  const [selectedVehicles, setSelectedVehicles] = useState<VehicleType[]>([]);
  const [fullName, setFullName] = useState("");
  const [nameError, setNameError] = useState("");
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
    await new Promise((resolve) => setTimeout(resolve, 550));
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
    await new Promise((resolve) => setTimeout(resolve, 650));
    if (verifySimulationOtp(otp)) {
      let existingProfile = null;
      try {
        existingProfile = await lookupProfileMutation.mutateAsync({ phone, otp: otp as "730512" });
      } catch {
        // The simulation remains usable offline; the profile is persisted on the next successful registration call.
      }
      const demoProfile = findSimulatedAccount(phone);
      haptic.success();
      if (existingProfile) {
        signInProfile(existingProfile);
        router.replace("/(tabs)");
        return;
      }
      if (demoProfile) {
        try {
          const persistedDemoProfile = await registerProfileMutation.mutateAsync({ phone: demoProfile.phone, fullName: demoProfile.fullName, role: demoProfile.role, vehicles: demoProfile.vehicles, otp: otp as "730512" });
          signInProfile(persistedDemoProfile);
        } catch {
          signInProfile(demoProfile);
        }
        router.replace("/(tabs)");
        return;
      }
      setVerifying(false);
      setStage("role");
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

  function resendOtp() {
    if (secondsLeft > 0) return;
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
    const localProfile = createRegisteredProfile({ fullName: validatedName, phone, role: selectedRole, vehicles: selectedVehicles });
    try {
      const persistedProfile = await registerProfileMutation.mutateAsync({ phone: localProfile.phone, fullName: localProfile.fullName, role: localProfile.role, vehicles: localProfile.vehicles, otp: otp as "730512" });
      registerProfile(persistedProfile);
    } catch {
      setFinishing(false);
      setNameError("Impossible d’enregistrer votre profil de façon sécurisée. Vérifiez votre connexion puis réessayez.");
      haptic.error();
      return;
    }
    haptic.success();
    router.replace("/(tabs)");
  }

  const top = stage === "welcome" ? null : <OnboardingTop step={onboardingStep} onBack={() => { if (stage === "phone") setStage("welcome"); else if (stage === "otp") setStage("phone"); else if (stage === "role") setStage("phone"); else if (stage === "vehicles") setStage("role"); else setStage(selectedRole === "driver" ? "vehicles" : "role"); }} />;

  return <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}><KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === "ios" ? "padding" : undefined}><ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">{top}{stage === "welcome" ? <WelcomeScreen language={language} onLanguageChange={setLanguage} onContinue={() => setStage("phone")} copy={copy} /> : null}{stage === "phone" ? <PhoneScreen country={country} value={phoneInput} error={phoneError} loading={sending} onCountryPress={() => setCountryPickerOpen(true)} onChange={(value) => { setPhoneInput(sanitizePhoneInput(value, country)); setPhoneError(""); }} onContinue={() => void requestOtp()} /> : null}{stage === "otp" ? <OtpScreen phone={phone} digits={digits} error={otpError} verifying={verifying} secondsLeft={secondsLeft} onChangeDigit={updateDigit} onKeyPress={handleKeyPress} inputRefs={inputs} onResend={resendOtp} onSubmit={() => void submitOtp()} /> : null}{stage === "role" ? <RoleScreen selectedRole={selectedRole} onSelect={setSelectedRole} onContinue={continueRole} /> : null}{stage === "vehicles" ? <VehiclesScreen selected={selectedVehicles} onToggle={toggleVehicle} onContinue={continueVehicles} /> : null}{stage === "name" ? <NameScreen role={selectedRole} value={fullName} error={nameError} loading={finishing} onChange={(value) => { setFullName(sanitizeFullName(value, { preserveTrailingSeparator: true })); setNameError(""); }} onContinue={() => void finishRegistration()} /> : null}</ScrollView></KeyboardAvoidingView><CountryPicker visible={isCountryPickerOpen} selected={country} onClose={() => setCountryPickerOpen(false)} onSelect={selectCountry} /></SafeAreaView>;
}

function OnboardingTop({ step, onBack }: { step: number; onBack: () => void }) { return <View style={styles.top}><Pressable accessibilityRole="button" accessibilityLabel="Étape précédente" onPress={onBack} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><MaterialIcons name="arrow-back" size={21} color="#0B1F3A" /></Pressable><View style={styles.stepInfo}><Text style={styles.stepLabel}>INSCRIPTION</Text><Text style={styles.stepCount}>Étape {step} sur 5</Text></View><View style={styles.stepDots}>{[1, 2, 3, 4, 5].map((item) => <View key={item} style={[styles.stepDot, item <= step && styles.stepDotActive]} />)}</View></View>; }

function WelcomeScreen({ language, onLanguageChange, onContinue, copy }: { language: Language; onLanguageChange: (language: Language) => void; onContinue: () => void; copy: (typeof welcomeCopy)[Language] }) { const isFrench = language === "fr"; return <View style={styles.welcome}><View style={styles.brandArea}><Image source={require("@/assets/images/icon.png")} style={styles.logo} accessibilityLabel="Logo Tikis" /><View style={styles.brandChip}><View style={styles.brandStatus} /><Text style={styles.brandChipText}>PLATEFORME DE LIVRAISON</Text></View></View><View style={styles.welcomeBody}><Text style={styles.welcomeEyebrow}>{copy.eyebrow}</Text><Text style={styles.welcomeTitle}>{copy.title}</Text><Text style={styles.welcomeSubtitle}>{copy.subtitle}</Text><Text style={styles.languageLabel}>LANGUE</Text><View style={styles.languageSwitch}><Pressable onPress={() => onLanguageChange("fr")} style={({ pressed }) => [styles.languageOption, language === "fr" && styles.languageActive, pressed && styles.pressed]}><Text style={[styles.languageText, language === "fr" && styles.languageTextActive]}>Français</Text></Pressable><Pressable onPress={() => onLanguageChange("en")} style={({ pressed }) => [styles.languageOption, language === "en" && styles.languageActive, pressed && styles.pressed]}><Text style={[styles.languageText, language === "en" && styles.languageTextActive]}>English</Text></Pressable></View><View style={styles.trustList}><TrustRow icon="verified-user" title="Compte sécurisé" text="Votre numéro est protégé par une vérification OTP." /><TrustRow icon="handshake" title="Mise en relation transparente" text="Les informations sensibles sont partagées après confirmation." /></View><TikisButton label={copy.continue} icon="arrow-forward" onPress={onContinue} style={styles.welcomeButton} /><Text style={styles.legal}>{isFrench ? "En continuant, vous acceptez nos " : "By continuing, you accept our "}<Text onPress={() => router.push("/legal/terms" as any)} style={styles.legalLink}>{isFrench ? "conditions d’utilisation" : "terms of use"}</Text>{isFrench ? " et notre " : " and "}<Text onPress={() => router.push("/legal/privacy" as any)} style={styles.legalLink}>{isFrench ? "politique de confidentialité" : "privacy policy"}</Text>.</Text></View></View>; }

function TrustRow({ icon, title, text }: { icon: React.ComponentProps<typeof MaterialIcons>["name"]; title: string; text: string }) { return <View style={styles.trustRow}><View style={styles.trustIcon}><MaterialIcons name={icon} size={19} color="#007B8B" /></View><View style={styles.trustInfo}><Text style={styles.trustTitle}>{title}</Text><Text style={styles.trustText}>{text}</Text></View></View>; }

function PhoneScreen({ country, value, error, loading, onCountryPress, onChange, onContinue }: { country: CountrySpec; value: string; error: string; loading: boolean; onCountryPress: () => void; onChange: (value: string) => void; onContinue: () => void }) { return <View style={styles.form}><View style={styles.heroIcon}><MaterialIcons name="phone-iphone" size={30} color="#007B8B" /></View><Text style={styles.title}>Quel est votre numéro ?</Text><Text style={styles.subtitle}>Nous l’utiliserons pour sécuriser votre compte et vous connecter à Tikis.</Text><Text style={styles.fieldLabel}>PAYS / RÉGION</Text><Pressable accessibilityRole="button" onPress={onCountryPress} style={({ pressed }) => [styles.countryField, pressed && styles.pressed]}><View style={styles.countryBadge}><Text style={styles.countryFlag}>{country.flag}</Text></View><View style={styles.countryInfo}><Text style={styles.countryName}>{country.name}</Text><Text style={styles.countryHint}>{country.dialCode} · {country.digits} chiffres</Text></View><MaterialIcons name="keyboard-arrow-down" size={24} color="#697386" /></Pressable><Text style={styles.fieldLabel}>NUMÉRO DE TÉLÉPHONE</Text><View style={[styles.phoneField, error && styles.fieldError]}><View style={styles.dialCode}><Text style={styles.dialCodeText}>{country.dialCode}</Text></View><TextInput accessibilityLabel="Numéro de téléphone" keyboardType="phone-pad" placeholder={country.groups.map((size) => "0".repeat(size)).join(" ")} placeholderTextColor="#A1ADBC" value={formatLocalPhone(value, country)} onChangeText={onChange} style={styles.phoneInput} returnKeyType="done" onSubmitEditing={onContinue} /></View>{error ? <Text style={styles.error}>{error}</Text> : <Text style={styles.helper}>Les espaces sont ajoutés automatiquement selon le format de votre pays.</Text>}<TikisButton label="Recevoir mon code" icon="sms" onPress={onContinue} loading={loading} style={styles.actionButton} /></View>; }

function OtpScreen({ phone, digits, error, verifying, secondsLeft, onChangeDigit, onKeyPress, inputRefs, onResend, onSubmit }: { phone: string; digits: string[]; error: string; verifying: boolean; secondsLeft: number; onChangeDigit: (index: number, value: string) => void; onKeyPress: (index: number, key: string) => void; inputRefs: React.MutableRefObject<(TextInput | null)[]>; onResend: () => void; onSubmit: () => void }) { return <View style={styles.form}><View style={styles.heroIcon}><MaterialIcons name="mark-unread-chat-alt" size={30} color="#007B8B" /></View><Text style={styles.title}>Confirmez votre numéro</Text><Text style={styles.subtitle}>Saisissez le code à 6 chiffres envoyé au <Text style={styles.phoneHighlight}>{phone}</Text>.</Text><View style={styles.simulationNotice}><MaterialIcons name="science" size={18} color="#006572" /><Text style={styles.simulationText}>Mode simulation : utilisez le code <Text style={styles.simulationCode}>{SIMULATION_OTP}</Text>.</Text></View><View style={styles.otpRow}>{digits.map((digit, index) => <TextInput key={index} ref={(node) => { inputRefs.current[index] = node; }} accessibilityLabel={`Chiffre ${index + 1} du code`} keyboardType="number-pad" maxLength={6} value={digit} onChangeText={(value) => onChangeDigit(index, value)} onKeyPress={({ nativeEvent }) => onKeyPress(index, nativeEvent.key)} style={[styles.otpInput, error && styles.otpError]} textAlign="center" />)}</View>{error ? <Text style={styles.error}>{error}</Text> : null}<TikisButton label="Vérifier le code" icon="verified" onPress={onSubmit} loading={verifying} disabled={digits.join("").length !== 6} style={styles.actionButton} /><Pressable disabled={secondsLeft > 0} onPress={onResend} style={({ pressed }) => [styles.resend, (pressed || secondsLeft > 0) && styles.pressed]}><Text style={[styles.resendText, secondsLeft > 0 && styles.resendDisabled]}>{secondsLeft > 0 ? `Renvoyer le code dans ${secondsLeft}s` : "Renvoyer le code"}</Text></Pressable></View>; }

function RoleScreen({ selectedRole, onSelect, onContinue }: { selectedRole: UserRole | null; onSelect: (role: UserRole) => void; onContinue: () => void }) { return <View style={styles.form}><View style={styles.heroIcon}><MaterialIcons name="account-tree" size={30} color="#007B8B" /></View><Text style={styles.title}>Comment utiliserez-vous Tikis ?</Text><Text style={styles.subtitle}>Choisissez votre type de compte. Ce choix sera définitif après la création de votre compte.</Text><RoleChoice role="sender" selected={selectedRole === "sender"} icon="inventory-2" title="Je suis expéditeur" text="Je publie des livraisons et choisis un livreur." onPress={() => onSelect("sender")} /><RoleChoice role="driver" selected={selectedRole === "driver"} icon="two-wheeler" title="Je suis livreur" text="Je propose mes services sur les courses compatibles." onPress={() => onSelect("driver")} /><TikisButton label="Continuer" icon="arrow-forward" onPress={onContinue} disabled={!selectedRole} style={styles.actionButton} /></View>; }

function RoleChoice({ selected, icon, title, text, onPress }: { role: UserRole; selected: boolean; icon: React.ComponentProps<typeof MaterialIcons>["name"]; title: string; text: string; onPress: () => void }) { return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.roleChoice, selected && styles.roleChoiceActive, pressed && styles.pressed]}><View style={[styles.roleChoiceIcon, selected && styles.roleChoiceIconActive]}><MaterialIcons name={icon} size={27} color={selected ? "#FFFFFF" : "#007B8B"} /></View><View style={styles.roleChoiceInfo}><Text style={styles.roleChoiceTitle}>{title}</Text><Text style={styles.roleChoiceText}>{text}</Text></View><View style={[styles.radio, selected && styles.radioActive]}>{selected ? <View style={styles.radioInner} /> : null}</View></Pressable>; }

function VehiclesScreen({ selected, onToggle, onContinue }: { selected: VehicleType[]; onToggle: (vehicle: VehicleType) => void; onContinue: () => void }) { return <View style={styles.form}><View style={styles.heroIcon}><MaterialIcons name="two-wheeler" size={30} color="#007B8B" /></View><Text style={styles.title}>Avec quels engins livrez-vous ?</Text><Text style={styles.subtitle}>Sélectionnez un ou plusieurs engins. Nous vous proposerons uniquement les courses compatibles.</Text><View style={styles.vehicleGrid}>{VEHICLES.map((vehicle) => <Pressable key={vehicle.type} onPress={() => onToggle(vehicle.type)} style={({ pressed }) => [styles.vehicleCard, selected.includes(vehicle.type) && styles.vehicleCardActive, pressed && styles.pressed]}><MaterialIcons name={vehicle.icon} size={27} color={selected.includes(vehicle.type) ? "#FFFFFF" : "#007B8B"} /><Text style={[styles.vehicleTitle, selected.includes(vehicle.type) && styles.vehicleTitleActive]}>{vehicle.type}</Text><Text style={[styles.vehicleText, selected.includes(vehicle.type) && styles.vehicleTextActive]}>{vehicle.description}</Text><View style={[styles.vehicleCheck, selected.includes(vehicle.type) && styles.vehicleCheckActive]}>{selected.includes(vehicle.type) ? <MaterialIcons name="check" size={14} color="#FFFFFF" /> : null}</View></Pressable>)}</View><TikisButton label="Continuer" icon="arrow-forward" onPress={onContinue} disabled={selected.length === 0} style={styles.actionButton} /></View>; }

function NameScreen({ role, value, error, loading, onChange, onContinue }: { role: UserRole | null; value: string; error: string; loading: boolean; onChange: (value: string) => void; onContinue: () => void }) { return <View style={styles.form}><View style={styles.heroIcon}><MaterialIcons name="badge" size={30} color="#007B8B" /></View><Text style={styles.title}>Comment devons-nous vous appeler ?</Text><Text style={styles.subtitle}>{role === "driver" ? "Votre nom sera visible par les expéditeurs après confirmation d’une mission." : "Votre nom sera partagé avec le livreur uniquement après l’attribution d’une course."}</Text><Text style={styles.fieldLabel}>NOM</Text><TextInput accessibilityLabel="Nom" autoCapitalize="words" autoComplete="name" maxLength={70} placeholder="Ex. Mariam ou Mariam Ouédraogo" placeholderTextColor="#A1ADBC" value={value} onChangeText={onChange} style={[styles.nameInput, error && styles.fieldError]} returnKeyType="done" onSubmitEditing={onContinue} />{error ? <Text style={styles.error}>{error}</Text> : <Text style={styles.helper}>Un nom unique est accepté. Seuls les lettres, espaces, apostrophes et traits d’union sont autorisés.</Text>}<View style={styles.lockedRole}><MaterialIcons name="lock" size={17} color="#006572" /><Text style={styles.lockedRoleText}>Votre compte {role === "driver" ? "livreur" : "expéditeur"} sera verrouillé après inscription.</Text></View><TikisButton label="Créer mon compte" icon="check-circle" onPress={onContinue} loading={loading} style={styles.actionButton} /></View>; }

function CountryPicker({ visible, selected, onClose, onSelect }: { visible: boolean; selected: CountrySpec; onClose: () => void; onSelect: (country: CountrySpec) => void }) { return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}><View style={styles.modal}><Pressable style={styles.modalScrim} onPress={onClose} /><View style={styles.countrySheet}><View style={styles.sheetHandle} /><View style={styles.sheetTop}><View><Text style={styles.sheetTitle}>Choisir un pays</Text><Text style={styles.sheetSubtitle}>L’indicatif et le format du numéro seront adaptés.</Text></View><Pressable onPress={onClose} style={styles.sheetClose}><MaterialIcons name="close" size={20} color="#0B1F3A" /></Pressable></View>{COUNTRIES.map((country) => <Pressable key={country.id} onPress={() => onSelect(country)} style={({ pressed }) => [styles.countryRow, country.id === selected.id && styles.countryRowActive, pressed && styles.pressed]}><View style={styles.countryBadge}><Text style={styles.countryFlag}>{country.flag}</Text></View><View style={styles.countryInfo}><Text style={styles.countryName}>{country.name}</Text><Text style={styles.countryHint}>{country.dialCode} · {country.digits} chiffres</Text></View>{country.id === selected.id ? <MaterialIcons name="check-circle" size={21} color="#18A572" /> : null}</Pressable>)}</View></View></Modal>; }

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#F6F8FC" }, keyboard: { flex: 1 }, scroll: { flexGrow: 1, padding: 20, paddingBottom: 35 }, welcome: { flex: 1, justifyContent: "space-between" }, brandArea: { alignItems: "center", paddingTop: 18 }, logo: { width: 88, height: 88, borderRadius: 26 }, brandChip: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 12, paddingHorizontal: 10, height: 28, backgroundColor: "#E5F6F7", marginTop: 12 }, brandStatus: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#18A572" }, brandChipText: { color: "#006572", fontSize: 10, fontWeight: "900", letterSpacing: 0.45 }, welcomeBody: { marginTop: 30 }, welcomeEyebrow: { color: "#007B8B", fontSize: 13, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.7 }, welcomeTitle: { color: "#0B1F3A", fontSize: 33, lineHeight: 40, fontWeight: "900", letterSpacing: -0.7, marginTop: 8 }, welcomeSubtitle: { color: "#697386", fontSize: 15, lineHeight: 23, marginTop: 10 }, languageLabel: { color: "#8A96A8", fontSize: 11, fontWeight: "900", letterSpacing: 0.8, marginTop: 25, marginBottom: 8 }, languageSwitch: { flexDirection: "row", borderRadius: 15, backgroundColor: "#E8EDF3", padding: 4, gap: 4 }, languageOption: { flex: 1, height: 42, borderRadius: 11, alignItems: "center", justifyContent: "center" }, languageActive: { backgroundColor: "#FFFFFF", shadowColor: "#0B1F3A", shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 }, languageText: { color: "#697386", fontSize: 13, fontWeight: "900" }, languageTextActive: { color: "#007B8B" }, trustList: { marginTop: 23, gap: 10 }, trustRow: { flexDirection: "row", gap: 10, padding: 12, backgroundColor: "#FFFFFF", borderRadius: 16, borderWidth: 1, borderColor: "#E7ECF2" }, trustIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: "#E5F6F7", alignItems: "center", justifyContent: "center" }, trustInfo: { flex: 1 }, trustTitle: { color: "#0B1F3A", fontSize: 13, fontWeight: "900" }, trustText: { color: "#697386", fontSize: 12, lineHeight: 17, marginTop: 2 }, welcomeButton: { marginTop: 25 }, legal: { color: "#7B8798", fontSize: 11, lineHeight: 17, textAlign: "center", marginTop: 14, paddingHorizontal: 12 }, legalLink: { color: "#007B8B", fontWeight: "900" }, top: { height: 49, flexDirection: "row", alignItems: "center", marginBottom: 25 }, backButton: { width: 42, height: 42, borderRadius: 15, backgroundColor: "#FFFFFF", borderColor: "#E7ECF2", borderWidth: 1, alignItems: "center", justifyContent: "center" }, stepInfo: { flex: 1, marginLeft: 10 }, stepLabel: { color: "#007B8B", fontSize: 10, fontWeight: "900", letterSpacing: 0.8 }, stepCount: { color: "#0B1F3A", fontSize: 13, fontWeight: "900", marginTop: 2 }, stepDots: { flexDirection: "row", gap: 4 }, stepDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#D7DFE8" }, stepDotActive: { backgroundColor: "#007B8B" }, form: { flex: 1, paddingTop: 5 }, heroIcon: { width: 64, height: 64, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "#E5F6F7", marginBottom: 20 }, title: { color: "#0B1F3A", fontSize: 28, lineHeight: 34, fontWeight: "900", letterSpacing: -0.5 }, subtitle: { color: "#697386", fontSize: 14, lineHeight: 21, marginTop: 8 }, fieldLabel: { color: "#8A96A8", fontSize: 11, fontWeight: "900", letterSpacing: 0.75, marginTop: 25, marginBottom: 8 }, countryField: { minHeight: 60, borderRadius: 16, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#DDE5ED", borderWidth: 1 }, countryBadge: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#E5F6F7" }, countryFlag: { color: "#006572", fontWeight: "900", fontSize: 11 }, countryInfo: { flex: 1, marginLeft: 10 }, countryName: { color: "#0B1F3A", fontSize: 14, fontWeight: "900" }, countryHint: { color: "#78869A", fontSize: 11, marginTop: 2 }, phoneField: { height: 58, borderRadius: 16, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#DDE5ED", flexDirection: "row", alignItems: "center", paddingHorizontal: 14 }, fieldError: { borderColor: "#E45858" }, dialCode: { paddingRight: 12, borderRightWidth: 1, borderColor: "#E1E7ED" }, dialCodeText: { color: "#0B1F3A", fontWeight: "900", fontSize: 15 }, phoneInput: { flex: 1, color: "#0B1F3A", fontSize: 17, fontWeight: "800", marginLeft: 12, letterSpacing: 0.5 }, helper: { color: "#78869A", fontSize: 12, lineHeight: 18, marginTop: 8 }, error: { color: "#C23B45", fontSize: 12, lineHeight: 18, marginTop: 8, fontWeight: "700" }, actionButton: { marginTop: 25 }, simulationNotice: { flexDirection: "row", gap: 9, padding: 12, borderRadius: 15, backgroundColor: "#E5F6F7", marginTop: 22 }, simulationText: { flex: 1, color: "#35656C", fontSize: 12, lineHeight: 18 }, simulationCode: { color: "#006572", fontWeight: "900" }, phoneHighlight: { color: "#007B8B", fontWeight: "900" }, otpRow: { flexDirection: "row", justifyContent: "space-between", gap: 8, marginTop: 27 }, otpInput: { flex: 1, height: 54, backgroundColor: "#FFFFFF", borderRadius: 14, borderWidth: 1, borderColor: "#C8D6E3", color: "#0B1F3A", fontSize: 21, fontWeight: "900" }, otpError: { borderColor: "#E45858" }, resend: { alignItems: "center", paddingVertical: 17 }, resendText: { color: "#007B8B", fontSize: 13, fontWeight: "900" }, resendDisabled: { color: "#96A1B1" }, roleChoice: { marginTop: 17, padding: 15, minHeight: 103, borderRadius: 19, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E1E7ED", flexDirection: "row", alignItems: "center", gap: 12 }, roleChoiceActive: { borderColor: "#007B8B", backgroundColor: "#F7FEFF" }, roleChoiceIcon: { width: 51, height: 51, borderRadius: 17, backgroundColor: "#E5F6F7", alignItems: "center", justifyContent: "center" }, roleChoiceIconActive: { backgroundColor: "#007B8B" }, roleChoiceInfo: { flex: 1 }, roleChoiceTitle: { color: "#0B1F3A", fontSize: 16, fontWeight: "900" }, roleChoiceText: { color: "#697386", fontSize: 12, lineHeight: 17, marginTop: 4 }, radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: "#C6D1DC", alignItems: "center", justifyContent: "center" }, radioActive: { borderColor: "#007B8B" }, radioInner: { width: 11, height: 11, borderRadius: 6, backgroundColor: "#007B8B" }, vehicleGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 22 }, vehicleCard: { width: "48.5%", minHeight: 130, borderRadius: 18, padding: 13, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E1E7ED" }, vehicleCardActive: { backgroundColor: "#007B8B", borderColor: "#007B8B" }, vehicleTitle: { color: "#0B1F3A", fontSize: 15, fontWeight: "900", marginTop: 11 }, vehicleTitleActive: { color: "#FFFFFF" }, vehicleText: { color: "#78869A", fontSize: 11, marginTop: 3 }, vehicleTextActive: { color: "#C5E6EA" }, vehicleCheck: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: "#B9C7D5", alignItems: "center", justifyContent: "center", position: "absolute", right: 10, top: 10 }, vehicleCheckActive: { backgroundColor: "#18A572", borderColor: "#18A572" }, nameInput: { minHeight: 58, paddingHorizontal: 15, borderRadius: 16, borderWidth: 1, borderColor: "#DDE5ED", backgroundColor: "#FFFFFF", color: "#0B1F3A", fontSize: 16, fontWeight: "800" }, lockedRole: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, borderRadius: 14, backgroundColor: "#FFF7E6", marginTop: 18 }, lockedRoleText: { flex: 1, color: "#8A5A0E", fontSize: 12, lineHeight: 18 }, modal: { flex: 1, justifyContent: "flex-end" }, modalScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(11,31,58,0.46)" }, countrySheet: { backgroundColor: "#FFFFFF", borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 20, paddingBottom: 30 }, sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#D1DAE4", alignSelf: "center", marginBottom: 18 }, sheetTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }, sheetTitle: { color: "#0B1F3A", fontSize: 20, fontWeight: "900" }, sheetSubtitle: { color: "#697386", fontSize: 12, marginTop: 3 }, sheetClose: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "#F6F8FC" }, countryRow: { minHeight: 58, flexDirection: "row", alignItems: "center", paddingHorizontal: 8, borderRadius: 15, marginTop: 4 }, countryRowActive: { backgroundColor: "#F2FBFC" }, pressed: { opacity: 0.68 },
});
