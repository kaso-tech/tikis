import MapView, { Marker, PROVIDER_GOOGLE, type MapPressEvent } from "react-native-maps";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { SurfaceCard } from "@/components/tikis/ui";
import { sanitizePlaceText } from "@/lib/geo-rules";
import { autocompleteQuery, haveSameSuggestionIds, PLACE_AUTOCOMPLETE_DEBOUNCE_MS } from "@/lib/place-autocomplete";
import { trpc } from "@/lib/trpc";
import { useSearchLocationBias } from "@/hooks/use-search-location-bias";
import { locationSubtitle, locationTitle, type LocationLabel, type PlaceSuggestion } from "@/shared/tikis-domain";

type Props = { label: string; tone: "pickup" | "dropoff"; value: LocationLabel | null; countryCode?: string; onChange: (place: LocationLabel) => void };
const INITIAL_REGION = { latitude: 12.3714, longitude: -1.5197, latitudeDelta: 0.12, longitudeDelta: 0.12 };

export function PlacePicker({ label, tone, value, countryCode, onChange }: Props) {
  const mapRef = useRef<MapView>(null);
  const [query, setQuery] = useState(value?.name ?? "");
  const [results, setResults] = useState<PlaceSuggestion[]>([]);
  const [message, setMessage] = useState("");
  const search = trpc.geography.search.useMutation();
  const reverse = trpc.geography.reverse.useMutation();
  const resolve = trpc.geography.resolve.useMutation();
  const latestSearch = useRef(0);
  const searchMutationRef = useRef(search.mutateAsync);
  const valueRef = useRef(value);
  searchMutationRef.current = search.mutateAsync;
  valueRef.current = value;
  const { bias: deviceBias, status: gpsStatus, requestBias } = useSearchLocationBias();
  const accent = tone === "pickup" ? "#007B8B" : "#B4232D";
  const valueName = value?.name ?? null;
  const valueLatitude = value?.latitude ?? null;
  const valueLongitude = value?.longitude ?? null;
  const biasLatitude = deviceBias?.latitude ?? null;
  const biasLongitude = deviceBias?.longitude ?? null;

  useEffect(() => {
    if (!valueName || valueLatitude === null || valueLongitude === null) return;
    setQuery((current) => current === valueName ? current : valueName);
    mapRef.current?.animateToRegion({ latitude: valueLatitude, longitude: valueLongitude, latitudeDelta: 0.025, longitudeDelta: 0.025 }, 350);
  }, [valueLatitude, valueLongitude, valueName]);

  const runSearch = useCallback(async (rawQuery: string, includeCommunityFallback = false) => {
    const clean = autocompleteQuery(rawQuery);
    if (!clean) { setResults([]); return; }
    const requestId = ++latestSearch.current;
    try {
      setMessage("");
      const selectedPlace = valueRef.current;
      const preferredBias = biasLatitude !== null && biasLongitude !== null ? { latitude: biasLatitude, longitude: biasLongitude } : (selectedPlace ? { latitude: selectedPlace.latitude, longitude: selectedPlace.longitude } : null);
      const places = await searchMutationRef.current({ query: clean, ...(countryCode ? { countryCode } : {}), ...(preferredBias ? { biasLatitude: preferredBias.latitude, biasLongitude: preferredBias.longitude } : {}), ...(includeCommunityFallback ? { includeCommunityFallback: true } : {}) });
      if (requestId === latestSearch.current) {
        setResults((current) => haveSameSuggestionIds(current, places) ? current : places);
        if (!places.length) setMessage(includeCommunityFallback ? "Aucun lieu trouvé. Touchez la carte pour choisir une position." : "Aucun résultat Mapbox. Appuyez sur Rechercher pour élargir aux commerces connus.");
      }
    } catch (cause) {
      if (requestId === latestSearch.current) setMessage(cause instanceof Error ? cause.message : "La recherche est indisponible.");
    }
  }, [biasLatitude, biasLongitude, countryCode]);

  useEffect(() => {
    if (!autocompleteQuery(query)) { latestSearch.current += 1; setResults((current) => current.length ? [] : current); return; }
    const timer = setTimeout(() => { void runSearch(query); }, PLACE_AUTOCOMPLETE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, runSearch]);

  async function selectOnMap(event: MapPressEvent) {
    const { latitude, longitude } = event.nativeEvent.coordinate;
    try {
      setMessage("Résolution de l’adresse…");
      const place = await reverse.mutateAsync({ latitude, longitude });
      if (!place) { setMessage("Impossible d’identifier ce point. Essayez une autre position."); return; }
      latestSearch.current += 1;
      onChange(place);
      setResults([]);
      setMessage("");
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Le géocodage est indisponible."); }
  }

  async function selectSuggestion(suggestion: PlaceSuggestion) {
    try {
      if (suggestion.directLocation) {
        latestSearch.current += 1;
        onChange(suggestion.directLocation);
        setResults([]);
        setMessage("");
        return;
      }
      if (!suggestion.mapboxId) throw new Error("Ce résultat ne possède pas de coordonnées exploitables.");
      setMessage("Chargement des coordonnées…");
      const place = await resolve.mutateAsync({ mapboxId: suggestion.mapboxId, ...(suggestion.mapboxSessionToken ? { mapboxSessionToken: suggestion.mapboxSessionToken } : {}) });
      latestSearch.current += 1;
      onChange(place);
      setResults([]);
      setMessage("");
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "La sélection du lieu est indisponible."); }
  }

  async function prioritizeNearbyResults() {
    const nearby = await requestBias();
    if (!nearby) {
      setMessage("Position indisponible ou non autorisée. La recherche reste disponible.");
      return;
    }
    mapRef.current?.animateToRegion({ latitude: nearby.latitude, longitude: nearby.longitude, latitudeDelta: 0.045, longitudeDelta: 0.045 }, 350);
    setMessage(autocompleteQuery(query) ? "Résultats priorisés autour de votre position actuelle." : "Position activée. Saisissez une adresse pour rechercher à proximité.");
  }

  async function selectCurrentLocation() {
    if (gpsStatus === "loading" || reverse.isPending) return;
    const nearby = await requestBias();
    if (!nearby) {
      setMessage("Position indisponible ou non autorisée. Vous pouvez rechercher une adresse ou toucher la carte.");
      return;
    }
    try {
      setMessage("Identification de votre position actuelle…");
      const place = await reverse.mutateAsync(nearby);
      if (!place) {
        setMessage("Votre position a été détectée, mais son adresse est introuvable. Touchez la carte pour ajuster le point.");
        return;
      }
      latestSearch.current += 1;
      setResults((current) => current.length ? [] : current);
      mapRef.current?.animateToRegion({ latitude: place.latitude, longitude: place.longitude, latitudeDelta: 0.025, longitudeDelta: 0.025 }, 350);
      onChange(place);
      setMessage("");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Impossible d’identifier votre position actuelle.");
    }
  }

  return <View style={styles.wrap}>
    <Text style={styles.label}>{label}</Text>
    <SurfaceCard style={styles.card}>
      <View style={styles.searchRow}>
        <MaterialIcons name={tone === "pickup" ? "trip-origin" : "location-on"} size={19} color={accent} />
        <TextInput value={query} onChangeText={(text) => { setQuery(sanitizePlaceText(text, 120, { preserveTrailingSpace: true })); setMessage(""); }} maxLength={120} placeholder="Adresse, commerce ou lieu public" placeholderTextColor="#8B97A8" returnKeyType="search" onSubmitEditing={() => void runSearch(query, true)} style={styles.input} />
        <Pressable accessibilityRole="button" accessibilityLabel="Prioriser les résultats autour de ma position" onPress={() => void prioritizeNearbyResults()} disabled={gpsStatus === "loading"} style={({ pressed }) => [styles.nearbyButton, (pressed || gpsStatus === "loading") && styles.pressed]}>{gpsStatus === "loading" ? <ActivityIndicator size="small" color="#007B8B" /> : <MaterialIcons name={deviceBias ? "my-location" : "near-me"} size={18} color="#007B8B" />}</Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Rechercher ${label}`} onPress={() => void runSearch(query, true)} disabled={search.isPending} style={({ pressed }) => [styles.searchButton, { backgroundColor: accent }, (pressed || search.isPending) && styles.pressed]}>{search.isPending ? <ActivityIndicator size="small" color="#FFFFFF" /> : <MaterialIcons name="search" size={19} color="#FFFFFF" />}</Pressable>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Utiliser ma position actuelle" onPress={() => void selectCurrentLocation()} disabled={gpsStatus === "loading" || reverse.isPending} style={({ pressed }) => [styles.currentLocationButton, (pressed || gpsStatus === "loading" || reverse.isPending) && styles.pressed]}>{gpsStatus === "loading" || reverse.isPending ? <ActivityIndicator size="small" color="#007B8B" /> : <MaterialIcons name="my-location" size={18} color="#007B8B" />}<Text style={styles.currentLocationText}>{reverse.isPending ? "Identification de votre position…" : "Utiliser ma position actuelle"}</Text></Pressable>
      <View style={styles.mapWrap}><MapView provider={PROVIDER_GOOGLE} ref={mapRef} style={styles.map} initialRegion={value ? { latitude: value.latitude, longitude: value.longitude, latitudeDelta: 0.025, longitudeDelta: 0.025 } : INITIAL_REGION} onPress={(event) => void selectOnMap(event)}>{value ? <Marker coordinate={{ latitude: value.latitude, longitude: value.longitude }} pinColor={accent} title={locationTitle(value)} description={locationSubtitle(value)} /> : null}</MapView><View pointerEvents="none" style={styles.mapHint}><MaterialIcons name="touch-app" size={14} color="#FFFFFF" /><Text style={styles.mapHintText}>Touchez la carte pour sélectionner</Text></View></View>
      {results.map((place) => <Pressable key={place.id} onPress={() => void selectSuggestion(place)} disabled={resolve.isPending && !place.directLocation} style={({ pressed }) => [styles.result, (pressed || (resolve.isPending && !place.directLocation)) && styles.pressed]}><MaterialIcons name={place.provider === "openstreetmap" ? "storefront" : "place"} size={18} color="#007B8B" /><View style={styles.resultText}><Text style={styles.resultName}>{locationTitle(place)}</Text><Text style={styles.resultMeta} numberOfLines={1}>{locationSubtitle(place)}{place.provider === "openstreetmap" ? " · OpenStreetMap" : ""}</Text></View>{resolve.isPending && !place.directLocation ? <ActivityIndicator size="small" color="#007B8B" /> : <MaterialIcons name="chevron-right" size={20} color="#A1ADBC" />}</Pressable>)}
      {results.some((place) => place.provider === "openstreetmap") ? <Text style={styles.attribution}>Données © OpenStreetMap contributors</Text> : null}
      {value ? <View style={styles.selected}><MaterialIcons name="check-circle" size={16} color="#167A55" /><Text style={styles.selectedText} numberOfLines={2}>{locationTitle(value)}{"\n"}{locationSubtitle(value)}</Text></View> : null}
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </SurfaceCard>
  </View>;
}

const styles = StyleSheet.create({ wrap: { marginBottom: 12 }, label: { color: "#444444", fontWeight: "600", fontSize: 12, marginBottom: 6 }, card: { padding: 10 }, searchRow: { flexDirection: "row", alignItems: "center", minHeight: 44, borderWidth: 0, borderRadius: 9, backgroundColor: "#EEEDF3", paddingLeft: 10, gap: 7 }, input: { flex: 1, minHeight: 42, color: "#111111", fontSize: 13, fontWeight: "500" }, nearbyButton: { width: 32, height: 32, borderRadius: 7, alignItems: "center", justifyContent: "center", backgroundColor: "#EEEDF3" }, searchButton: { width: 36, alignSelf: "stretch", borderRadius: 8, alignItems: "center", justifyContent: "center" }, currentLocationButton: { minHeight: 40, marginTop: 9, borderRadius: 8, backgroundColor: "#EEEDF3", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 11 }, currentLocationText: { color: "#007B8B", fontSize: 12, fontWeight: "600" }, mapWrap: { overflow: "hidden", borderRadius: 9, height: 160, marginTop: 9, backgroundColor: "#EEEDF3" }, map: { width: "100%", height: "100%" }, mapHint: { position: "absolute", bottom: 8, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(0,0,0,0.7)", paddingHorizontal: 9, paddingVertical: 5, borderRadius: 7 }, mapHintText: { color: "#FFFFFF", fontSize: 10, fontWeight: "600" }, result: { flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 9, borderBottomWidth: 0 }, resultText: { flex: 1 }, resultName: { color: "#111111", fontSize: 13, fontWeight: "600" }, resultMeta: { color: "#666666", fontSize: 11, marginTop: 2 }, attribution: { color: "#666666", fontSize: 9, marginTop: 6 }, selected: { backgroundColor: "#EEEDF3", borderRadius: 9, padding: 9, flexDirection: "row", alignItems: "center", gap: 6, marginTop: 9 }, selectedText: { flex: 1, color: "#167A55", fontSize: 12, fontWeight: "600" }, message: { color: "#9A6200", fontSize: 11, lineHeight: 16, marginTop: 6 }, pressed: { opacity: 0.67 } });
