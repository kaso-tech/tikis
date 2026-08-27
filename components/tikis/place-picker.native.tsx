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
  const accent = tone === "pickup" ? "#007B8B" : "#C23B45";
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

  const runSearch = useCallback(async (rawQuery: string) => {
    const clean = autocompleteQuery(rawQuery);
    if (!clean) { setResults([]); return; }
    const requestId = ++latestSearch.current;
    try {
      setMessage("");
      const selectedPlace = valueRef.current;
      const preferredBias = biasLatitude !== null && biasLongitude !== null ? { latitude: biasLatitude, longitude: biasLongitude } : (selectedPlace ? { latitude: selectedPlace.latitude, longitude: selectedPlace.longitude } : null);
      const places = await searchMutationRef.current({ query: clean, ...(countryCode ? { countryCode } : {}), ...(preferredBias ? { biasLatitude: preferredBias.latitude, biasLongitude: preferredBias.longitude } : {}) });
      if (requestId === latestSearch.current) {
        setResults((current) => haveSameSuggestionIds(current, places) ? current : places);
        if (!places.length) setMessage("Aucun lieu trouvé. Touchez la carte pour choisir une position.");
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
      setMessage("Chargement des coordonnées…");
      const place = await resolve.mutateAsync({ mapboxId: suggestion.mapboxId, mapboxSessionToken: suggestion.mapboxSessionToken });
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

  return <View style={styles.wrap}>
    <Text style={styles.label}>{label}</Text>
    <SurfaceCard style={styles.card}>
      <View style={styles.searchRow}>
        <MaterialIcons name={tone === "pickup" ? "trip-origin" : "location-on"} size={19} color={accent} />
        <TextInput value={query} onChangeText={(text) => { setQuery(sanitizePlaceText(text, 120, { preserveTrailingSpace: true })); setMessage(""); }} maxLength={120} placeholder="Rechercher une adresse ou un lieu" placeholderTextColor="#8B97A8" returnKeyType="search" onSubmitEditing={() => void runSearch(query)} style={styles.input} />
        <Pressable accessibilityRole="button" accessibilityLabel="Prioriser les résultats autour de ma position" onPress={() => void prioritizeNearbyResults()} disabled={gpsStatus === "loading"} style={({ pressed }) => [styles.nearbyButton, (pressed || gpsStatus === "loading") && styles.pressed]}>{gpsStatus === "loading" ? <ActivityIndicator size="small" color="#007B8B" /> : <MaterialIcons name={deviceBias ? "my-location" : "near-me"} size={18} color="#007B8B" />}</Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Rechercher ${label}`} onPress={() => void runSearch(query)} disabled={search.isPending} style={({ pressed }) => [styles.searchButton, { backgroundColor: accent }, (pressed || search.isPending) && styles.pressed]}>{search.isPending ? <ActivityIndicator size="small" color="#FFFFFF" /> : <MaterialIcons name="search" size={19} color="#FFFFFF" />}</Pressable>
      </View>
      <View style={styles.mapWrap}><MapView provider={PROVIDER_GOOGLE} ref={mapRef} style={styles.map} initialRegion={value ? { latitude: value.latitude, longitude: value.longitude, latitudeDelta: 0.025, longitudeDelta: 0.025 } : INITIAL_REGION} onPress={(event) => void selectOnMap(event)}>{value ? <Marker coordinate={{ latitude: value.latitude, longitude: value.longitude }} pinColor={accent} title={locationTitle(value)} description={locationSubtitle(value)} /> : null}</MapView><View pointerEvents="none" style={styles.mapHint}><MaterialIcons name="touch-app" size={14} color="#FFFFFF" /><Text style={styles.mapHintText}>Touchez la carte pour sélectionner</Text></View></View>
      {results.map((place, index) => <Pressable key={`${place.mapboxId}-${index}`} onPress={() => void selectSuggestion(place)} disabled={resolve.isPending} style={({ pressed }) => [styles.result, (pressed || resolve.isPending) && styles.pressed]}><MaterialIcons name="place" size={18} color="#007B8B" /><View style={styles.resultText}><Text style={styles.resultName}>{locationTitle(place)}</Text><Text style={styles.resultMeta} numberOfLines={1}>{locationSubtitle(place)}</Text></View>{resolve.isPending ? <ActivityIndicator size="small" color="#007B8B" /> : <MaterialIcons name="chevron-right" size={20} color="#A1ADBC" />}</Pressable>)}
      {value ? <View style={styles.selected}><MaterialIcons name="check-circle" size={16} color="#147A58" /><Text style={styles.selectedText} numberOfLines={2}>{locationTitle(value)}{"\n"}{locationSubtitle(value)}</Text></View> : null}
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </SurfaceCard>
  </View>;
}

const styles = StyleSheet.create({ wrap: { marginBottom: 15 }, label: { color: "#485569", fontWeight: "800", fontSize: 13, marginBottom: 7 }, card: { padding: 10 }, searchRow: { flexDirection: "row", alignItems: "center", minHeight: 48, borderWidth: 1, borderColor: "#DDE5ED", borderRadius: 14, paddingLeft: 11, gap: 8 }, input: { flex: 1, minHeight: 46, color: "#0B1F3A", fontSize: 13, fontWeight: "600" }, nearbyButton: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#E6F5F6" }, searchButton: { width: 40, alignSelf: "stretch", borderRadius: 13, alignItems: "center", justifyContent: "center" }, mapWrap: { overflow: "hidden", borderRadius: 14, height: 180, marginTop: 10, backgroundColor: "#EAF1F6" }, map: { width: "100%", height: "100%" }, mapHint: { position: "absolute", bottom: 9, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(11,31,58,0.82)", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12 }, mapHintText: { color: "#FFFFFF", fontSize: 10, fontWeight: "800" }, result: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 11, borderBottomWidth: 1, borderColor: "#EEF2F6" }, resultText: { flex: 1 }, resultName: { color: "#0B1F3A", fontSize: 13, fontWeight: "800" }, resultMeta: { color: "#78869A", fontSize: 11, marginTop: 2 }, selected: { backgroundColor: "#EAF8F1", borderRadius: 12, padding: 10, flexDirection: "row", alignItems: "center", gap: 7, marginTop: 10 }, selectedText: { flex: 1, color: "#147A58", fontSize: 12, fontWeight: "800" }, message: { color: "#B45309", fontSize: 11, lineHeight: 16, marginTop: 8 }, pressed: { opacity: 0.68 } });
