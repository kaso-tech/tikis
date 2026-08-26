import MapView, { Marker, PROVIDER_GOOGLE, type MapPressEvent } from "react-native-maps";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { SurfaceCard } from "@/components/tikis/ui";
import { sanitizePlaceText } from "@/lib/geo-rules";
import { autocompleteQuery, PLACE_AUTOCOMPLETE_DEBOUNCE_MS } from "@/lib/place-autocomplete";
import { trpc } from "@/lib/trpc";
import type { LocationLabel } from "@/shared/tikis-domain";

type Props = { label: string; tone: "pickup" | "dropoff"; value: LocationLabel | null; onChange: (place: LocationLabel) => void };
const INITIAL_REGION = { latitude: 12.3714, longitude: -1.5197, latitudeDelta: 0.12, longitudeDelta: 0.12 };

export function PlacePicker({ label, tone, value, onChange }: Props) {
  const mapRef = useRef<MapView>(null);
  const [query, setQuery] = useState(value?.name ?? "");
  const [results, setResults] = useState<LocationLabel[]>([]);
  const [message, setMessage] = useState("");
  const search = trpc.geography.search.useMutation();
  const reverse = trpc.geography.reverse.useMutation();
  const resolve = trpc.geography.resolve.useMutation();
  const latestSearch = useRef(0);
  const accent = tone === "pickup" ? "#007B8B" : "#C23B45";

  useEffect(() => {
    if (!value) return;
    if (query !== value.name) setQuery(value.name);
    mapRef.current?.animateToRegion({ latitude: value.latitude, longitude: value.longitude, latitudeDelta: 0.025, longitudeDelta: 0.025 }, 350);
  }, [query, value]);

  const runSearch = useCallback(async (rawQuery: string) => {
    const clean = autocompleteQuery(rawQuery);
    if (!clean) { setResults([]); return; }
    const requestId = ++latestSearch.current;
    try {
      setMessage("");
      const places = await search.mutateAsync({ query: clean, ...(value ? { biasLatitude: value.latitude, biasLongitude: value.longitude } : {}) });
      if (requestId === latestSearch.current) {
        setResults(places);
        if (!places.length) setMessage("Aucun lieu trouvé. Touchez la carte pour choisir une position.");
      }
    } catch (cause) {
      if (requestId === latestSearch.current) setMessage(cause instanceof Error ? cause.message : "La recherche est indisponible.");
    }
  }, [search, value]);

  useEffect(() => {
    if (!autocompleteQuery(query)) { latestSearch.current += 1; setResults([]); return; }
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

  async function selectSuggestion(suggestion: LocationLabel) {
    try {
      setMessage("Chargement des coordonnées…");
      const place = suggestion.mapboxId
        ? await resolve.mutateAsync({ mapboxId: suggestion.mapboxId, ...(suggestion.mapboxSessionToken ? { mapboxSessionToken: suggestion.mapboxSessionToken } : {}) })
        : suggestion;
      latestSearch.current += 1;
      onChange(place);
      setResults([]);
      setMessage("");
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "La sélection du lieu est indisponible."); }
  }

  return <View style={styles.wrap}>
    <Text style={styles.label}>{label}</Text>
    <SurfaceCard style={styles.card}>
      <View style={styles.searchRow}>
        <MaterialIcons name={tone === "pickup" ? "trip-origin" : "location-on"} size={19} color={accent} />
        <TextInput value={query} onChangeText={(text) => { setQuery(sanitizePlaceText(text, 120, { preserveTrailingSpace: true })); setMessage(""); }} maxLength={120} placeholder="Rechercher une adresse ou un lieu" placeholderTextColor="#8B97A8" returnKeyType="search" onSubmitEditing={() => void runSearch(query)} style={styles.input} />
        <Pressable accessibilityRole="button" accessibilityLabel={`Rechercher ${label}`} onPress={() => void runSearch(query)} disabled={search.isPending} style={({ pressed }) => [styles.searchButton, { backgroundColor: accent }, (pressed || search.isPending) && styles.pressed]}>{search.isPending ? <ActivityIndicator size="small" color="#FFFFFF" /> : <MaterialIcons name="search" size={19} color="#FFFFFF" />}</Pressable>
      </View>
      <View style={styles.mapWrap}><MapView provider={PROVIDER_GOOGLE} ref={mapRef} style={styles.map} initialRegion={value ? { latitude: value.latitude, longitude: value.longitude, latitudeDelta: 0.025, longitudeDelta: 0.025 } : INITIAL_REGION} onPress={(event) => void selectOnMap(event)}>{value ? <Marker coordinate={{ latitude: value.latitude, longitude: value.longitude }} pinColor={accent} title={value.name} description={[value.district, value.city].filter(Boolean).join(" · ")} /> : null}</MapView><View pointerEvents="none" style={styles.mapHint}><MaterialIcons name="touch-app" size={14} color="#FFFFFF" /><Text style={styles.mapHintText}>Touchez la carte pour sélectionner</Text></View></View>
      {results.map((place, index) => <Pressable key={`${place.mapboxId ?? place.googlePlaceId ?? place.latitude}-${index}`} onPress={() => void selectSuggestion(place)} disabled={resolve.isPending} style={({ pressed }) => [styles.result, (pressed || resolve.isPending) && styles.pressed]}><MaterialIcons name="place" size={18} color="#007B8B" /><View style={styles.resultText}><Text style={styles.resultName}>{place.name}</Text><Text style={styles.resultMeta} numberOfLines={1}>{[place.district, place.city, place.formattedAddress].filter(Boolean).join(" · ")}</Text></View>{resolve.isPending ? <ActivityIndicator size="small" color="#007B8B" /> : <MaterialIcons name="chevron-right" size={20} color="#A1ADBC" />}</Pressable>)}
      {value ? <View style={styles.selected}><MaterialIcons name="check-circle" size={16} color="#147A58" /><Text style={styles.selectedText} numberOfLines={2}>{[value.name, value.district, value.city].filter(Boolean).join(" · ")}</Text></View> : null}
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </SurfaceCard>
  </View>;
}

const styles = StyleSheet.create({ wrap: { marginBottom: 15 }, label: { color: "#485569", fontWeight: "800", fontSize: 13, marginBottom: 7 }, card: { padding: 10 }, searchRow: { flexDirection: "row", alignItems: "center", minHeight: 48, borderWidth: 1, borderColor: "#DDE5ED", borderRadius: 14, paddingLeft: 11, gap: 8 }, input: { flex: 1, minHeight: 46, color: "#0B1F3A", fontSize: 13, fontWeight: "600" }, searchButton: { width: 40, alignSelf: "stretch", borderRadius: 13, alignItems: "center", justifyContent: "center" }, mapWrap: { overflow: "hidden", borderRadius: 14, height: 180, marginTop: 10, backgroundColor: "#EAF1F6" }, map: { width: "100%", height: "100%" }, mapHint: { position: "absolute", bottom: 9, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(11,31,58,0.82)", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12 }, mapHintText: { color: "#FFFFFF", fontSize: 10, fontWeight: "800" }, result: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 11, borderBottomWidth: 1, borderColor: "#EEF2F6" }, resultText: { flex: 1 }, resultName: { color: "#0B1F3A", fontSize: 13, fontWeight: "800" }, resultMeta: { color: "#78869A", fontSize: 11, marginTop: 2 }, selected: { backgroundColor: "#EAF8F1", borderRadius: 12, padding: 10, flexDirection: "row", alignItems: "center", gap: 7, marginTop: 10 }, selectedText: { flex: 1, color: "#147A58", fontSize: 12, fontWeight: "800" }, message: { color: "#B45309", fontSize: 11, lineHeight: 16, marginTop: 8 }, pressed: { opacity: 0.68 } });
