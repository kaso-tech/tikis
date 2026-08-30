import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { type SavedFavorite } from "@/components/tikis/place-sheets";
import { YangoAddressPicker } from "@/components/tikis/yango-address-picker";
import { TikisButton } from "@/components/tikis/ui";
import { offeredPriceError, parseOfferedPrice, priceDifferencePercent, sanitizeOfferedPriceInput } from "@/lib/delivery-price";
import { estimateDeliveryPrice, formatListRoute, formatFavoritePlace, provisionalRoute, sanitizePlaceText, validateDeliveryMeasurement } from "@/lib/geo-rules";
import { deliveryTextInputIssue, isAllowedDeliveryText, sanitizeDeliveryText } from "@/lib/tikis-engine";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";
import { locationSubtitle, locationTitle, type DeliveryType, type LocationLabel, type SelectableVehicleType } from "@/shared/tikis-domain";

const VEHICLES: SelectableVehicleType[] = ["Vélo", "Moto", "Tricycle", "Voiture"];
const VEHICLE_ICON: Record<SelectableVehicleType, React.ComponentProps<typeof MaterialIcons>["name"]> = {
  Vélo: "pedal-bike",
  Moto: "two-wheeler",
  Tricycle: "local-shipping",
  Voiture: "directions-car",
};
const DELIVERY_TYPES: { value: DeliveryType; icon: React.ComponentProps<typeof MaterialIcons>["name"]; label: string; sub: string }[] = [
  { value: "Plis", icon: "description", label: "Plis", sub: "Documents, colis" },
  { value: "Personne", icon: "person", label: "Personne", sub: "Trajet, transfert" },
  { value: "Autre", icon: "inventory-2", label: "Autre", sub: "Marchandises" },
];
type DeliveryFieldName = "title" | "details" | "passengers" | "pickup" | "dropoff" | "price";

function toPlacePayload(place: LocationLabel) {
  return { name: place.name, district: place.district, city: place.city, latitude: place.latitude, longitude: place.longitude, ...(place.googlePlaceId ? { googlePlaceId: place.googlePlaceId } : {}), ...(place.mapboxId ? { mapboxId: place.mapboxId } : {}), ...(place.mapboxSessionToken ? { mapboxSessionToken: place.mapboxSessionToken } : {}), ...(place.formattedAddress ? { formattedAddress: place.formattedAddress } : {}), ...(place.street ? { street: place.street } : {}), ...(place.province ? { province: place.province } : {}), ...(place.country ? { country: place.country } : {}), ...(place.source ? { source: place.source } : {}) };
}

function favoriteToLocation(item: { place: { placeName: string; district: string | null; city: string | null; latitude: string; longitude: string; googlePlaceId: string | null; mapboxPlaceId: string | null; formattedAddress: string; street: string | null; province: string | null; country: string | null; provider: string; source: string; featureType: string; precision: string } }): LocationLabel {
  return { name: item.place.placeName, district: item.place.district ?? "", city: item.place.city ?? "", latitude: Number(item.place.latitude), longitude: Number(item.place.longitude), ...(item.place.googlePlaceId ? { googlePlaceId: item.place.googlePlaceId } : {}), ...(item.place.mapboxPlaceId ? { mapboxId: item.place.mapboxPlaceId } : {}), ...(item.place.formattedAddress ? { formattedAddress: item.place.formattedAddress } : {}), ...(item.place.street ? { street: item.place.street } : {}), ...(item.place.province ? { province: item.place.province } : {}), ...(item.place.country ? { country: item.place.country } : {}), provider: item.place.provider === "mapbox" ? "mapbox" : item.place.provider === "manual" ? "manual" : "legacy", source: ["retrieve", "reverse", "forward", "favorite", "manual", "legacy"].includes(item.place.source) ? item.place.source as LocationLabel["source"] : "legacy", featureType: ["address", "secondary_address", "poi", "street", "neighborhood", "locality", "place", "point", "unknown"].includes(item.place.featureType) ? item.place.featureType as LocationLabel["featureType"] : "unknown", precision: ["exact", "street", "area", "city", "unknown"].includes(item.place.precision) ? item.place.precision as LocationLabel["precision"] : "unknown" };
}

export default function CreateDeliveryScreen() {
  const { deliveryId } = useLocalSearchParams<{ deliveryId?: string }>();
  const { profile } = useTikisStore();
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [deliveryType, setDeliveryType] = useState<DeliveryType>("Plis");
  const [vehicle, setVehicle] = useState<SelectableVehicleType>("Moto");
  const [pickup, setPickup] = useState<LocationLabel | null>(null);
  const [dropoff, setDropoff] = useState<LocationLabel | null>(null);
  const [weightKg, setWeightKg] = useState("");
  const [lengthCm, setLengthCm] = useState("");
  const [widthCm, setWidthCm] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [passengers, setPassengers] = useState("");
  const [offeredPriceInput, setOfferedPriceInput] = useState("");
  const [route, setRoute] = useState<{ distanceKm: number; durationMinutes: number; precise: boolean; source: "routes" | "provisional" } | null>(null);
  const [routeMessage, setRouteMessage] = useState("");
  const [touched, setTouched] = useState<Partial<Record<DeliveryFieldName, boolean>>>({});
  const [inputIssues, setInputIssues] = useState<Partial<Record<DeliveryFieldName, string>>>({});
  const [loading, setLoading] = useState(false);
  const [publicationStage, setPublicationStage] = useState("");
  const [pickerTarget, setPickerTarget] = useState<"pickup" | "dropoff" | null>(null);
  const { mutateAsync: requestRoute } = trpc.geography.route.useMutation();
  const createDeliveryMutation = trpc.deliveries.create.useMutation();
  const updateDeliveryMutation = trpc.deliveries.update.useMutation();
  const savePlaceMutation = trpc.geography.savePlace.useMutation();
  const favoriteMutation = trpc.geography.favorites.add.useMutation();
  const favoritesQuery = trpc.geography.favorites.list.useQuery(undefined, { enabled: Boolean(profile?.phone) });
  const deliveryQuery = trpc.deliveries.get.useQuery({ id: deliveryId ?? "00000000-0000-4000-8000-000000000000" }, { enabled: Boolean(deliveryId && profile?.phone) });
  const initializedDeliveryId = useRef<string | null>(null);
  const isEditing = Boolean(deliveryId);

  useEffect(() => {
    const delivery = deliveryQuery.data;
    if (!delivery || initializedDeliveryId.current === delivery.id) return;
    initializedDeliveryId.current = delivery.id;
    setTitle(delivery.title);
    setDetails(delivery.details);
    setDeliveryType(delivery.type);
    setVehicle(delivery.vehicleTypes[0] ?? "Moto");
    setPickup(delivery.pickup);
    setDropoff(delivery.dropoff);
    setWeightKg(delivery.weightKg ? String(delivery.weightKg) : "");
    setLengthCm(delivery.dimensions?.lengthCm ? String(delivery.dimensions.lengthCm) : "");
    setWidthCm(delivery.dimensions?.widthCm ? String(delivery.dimensions.widthCm) : "");
    setHeightCm(delivery.dimensions?.heightCm ? String(delivery.dimensions.heightCm) : "");
    setPassengers(delivery.passengers ? String(delivery.passengers) : "");
    setOfferedPriceInput(delivery.offeredPrice ? String(delivery.offeredPrice) : "");
  }, [deliveryQuery.data]);

  const dimensions = useMemo(() => ({ ...(lengthCm ? { lengthCm: Number(lengthCm) } : {}), ...(widthCm ? { widthCm: Number(widthCm) } : {}), ...(heightCm ? { heightCm: Number(heightCm) } : {}) }), [lengthCm, widthCm, heightCm]);
  const measurement = useMemo(() => ({ ...(weightKg ? { weightKg: Number(weightKg) } : {}), ...(deliveryType === "Personne" ? { passengers: Number(passengers) } : {}), ...(Object.keys(dimensions).length ? { dimensions } : {}) }), [weightKg, deliveryType, passengers, dimensions]);

  useEffect(() => {
    let active = true;
    async function calculateRoute() {
      if (!pickup || !dropoff) { setRoute(null); setRouteMessage(""); return; }
      const fallback = provisionalRoute(pickup, dropoff);
      setRoute(fallback);
      setRouteMessage("Estimation de distance en cours de précision…");
      try {
        const result = await requestRoute({ origin: toPlacePayload(pickup), destination: toPlacePayload(dropoff) });
        if (active) { setRoute({ ...result, precise: true, source: "routes" }); setRouteMessage("Distance routière calculée."); }
      } catch {
        if (active) {
          setRoute(fallback);
          setRouteMessage("Estimation provisoire basée sur les coordonnées GPS.");
        }
      }
    }
    void calculateRoute();
    return () => { active = false; };
  }, [pickup, dropoff, requestRoute]);

  const estimate = useMemo(() => route ? estimateDeliveryPrice({ distanceKm: route.distanceKm, durationMinutes: route.durationMinutes, type: deliveryType, vehicle, ...measurement }) : 0, [route, deliveryType, vehicle, measurement]);
  const parsedOfferedPrice = useMemo(() => parseOfferedPrice(offeredPriceInput), [offeredPriceInput]);
  const priceInputError = useMemo(() => offeredPriceError(offeredPriceInput), [offeredPriceInput]);
  const titleIssue = inputIssues.title || (touched.title ? deliveryTextInputIssue(title) : "");
  const detailsIssue = inputIssues.details || (touched.details ? deliveryTextInputIssue(details) : "");
  const passengerIssue = inputIssues.passengers || (deliveryType === "Personne" && touched.passengers && (!Number(passengers) || Number(passengers) > 4) ? "Indiquez entre 1 et 4 personnes." : "");
  const pickupIssue = touched.pickup && !pickup ? "Choisissez le lieu de récupération." : "";
  const dropoffIssue = touched.dropoff && !dropoff ? "Choisissez la destination." : "";
  const measurementIssue = useMemo(() => validateDeliveryMeasurement(deliveryType, measurement), [deliveryType, measurement]);
  const titleReady = !deliveryTextInputIssue(title) && !inputIssues.title;
  const detailsReady = !deliveryTextInputIssue(details) && !inputIssues.details;
  const passengerReady = deliveryType !== "Personne" || (Number(passengers) >= 1 && Number(passengers) <= 4 && !inputIssues.passengers);
  const canPublish = Boolean(titleReady && detailsReady && pickup && dropoff && route && estimate && passengerReady && !measurementIssue && !priceInputError);
  const publishedPrice = parsedOfferedPrice ?? estimate;
  const priceDifference = parsedOfferedPrice && estimate ? priceDifferencePercent(parsedOfferedPrice, estimate) : 0;
  const favoriteLocations: SavedFavorite[] = useMemo(() => (favoritesQuery.data ?? []).map((item) => ({ id: item.id, label: item.label, location: favoriteToLocation(item) })), [favoritesQuery.data]);

  const filledCount = useMemo(() => {
    let count = 0;
    if (pickup) count++;
    if (dropoff) count++;
    if (title.trim()) count++;
    if (details.trim()) count++;
    if (deliveryType === "Personne" && passengers) count++;
    if (offeredPriceInput) count++;
    return count;
  }, [pickup, dropoff, title, details, passengers, deliveryType, offeredPriceInput]);
  const totalFields = 5;
  const progress = Math.min(100, Math.round((filledCount / totalFields) * 100));

  async function addFavorite(place: LocationLabel, label: string) {
    if (!profile?.phone) return;
    try {
      const persisted = await savePlaceMutation.mutateAsync(toPlacePayload(place));
      await favoriteMutation.mutateAsync({ placeId: persisted.id, label: sanitizePlaceText(label, 80) || formatFavoritePlace(place) || "Lieu favori" });
      await favoritesQuery.refetch();
    } catch { throw new Error("Impossible d’enregistrer cette adresse. Vérifiez votre connexion puis réessayez."); }
  }

  async function executePublication() {
    if (loading || !canPublish) {
      setTouched({ title: true, details: true, passengers: deliveryType === "Personne", pickup: true, dropoff: true, price: Boolean(offeredPriceInput) });
      setInputIssues((current) => ({ ...current, title: deliveryTextInputIssue(title), details: deliveryTextInputIssue(details), passengers: deliveryType === "Personne" && (!Number(passengers) || Number(passengers) > 4) ? "Indiquez entre 1 et 4 personnes." : "", price: priceInputError || "" }));
      if (!pickup || !dropoff) setRouteMessage("Sélectionnez les deux lieux requis pour calculer l’itinéraire.");
      return;
    }
    const cleanTitle = sanitizeDeliveryText(title);
    const cleanDetails = sanitizeDeliveryText(details);
    if (!pickup || !dropoff || !route || !isAllowedDeliveryText(cleanTitle) || !isAllowedDeliveryText(cleanDetails)) return;
    setPublicationStage("Enregistrement des lieux…"); setLoading(true);
    try {
      setPublicationStage(isEditing ? "Mise à jour de la livraison…" : "Publication auprès des livreurs…");
      const payload = { title: cleanTitle, type: deliveryType, pickup: toPlacePayload(pickup), dropoff: toPlacePayload(dropoff), distanceKm: route.distanceKm, routeSource: route.source, estimatedPrice: estimate, ...(parsedOfferedPrice ? { offeredPrice: parsedOfferedPrice } : {}), vehicleTypes: [vehicle], details: cleanDetails, ...(deliveryType === "Autre" && weightKg ? { weightKg: Number(weightKg) } : {}), ...(deliveryType === "Autre" && Object.keys(dimensions).length ? { dimensions } : {}), ...(deliveryType === "Personne" ? { passengers: Number(passengers) } : {}) };
      const delivery = isEditing && deliveryId ? await updateDeliveryMutation.mutateAsync({ ...payload, deliveryId }) : await createDeliveryMutation.mutateAsync(payload);
      if (!delivery) throw new Error("La livraison n’a pas pu être enregistrée.");
      router.replace(`/delivery/${delivery.id}` as any);
    } catch { setPublicationStage(isEditing ? "Modification indisponible. Vérifiez votre connexion puis réessayez." : "Publication indisponible. Vérifiez votre connexion puis réessayez."); }
    finally { setLoading(false); setPublicationStage(""); }
  }

  function publish() {
    if (loading || !canPublish) {
      void executePublication();
      return;
    }
    if (!isEditing) { void executePublication(); return; }
    Alert.alert("Enregistrer les modifications", "Les livreurs qui se sont déjà proposés seront informés et leurs candidatures seront annulées afin qu’ils puissent se proposer à nouveau avec les bonnes informations.", [
      { text: "Continuer l’édition", style: "cancel" },
      { text: "Enregistrer", onPress: () => void executePublication() },
    ]);
  }

  function selectPlace(target: "pickup" | "dropoff", place: LocationLabel) {
    if (target === "pickup") setPickup(place); else setDropoff(place);
    setTouched((current) => ({ ...current, [target]: true }));
  }

  function retryRoute() {
    if (!pickup || !dropoff) return;
    setRouteMessage("Nouvelle tentative de calcul de l’itinéraire sécurisé…");
    setPickup((current) => current ? { ...current } : current);
  }

  const footerLabel = !pickup || !dropoff
    ? `${pickup && dropoff ? 2 : pickup || dropoff ? 1 : 0}/2 adresses`
    : !title.trim() || !details.trim()
      ? `${title.trim() && details.trim() ? 2 : title.trim() || details.trim() ? 1 : 0} champ${title.trim() && details.trim() ? "s" : ""} restant${title.trim() && details.trim() ? "s" : ""}`
      : publishedPrice
        ? `${publishedPrice.toLocaleString("fr-FR")} FCFA`
        : "Prix à définir";
  const ctaLabel = isEditing ? "Enregistrer" : "Publier";

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]} accessibilityLabel="Retour">
            <MaterialIcons name="arrow-back" size={20} color="#111111" />
          </Pressable>
          <View style={styles.topTitleWrap}>
            <Text style={styles.topTitle}>{isEditing ? "Modifier la livraison" : "Nouvelle livraison"}</Text>
            <Text style={styles.topStep}>{progress}%</Text>
          </View>
          <View style={styles.iconBtnSpacer} />
        </View>

        <View style={styles.progressWrap}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress}%` }]} />
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.section}>
            <Text style={styles.eyebrow}>ITINÉRAIRE</Text>
            <Text style={styles.sectionTitle}>D’où à où ?</Text>
            <View style={styles.routeCard}>
              <RouteInput tone="pickup" label="RÉCUPÉRATION" value={pickup} invalid={Boolean(pickupIssue)} onPress={() => setPickerTarget("pickup")} />
              {route ? (
                <View style={styles.routeConnector}>
                  <View style={styles.routeConnectorLine} />
                  <Text style={styles.routeConnectorMeta}>{route.distanceKm.toFixed(1)} km · ~{Math.max(1, Math.round(route.durationMinutes))} min</Text>
                </View>
              ) : (
                <View style={styles.routeConnector}>
                  <View style={[styles.routeConnectorLine, styles.routeConnectorLineDashed]} />
                </View>
              )}
              <RouteInput tone="dropoff" label="DESTINATION" value={dropoff} invalid={Boolean(dropoffIssue)} onPress={() => setPickerTarget("dropoff")} />
              {route ? (
                <View style={styles.routeMiniSummary}>
                  <Text style={styles.routeMiniSummaryLabel}>Distance estimée</Text>
                  <Text style={styles.routeMiniSummaryValue}>{route.distanceKm.toFixed(1)} km · ~{Math.max(1, Math.round(route.durationMinutes))} min</Text>
                </View>
              ) : null}
            </View>
            {routeMessage ? <Text style={[styles.routeMessage, !route?.precise && styles.routeWarning]}>{routeMessage}</Text> : null}
            {pickup && dropoff && (!route || !route.precise) ? (
              <Pressable accessibilityRole="button" onPress={retryRoute} style={({ pressed }) => [styles.retryRoute, pressed && styles.pressed]}>
                <MaterialIcons name="refresh" size={14} color="#007B8B" />
                <Text style={styles.retryRouteText}>{route ? "Recalculer avec Routes API" : "Réessayer le calcul d’itinéraire"}</Text>
              </Pressable>
            ) : null}
            {pickup && dropoff ? <Text style={styles.routeTitle}>{formatListRoute(pickup, dropoff)}</Text> : null}
          </View>

          <View style={styles.section}>
            <Text style={styles.eyebrow}>RACCOURCI</Text>
            <Pressable onPress={() => router.push("/(tabs)/addresses" as any)} style={({ pressed }) => [styles.shortcut, pressed && styles.pressed]}>
              <MaterialIcons name="bookmark" size={16} color="#747474" />
              <Text style={styles.shortcutText}>Choisir depuis mes adresses enregistrées</Text>
              <MaterialIcons name="chevron-right" size={16} color="#747474" />
            </Pressable>
          </View>

          <View style={styles.section}>
            <Text style={styles.eyebrow}>TYPE</Text>
            <Text style={styles.sectionTitle}>Qu’envoyez-vous ?</Text>
            <View style={styles.typeGrid}>
              {DELIVERY_TYPES.map((item) => {
                const active = deliveryType === item.value;
                return (
                  <Pressable key={item.value} onPress={() => setDeliveryType(item.value)} style={({ pressed }) => [styles.typeCard, active && styles.typeCardActive, pressed && styles.pressed]}>
                    <View style={[styles.typeIcon, active && styles.typeIconActive]}>
                      <MaterialIcons name={item.icon} size={18} color={active ? "#FFFFFF" : "#007B8B"} />
                    </View>
                    <Text style={[styles.typeLabel, active && styles.typeLabelActive]}>{item.label}</Text>
                    <Text style={[styles.typeSub, active && styles.typeSubActive]}>{item.sub}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.eyebrow}>ENGIN</Text>
            <Text style={styles.sectionTitle}>Quel engin ?</Text>
            <View style={styles.vehicleGrid}>
              {VEHICLES.map((item) => {
                const active = vehicle === item;
                return (
                  <Pressable key={item} onPress={() => setVehicle(item)} style={({ pressed }) => [styles.vehicleCard, active && styles.vehicleCardActive, pressed && styles.pressed]}>
                    <MaterialIcons name={VEHICLE_ICON[item]} size={18} color={active ? "#007B8B" : "#666666"} />
                    <Text style={[styles.vehicleLabel, active && styles.vehicleLabelActive]}>{item}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.eyebrow}>DÉTAILS</Text>
            <Field label="Titre de la course" value={title} error={titleIssue} onBlur={() => { setTouched((current) => ({ ...current, title: true })); setInputIssues((current) => ({ ...current, title: deliveryTextInputIssue(title) })); }} onChangeText={(value) => { const issue = !isAllowedDeliveryText(value) ? "Caractères non autorisés." : ""; setTitle(sanitizeDeliveryText(value, { preserveTrailingSpace: true })); setInputIssues((current) => ({ ...current, title: issue || (touched.title ? deliveryTextInputIssue(value) : "") })); }} placeholder={deliveryType === "Plis" ? "Ex. Documents de bureau" : deliveryType === "Personne" ? "Ex. Trajet vers l’aéroport" : "Ex. Petit matériel"} />
            <Field label="Consignes" value={details} error={detailsIssue} onBlur={() => { setTouched((current) => ({ ...current, details: true })); setInputIssues((current) => ({ ...current, details: deliveryTextInputIssue(details) })); }} onChangeText={(value) => { const issue = !isAllowedDeliveryText(value) ? "Caractères non autorisés." : ""; setDetails(sanitizeDeliveryText(value, { preserveTrailingSpace: true })); setInputIssues((current) => ({ ...current, details: issue || (touched.details ? deliveryTextInputIssue(value) : "") })); }} placeholder="Informations utiles pour le livreur" multiline />
            {deliveryType === "Personne" ? (
              <Field label="Nombre de personnes" value={passengers} error={passengerIssue} onBlur={() => { setTouched((current) => ({ ...current, passengers: true })); }} onChangeText={(value) => { setPassengers(value.replace(/\D/g, "").slice(0, 1)); setInputIssues((current) => ({ ...current, passengers: /\D/.test(value) ? "Caractères non autorisés." : "" })); }} placeholder="1" keyboardType="number-pad" icon="groups" />
            ) : null}
            {deliveryType === "Autre" ? (
              <View style={styles.measureCard}>
                <Text style={styles.measureTitle}>Mesures facultatives</Text>
                <Text style={styles.measureSubtitle}>Ajoutez le poids et les dimensions pour affiner l’estimation.</Text>
                <Field label="Poids (kg)" value={weightKg} onChangeText={(value) => setWeightKg(value.replace(/[^0-9.]/g, "").slice(0, 6))} placeholder="Ex. 12" keyboardType="decimal-pad" icon="scale" />
                <Text style={styles.fieldLabel}>Dimensions (cm)</Text>
                <View style={styles.dimensionRow}>
                  <MiniNumber value={lengthCm} onChangeText={setLengthCm} placeholder="Long." />
                  <MiniNumber value={widthCm} onChangeText={setWidthCm} placeholder="Larg." />
                  <MiniNumber value={heightCm} onChangeText={setHeightCm} placeholder="Haut." />
                </View>
              </View>
            ) : null}
          </View>

          <View style={styles.section}>
            <Text style={styles.eyebrow}>PRIX</Text>
            <Text style={styles.sectionTitle}>Fixez le prix de la course</Text>
            <View style={styles.priceCard}>
              <View style={styles.priceCardHeader}>
                <Text style={styles.priceCardLabel}>PRIX ESTIMÉ · {vehicle}</Text>
                <Text style={styles.priceCardValue}>{estimate ? `${estimate.toLocaleString("fr-FR")} F` : "—"}</Text>
              </View>
              <View style={styles.priceCardInput}>
                <TextInput value={offeredPriceInput} onBlur={() => setTouched((current) => ({ ...current, price: true }))} onChangeText={(value) => setOfferedPriceInput(sanitizeOfferedPriceInput(value))} keyboardType="number-pad" maxLength={8} placeholder={estimate ? `${estimate.toLocaleString("fr-FR")} F CFA` : "Ex. 4 500"} placeholderTextColor="rgba(255,255,255,0.5)" style={styles.priceCardInputText} />
                <Text style={styles.priceCardInputSuffix}>F CFA</Text>
              </View>
              {priceInputError ? (
                <Text style={styles.priceError}>{priceInputError}</Text>
              ) : parsedOfferedPrice && estimate ? (
                <View style={styles.priceCardHelper}>
                  <MaterialIcons name="check" size={12} color="#FFFFFF" />
                  <Text style={styles.priceCardNote}>{priceDifference === 0 ? "Aligné sur l’estimation intelligente." : `${priceDifference > 0 ? "+" : ""}${priceDifference}% vs estimation · Les livreurs voient cette majoration et peuvent candidater.`}</Text>
                </View>
              ) : (
                <Text style={styles.priceCardNote}>Sans saisie, l’estimation intelligente sera publiée comme prix proposé.</Text>
              )}
            </View>
          </View>

          {loading ? <Text style={styles.publicationLoadingHint}>{publicationStage || "Publication en cours…"}</Text> : null}
          {!loading && !canPublish ? <Text style={styles.publicationHint}>Complétez les champs requis et sélectionnez les deux lieux GPS pour {isEditing ? "enregistrer" : "publier"}.</Text> : null}
          <Text style={styles.footerNote}>Aucun débit immédiat. Les coordonnées complètes servent uniquement à la course et au calcul de distance.</Text>
        </ScrollView>

        <View style={styles.footer}>
          <View style={styles.footerSummary}>
            <Text style={styles.footerSummaryLabel}>{isEditing ? "Total" : "Total à publier"}</Text>
            <Text style={styles.footerSummaryValue}>{footerLabel}</Text>
          </View>
          <TikisButton
            label={`${ctaLabel}${publishedPrice ? ` · ${publishedPrice.toLocaleString("fr-FR")} F` : ""}`}
            icon={isEditing ? "save" : "publish"}
            onPress={publish}
            disabled={!canPublish || loading || (isEditing && deliveryQuery.isLoading)}
            loading={loading || (isEditing && deliveryQuery.isLoading)}
            loadingLabel={publicationStage || (isEditing && deliveryQuery.isLoading ? "Chargement de la livraison…" : "Publication en cours…")}
            style={styles.footerCta}
          />
        </View>
      </KeyboardAvoidingView>
      <YangoAddressPicker visible={Boolean(pickerTarget)} target={pickerTarget} value={pickerTarget === "pickup" ? pickup : dropoff} countryCode={profile?.countryCode} profilePhone={profile?.phone} favorites={favoriteLocations} onClose={() => { if (pickerTarget && !(pickerTarget === "pickup" ? pickup : dropoff)) setTouched((current) => ({ ...current, [pickerTarget]: true })); setPickerTarget(null); }} onSelect={(place) => { if (pickerTarget) selectPlace(pickerTarget, place); }} onFavorite={addFavorite} />
    </SafeAreaView>
  );
}

function RouteInput({ tone, label, value, invalid, onPress }: { tone: "pickup" | "dropoff"; label: string; value: LocationLabel | null; invalid: boolean; onPress: () => void }) {
  const isPickup = tone === "pickup";
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.routeInput, isPickup ? styles.routeInputFrom : styles.routeInputTo, invalid && styles.routeInputInvalid, pressed && styles.pressed]}>
      <View style={[styles.routeInputIcon, isPickup ? styles.routeInputIconFrom : styles.routeInputIconTo]}>
        <MaterialIcons name={isPickup ? "trip-origin" : "location-on"} size={14} color={isPickup ? "#007B8B" : "#B4232D"} />
      </View>
      <View style={styles.routeInputContent}>
        <Text style={[styles.routeInputLabel, invalid && styles.routeInputLabelInvalid]}>{label}</Text>
        {value ? (
          <>
            <Text style={styles.routeInputValue} numberOfLines={1}>{locationTitle(value)}</Text>
            <Text style={styles.routeInputMeta} numberOfLines={1}>{locationSubtitle(value)}</Text>
          </>
        ) : (
          <Text style={styles.routeInputPlaceholder}>Choisir une adresse</Text>
        )}
        {invalid ? <Text style={styles.routeInputIssue}>Lieu requis</Text> : null}
      </View>
      <MaterialIcons name="chevron-right" size={18} color="#747474" />
    </Pressable>
  );
}

function Field({ label, icon, keyboardType, error, ...props }: { label: string; icon?: React.ComponentProps<typeof MaterialIcons>["name"]; keyboardType?: "default" | "number-pad" | "decimal-pad"; value: string; onChangeText: (value: string) => void; onBlur?: () => void; placeholder: string; multiline?: boolean; error?: string }) {
  return <View style={styles.fieldWrap}><Text style={[styles.fieldLabel, error && styles.fieldLabelInvalid]}>{label}</Text><View style={[styles.field, props.multiline && styles.fieldMultiline, error && styles.fieldInvalid]}>{icon ? <MaterialIcons name={icon} size={18} color={error ? "#B4232D" : "#007B8B"} style={styles.fieldIcon} /> : null}<TextInput {...props} keyboardType={keyboardType} maxLength={props.multiline ? 450 : 120} style={[styles.input, props.multiline && styles.inputMultiline]} placeholderTextColor="#9AA5B6" /></View>{error ? <Text style={styles.fieldIssue}>{error}</Text> : null}</View>;
}

function MiniNumber({ value, onChangeText, placeholder }: { value: string; onChangeText: (value: string) => void; placeholder: string }) {
  return <TextInput value={value} onChangeText={(text) => onChangeText(text.replace(/\D/g, "").slice(0, 4))} keyboardType="number-pad" placeholder={placeholder} placeholderTextColor="#9AA5B6" style={styles.miniInput} />;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#EEEDF3" },
  keyboard: { flex: 1 },
  content: { padding: 16, paddingBottom: 24, gap: 14 },

  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8, gap: 8 },
  iconBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  iconBtnSpacer: { width: 36 },
  topTitleWrap: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  topTitle: { color: "#111111", fontSize: 15, fontWeight: "600" },
  topStep: { color: "#007B8B", fontSize: 11, fontWeight: "700" },

  progressWrap: { paddingHorizontal: 16, paddingBottom: 8 },
  progressTrack: { height: 4, backgroundColor: "#ECECEC", borderRadius: 2, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: "#007B8B", borderRadius: 2 },

  eyebrow: { color: "#747474", fontSize: 10, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 4 },
  sectionTitle: { color: "#111111", fontSize: 14, fontWeight: "600", marginBottom: 10 },
  section: { gap: 4 },

  routeCard: { backgroundColor: "#FFFFFF", borderRadius: 12, padding: 12, gap: 4 },
  routeInput: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, backgroundColor: "#EEEDF3", borderRadius: 9, borderLeftWidth: 3 },
  routeInputFrom: { borderLeftColor: "#007B8B" },
  routeInputTo: { borderLeftColor: "#B4232D" },
  routeInputInvalid: { borderColor: "#B4232D", borderWidth: 1 },
  routeInputIcon: { width: 24, height: 24, borderRadius: 12, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  routeInputIconFrom: { backgroundColor: "#E2F3F4" },
  routeInputIconTo: { backgroundColor: "#FDEBEC" },
  routeInputContent: { flex: 1, minWidth: 0 },
  routeInputLabel: { color: "#747474", fontSize: 9, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase" },
  routeInputLabelInvalid: { color: "#B4232D" },
  routeInputValue: { color: "#111111", fontSize: 13, fontWeight: "600", marginTop: 1 },
  routeInputMeta: { color: "#666666", fontSize: 10, marginTop: 1 },
  routeInputPlaceholder: { color: "#747474", fontSize: 12, fontWeight: "500", marginTop: 4 },
  routeInputIssue: { color: "#B4232D", fontSize: 10, fontWeight: "600", marginTop: 2 },

  routeConnector: { flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 18, paddingVertical: 4 },
  routeConnectorLine: { width: 1.5, height: 16, backgroundColor: "#ECECEC" },
  routeConnectorLineDashed: { backgroundColor: "#ECECEC", opacity: 0.5 },
  routeConnectorMeta: { color: "#747474", fontSize: 10, fontWeight: "600" },

  routeMiniSummary: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#E2F3F4", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, marginTop: 4 },
  routeMiniSummaryLabel: { color: "#007B8B", fontSize: 11, fontWeight: "600" },
  routeMiniSummaryValue: { color: "#007B8B", fontSize: 13, fontWeight: "700" },

  routeMessage: { color: "#167A55", fontSize: 11, marginTop: 4, lineHeight: 16 },
  routeWarning: { color: "#9A6200" },
  retryRoute: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  retryRouteText: { color: "#007B8B", fontSize: 11, fontWeight: "600" },
  routeTitle: { color: "#666666", fontSize: 11, marginTop: 6, lineHeight: 16 },

  shortcut: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FFFFFF", borderRadius: 9, padding: 12 },
  shortcutText: { flex: 1, color: "#747474", fontSize: 12 },

  typeGrid: { flexDirection: "row", gap: 8 },
  typeCard: { flex: 1, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#ECECEC", borderRadius: 10, paddingVertical: 12, paddingHorizontal: 8, alignItems: "center", gap: 4 },
  typeCardActive: { backgroundColor: "#111111", borderColor: "#111111" },
  typeIcon: { width: 32, height: 32, borderRadius: 8, backgroundColor: "#E2F3F4", alignItems: "center", justifyContent: "center" },
  typeIconActive: { backgroundColor: "#007B8B" },
  typeLabel: { color: "#111111", fontSize: 11, fontWeight: "600" },
  typeLabelActive: { color: "#FFFFFF" },
  typeSub: { color: "#747474", fontSize: 9, fontWeight: "500", textAlign: "center" },
  typeSubActive: { color: "rgba(255,255,255,0.6)" },

  vehicleGrid: { flexDirection: "row", gap: 8 },
  vehicleCard: { flex: 1, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#ECECEC", borderRadius: 10, paddingVertical: 10, alignItems: "center", gap: 4 },
  vehicleCardActive: { backgroundColor: "#E2F3F4", borderColor: "#007B8B" },
  vehicleLabel: { color: "#111111", fontSize: 10, fontWeight: "600" },
  vehicleLabelActive: { color: "#007B8B" },

  fieldWrap: { gap: 5 },
  fieldLabel: { color: "#111111", fontSize: 12, fontWeight: "600" },
  fieldLabelInvalid: { color: "#B4232D" },
  field: { flexDirection: "row", alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: 9, paddingHorizontal: 12, paddingVertical: 10, gap: 8, borderWidth: 1, borderColor: "#ECECEC" },
  fieldMultiline: { alignItems: "flex-start", paddingVertical: 12, minHeight: 80 },
  fieldInvalid: { borderColor: "#B4232D" },
  fieldIcon: { marginRight: 2 },
  input: { flex: 1, color: "#111111", fontSize: 13, fontWeight: "500" },
  inputMultiline: { minHeight: 60, textAlignVertical: "top" },
  fieldIssue: { color: "#B4232D", fontSize: 11, fontWeight: "500" },

  measureCard: { backgroundColor: "#FFFFFF", borderRadius: 10, padding: 12, gap: 10, marginTop: 4 },
  measureTitle: { color: "#111111", fontSize: 12, fontWeight: "600" },
  measureSubtitle: { color: "#666666", fontSize: 11, lineHeight: 16 },
  dimensionRow: { flexDirection: "row", gap: 6 },
  miniInput: { flex: 1, backgroundColor: "#EEEDF3", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 10, color: "#111111", fontSize: 12, fontWeight: "600", textAlign: "center" },

  priceCard: { backgroundColor: "#007B8B", borderRadius: 12, padding: 14, gap: 10 },
  priceCardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  priceCardLabel: { color: "rgba(255,255,255,0.7)", fontSize: 10, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase" },
  priceCardValue: { color: "#FFFFFF", fontSize: 20, fontWeight: "700" },
  priceCardInput: { flexDirection: "row", alignItems: "center", backgroundColor: "rgba(255,255,255,0.18)", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 12, gap: 8 },
  priceCardInputText: { flex: 1, color: "#FFFFFF", fontSize: 15, fontWeight: "600" },
  priceCardInputSuffix: { color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: "600" },
  priceCardHelper: { flexDirection: "row", alignItems: "center", gap: 4 },
  priceCardNote: { color: "rgba(255,255,255,0.7)", fontSize: 11, lineHeight: 16, flex: 1 },
  priceError: { color: "#FFFFFF", fontSize: 11, fontWeight: "600", backgroundColor: "rgba(180,35,45,0.4)", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },

  publicationLoadingHint: { color: "#007B8B", fontSize: 12, textAlign: "center", marginTop: 4, fontWeight: "600" },
  publicationHint: { color: "#9A6200", fontSize: 12, textAlign: "center", marginTop: 4, fontWeight: "500" },
  footerNote: { color: "#747474", fontSize: 10, lineHeight: 14, textAlign: "center", marginTop: 8 },

  footer: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 10, paddingBottom: 18, backgroundColor: "#FFFFFF", borderTopWidth: 1, borderTopColor: "#ECECEC" },
  footerSummary: { flex: 1 },
  footerSummaryLabel: { color: "#747474", fontSize: 10, fontWeight: "600" },
  footerSummaryValue: { color: "#111111", fontSize: 14, fontWeight: "700", marginTop: 1 },
  footerCta: { minWidth: 160, minHeight: 44 },

  pressed: { opacity: 0.7 },
});
