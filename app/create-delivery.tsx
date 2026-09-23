import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useThemeColors } from "@/lib/use-theme-colors";
import { SafeAreaView } from "react-native-safe-area-context";
import { YangoAddressPicker } from "@/components/tikis/yango-address-picker";
import { TikisButton } from "@/components/tikis/ui";
import { MapPreview } from "@/components/tikis/map-preview";
import { publicationBlocker, suggestVehicle } from "@/lib/delivery-form";
import { priceSuggestions } from "@/lib/price-suggestions";
import { offeredPriceError, parseOfferedPrice, priceDifferencePercent, sanitizeOfferedPriceInput } from "@/lib/delivery-price";
import { estimateDeliveryPrice, formatFavoritePlace, provisionalRoute, sanitizePlaceText, validateDeliveryMeasurement } from "@/lib/geo-rules";
import { favoriteToLocation, toPlacePayload } from "@/lib/place-favorites";
import { deliveryTextInputIssue, isAllowedDeliveryText, sanitizeDeliveryText } from "@/lib/tikis-engine";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";
import { haptic } from "@/lib/haptics";
import { locationSubtitle, locationTitle, type DeliveryType, type LocationLabel, type SavedFavorite, type SelectableVehicleType } from "@/shared/tikis-domain";
import { getDeliveryDraft, saveDeliveryDraft } from "@/lib/delivery-drafts";

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

/** Les consignes sont facultatives : seul le jeu de caractères est vérifié, jamais la présence.
 *  `deliveryTextInputIssue` exige un contenu par défaut — l'appeler sans ce second argument
 *  rendait « Ce champ est requis. » sur un champ vide, ce qui désactivait le bouton Publier
 *  sans que rien ne l'explique (le pied de page ne mentionne jamais les consignes). */
const detailsInputIssue = (value: string) => deliveryTextInputIssue(value, false);

export default function CreateDeliveryScreen() {
  const { deliveryId, draftId } = useLocalSearchParams<{ deliveryId?: string; draftId?: string }>();
  const { colors: theme } = useThemeColors();
  const { profile } = useTikisStore();
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [deliveryType, setDeliveryType] = useState<DeliveryType>("Plis");
  const [chosenVehicle, setChosenVehicle] = useState<SelectableVehicleType>("Moto");
  /** Un engin repris d'une livraison, d'un brouillon ou choisi à la main ne se fait plus corriger. */
  const [vehicleChosen, setVehicleChosen] = useState(false);
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
    setChosenVehicle(delivery.vehicleTypes[0] ?? "Moto");
    setVehicleChosen(true);
    setPickup(delivery.pickup);
    setDropoff(delivery.dropoff);
    setWeightKg(delivery.weightKg ? String(delivery.weightKg) : "");
    setLengthCm(delivery.dimensions?.lengthCm ? String(delivery.dimensions.lengthCm) : "");
    setWidthCm(delivery.dimensions?.widthCm ? String(delivery.dimensions.widthCm) : "");
    setHeightCm(delivery.dimensions?.heightCm ? String(delivery.dimensions.heightCm) : "");
    setPassengers(delivery.passengers ? String(delivery.passengers) : "");
    setOfferedPriceInput(delivery.offeredPrice ? String(delivery.offeredPrice) : "");
  }, [deliveryQuery.data]);

  useEffect(() => {
    if (!draftId || !profile?.phone) return;
    let active = true;
    (async () => {
      const draft = await getDeliveryDraft(profile.phone, draftId);
      if (!active || !draft) return;
      setTitle(draft.title);
      setDetails(draft.details);
      setDeliveryType(draft.deliveryType);
      setChosenVehicle(draft.vehicle);
    setVehicleChosen(true);
      setPickup(draft.pickup as LocationLabel | null);
      setDropoff(draft.dropoff as LocationLabel | null);
      setWeightKg(draft.weightKg ?? "");
      setLengthCm(draft.lengthCm ?? "");
      setWidthCm(draft.widthCm ?? "");
      setHeightCm(draft.heightCm ?? "");
      setPassengers(draft.passengers ?? "");
      setOfferedPriceInput(draft.offeredPriceInput ?? "");
      Alert.alert("Brouillon restauré", `« ${draft.title || "Sans titre"} » a été chargé. Vous pouvez le modifier puis le publier.`);
    })();
    return () => { active = false; };
  }, [draftId, profile?.phone]);

  // Dérivé plutôt que recopié dans un effet : un `setState` dans un effet
  // rendrait une première fois avec l'ancien engin, donc avec l'ancienne
  // estimation, avant de se corriger.
  const vehicle = vehicleChosen ? chosenVehicle : suggestVehicle({ deliveryType, weightKg, passengers });

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

  const pricingConfigQuery = trpc.geography.pricingConfig.useQuery(undefined, { staleTime: 5 * 60_000 });
  const estimate = useMemo(() => route ? estimateDeliveryPrice({ distanceKm: route.distanceKm, durationMinutes: route.durationMinutes, type: deliveryType, vehicle, ...measurement }, pricingConfigQuery.data) : 0, [route, deliveryType, vehicle, measurement, pricingConfigQuery.data]);
  const parsedOfferedPrice = useMemo(() => parseOfferedPrice(offeredPriceInput), [offeredPriceInput]);
  const priceInputError = useMemo(() => offeredPriceError(offeredPriceInput), [offeredPriceInput]);
  const titleIssue = inputIssues.title || (touched.title ? deliveryTextInputIssue(title) : "");
  const detailsIssue = inputIssues.details || (touched.details ? detailsInputIssue(details) : "");
  const passengerIssue = inputIssues.passengers || (deliveryType === "Personne" && touched.passengers && (!Number(passengers) || Number(passengers) > 4) ? "Indiquez entre 1 et 4 personnes." : "");
  const pickupIssue = touched.pickup && !pickup ? "Choisissez le lieu de récupération." : "";
  const dropoffIssue = touched.dropoff && !dropoff ? "Choisissez la destination." : "";
  const measurementIssue = useMemo(() => validateDeliveryMeasurement(deliveryType, measurement), [deliveryType, measurement]);
  const titleReady = !deliveryTextInputIssue(title) && !inputIssues.title;
  const detailsReady = !detailsInputIssue(details) && !inputIssues.details;
  const passengerReady = deliveryType !== "Personne" || (Number(passengers) >= 1 && Number(passengers) <= 4 && !inputIssues.passengers);
  const canPublish = Boolean(titleReady && detailsReady && pickup && dropoff && route && estimate && passengerReady && !measurementIssue && !priceInputError && parsedOfferedPrice);
  const priceDifference = parsedOfferedPrice && estimate ? priceDifferencePercent(parsedOfferedPrice, estimate) : 0;
  // `priceDifference` est arrondi : sous le pour cent d'écart il vaut 0, et on retombe sur la note
  // neutre plutôt que d'annoncer « 0 % sous l'estimation ».
  const isBelowEstimate = Boolean(parsedOfferedPrice) && priceDifference < 0;
  const favoriteLocations: SavedFavorite[] = useMemo(() => (favoritesQuery.data ?? []).map((item) => ({ id: item.id, label: item.label, location: favoriteToLocation(item) })), [favoritesQuery.data]);
  const isAddressInFavorites = useCallback((place: LocationLabel | null) => {
    if (!place || favoriteLocations.length === 0) return false;
    return favoriteLocations.some((fav) => {
      const lat = fav.location.latitude;
      const lng = fav.location.longitude;
      return Math.abs(lat - place.latitude) < 0.00005 && Math.abs(lng - place.longitude) < 0.00005;
    });
  }, [favoriteLocations]);

  // La barre de progression annonçait un pourcentage calculé sur cinq champs
  // alors qu'elle en comptait six, et comptait les consignes, facultatives :
  // elle affichait 100 % sur une course impubliable et 80 % sur une course
  // prête. À la place, le pied de page nomme ce qui manque, un point à la fois.
  const blocker = useMemo(() => publicationBlocker({
    pickup: Boolean(pickup),
    dropoff: Boolean(dropoff),
    route: Boolean(route),
    title: title.trim(),
    titleReady,
    deliveryType,
    passengers,
    measurementIssue,
    offeredPrice: offeredPriceInput,
    priceError: priceInputError,
  }), [pickup, dropoff, route, title, titleReady, deliveryType, passengers, measurementIssue, offeredPriceInput, priceInputError]);
  const suggestions = useMemo(() => priceSuggestions(estimate), [estimate]);

  async function addFavorite(place: LocationLabel, label: string) {
    if (!profile?.phone) return;
    try {
      const persisted = await savePlaceMutation.mutateAsync(toPlacePayload(place));
      await favoriteMutation.mutateAsync({ placeId: persisted.id, label: sanitizePlaceText(label, 80) || formatFavoritePlace(place) || "Lieu favori" });
      await favoritesQuery.refetch();
    } catch { throw new Error("Impossible d’enregistrer cette adresse. Vérifiez votre connexion puis réessayez."); }
  }

  async function saveDraft() {
    if (!profile?.phone) {
      Alert.alert("Brouillon indisponible", "Vous devez être connecté pour enregistrer un brouillon.");
      return;
    }
    if (!title.trim() && !pickup && !dropoff) {
      Alert.alert("Brouillon vide", "Renseignez au moins le titre ou une adresse pour enregistrer un brouillon.");
      return;
    }
    setLoading(true);
    try {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const now = new Date().toISOString();
      await saveDeliveryDraft(profile.phone, {
        id,
        createdAt: now,
        updatedAt: now,
        title,
        details,
        deliveryType,
        vehicle,
        pickup,
        dropoff,
        weightKg,
        lengthCm,
        widthCm,
        heightCm,
        passengers,
        offeredPriceInput,
      });
      haptic.success();
      Alert.alert("Brouillon enregistré", "Vous pouvez le retrouver depuis l'onglet Brouillons.", [{ text: "OK" }]);
    } catch {
      Alert.alert("Brouillon indisponible", "Impossible d'enregistrer le brouillon. Réessayez dans un instant.");
    } finally {
      setLoading(false);
    }
  }

  /** Inverse les deux lieux. L'itinéraire se recalcule tout seul : il suit `pickup`/`dropoff`. */
  function swapPlaces() {
    setPickup(dropoff);
    setDropoff(pickup);
    setTouched((current) => ({ ...current, pickup: true, dropoff: true }));
  }

  async function executePublication() {
    if (loading) return;
    if (!canPublish) {
      setTouched({ title: true, details: true, passengers: deliveryType === "Personne", pickup: true, dropoff: true, price: Boolean(offeredPriceInput) });
      setInputIssues((current) => ({ ...current, title: deliveryTextInputIssue(title), details: detailsInputIssue(details), passengers: deliveryType === "Personne" && (!Number(passengers) || Number(passengers) > 4) ? "Indiquez entre 1 et 4 personnes." : "", price: priceInputError || "" }));
      if (!pickup || !dropoff) setRouteMessage("Sélectionnez les deux lieux requis pour calculer l’itinéraire.");
      return;
    }
    const cleanTitle = sanitizeDeliveryText(title);
    const cleanDetails = sanitizeDeliveryText(details);
    if (!pickup || !dropoff || !route || !isAllowedDeliveryText(cleanTitle) || !isAllowedDeliveryText(cleanDetails)) return;
    const pickupKey = `${pickup.latitude.toFixed(5)}|${pickup.longitude.toFixed(5)}`;
    const dropoffKey = `${dropoff.latitude.toFixed(5)}|${dropoff.longitude.toFixed(5)}`;
    if (pickupKey === dropoffKey) {
      Alert.alert("Adresses identiques", "L'adresse de collecte ne peut pas être identique à l'adresse de destination. Choisissez une autre destination.");
      return;
    }
    setPublicationStage("Enregistrement des lieux…"); setLoading(true);
    try {
      setPublicationStage(isEditing ? "Mise à jour de la livraison…" : "Publication auprès des livreurs…");
      const payload = { title: cleanTitle, type: deliveryType, pickup: toPlacePayload(pickup), dropoff: toPlacePayload(dropoff), distanceKm: route.distanceKm, routeSource: route.source, estimatedPrice: estimate, ...(parsedOfferedPrice ? { offeredPrice: parsedOfferedPrice } : {}), vehicleTypes: [vehicle], details: cleanDetails, ...(deliveryType === "Autre" && weightKg ? { weightKg: Number(weightKg) } : {}), ...(deliveryType === "Autre" && Object.keys(dimensions).length ? { dimensions } : {}), ...(deliveryType === "Personne" ? { passengers: Number(passengers) } : {}) };
      const delivery = isEditing && deliveryId ? await updateDeliveryMutation.mutateAsync({ ...payload, deliveryId }) : await createDeliveryMutation.mutateAsync(payload);
      if (!delivery) throw new Error("La livraison n’a pas pu être enregistrée.");
      router.replace(`/delivery/${delivery.id}` as any);
    } catch (error) {
      console.error("[create-delivery] publication failed", error);
      let message = error instanceof Error ? error.message : "Une erreur inattendue est survenue.";
      const data = (error as { data?: unknown })?.data;
      if (typeof data === "string" && data.length > 0 && data.length < 500) {
        message = `${message} (${data.slice(0, 200)})`;
      } else if (data && typeof data === "object") {
        try {
          const snippet = JSON.stringify(data).slice(0, 200);
          message = `${message} (${snippet})`;
        } catch {}
      }
      const errorString = `${error?.toString?.() ?? ""} ${message}`.toLowerCase();
      if (errorString.includes("json parse") || errorString.includes("unexpected character") || errorString.includes("failed to fetch") || errorString.includes("network request failed")) {
        message = "Le serveur Tikis ne répond pas. Vérifiez que le serveur dev est bien démarré (npm run dev:server) puis réessayez.";
      }
      const reason = isEditing ? "Modification indisponible" : "Publication indisponible";
      setPublicationStage(`${reason} : ${message}`);
      Alert.alert(reason, `${message}\n\nVérifiez votre connexion puis réessayez.`);
    }
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

  const ctaLabel = isEditing ? "Enregistrer" : "Publier la course";

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={["top", "bottom"]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]} accessibilityLabel="Retour">
          <MaterialIcons name="arrow-back" size={20} color="#111111" />
        </Pressable>
        <Text style={styles.topTitle} numberOfLines={1}>{isEditing ? "Modifier la livraison" : "Nouvelle livraison"}</Text>
        <Pressable onPress={() => router.push("/delivery-drafts" as any)} hitSlop={6} accessibilityRole="button" style={({ pressed }) => [styles.draftsLink, pressed && styles.pressed]}>
          <MaterialIcons name="folder-open" size={14} color="#667085" />
          <Text style={styles.draftsLinkText}>Brouillons</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} keyboardDismissMode="interactive">

          {pickup && dropoff ? (
            <View style={styles.mapStrip}>
              <MapPreview pickup={pickup} dropoff={dropoff} height={136} showLegend={false} />
            </View>
          ) : null}

          <View style={styles.routeCard}>
            <RouteInput tone="pickup" label="RÉCUPÉRATION" value={pickup} invalid={Boolean(pickupIssue)} onPress={() => setPickerTarget("pickup")} onAddFavorite={pickup && !isAddressInFavorites(pickup) ? (label) => void addFavorite(pickup, label) : undefined} />
            <View style={styles.routeConnector}>
              <View style={styles.routeConnectorLine} />
              <Text style={styles.routeConnectorMeta}>
                {route ? `${route.distanceKm.toFixed(1)} km · ~${Math.max(1, Math.round(route.durationMinutes))} min` : "Distance à calculer"}
              </Text>
              {pickup || dropoff ? (
                <Pressable onPress={swapPlaces} hitSlop={8} accessibilityRole="button" accessibilityLabel="Inverser la récupération et la destination" style={({ pressed }) => [styles.swapBtn, pressed && styles.pressed]}>
                  <MaterialIcons name="swap-vert" size={18} color="#111111" />
                </Pressable>
              ) : null}
            </View>
            <RouteInput tone="dropoff" label="DESTINATION" value={dropoff} invalid={Boolean(dropoffIssue)} onPress={() => setPickerTarget("dropoff")} onAddFavorite={dropoff && !isAddressInFavorites(dropoff) ? (label) => void addFavorite(dropoff, label) : undefined} />
          </View>
          {routeMessage ? <Text style={[styles.routeMessage, !route?.precise && styles.routeWarning]}>{routeMessage}</Text> : null}
          {pickup && dropoff && (!route || !route.precise) ? (
            <Pressable accessibilityRole="button" onPress={retryRoute} style={({ pressed }) => [styles.retryRoute, pressed && styles.pressed]}>
              <MaterialIcons name="refresh" size={14} color="#667085" />
              <Text style={styles.retryRouteText}>{route ? "Recalculer avec Routes API" : "Réessayer le calcul d’itinéraire"}</Text>
            </Pressable>
          ) : null}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Ce que vous envoyez</Text>
            <View style={styles.pillRow}>
              {DELIVERY_TYPES.map((item) => {
                const active = deliveryType === item.value;
                return (
                  <Pressable
                    key={item.value}
                    onPress={() => setDeliveryType(item.value)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`${item.label} — ${item.sub}`}
                    style={({ pressed }) => [styles.pill, active && styles.pillActive, pressed && styles.pressed]}
                  >
                    <MaterialIcons name={item.icon} size={15} color={active ? "#FF9800" : "#667085"} />
                    <Text style={[styles.pillLabel, active && styles.pillLabelActive]} numberOfLines={1}>{item.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Field label="Titre de la course" value={title} error={titleIssue} onBlur={() => { setTouched((current) => ({ ...current, title: true })); setInputIssues((current) => ({ ...current, title: deliveryTextInputIssue(title) })); }} onChangeText={(value) => { const issue = !isAllowedDeliveryText(value) ? "Caractères non autorisés." : ""; setTitle(sanitizeDeliveryText(value, { preserveTrailingSpace: true })); setInputIssues((current) => ({ ...current, title: issue || (touched.title ? deliveryTextInputIssue(value) : "") })); }} placeholder={deliveryType === "Plis" ? "Ex. Documents de bureau" : deliveryType === "Personne" ? "Ex. Trajet vers l’aéroport" : "Ex. Petit matériel"} />
            <Field label="Consignes — facultatif" value={details} error={detailsIssue} onBlur={() => { setTouched((current) => ({ ...current, details: true })); setInputIssues((current) => ({ ...current, details: detailsInputIssue(details) })); }} onChangeText={(value) => { const issue = !isAllowedDeliveryText(value) ? "Caractères non autorisés." : ""; setDetails(sanitizeDeliveryText(value, { preserveTrailingSpace: true })); setInputIssues((current) => ({ ...current, details: issue || (touched.details ? detailsInputIssue(value) : "") })); }} placeholder="Ex. Demander Awa à l’accueil, 2e étage" multiline />
            {deliveryType === "Personne" ? (
              <Field label="Nombre de personnes" value={passengers} error={passengerIssue} onBlur={() => { setTouched((current) => ({ ...current, passengers: true })); }} onChangeText={(value) => { setPassengers(value.replace(/\D/g, "").slice(0, 1)); setInputIssues((current) => ({ ...current, passengers: /\D/.test(value) ? "Caractères non autorisés." : "" })); }} placeholder="1" keyboardType="number-pad" icon="groups" />
            ) : null}
            {deliveryType === "Autre" ? (
              <View style={styles.measureCard}>
                <Text style={styles.measureTitle}>Poids et dimensions — facultatif</Text>
                <Text style={styles.measureSubtitle}>Ils affinent l’estimation et choisissent l’engin à votre place.</Text>
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
            <View style={styles.sectionHeadRow}>
              <Text style={styles.sectionTitle}>L’engin</Text>
              {!vehicleChosen ? <Text style={styles.sectionHint}>suggéré d’après le colis</Text> : null}
            </View>
            <View style={styles.pillRow}>
              {VEHICLES.map((item) => {
                const active = vehicle === item;
                return (
                  <Pressable
                    key={item}
                    onPress={() => { setChosenVehicle(item); setVehicleChosen(true); }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={item}
                    style={({ pressed }) => [styles.vehiclePill, active && styles.pillActive, pressed && styles.pressed]}
                  >
                    <MaterialIcons name={VEHICLE_ICON[item]} size={17} color={active ? "#FF9800" : "#667085"} />
                    <Text style={[styles.vehicleLabel, active && styles.pillLabelActive]} numberOfLines={1}>{item}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* En dernier, et pas avant le colis : l'estimation dépend du type, du nombre de
              personnes, du poids/volume et de l'engin autant que de la distance
              (`estimateDeliveryPrice`, lib/geo-rules.ts). Placée plus haut, elle demandait un prix
              sur des données encore incomplètes, puis bougeait dans le dos de l'expéditeur — un
              colis lourd renseigné après coup pouvait tripler l'estimation sans toucher au montant
              déjà saisi. */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Votre offre</Text>
            {!route ? (
              // Sans itinéraire il n'y a pas d'estimation, et la carte complète
              // n'affichait qu'un tiret au-dessus d'un champ vide : un écran de
              // haut pour ne rien dire, entre les adresses et le colis.
              <View style={styles.offerWaiting}>
                <MaterialIcons name="schedule" size={16} color="#667085" />
                <Text style={styles.offerWaitingText}>L’estimation s’affiche dès que les deux adresses sont choisies.</Text>
              </View>
            ) : (
            <View style={styles.offerCard}>
              <View style={styles.offerHead}>
                <Text style={styles.offerHeadLabel}>Tikis estime cette course à</Text>
                <Text style={styles.offerHeadValue}>{estimate ? `${estimate.toLocaleString("fr-FR")} F` : "—"}</Text>
              </View>
              <View style={styles.offerBody}>
                <Text style={styles.offerLabel}>CE QUE VOUS PROPOSEZ</Text>
                <View style={[styles.offerInputRow, priceInputError && styles.offerInputRowInvalid]}>
                  <TextInput
                    value={offeredPriceInput}
                    onBlur={() => setTouched((current) => ({ ...current, price: true }))}
                    onChangeText={(value) => setOfferedPriceInput(sanitizeOfferedPriceInput(value))}
                    keyboardType="number-pad"
                    maxLength={8}
                    placeholder="0"
                    placeholderTextColor="#C4CBD6"
                    accessibilityLabel="Prix que vous proposez, en francs CFA"
                    style={styles.offerInput}
                  />
                  <Text style={styles.offerSuffix}>F CFA</Text>
                </View>
                {suggestions.length > 0 ? (
                  <View style={styles.suggestionRow}>
                    {suggestions.map((suggestion) => {
                      const active = parsedOfferedPrice === suggestion.amount;
                      return (
                        <Pressable
                          key={suggestion.amount}
                          onPress={() => { setOfferedPriceInput(String(suggestion.amount)); setTouched((current) => ({ ...current, price: true })); }}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
                          accessibilityLabel={suggestion.markupPercent === 0 ? `Proposer l’estimation, ${suggestion.amount} francs` : `Proposer ${suggestion.amount} francs, soit ${suggestion.markupPercent} % de plus que l’estimation`}
                          style={({ pressed }) => [styles.suggestion, active && styles.suggestionActive, pressed && styles.pressed]}
                        >
                          <Text style={[styles.suggestionAmount, active && styles.suggestionAmountActive]}>{suggestion.amount.toLocaleString("fr-FR")}</Text>
                          <Text style={[styles.suggestionNote, active && styles.suggestionNoteActive]}>{suggestion.markupPercent === 0 ? "estimation" : `+${suggestion.markupPercent} %`}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
                {priceInputError ? (
                  <Text style={styles.offerError}>{priceInputError}</Text>
                ) : isBelowEstimate ? (
                  // Reste atteignable même le prix en dernier : l'expéditeur peut remonter changer
                  // le colis après avoir saisi son montant. Le dire vaut mieux que laisser partir
                  // une course sous-payée qui restera en bas de la liste des livreurs.
                  <Text style={styles.offerWarning}>
                    {`${Math.abs(priceDifference)} % sous l’estimation : votre course passera après les autres. Touchez ${estimate.toLocaleString("fr-FR")} F pour vous aligner.`}
                  </Text>
                ) : (
                  <Text style={styles.offerNote}>
                    {priceDifference > 0
                      ? `Au-dessus de l’estimation, votre course passe devant les autres dans la liste des livreurs proches.`
                      : `Les livreurs voient les courses les mieux payées en premier.`}
                  </Text>
                )}
              </View>
            </View>
            )}
          </View>

          {loading ? <Text style={styles.publicationHint}>{publicationStage || "Publication en cours…"}</Text> : null}
          {!loading && blocker ? <Text style={styles.publicationHint}>{blocker}</Text> : null}
        </ScrollView>

        <View style={styles.footer}>
          <TikisButton
            // Le libellé reprenait `publishedPrice`, qui retombe sur l'estimation :
            // le bouton annonçait un prix que l'expéditeur n'avait pas fixé.
            label={`${ctaLabel}${parsedOfferedPrice ? ` · ${parsedOfferedPrice.toLocaleString("fr-FR")} F` : ""}`}
            icon={isEditing ? "save" : "publish"}
            onPress={publish}
            disabled={!canPublish || loading || (isEditing && deliveryQuery.isLoading)}
            loading={loading || (isEditing && deliveryQuery.isLoading)}
            loadingLabel={publicationStage || (isEditing && deliveryQuery.isLoading ? "Chargement de la livraison…" : "Publication en cours…")}
          />
          <Pressable
            onPress={() => { if (!loading) void saveDraft(); }}
            disabled={loading}
            hitSlop={6}
            accessibilityRole="button"
            style={({ pressed }) => [styles.draftSave, pressed && styles.pressed]}
          >
            <Text style={styles.draftSaveText}>Enregistrer comme brouillon</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
      <YangoAddressPicker visible={Boolean(pickerTarget)} target={pickerTarget} value={pickerTarget === "pickup" ? pickup : dropoff} countryCode={profile?.countryCode} profilePhone={profile?.phone} favorites={favoriteLocations} onClose={() => { if (pickerTarget && !(pickerTarget === "pickup" ? pickup : dropoff)) setTouched((current) => ({ ...current, [pickerTarget]: true })); setPickerTarget(null); }} onSelect={(place) => { if (pickerTarget) selectPlace(pickerTarget, place); }} onFavorite={addFavorite} />
    </SafeAreaView>
  );
}

function RouteInput({ tone, label, value, invalid, onPress, onAddFavorite }: { tone: "pickup" | "dropoff"; label: string; value: LocationLabel | null; invalid: boolean; onPress: () => void; onAddFavorite?: (label: string) => void }) {
  const { colors: theme } = useThemeColors();
  const isPickup = tone === "pickup";
  const [showFavoriteInput, setShowFavoriteInput] = useState(false);
  const [favoriteLabel, setFavoriteLabel] = useState("");
  return (
    <View>
      {/* Pas de `accessibilityRole="button"` ici : le bouton favori vit à
          l'intérieur, et le web en ferait un <button> dans un <button>. */}
      <Pressable onPress={onPress} accessibilityLabel={value ? `${label} : ${locationTitle(value)}. Changer` : `Choisir le lieu de ${isPickup ? "récupération" : "destination"}`} style={({ pressed }) => [styles.routeInput, pressed && styles.pressed]}>
        <View style={[styles.routeInputIcon, isPickup ? styles.routeInputIconFrom : styles.routeInputIconTo]}>
          <MaterialIcons name={isPickup ? "inventory-2" : "sports-score"} size={14} color={isPickup ? "#FF9800" : "#A43740"} />
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
        </View>
        {onAddFavorite && value ? (
          <Pressable
            onPress={(event) => { event.stopPropagation(); setShowFavoriteInput((current) => !current); }}
            hitSlop={6}
            style={({ pressed }) => [styles.routeFavoriteBtn, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Ajouter aux favoris"
          >
            <MaterialIcons name={showFavoriteInput ? "close" : "star-outline"} size={17} color="#667085" />
          </Pressable>
        ) : null}
        <MaterialIcons name="chevron-right" size={18} color="#667085" />
      </Pressable>
      {showFavoriteInput && value ? (
        <View style={styles.favoriteInputRow}>
          <TextInput value={favoriteLabel} onChangeText={setFavoriteLabel} placeholder="Nom du favori (ex. Maison, Bureau)" placeholderTextColor={theme.placeholder} style={styles.favoriteInput} maxLength={40} />
          <Pressable
            onPress={() => { if (onAddFavorite) { onAddFavorite(favoriteLabel.trim() || locationTitle(value) || "Adresse favorite"); setShowFavoriteInput(false); setFavoriteLabel(""); } }}
            style={({ pressed }) => [styles.favoriteSaveBtn, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Enregistrer le favori"
          >
            <Text style={styles.favoriteSaveBtnText}>OK</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function Field({ label, icon, keyboardType, error, ...props }: { label: string; icon?: React.ComponentProps<typeof MaterialIcons>["name"]; keyboardType?: "default" | "number-pad" | "decimal-pad"; value: string; onChangeText: (value: string) => void; onBlur?: () => void; placeholder: string; multiline?: boolean; error?: string }) {
  const { colors: theme } = useThemeColors();
  return <View style={styles.fieldWrap}><Text style={[styles.fieldLabel, error && styles.fieldLabelInvalid]}>{label}</Text><View style={[styles.field, props.multiline && styles.fieldMultiline, error && styles.fieldInvalid]}>{icon ? <MaterialIcons name={icon} size={18} color={error ? "#A43740" : "#667085"} style={styles.fieldIcon} /> : null}<TextInput {...props} keyboardType={keyboardType} maxLength={props.multiline ? 450 : 120} style={[styles.input, props.multiline && styles.inputMultiline]} placeholderTextColor={theme.placeholder} /></View>{error ? <Text style={styles.fieldIssue}>{error}</Text> : null}</View>;
}

function MiniNumber({ value, onChangeText, placeholder }: { value: string; onChangeText: (value: string) => void; placeholder: string }) {
  const { colors: theme } = useThemeColors();
  return <TextInput value={value} onChangeText={(text) => onChangeText(text.replace(/\D/g, "").slice(0, 4))} keyboardType="number-pad" placeholder={placeholder} placeholderTextColor={theme.placeholder} style={styles.miniInput} />;
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  keyboard: { flex: 1 },
  content: { padding: 16, paddingBottom: 24, gap: 18 },

  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 9, gap: 10, backgroundColor: "#FFFFFF", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#E8ECF2" },
  iconBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: "#F0F3F8", alignItems: "center", justifyContent: "center" },
  topTitle: { flex: 1, color: "#111111", fontSize: 15, fontWeight: "700" },
  draftsLink: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 4, paddingVertical: 8 },
  draftsLinkText: { color: "#111111", fontSize: 12, fontWeight: "700" },

  mapStrip: { borderRadius: 14, overflow: "hidden", backgroundColor: "#E9EEF4" },

  section: { gap: 10 },
  sectionHeadRow: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  sectionTitle: { color: "#111111", fontSize: 16, fontWeight: "700" },
  sectionHint: { color: "#667085", fontSize: 11.5 },

  routeCard: { backgroundColor: "#FFFFFF", borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: "#E8ECF2", paddingVertical: 4 },
  routeInput: { flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 12, paddingVertical: 11 },
  routeInputIcon: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  routeInputIconFrom: { backgroundColor: "#FFF3E0" },
  routeInputIconTo: { backgroundColor: "#F7EAEB" },
  routeInputContent: { flex: 1, minWidth: 0 },
  routeInputLabel: { color: "#667085", fontSize: 9.5, fontWeight: "700", letterSpacing: 0.7 },
  routeInputLabelInvalid: { color: "#A43740" },
  routeInputValue: { color: "#111111", fontSize: 14, fontWeight: "600", marginTop: 2 },
  routeInputMeta: { color: "#667085", fontSize: 11.5, marginTop: 1 },
  routeInputPlaceholder: { color: "#667085", fontSize: 13.5, fontWeight: "600", marginTop: 3 },
  routeFavoriteBtn: { width: 32, height: 32, borderRadius: 9, backgroundColor: "#FFFFFF", borderWidth: StyleSheet.hairlineWidth, borderColor: "#E8ECF2", alignItems: "center", justifyContent: "center" },
  favoriteInputRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 51, paddingRight: 12, paddingBottom: 8 },
  favoriteInput: { flex: 1, backgroundColor: "#FFFFFF", borderRadius: 9, borderWidth: StyleSheet.hairlineWidth, borderColor: "#E8ECF2", paddingHorizontal: 10, paddingVertical: 9, color: "#111111", fontSize: 12.5 },
  favoriteSaveBtn: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 9, borderWidth: 1, borderColor: "#FF9800", backgroundColor: "#FFFFFF" },
  favoriteSaveBtnText: { color: "#111111", fontSize: 12.5, fontWeight: "700" },

  routeConnector: { flexDirection: "row", alignItems: "center", gap: 9, paddingLeft: 25, paddingRight: 12 },
  routeConnectorLine: { width: 1, height: 16, backgroundColor: "#E8ECF2" },
  routeConnectorMeta: { flex: 1, color: "#667085", fontSize: 11, fontWeight: "600" },
  swapBtn: { width: 32, height: 32, borderRadius: 9, borderWidth: StyleSheet.hairlineWidth, borderColor: "#E8ECF2", backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },

  routeMessage: { color: "#176C52", fontSize: 11.5, lineHeight: 16, marginTop: -10 },
  routeWarning: { color: "#A65300" },
  retryRoute: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: -10 },
  retryRouteText: { color: "#111111", fontSize: 11.5, fontWeight: "600" },

  offerWaiting: { flexDirection: "row", alignItems: "center", gap: 9, backgroundColor: "#FFFFFF", borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: "#E8ECF2", paddingHorizontal: 13, paddingVertical: 13 },
  offerWaitingText: { flex: 1, color: "#667085", fontSize: 12.5, lineHeight: 17 },
  offerCard: { backgroundColor: "#FFFFFF", borderRadius: 15, borderWidth: StyleSheet.hairlineWidth, borderColor: "#E8ECF2", overflow: "hidden" },
  offerHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", backgroundColor: "#FFF3E0", paddingHorizontal: 14, paddingVertical: 10, gap: 10 },
  offerHeadLabel: { color: "#6B4600", fontSize: 11.5, fontWeight: "600", flex: 1 },
  offerHeadValue: { color: "#6B4600", fontSize: 14, fontWeight: "800" },
  offerBody: { padding: 14 },
  offerLabel: { color: "#667085", fontSize: 11, fontWeight: "700", letterSpacing: 0.7 },
  offerInputRow: { flexDirection: "row", alignItems: "baseline", gap: 8, marginTop: 8, paddingBottom: 8, borderBottomWidth: 2, borderBottomColor: "#111111" },
  offerInputRowInvalid: { borderBottomColor: "#A43740" },
  offerInput: { flex: 1, color: "#111111", fontSize: 28, fontWeight: "800", padding: 0 },
  offerSuffix: { color: "#667085", fontSize: 14, fontWeight: "700" },
  suggestionRow: { flexDirection: "row", gap: 7, marginTop: 12 },
  suggestion: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 44, borderRadius: 9, borderWidth: 1, borderColor: "#E8ECF2", backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", gap: 1, paddingHorizontal: 4 },
  suggestionActive: { borderColor: "#FF9800", borderWidth: 1.5 },
  suggestionAmount: { color: "#111111", fontSize: 13, fontWeight: "700" },
  suggestionAmountActive: { color: "#111111", fontWeight: "800" },
  suggestionNote: { color: "#667085", fontSize: 9.5 },
  suggestionNoteActive: { color: "#111111", fontWeight: "600" },
  offerNote: { color: "#667085", fontSize: 11.5, lineHeight: 17, marginTop: 11 },
  offerError: { color: "#A43740", fontSize: 11.5, fontWeight: "600", lineHeight: 17, marginTop: 11 },
  // Ambre et non rouge : proposer moins que l'estimation reste un choix valide, pas une erreur.
  offerWarning: { color: "#A65300", fontSize: 11.5, fontWeight: "600", lineHeight: 17, marginTop: 11 },

  pillRow: { flexDirection: "row", gap: 7 },
  pill: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 6, borderRadius: 10, borderWidth: 1, borderColor: "#E8ECF2", backgroundColor: "#FFFFFF" },
  pillActive: { borderColor: "#FF9800", borderWidth: 1.5, backgroundColor: "#FFF3E0" },
  pillLabel: { color: "#344054", fontSize: 12.5, fontWeight: "600" },
  pillLabelActive: { color: "#111111", fontWeight: "800" },
  vehiclePill: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 46, alignItems: "center", justifyContent: "center", gap: 2, paddingHorizontal: 4, borderRadius: 10, borderWidth: 1, borderColor: "#E8ECF2", backgroundColor: "#FFFFFF" },
  vehicleLabel: { color: "#344054", fontSize: 10.5, fontWeight: "600" },

  fieldWrap: { gap: 5 },
  fieldLabel: { color: "#344054", fontSize: 12, fontWeight: "600" },
  fieldLabelInvalid: { color: "#A43740" },
  field: { flexDirection: "row", alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: 11, paddingHorizontal: 13, paddingVertical: 11, gap: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: "#E8ECF2" },
  fieldMultiline: { alignItems: "flex-start", paddingVertical: 12, minHeight: 74 },
  fieldInvalid: { borderColor: "#A43740", borderWidth: 1 },
  fieldIcon: { marginRight: 2 },
  input: { flex: 1, color: "#111111", fontSize: 14, fontWeight: "500" },
  inputMultiline: { minHeight: 52, textAlignVertical: "top" },
  fieldIssue: { color: "#A43740", fontSize: 11, fontWeight: "500" },

  measureCard: { backgroundColor: "#FFFFFF", borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: "#E8ECF2", padding: 13, gap: 10 },
  measureTitle: { color: "#111111", fontSize: 12.5, fontWeight: "700" },
  measureSubtitle: { color: "#667085", fontSize: 11.5, lineHeight: 16 },
  dimensionRow: { flexDirection: "row", gap: 6 },
  miniInput: { flex: 1, backgroundColor: "#FFFFFF", borderRadius: 9, borderWidth: StyleSheet.hairlineWidth, borderColor: "#E8ECF2", paddingHorizontal: 10, paddingVertical: 11, color: "#111111", fontSize: 13, fontWeight: "600", textAlign: "center" },

  publicationHint: { color: "#667085", fontSize: 12, textAlign: "center", fontWeight: "500", marginTop: -4 },

  footer: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 18, backgroundColor: "#FFFFFF", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#E8ECF2" },
  draftSave: { alignSelf: "center", paddingHorizontal: 8, paddingVertical: 8, marginTop: 4 },
  draftSaveText: { color: "#667085", fontSize: 12.5, fontWeight: "600" },

  pressed: { opacity: 0.7 },
});
