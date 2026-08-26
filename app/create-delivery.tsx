import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { FavoritePlacesSheet, FloatingPlacePicker, type SavedFavorite } from "@/components/tikis/place-sheets";
import { SurfaceCard, TikisButton } from "@/components/tikis/ui";
import { offeredPriceError, parseOfferedPrice, priceDifferencePercent, sanitizeOfferedPriceInput } from "@/lib/delivery-price";
import { compactRouteLabel, estimateDeliveryPrice, sanitizePlaceText, validateDeliveryMeasurement } from "@/lib/geo-rules";
import { isAllowedDeliveryText, sanitizeDeliveryText } from "@/lib/tikis-engine";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";
import type { DeliveryType, LocationLabel, SelectableVehicleType } from "@/shared/tikis-domain";

const VEHICLES: SelectableVehicleType[] = ["Vélo", "Moto", "Tricycle", "Voiture"];
const DELIVERY_TYPES: { value: DeliveryType; icon: React.ComponentProps<typeof MaterialIcons>["name"]; label: string }[] = [
  { value: "Plis", icon: "description", label: "Plis" },
  { value: "Personne", icon: "person", label: "Personne" },
  { value: "Autre", icon: "inventory-2", label: "Autre" },
];

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
  const [offeredPriceInput, setOfferedPriceInput] = useState("");
  const [route, setRoute] = useState<{ distanceKm: number; durationMinutes: number; precise: boolean } | null>(null);
  const [routeMessage, setRouteMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [favoriteTarget, setFavoriteTarget] = useState<"pickup" | "dropoff" | null>(null);
  const [pickerTarget, setPickerTarget] = useState<"pickup" | "dropoff" | null>(null);
  const [favoritesVisible, setFavoritesVisible] = useState(false);
  const { mutateAsync: requestRoute } = trpc.geography.route.useMutation();
  const savePlaceMutation = trpc.geography.savePlace.useMutation();
  const favoriteMutation = trpc.geography.favorites.add.useMutation();
  const renameFavoriteMutation = trpc.geography.favorites.rename.useMutation();
  const removeFavoriteMutation = trpc.geography.favorites.remove.useMutation();
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
  const parsedOfferedPrice = useMemo(() => parseOfferedPrice(offeredPriceInput), [offeredPriceInput]);
  const priceInputError = useMemo(() => offeredPriceError(offeredPriceInput), [offeredPriceInput]);
  const publishedPrice = parsedOfferedPrice ?? estimate;
  const priceDifference = parsedOfferedPrice && estimate ? priceDifferencePercent(parsedOfferedPrice, estimate) : 0;
  const favoriteLocations: SavedFavorite[] = useMemo(() => (favoritesQuery.data ?? []).map((item) => ({ id: item.id, label: item.label, location: favoriteToLocation(item) })), [favoritesQuery.data]);

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

  async function renameFavorite(favorite: SavedFavorite, label: string) {
    if (!profile?.phone) return;
    await renameFavoriteMutation.mutateAsync({ phone: profile.phone, favoriteId: Number(favorite.id), label });
    await favoritesQuery.refetch();
  }

  async function removeFavorite(favorite: SavedFavorite) {
    if (!profile?.phone) return;
    await removeFavoriteMutation.mutateAsync({ phone: profile.phone, favoriteId: Number(favorite.id) });
    await favoritesQuery.refetch();
  }

  async function publish() {
    const cleanTitle = sanitizeDeliveryText(title);
    const cleanDetails = sanitizeDeliveryText(details);
    const measurementError = validateDeliveryMeasurement(deliveryType, measurement);
    if (!pickup || !dropoff || !route || !cleanTitle || !cleanDetails) { setError("Sélectionnez deux lieux GPS et renseignez les informations demandées."); return; }
    if (!isAllowedDeliveryText(cleanTitle) || !isAllowedDeliveryText(cleanDetails)) { setError("Les informations contiennent des caractères non autorisés."); return; }
    if (measurementError) { setError(measurementError); return; }
    if (priceInputError) { setError(priceInputError); return; }
    setError(""); setLoading(true);
    try {
      await Promise.all([savePlaceMutation.mutateAsync(toPlacePayload(pickup)), savePlaceMutation.mutateAsync(toPlacePayload(dropoff))]);
      const delivery = createDemoDelivery({ title: cleanTitle, type: deliveryType, pickup, dropoff, distanceKm: route.distanceKm, estimatedPrice: estimate, ...(parsedOfferedPrice ? { offeredPrice: parsedOfferedPrice } : {}), vehicleTypes: [vehicle], details: cleanDetails, ...(deliveryType === "Autre" && weightKg ? { weightKg: Number(weightKg) } : {}), ...(deliveryType === "Autre" && Object.keys(dimensions).length ? { dimensions } : {}), ...(deliveryType === "Personne" ? { passengers: Number(passengers) } : {}) });
      router.replace(`/delivery/${delivery.id}` as any);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "La livraison n’a pas pu être publiée."); }
    finally { setLoading(false); }
  }

  function selectPlace(target: "pickup" | "dropoff", place: LocationLabel) {
    if (target === "pickup") setPickup(place); else setDropoff(place);
    setError("");
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.topBar}>
            <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.back, pressed && styles.pressed]}><MaterialIcons name="arrow-back" size={22} color="#0B1F3A" /></Pressable>
            <Text style={styles.topTitle}>Nouvelle livraison</Text>
            <View style={styles.placeholder} />
          </View>
          <Text style={styles.title}>Composez une course précise.</Text>
          <Text style={styles.subtitle}>Choisissez vos lieux dans un écran dédié pour garder ce formulaire clair et rapide.</Text>

          <Text style={styles.sectionLabel}>TYPE DE COURSE</Text>
          <View style={styles.typeRow}>{DELIVERY_TYPES.map((item) => <Pressable key={item.value} onPress={() => setDeliveryType(item.value)} style={({ pressed }) => [styles.typeChip, deliveryType === item.value && styles.typeChipActive, pressed && styles.pressed]}><MaterialIcons name={item.icon} size={17} color={deliveryType === item.value ? "#FFFFFF" : "#007B8B"} /><Text style={[styles.typeText, deliveryType === item.value && styles.typeTextActive]}>{item.label}</Text></Pressable>)}</View>

          <Field label="Titre de la course" value={title} onChangeText={(value) => setTitle(sanitizeDeliveryText(value))} placeholder={deliveryType === "Plis" ? "Ex. Documents de bureau" : deliveryType === "Personne" ? "Ex. Trajet vers l’aéroport" : "Ex. Petit matériel"} />
          <Field label="Consignes" value={details} onChangeText={(value) => setDetails(sanitizeDeliveryText(value))} placeholder="Informations utiles pour le livreur" multiline />
          {deliveryType === "Personne" ? <Field label="Nombre de personnes" value={passengers} onChangeText={(value) => setPassengers(value.replace(/\D/g, "").slice(0, 1))} placeholder="1" keyboardType="number-pad" icon="groups" /> : null}
          {deliveryType === "Autre" ? <SurfaceCard style={styles.measureCard}><Text style={styles.measureTitle}>Mesures facultatives</Text><Text style={styles.measureSubtitle}>Ajoutez le poids et les dimensions si vous les connaissez pour affiner l’estimation.</Text><Field label="Poids (kg)" value={weightKg} onChangeText={(value) => setWeightKg(value.replace(/[^0-9.]/g, "").slice(0, 6))} placeholder="Ex. 12" keyboardType="decimal-pad" icon="scale" /><Text style={styles.fieldLabel}>Dimensions (cm)</Text><View style={styles.dimensionRow}><MiniNumber value={lengthCm} onChangeText={setLengthCm} placeholder="Long." /><MiniNumber value={widthCm} onChangeText={setWidthCm} placeholder="Larg." /><MiniNumber value={heightCm} onChangeText={setHeightCm} placeholder="Haut." /></View></SurfaceCard> : null}

          <View style={styles.routeHeader}><Text style={styles.sectionLabel}>TRAJET</Text><Pressable onPress={() => setFavoritesVisible(true)} style={({ pressed }) => [styles.favoritesButton, pressed && styles.pressed]}><MaterialIcons name="star" size={16} color="#A86600" /><Text style={styles.favoritesButtonText}>Favoris</Text></Pressable></View>
          <SurfaceCard style={styles.routeCard}>
            <CompactLocationField label="Récupération" tone="pickup" value={pickup} loading={favoriteTarget === "pickup"} onPress={() => setPickerTarget("pickup")} onFavorite={() => void addFavorite("pickup")} />
            <View style={styles.routeDivider} />
            <CompactLocationField label="Destination" tone="dropoff" value={dropoff} loading={favoriteTarget === "dropoff"} onPress={() => setPickerTarget("dropoff")} onFavorite={() => void addFavorite("dropoff")} />
          </SurfaceCard>

          <Text style={styles.sectionLabel}>ENGIN ET ESTIMATION</Text>
          <Text style={styles.helper}>Sélectionnez un seul engin compatible. La fourgonnette n’est pas disponible.</Text>
          <View style={styles.vehicleGrid}>{VEHICLES.map((item) => <Pressable key={item} onPress={() => setVehicle(item)} style={({ pressed }) => [styles.vehicle, vehicle === item && styles.vehicleActive, pressed && styles.pressed]}><MaterialIcons name={item === "Vélo" || item === "Tricycle" ? "pedal-bike" : item === "Moto" ? "two-wheeler" : "directions-car"} size={20} color={vehicle === item ? "#FFFFFF" : "#007B8B"} /><Text style={[styles.vehicleText, vehicle === item && styles.vehicleTextActive]}>{item}</Text></Pressable>)}</View>
          <View style={styles.estimate}><MaterialIcons name="auto-awesome" size={18} color="#007B8B" /><View style={styles.estimateInfo}><Text style={styles.estimateLabel}>{route ? `Estimation ${vehicle.toLocaleLowerCase("fr-FR")} · ${route.distanceKm.toFixed(1)} km` : "Sélectionnez les deux lieux"}</Text><Text style={styles.estimateValue}>{estimate ? `${estimate.toLocaleString("fr-FR")} FCFA` : "—"}</Text></View></View>
          <View style={styles.priceFieldWrap}>
            <View style={styles.priceLabelRow}><Text style={styles.fieldLabel}>Prix proposé au livreur</Text><Text style={styles.optional}>Facultatif</Text></View>
            <View style={styles.priceField}><MaterialIcons name="payments" size={18} color="#007B8B" style={styles.fieldIcon} /><TextInput value={offeredPriceInput} onChangeText={(value) => setOfferedPriceInput(sanitizeOfferedPriceInput(value))} keyboardType="number-pad" maxLength={8} placeholder={estimate ? `${estimate.toLocaleString("fr-FR")} FCFA` : "Ex. 4 500"} placeholderTextColor="#9AA5B6" style={styles.input} /><Text style={styles.currency}>FCFA</Text></View>
            {priceInputError ? <Text style={styles.priceError}>{priceInputError}</Text> : parsedOfferedPrice && estimate ? <Text style={styles.priceHint}>{priceDifference === 0 ? "Aligné sur l’estimation intelligente." : `${priceDifference > 0 ? "+" : ""}${priceDifference}% par rapport à l’estimation.`}</Text> : <Text style={styles.priceHint}>Sans saisie, l’estimation intelligente sera publiée comme prix proposé.</Text>}
          </View>
          {routeMessage ? <Text style={[styles.routeMessage, !route?.precise && styles.routeWarning]}>{routeMessage}</Text> : null}
          {pickup && dropoff ? <Text style={styles.routeTitle}>{compactRouteLabel(pickup, dropoff)}</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <TikisButton label={`Publier · ${publishedPrice ? `${publishedPrice.toLocaleString("fr-FR")} FCFA` : "prix à définir"}`} icon="publish" onPress={() => void publish()} loading={loading} disabled={!pickup || !dropoff || !route || !estimate || Boolean(priceInputError)} style={styles.publish} />
          <Text style={styles.footerNote}>Aucun débit immédiat. Les coordonnées complètes servent uniquement à la course et au calcul de distance.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
      <FloatingPlacePicker visible={Boolean(pickerTarget)} target={pickerTarget} value={pickerTarget === "pickup" ? pickup : dropoff} onClose={() => setPickerTarget(null)} onSelect={(place) => { if (pickerTarget) selectPlace(pickerTarget, place); }} />
      <FavoritePlacesSheet visible={favoritesVisible} favorites={favoriteLocations} onClose={() => setFavoritesVisible(false)} onPickup={(place) => selectPlace("pickup", place)} onDropoff={(place) => selectPlace("dropoff", place)} onRename={renameFavorite} onRemove={removeFavorite} />
    </SafeAreaView>
  );
}

function CompactLocationField({ label, tone, value, loading, onPress, onFavorite }: { label: string; tone: "pickup" | "dropoff"; value: LocationLabel | null; loading: boolean; onPress: () => void; onFavorite: () => void }) {
  const accent = tone === "pickup" ? "#007B8B" : "#C23B45";
  return <View style={styles.locationRow}><Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.locationPressable, pressed && styles.pressed]}><View style={[styles.locationIcon, { backgroundColor: tone === "pickup" ? "#E6F5F6" : "#FFF0F1" }]}><MaterialIcons name={tone === "pickup" ? "trip-origin" : "location-on"} size={18} color={accent} /></View><View style={styles.locationCopy}><Text style={styles.locationLabel}>{label}</Text><Text style={[styles.locationValue, !value && styles.locationPlaceholder]} numberOfLines={1}>{value ? [value.name, value.district, value.city].filter(Boolean).join(" · ") : "Choisir une adresse"}</Text></View><MaterialIcons name="chevron-right" size={21} color="#9AA5B6" /></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Ajouter ${label} aux favoris`} onPress={onFavorite} disabled={!value || loading} style={({ pressed }) => [styles.starButton, (!value || loading) && styles.disabled, pressed && styles.pressed]}>{loading ? <ActivityIndicator size="small" color="#A86600" /> : <MaterialIcons name={value ? "star-outline" : "star-border"} size={19} color="#A86600" />}</Pressable></View>;
}

function Field({ label, icon, keyboardType, ...props }: { label: string; icon?: React.ComponentProps<typeof MaterialIcons>["name"]; keyboardType?: "default" | "number-pad" | "decimal-pad"; value: string; onChangeText: (value: string) => void; placeholder: string; multiline?: boolean }) { return <View style={styles.fieldWrap}><Text style={styles.fieldLabel}>{label}</Text><View style={[styles.field, props.multiline && styles.fieldMultiline]}>{icon ? <MaterialIcons name={icon} size={18} color="#007B8B" style={styles.fieldIcon} /> : null}<TextInput {...props} keyboardType={keyboardType} maxLength={props.multiline ? 450 : 120} style={[styles.input, props.multiline && styles.inputMultiline]} placeholderTextColor="#9AA5B6" /></View></View>; }
function MiniNumber({ value, onChangeText, placeholder }: { value: string; onChangeText: (value: string) => void; placeholder: string }) { return <TextInput value={value} onChangeText={(text) => onChangeText(text.replace(/\D/g, "").slice(0, 4))} keyboardType="number-pad" placeholder={placeholder} placeholderTextColor="#9AA5B6" style={styles.miniInput} />; }

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F6F8FC" }, keyboard: { flex: 1 }, content: { padding: 20, paddingBottom: 45 }, topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }, back: { width: 42, height: 42, borderRadius: 21, backgroundColor: "#FFFFFF", borderColor: "#E7ECF2", borderWidth: 1, alignItems: "center", justifyContent: "center" }, topTitle: { color: "#0B1F3A", fontWeight: "900", fontSize: 16 }, placeholder: { width: 42 }, title: { color: "#0B1F3A", fontSize: 26, lineHeight: 32, fontWeight: "900", letterSpacing: -0.4 }, subtitle: { color: "#697386", fontSize: 13, lineHeight: 20, marginTop: 7 }, sectionLabel: { color: "#8A96A8", fontSize: 11, fontWeight: "900", letterSpacing: 0.8, marginTop: 25, marginBottom: 9 }, typeRow: { flexDirection: "row", gap: 8, marginBottom: 15 }, typeChip: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", gap: 3, backgroundColor: "#FFFFFF", borderRadius: 13, borderWidth: 1, borderColor: "#DDE5ED" }, typeChipActive: { backgroundColor: "#007B8B", borderColor: "#007B8B" }, typeText: { color: "#697386", fontSize: 12, fontWeight: "800" }, typeTextActive: { color: "#FFFFFF" }, fieldWrap: { marginBottom: 13 }, fieldLabel: { color: "#485569", fontWeight: "800", fontSize: 13, marginBottom: 7 }, field: { minHeight: 50, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#DDE5ED", borderRadius: 15, flexDirection: "row", alignItems: "center", paddingHorizontal: 14 }, fieldMultiline: { minHeight: 78, alignItems: "flex-start", paddingTop: 13 }, fieldIcon: { marginRight: 9, marginTop: 1 }, input: { flex: 1, color: "#0B1F3A", fontSize: 14, fontWeight: "600", minHeight: 39 }, inputMultiline: { textAlignVertical: "top", minHeight: 51 }, measureCard: { padding: 15, marginBottom: 4 }, measureTitle: { color: "#0B1F3A", fontWeight: "900", fontSize: 14 }, measureSubtitle: { color: "#697386", fontSize: 12, lineHeight: 17, marginTop: 4, marginBottom: 13 }, dimensionRow: { flexDirection: "row", gap: 8 }, miniInput: { flex: 1, minHeight: 47, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#DDE5ED", borderRadius: 13, paddingHorizontal: 10, color: "#0B1F3A", fontSize: 13, fontWeight: "800" }, routeHeader: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" }, favoritesButton: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#FFF4D8", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, marginBottom: 6 }, favoritesButtonText: { color: "#8A5A0E", fontSize: 11, fontWeight: "900" }, routeCard: { padding: 4, overflow: "hidden" }, locationRow: { minHeight: 64, flexDirection: "row", alignItems: "center", paddingLeft: 10, paddingRight: 7 }, locationPressable: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, minWidth: 0 }, locationIcon: { width: 34, height: 34, borderRadius: 12, alignItems: "center", justifyContent: "center" }, locationCopy: { flex: 1, minWidth: 0 }, locationLabel: { color: "#79869A", fontSize: 10, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.45 }, locationValue: { color: "#0B1F3A", fontSize: 13, fontWeight: "800", marginTop: 3 }, locationPlaceholder: { color: "#9AA5B6" }, starButton: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", marginLeft: 6, backgroundColor: "#FFF8E8" }, routeDivider: { height: 1, backgroundColor: "#EEF2F6", marginHorizontal: 9 }, helper: { color: "#697386", fontSize: 12, lineHeight: 18, marginBottom: 10 }, vehicleGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, vehicle: { width: "48.5%", height: 48, borderRadius: 14, borderWidth: 1, borderColor: "#CDE4E7", backgroundColor: "#FFFFFF", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 }, vehicleActive: { backgroundColor: "#007B8B", borderColor: "#007B8B" }, vehicleText: { color: "#007B8B", fontSize: 13, fontWeight: "900" }, vehicleTextActive: { color: "#FFFFFF" }, estimate: { backgroundColor: "#E5F6F7", borderRadius: 14, flexDirection: "row", alignItems: "center", gap: 10, padding: 13, marginTop: 12 }, estimateInfo: { flex: 1 }, estimateLabel: { color: "#35656C", fontSize: 12, fontWeight: "700" }, estimateValue: { color: "#006572", fontWeight: "900", fontSize: 17, marginTop: 2 }, priceFieldWrap: { marginTop: 13 }, priceLabelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, optional: { color: "#8A96A8", fontSize: 11, fontWeight: "800", marginBottom: 7 }, priceField: { minHeight: 50, flexDirection: "row", alignItems: "center", paddingHorizontal: 14, borderRadius: 15, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#B8DDE0" }, currency: { color: "#697386", fontSize: 12, fontWeight: "900", marginLeft: 8 }, priceHint: { color: "#35656C", fontSize: 11, lineHeight: 16, marginTop: 6 }, priceError: { color: "#C23B45", fontSize: 11, lineHeight: 16, marginTop: 6, fontWeight: "700" }, routeMessage: { color: "#147A58", fontSize: 11, fontWeight: "700", lineHeight: 16, marginTop: 6 }, routeWarning: { color: "#B45309" }, routeTitle: { color: "#0B1F3A", fontSize: 12, fontWeight: "800", marginTop: 5 }, error: { color: "#C23B45", fontWeight: "800", fontSize: 13, textAlign: "center", marginTop: 18 }, publish: { marginTop: 23 }, footerNote: { color: "#778398", fontSize: 12, textAlign: "center", lineHeight: 18, marginTop: 14, paddingHorizontal: 8 }, disabled: { opacity: 0.45 }, pressed: { opacity: 0.67 } });
