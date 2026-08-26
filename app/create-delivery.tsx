import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { TikisButton } from "@/components/tikis/ui";
import { useTikisStore } from "@/lib/tikis-store";
import { isAllowedDeliveryText, sanitizeDeliveryText } from "@/lib/tikis-engine";
import type { VehicleType } from "@/shared/tikis-domain";

const VEHICLES: VehicleType[] = ["Moto", "Tricycle", "Voiture", "Fourgonnette"];
const DELIVERY_TYPES = ["Colis", "Plis", "Personne"] as const;

export default function CreateDeliveryScreen() {
  const { createDemoDelivery } = useTikisStore();
  const [title, setTitle] = useState("Documents confidentiels");
  const [pickup, setPickup] = useState("Siège Coris Bank, Koulouba");
  const [dropoff, setDropoff] = useState("Maison de l’Entreprise, Ouaga 2000");
  const [price, setPrice] = useState("4500");
  const [details, setDetails] = useState("Enveloppe à remettre contre signature.");
  const [deliveryType, setDeliveryType] = useState<(typeof DELIVERY_TYPES)[number]>("Plis");
  const [vehicles, setVehicles] = useState<VehicleType[]>(["Moto"]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const estimate = useMemo(() => Number(price.replace(/\D/g, "")) || 0, [price]);

  function toggleVehicle(vehicle: VehicleType) {
    setVehicles((current) => current.includes(vehicle) ? (current.length > 1 ? current.filter((item) => item !== vehicle) : current) : [...current, vehicle]);
  }

  async function publish() {
    const values = [title, pickup, dropoff, details];
    if (!values.every((value) => value.trim()) || estimate <= 0 || vehicles.length === 0) {
      setError("Renseignez tous les champs et un montant supérieur à zéro.");
      return;
    }
    if (!values.every(isAllowedDeliveryText)) {
      setError("Caractères non autorisés");
      return;
    }
    setError("");
    setLoading(true);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const delivery = createDemoDelivery({
      title: sanitizeDeliveryText(title),
      type: deliveryType,
      pickup: { name: sanitizeDeliveryText(pickup), district: "", city: "Ouagadougou" },
      dropoff: { name: sanitizeDeliveryText(dropoff), district: "", city: "Ouagadougou" },
      estimatedPrice: estimate,
      vehicleTypes: vehicles,
      details: sanitizeDeliveryText(details),
    });
    setLoading(false);
    router.replace(`/delivery/${delivery.id}` as any);
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.topBar}><Pressable onPress={() => router.back()} style={({ pressed }) => [styles.back, pressed && styles.pressed]}><MaterialIcons name="arrow-back" size={22} color="#0B1F3A" /></Pressable><Text style={styles.topTitle}>Nouvelle livraison</Text><View style={styles.placeholder} /></View>
          <Text style={styles.title}>Dites-nous ce qu’il faut livrer.</Text>
          <Text style={styles.subtitle}>L’estimation s’adapte à l’engin sélectionné. Vous paierez directement le livreur à la remise.</Text>

          <Text style={styles.sectionLabel}>DÉTAILS</Text>
          <Field label="Titre" value={title} onChangeText={setTitle} placeholder="Ex. Documents de bureau" />
          <View style={styles.typeRow}>{DELIVERY_TYPES.map((item) => <Pressable key={item} onPress={() => setDeliveryType(item)} style={({ pressed }) => [styles.typeChip, deliveryType === item && styles.typeChipActive, pressed && styles.pressed]}><Text style={[styles.typeText, deliveryType === item && styles.typeTextActive]}>{item}</Text></Pressable>)}</View>
          <Field label="Détails" value={details} onChangeText={setDetails} placeholder="Consignes utiles" multiline />

          <Text style={styles.sectionLabel}>TRAJET</Text>
          <Field label="Récupération" value={pickup} onChangeText={setPickup} placeholder="Lieu de récupération" icon="trip-origin" />
          <Field label="Destination" value={dropoff} onChangeText={setDropoff} placeholder="Lieu de destination" icon="location-on" />

          <Text style={styles.sectionLabel}>ENGIN ET FRAIS</Text>
          <Text style={styles.helper}>Sélectionnez les engins compatibles avec votre livraison.</Text>
          <View style={styles.vehicleGrid}>{VEHICLES.map((vehicle) => <Pressable key={vehicle} onPress={() => toggleVehicle(vehicle)} style={({ pressed }) => [styles.vehicle, vehicles.includes(vehicle) && styles.vehicleActive, pressed && styles.pressed]}><MaterialIcons name={vehicle === "Moto" ? "two-wheeler" : vehicle === "Tricycle" ? "pedal-bike" : "local-shipping"} size={20} color={vehicles.includes(vehicle) ? "#FFFFFF" : "#007B8B"} /><Text style={[styles.vehicleText, vehicles.includes(vehicle) && styles.vehicleTextActive]}>{vehicle}</Text></Pressable>)}</View>
          <Text style={styles.fieldLabel}>Frais suggérés</Text>
          <View style={styles.priceField}><TextInput value={price} onChangeText={(value) => setPrice(value.replace(/\D/g, ""))} keyboardType="number-pad" style={styles.priceInput} placeholder="4500" placeholderTextColor="#9AA5B6" /><Text style={styles.currency}>FCFA</Text></View>
          <View style={styles.estimate}><MaterialIcons name="auto-awesome" size={17} color="#007B8B" /><Text style={styles.estimateText}>Estimation intelligente pour {vehicles[0]} : <Text style={styles.estimateValue}>{estimate.toLocaleString("fr-FR")} FCFA</Text></Text></View>

          {error ? <Text style={styles.error}>{error}</Text> : null}
          <TikisButton label="Publier la livraison" icon="publish" onPress={() => void publish()} loading={loading} style={styles.publish} />
          <Text style={styles.footerNote}>Aucun débit immédiat. Tikis vous mettra en relation avec le livreur que vous choisirez.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({ label, icon, ...props }: { label: string; icon?: React.ComponentProps<typeof MaterialIcons>["name"]; value: string; onChangeText: (value: string) => void; placeholder: string; multiline?: boolean }) {
  return <View style={styles.fieldWrap}><Text style={styles.fieldLabel}>{label}</Text><View style={[styles.field, props.multiline && styles.fieldMultiline]}>{icon ? <MaterialIcons name={icon} size={18} color="#007B8B" style={styles.fieldIcon} /> : null}<TextInput {...props} style={[styles.input, props.multiline && styles.inputMultiline]} placeholderTextColor="#9AA5B6" /></View></View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F6F8FC" }, keyboard: { flex: 1 }, content: { padding: 20, paddingBottom: 45 }, topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 25 }, back: { width: 42, height: 42, borderRadius: 21, backgroundColor: "#FFFFFF", borderColor: "#E7ECF2", borderWidth: 1, alignItems: "center", justifyContent: "center" }, topTitle: { color: "#0B1F3A", fontWeight: "900", fontSize: 16 }, placeholder: { width: 42 }, title: { color: "#0B1F3A", fontSize: 27, lineHeight: 33, fontWeight: "900", letterSpacing: -0.4 }, subtitle: { color: "#697386", fontSize: 14, lineHeight: 21, marginTop: 8 }, sectionLabel: { color: "#8A96A8", fontSize: 11, fontWeight: "900", letterSpacing: 0.8, marginTop: 26, marginBottom: 9 }, fieldWrap: { marginBottom: 14 }, fieldLabel: { color: "#485569", fontWeight: "800", fontSize: 13, marginBottom: 7 }, field: { minHeight: 51, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#DDE5ED", borderRadius: 15, flexDirection: "row", alignItems: "center", paddingHorizontal: 14 }, fieldMultiline: { minHeight: 82, alignItems: "flex-start", paddingTop: 13 }, fieldIcon: { marginRight: 9, marginTop: 1 }, input: { flex: 1, color: "#0B1F3A", fontSize: 14, fontWeight: "600", minHeight: 40 }, inputMultiline: { textAlignVertical: "top", minHeight: 54 }, typeRow: { flexDirection: "row", gap: 8, marginBottom: 14 }, typeChip: { flex: 1, height: 39, alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF", borderRadius: 12, borderWidth: 1, borderColor: "#DDE5ED" }, typeChipActive: { backgroundColor: "#007B8B", borderColor: "#007B8B" }, typeText: { color: "#697386", fontSize: 13, fontWeight: "800" }, typeTextActive: { color: "#FFFFFF" }, helper: { color: "#697386", fontSize: 12, lineHeight: 18, marginBottom: 10 }, vehicleGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, vehicle: { width: "48.5%", height: 49, borderRadius: 14, borderWidth: 1, borderColor: "#CDE4E7", backgroundColor: "#FFFFFF", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 }, vehicleActive: { backgroundColor: "#007B8B", borderColor: "#007B8B" }, vehicleText: { color: "#007B8B", fontSize: 13, fontWeight: "900" }, vehicleTextActive: { color: "#FFFFFF" }, priceField: { height: 54, backgroundColor: "#FFFFFF", borderColor: "#DDE5ED", borderWidth: 1, borderRadius: 15, flexDirection: "row", alignItems: "center", paddingLeft: 14, paddingRight: 15 }, priceInput: { flex: 1, color: "#0B1F3A", fontSize: 16, fontWeight: "900" }, currency: { color: "#697386", fontSize: 13, fontWeight: "900" }, estimate: { backgroundColor: "#E5F6F7", borderRadius: 12, flexDirection: "row", alignItems: "center", gap: 8, padding: 11, marginTop: 9 }, estimateText: { color: "#35656C", fontSize: 12, flex: 1, lineHeight: 17 }, estimateValue: { color: "#006572", fontWeight: "900" }, error: { color: "#C23B45", fontWeight: "800", fontSize: 13, textAlign: "center", marginTop: 18 }, publish: { marginTop: 23 }, footerNote: { color: "#778398", fontSize: 12, textAlign: "center", lineHeight: 18, marginTop: 14, paddingHorizontal: 8 }, pressed: { opacity: 0.67 },
});
