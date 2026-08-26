import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PlacePicker } from "@/components/tikis/place-picker";
import { SurfaceCard, TikisButton } from "@/components/tikis/ui";
import { compactRouteLabel, estimateDeliveryPrice, sanitizePlaceText, validateDeliveryMeasurement } from "@/lib/geo-rules";
import { isAllowedDeliveryText, sanitizeDeliveryText } from "@/lib/tikis-engine";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";
import type { DeliveryType, LocationLabel, SelectableVehicleType } from "@/shared/tikis-domain";

const VEHICLES: SelectableVehicleType[] = ["Vélo", "Moto", "Tricycle", "Voiture"];
const DELIVERY_TYPES: { value: DeliveryType; icon: React.ComponentProps<typeof MaterialIcons>["name"]; label: string }[] = [{ value: "Plis", icon: "description", label: "Plis" }, { value: "Personne", icon: "person", label: "Personne" }, { value: "Autre", icon: "inventory-2", label: "Autre" }];

function toPlacePayload(place: LocationLabel) {
  return { name: place.name, district: place.district, city: place.city, latitude: place.latitude, longitude: place.longitude, ...(place.googlePlaceId ? { googlePlaceId: place.googlePlaceId } : {}), ...(place.formattedAddress ? { formattedAddress: place.formattedAddress } : {}), ...(place.street ? { street: place.street } : {}), ...(place.province ? { province: place.province } : {}), ...(place.country ? { country: place.country } : {}) };
}

function favoriteToLocation(item: { place: { placeName: string; district: string | null; city: string | null; latitude: string; longitude: string; googlePlaceId: string | null; formattedAddress: string; street: string | null; province: string | null; country: string | null } }): LocationLabel {
  return { name: item.place.placeName, district: item.place.district ?? "", city: item.place.city ?? "", latitude: Number(item.place.latitude), longitude: Number(item.place.longitude), ...(item.place.googlePlaceId ? { googlePlaceId: item.place.googlePlaceId } : {}), ...(item.place.formattedAddress ? { formattedAddress: item.place.formattedAddress } : {}), ...(item.place.street ? { street: item.place.street } : {}), ...(item.place.province ? { province: item.place.province } : {}), ...(item.place.country ? { country: item.place.country } : {}) };
}

export default function CreateDeliveryScreen() {
  const { createDemoDelivery, profile } = useTikisStore();
  const phone = profile?.phone ?? "+22670000000";
  const [title, setTitle] = useState("Documents confidentiels");
  const [details, setDetails] = useState("À remettre contre signature.");
  const [deliveryType, setDeliveryType] = useState<DeliveryType>("Plis");
  const [vehicle, setVehicle] = useState<SelectableVehicleType>("Moto");
  const [pickup, setPickup] = useState<LocationLabel | null>(null);
  const [dropoff, setDropoff] = useState<LocationLabel | null>(null);
  const [weightKg, setWeightKg] = useState("");
  const [lengthCm, setLengthCm] = useState("");
  const [widthCm, setWidthCm] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [passengers, setPassengers] = useState("1");
  const [route, setRoute] = useState<{ distanceKm: number; durationMinutes: number; precise: boolean } | null>(null);
  const [routeMessage, setRouteMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [favoriteTarget, setFavoriteTarget] = useState<"pickup" | "dropoff" | null>(null);
  const { mutateAsync: requestRoute } = trpc.geography.route.useMutation();
  const savePlaceMutation = trpc.geography.savePlace.useMutation();
  const favoriteMutation = trpc.geography.favorites.add.useMutation();
  const favoritesQuery = trpc.geography.favorites.list.useQuery({ phone }, { enabled: Boolean(profile?.phone) });

  const dimensions = useMemo(() => ({ ...(lengthCm ? { lengthCm: Number(lengthCm) } : {}), ...(widthCm ? { widthCm: Number(widthCm) } : {}), ...(heightCm ? { heightCm: Number(heightCm) } : {}) }), [lengthCm, widthCm, heightCm]);
  const measurement = useMemo(() => ({ ...(weightKg ? { weightKg: Number(weightKg) } : {}), ...(deliveryType === "Personne" ? { passengers: Number(passengers) } : {}), ...(Object.keys(dimensions).length ? { dimensions } : {}) }), [weightKg, deliveryType, passengers, dimensions]);

  useEffect(() => {
    let active = true;
    async function calculateRoute() {
      if (!pickup || !dropoff) { setRoute(null); setRouteMessage(""); return; }
      setRouteMessage("Calcul de l’itinéraire sécurisé…");
      try {
        const result = await requestRoute({ origin: toPlacePayload(pickup), destination: toPlacePayload(dropoff) });
        if (active) { setRoute({ ...result, precise: true }); setRouteMessage("Distance routière calculée avec Routes API."); }
      } catch (cause) {
        if (active) { setRoute(null); setRouteMessage(cause instanceof Error ? cause.message : "L’itinéraire sécurisé est indisponible. Vérifiez votre connexion puis réessayez."); }
      }
    }
    void calculateRoute();
    return () => { active = false; };
  }, [pickup, dropoff, requestRoute]);

  const estimate = useMemo(() => route ? estimateDeliveryPrice({ distanceKm: route.distanceKm, durationMinutes: route.durationMinutes, type: deliveryType, vehicle, ...measurement }) : 0, [route, deliveryType, vehicle, measurement]);

  async function addFavorite(target: "pickup" | "dropoff") {
    const place = target === "pickup" ? pickup : dropoff;
    if (!place || !profile?.phone) return;
    setFavoriteTarget(target);
    try {
      const persisted = await savePlaceMutation.mutateAsync(toPlacePayload(place));
      await favoriteMutation.mutateAsync({ phone: profile.phone, placeId: persisted.id, label: sanitizePlaceText(place.name, 80) || "Lieu favori" });
      await favoritesQuery.refetch();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Impossible d’ajouter ce favori."); }
    finally { setFavoriteTarget(null); }
  }

  async function publish() {
    const cleanTitle = sanitizeDeliveryText(title);
    const cleanDetails = sanitizeDeliveryText(details);
    const measurementError = validateDeliveryMeasurement(deliveryType, measurement);
    if (!pickup || !dropoff || !route || !cleanTitle || !cleanDetails) { setError("Sélectionnez deux lieux GPS et renseignez les informations demandées."); return; }
    if (!isAllowedDeliveryText(cleanTitle) || !isAllowedDeliveryText(cleanDetails)) { setError("Les informations contiennent des caractères non autorisés."); return; }
    if (measurementError) { setError(measurementError); return; }
    setError(""); setLoading(true);
    try {
      await Promise.all([savePlaceMutation.mutateAsync(toPlacePayload(pickup)), savePlaceMutation.mutateAsync(toPlacePayload(dropoff))]);
      const delivery = createDemoDelivery({ title: cleanTitle, type: deliveryType, pickup, dropoff, distanceKm: route.distanceKm, estimatedPrice: estimate, vehicleTypes: [vehicle], details: cleanDetails, ...(deliveryType === "Autre" && weightKg ? { weightKg: Number(weightKg) } : {}), ...(deliveryType === "Autre" && Object.keys(dimensions).length ? { dimensions } : {}), ...(deliveryType === "Personne" ? { passengers: Number(passengers) } : {}) });
      router.replace(`/delivery/${delivery.id}` as any);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "La livraison n’a pas pu être publiée."); }
    finally { setLoading(false); }
  }

  const favorites = favoritesQuery.data ?? [];
  return <SafeAreaView style={styles.safe} edges={["top", "bottom"]}><KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === "ios" ? "padding" : undefined}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"><View style={styles.topBar}><Pressable onPress={() => router.back()} style={({ pressed }) => [styles.back, pressed && styles.pressed]}><MaterialIcons name="arrow-back" size={22} color="#0B1F3A" /></Pressable><Text style={styles.topTitle}>Nouvelle livraison</Text><View style={styles.placeholder} /></View><Text style={styles.title}>Composez une course précise.</Text><Text style={styles.subtitle}>Tikis calcule un itinéraire routier, adapte les frais à l’engin et protège vos informations à chaque étape.</Text><Text style={styles.sectionLabel}>TYPE DE COURSE</Text><View style={styles.typeRow}>{DELIVERY_TYPES.map((item) => <Pressable key={item.value} onPress={() => setDeliveryType(item.value)} style={({ pressed }) => [styles.typeChip, deliveryType === item.value && styles.typeChipActive, pressed && styles.pressed]}><MaterialIcons name={item.icon} size={17} color={deliveryType === item.value ? "#FFFFFF" : "#007B8B"} /><Text style={[styles.typeText, deliveryType === item.value && styles.typeTextActive]}>{item.label}</Text></Pressable>)}</View><Field label="Titre de la course" value={title} onChangeText={(value) => setTitle(sanitizeDeliveryText(value))} placeholder={deliveryType === "Plis" ? "Ex. Documents de bureau" : deliveryType === "Personne" ? "Ex. Trajet vers l’aéroport" : "Ex. Petit matériel"} /><Field label="Consignes" value={details} onChangeText={(value) => setDetails(sanitizeDeliveryText(value))} placeholder="Informations utiles pour le livreur" multiline />{deliveryType === "Personne" ? <Field label="Nombre de personnes" value={passengers} onChangeText={(value) => setPassengers(value.replace(/\D/g, "").slice(0, 1))} placeholder="1" keyboardType="number-pad" icon="groups" /> : null}{deliveryType === "Autre" ? <SurfaceCard style={styles.measureCard}><Text style={styles.measureTitle}>Mesures facultatives</Text><Text style={styles.measureSubtitle}>Ajoutez le poids et les dimensions si vous les connaissez pour affiner l’estimation.</Text><Field label="Poids (kg)" value={weightKg} onChangeText={(value) => setWeightKg(value.replace(/[^0-9.]/g, "").slice(0, 6))} placeholder="Ex. 12" keyboardType="decimal-pad" icon="scale" /><Text style={styles.fieldLabel}>Dimensions (cm)</Text><View style={styles.dimensionRow}><MiniNumber value={lengthCm} onChangeText={setLengthCm} placeholder="Long." /><MiniNumber value={widthCm} onChangeText={setWidthCm} placeholder="Larg." /><MiniNumber value={heightCm} onChangeText={setHeightCm} placeholder="Haut." /></View></SurfaceCard> : null}<Text style={styles.sectionLabel}>TRAJET</Text><PlacePicker label="Récupération" tone="pickup" value={pickup} onChange={setPickup} />{pickup ? <FavoriteButton label="Ajouter la récupération aux favoris" loading={favoriteTarget === "pickup"} onPress={() => void addFavorite("pickup")} /> : null}<PlacePicker label="Destination" tone="dropoff" value={dropoff} onChange={setDropoff} />{dropoff ? <FavoriteButton label="Ajouter la destination aux favoris" loading={favoriteTarget === "dropoff"} onPress={() => void addFavorite("dropoff")} /> : null}{favorites.length ? <View style={styles.favorites}><Text style={styles.favoritesLabel}>LIEUX FAVORIS</Text><Text style={styles.favoritesHint}>Touchez un lieu puis choisissez s’il s’agit de la récupération ou de la destination.</Text>{favorites.map((item) => <View key={item.id} style={styles.favoriteRow}><MaterialIcons name="star" size={16} color="#D28A00" /><Text style={styles.favoriteText} numberOfLines={1}>{item.label}</Text><Pressable onPress={() => setPickup(favoriteToLocation(item))} style={styles.favoriteAction}><Text style={styles.favoriteActionText}>Départ</Text></Pressable><Pressable onPress={() => setDropoff(favoriteToLocation(item))} style={styles.favoriteAction}><Text style={styles.favoriteActionText}>Arrivée</Text></Pressable></View>)}</View> : null}<Text style={styles.sectionLabel}>ENGIN ET ESTIMATION</Text><Text style={styles.helper}>Sélectionnez un seul engin compatible. La fourgonnette n’est pas disponible dans cette version.</Text><View style={styles.vehicleGrid}>{VEHICLES.map((item) => <Pressable key={item} onPress={() => setVehicle(item)} style={({ pressed }) => [styles.vehicle, vehicle === item && styles.vehicleActive, pressed && styles.pressed]}><MaterialIcons name={item === "Vélo" || item === "Tricycle" ? "pedal-bike" : item === "Moto" ? "two-wheeler" : "directions-car"} size={20} color={vehicle === item ? "#FFFFFF" : "#007B8B"} /><Text style={[styles.vehicleText, vehicle === item && styles.vehicleTextActive]}>{item}</Text></Pressable>)}</View><View style={styles.estimate}><MaterialIcons name="auto-awesome" size={18} color="#007B8B" /><View style={styles.estimateInfo}><Text style={styles.estimateLabel}>{route ? `${route.precise ? "Itinéraire routier" : "Distance provisoire"} · ${route.distanceKm.toFixed(1)} km` : "Sélectionnez les deux lieux"}</Text><Text style={styles.estimateValue}>{estimate ? `${estimate.toLocaleString("fr-FR")} FCFA` : "—"}</Text></View></View>{routeMessage ? <Text style={[styles.routeMessage, !route?.precise && styles.routeWarning]}>{routeMessage}</Text> : null}{pickup && dropoff ? <Text style={styles.routeTitle}>{compactRouteLabel(pickup, dropoff)}</Text> : null}{error ? <Text style={styles.error}>{error}</Text> : null}<TikisButton label="Publier la livraison" icon="publish" onPress={() => void publish()} loading={loading} disabled={!pickup || !dropoff || !route || !estimate} style={styles.publish} /><Text style={styles.footerNote}>Aucun débit immédiat. Les coordonnées complètes sont utilisées uniquement pour la course et les calculs de distance.</Text></ScrollView></KeyboardAvoidingView></SafeAreaView>;
}

function Field({ label, icon, keyboardType, ...props }: { label: string; icon?: React.ComponentProps<typeof MaterialIcons>["name"]; keyboardType?: "default" | "number-pad" | "decimal-pad"; value: string; onChangeText: (value: string) => void; placeholder: string; multiline?: boolean }) { return <View style={styles.fieldWrap}><Text style={styles.fieldLabel}>{label}</Text><View style={[styles.field, props.multiline && styles.fieldMultiline]}>{icon ? <MaterialIcons name={icon} size={18} color="#007B8B" style={styles.fieldIcon} /> : null}<TextInput {...props} keyboardType={keyboardType} maxLength={props.multiline ? 450 : 120} style={[styles.input, props.multiline && styles.inputMultiline]} placeholderTextColor="#9AA5B6" /></View></View>; }
function MiniNumber({ value, onChangeText, placeholder }: { value: string; onChangeText: (value: string) => void; placeholder: string }) { return <TextInput value={value} onChangeText={(text) => onChangeText(text.replace(/\D/g, "").slice(0, 4))} keyboardType="number-pad" placeholder={placeholder} placeholderTextColor="#9AA5B6" style={styles.miniInput} />; }
function FavoriteButton({ label, loading, onPress }: { label: string; loading: boolean; onPress: () => void }) { return <TikisButton label={label} variant="secondary" icon="star-outline" onPress={onPress} loading={loading} style={styles.favoriteButton} />; }

const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: "#F6F8FC" }, keyboard: { flex: 1 }, content: { padding: 20, paddingBottom: 45 }, topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 25 }, back: { width: 42, height: 42, borderRadius: 21, backgroundColor: "#FFFFFF", borderColor: "#E7ECF2", borderWidth: 1, alignItems: "center", justifyContent: "center" }, topTitle: { color: "#0B1F3A", fontWeight: "900", fontSize: 16 }, placeholder: { width: 42 }, title: { color: "#0B1F3A", fontSize: 27, lineHeight: 33, fontWeight: "900", letterSpacing: -0.4 }, subtitle: { color: "#697386", fontSize: 14, lineHeight: 21, marginTop: 8 }, sectionLabel: { color: "#8A96A8", fontSize: 11, fontWeight: "900", letterSpacing: 0.8, marginTop: 26, marginBottom: 9 }, typeRow: { flexDirection: "row", gap: 8, marginBottom: 16 }, typeChip: { flex: 1, minHeight: 45, alignItems: "center", justifyContent: "center", gap: 3, backgroundColor: "#FFFFFF", borderRadius: 13, borderWidth: 1, borderColor: "#DDE5ED" }, typeChipActive: { backgroundColor: "#007B8B", borderColor: "#007B8B" }, typeText: { color: "#697386", fontSize: 12, fontWeight: "800" }, typeTextActive: { color: "#FFFFFF" }, fieldWrap: { marginBottom: 14 }, fieldLabel: { color: "#485569", fontWeight: "800", fontSize: 13, marginBottom: 7 }, field: { minHeight: 51, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#DDE5ED", borderRadius: 15, flexDirection: "row", alignItems: "center", paddingHorizontal: 14 }, fieldMultiline: { minHeight: 82, alignItems: "flex-start", paddingTop: 13 }, fieldIcon: { marginRight: 9, marginTop: 1 }, input: { flex: 1, color: "#0B1F3A", fontSize: 14, fontWeight: "600", minHeight: 40 }, inputMultiline: { textAlignVertical: "top", minHeight: 54 }, measureCard: { padding: 15, marginBottom: 4 }, measureTitle: { color: "#0B1F3A", fontWeight: "900", fontSize: 14 }, measureSubtitle: { color: "#697386", fontSize: 12, lineHeight: 17, marginTop: 4, marginBottom: 14 }, dimensionRow: { flexDirection: "row", gap: 8 }, miniInput: { flex: 1, minHeight: 47, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#DDE5ED", borderRadius: 13, paddingHorizontal: 10, color: "#0B1F3A", fontSize: 13, fontWeight: "800" }, favoriteButton: { marginTop: -7, marginBottom: 11, minHeight: 43 }, favorites: { backgroundColor: "#FFF8E8", borderWidth: 1, borderColor: "#F4E4B7", borderRadius: 16, padding: 12, marginTop: -3 }, favoritesLabel: { color: "#8A5A0E", fontSize: 10, fontWeight: "900", letterSpacing: 0.7 }, favoritesHint: { color: "#8C7342", fontSize: 11, lineHeight: 15, marginTop: 3, marginBottom: 7 }, favoriteRow: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: 6, borderTopWidth: 1, borderColor: "#F5E8C4" }, favoriteText: { flex: 1, color: "#55411B", fontSize: 12, fontWeight: "800" }, favoriteAction: { paddingHorizontal: 7, paddingVertical: 5, borderRadius: 8, backgroundColor: "#FFFFFF" }, favoriteActionText: { color: "#8A5A0E", fontSize: 10, fontWeight: "900" }, helper: { color: "#697386", fontSize: 12, lineHeight: 18, marginBottom: 10 }, vehicleGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, vehicle: { width: "48.5%", height: 49, borderRadius: 14, borderWidth: 1, borderColor: "#CDE4E7", backgroundColor: "#FFFFFF", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 }, vehicleActive: { backgroundColor: "#007B8B", borderColor: "#007B8B" }, vehicleText: { color: "#007B8B", fontSize: 13, fontWeight: "900" }, vehicleTextActive: { color: "#FFFFFF" }, estimate: { backgroundColor: "#E5F6F7", borderRadius: 14, flexDirection: "row", alignItems: "center", gap: 10, padding: 13, marginTop: 12 }, estimateInfo: { flex: 1 }, estimateLabel: { color: "#35656C", fontSize: 12, fontWeight: "700" }, estimateValue: { color: "#006572", fontWeight: "900", fontSize: 17, marginTop: 2 }, routeMessage: { color: "#147A58", fontSize: 11, fontWeight: "700", lineHeight: 16, marginTop: 6 }, routeWarning: { color: "#B45309" }, routeTitle: { color: "#0B1F3A", fontSize: 12, fontWeight: "800", marginTop: 5 }, error: { color: "#C23B45", fontWeight: "800", fontSize: 13, textAlign: "center", marginTop: 18 }, publish: { marginTop: 23 }, footerNote: { color: "#778398", fontSize: 12, textAlign: "center", lineHeight: 18, marginTop: 14, paddingHorizontal: 8 }, pressed: { opacity: 0.67 } });
