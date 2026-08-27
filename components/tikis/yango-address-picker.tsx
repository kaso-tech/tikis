import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, Keyboard, KeyboardAvoidingView, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AddressMapPicker } from "@/components/tikis/address-map-picker";
import { sanitizePlaceText } from "@/lib/geo-rules";
import { autocompleteQuery, haveSameSuggestionIds, PLACE_AUTOCOMPLETE_DEBOUNCE_MS } from "@/lib/place-autocomplete";
import { loadRecentPlaces, rememberRecentPlace } from "@/lib/recent-places";
import { trpc } from "@/lib/trpc";
import { useSearchLocationBias } from "@/hooks/use-search-location-bias";
import { locationSubtitle, locationTitle, type LocationLabel, type PlaceSuggestion } from "@/shared/tikis-domain";
import type { SavedFavorite } from "@/components/tikis/place-sheets";

type LocationTarget = "pickup" | "dropoff";

export function YangoAddressPicker({ visible, target, value, countryCode, profilePhone, favorites, onClose, onSelect, onFavorite }: { visible: boolean; target: LocationTarget | null; value: LocationLabel | null; countryCode?: string; profilePhone?: string; favorites: SavedFavorite[]; onClose: () => void; onSelect: (place: LocationLabel) => void; onFavorite: (place: LocationLabel, label: string) => Promise<void> }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceSuggestion[]>([]);
  const [message, setMessage] = useState("");
  const [showAddresses, setShowAddresses] = useState(false);
  const [mapVisible, setMapVisible] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [recentPlaces, setRecentPlaces] = useState<LocationLabel[]>([]);
  const translateY = useRef(new Animated.Value(0)).current;
  const search = trpc.geography.search.useMutation();
  const resolve = trpc.geography.resolve.useMutation();
  const reverse = trpc.geography.reverse.useMutation();
  const latestSearch = useRef(0);
  const searchMutationRef = useRef(search.mutateAsync);
  const valueRef = useRef(value);
  valueRef.current = value;
  searchMutationRef.current = search.mutateAsync;
  const { bias, status: gpsStatus, requestBias } = useSearchLocationBias();
  const hasQuery = Boolean(query.trim());
  const title = target === "pickup" ? "Adresse de récupération" : "Adresse de destination";

  useEffect(() => {
    if (visible) return;
    setQuery(""); setResults([]); setMessage(""); setShowAddresses(false); setSelecting(false); setMapVisible(false); translateY.setValue(0);
  }, [translateY, visible]);

  useEffect(() => {
    if (!visible || !profilePhone) return;
    let active = true;
    void loadRecentPlaces(profilePhone).then((places) => { if (active) setRecentPlaces(places); });
    return () => { active = false; };
  }, [profilePhone, visible]);

  const runSearch = useCallback(async (raw: string, includeCommunityFallback = false) => {
    const clean = autocompleteQuery(raw);
    if (!clean) { setResults([]); return; }
    const requestId = ++latestSearch.current;
    try {
      setMessage("");
      const preferredBias = bias ?? (valueRef.current ? { latitude: valueRef.current.latitude, longitude: valueRef.current.longitude } : null);
      const places = await searchMutationRef.current({ query: clean, ...(countryCode ? { countryCode } : {}), ...(preferredBias ? { biasLatitude: preferredBias.latitude, biasLongitude: preferredBias.longitude } : {}), ...(includeCommunityFallback ? { includeCommunityFallback: true } : {}) });
      if (requestId === latestSearch.current) {
        setResults((current) => haveSameSuggestionIds(current, places) ? current : places);
        if (!places.length) setMessage("Aucune adresse trouvée. Essayez une formulation plus précise ou ouvrez la carte.");
      }
    } catch (cause) {
      if (requestId === latestSearch.current) setMessage(cause instanceof Error ? cause.message : "La recherche est momentanément indisponible.");
    }
  }, [bias, countryCode]);

  useEffect(() => {
    if (!hasQuery) { latestSearch.current += 1; setResults((current) => current.length ? [] : current); return; }
    const suggestionTimer = setTimeout(() => { void runSearch(query); }, PLACE_AUTOCOMPLETE_DEBOUNCE_MS);
    const expandedSearchTimer = setTimeout(() => { void runSearch(query, true); }, Math.max(850, PLACE_AUTOCOMPLETE_DEBOUNCE_MS + 450));
    return () => { clearTimeout(suggestionTimer); clearTimeout(expandedSearchTimer); };
  }, [hasQuery, query, runSearch]);

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => gesture.dy > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderMove: (_, gesture) => translateY.setValue(Math.max(0, gesture.dy)),
    onPanResponderRelease: (_, gesture) => {
      if (gesture.dy > 120 || gesture.vy > 1) { Keyboard.dismiss(); Animated.timing(translateY, { toValue: 780, duration: 170, useNativeDriver: true }).start(onClose); }
      else Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
    },
  }), [onClose, translateY]);

  async function selectCurrentLocation() {
    if (gpsStatus === "loading" || reverse.isPending) return;
    const current = await requestBias();
    if (!current) { setMessage("Position indisponible ou non autorisée. Vous pouvez rechercher une adresse ou utiliser la carte."); return; }
    try {
      setSelecting(true); setMessage("Identification de votre position actuelle…");
      const place = await reverse.mutateAsync(current);
      if (!place) { setMessage("Votre position a été détectée, mais son adresse est introuvable. Ajustez-la sur la carte."); return; }
      commitSelection(place);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Impossible d’identifier votre position actuelle."); }
    finally { setSelecting(false); }
  }

  async function selectSuggestion(suggestion: PlaceSuggestion) {
    if (selecting) return;
    try {
      setSelecting(true); setMessage("");
      const place = suggestion.directLocation ?? (suggestion.mapboxId ? await resolve.mutateAsync({ mapboxId: suggestion.mapboxId, ...(suggestion.mapboxSessionToken ? { mapboxSessionToken: suggestion.mapboxSessionToken } : {}) }) : null);
      if (!place) throw new Error("Ce résultat ne possède pas de coordonnées exploitables.");
      commitSelection(place);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "La sélection de l’adresse est indisponible."); }
    finally { setSelecting(false); }
  }

  function commitSelection(place: LocationLabel) { onSelect(place); if (profilePhone) void rememberRecentPlace(profilePhone, place); onClose(); }
  function selectSavedAddress(place: LocationLabel) { commitSelection(place); }
  function iconFor(place: PlaceSuggestion) { if (place.featureType === "poi") return "storefront"; if (place.featureType === "address" || place.featureType === "secondary_address") return "home-work"; if (place.featureType === "street") return "add-road"; if (place.featureType === "neighborhood") return "location-city"; return "place"; }

  return <><Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
    <View style={styles.overlay}><Pressable style={styles.backdrop} onPress={onClose} /><Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
      <View style={styles.dragZone} {...panResponder.panHandlers}><View style={styles.handle} /></View>
      <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <SafeAreaView style={styles.safe} edges={["top"]}>
          <View style={styles.searchBox}><MaterialIcons name="search" size={27} color="#1D2A35" /><TextInput value={query} onChangeText={(text) => { setQuery(sanitizePlaceText(text, 120, { preserveTrailingSpace: true })); setMessage(""); setShowAddresses(false); }} placeholder={target === "pickup" ? "Point de récupération" : "Destination"} placeholderTextColor="#929AA3" style={styles.input} autoFocus autoCorrect={false} maxLength={120} returnKeyType="search" onSubmitEditing={() => void runSearch(query, true)} />{query ? <Pressable accessibilityRole="button" accessibilityLabel="Effacer la recherche" onPress={() => setQuery("")} style={({ pressed }) => [styles.clear, pressed && styles.pressed]}><MaterialIcons name="close" size={24} color="#1D2A35" /></Pressable> : null}<View style={styles.searchDivider} /><Pressable accessibilityRole="button" accessibilityLabel="Choisir sur la carte" onPress={() => { Keyboard.dismiss(); setMapVisible(true); }} style={({ pressed }) => [styles.mapTextButton, pressed && styles.pressed]}><Text style={styles.mapText}>Carte</Text></Pressable></View>
          {!hasQuery && !showAddresses ? <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.quickActions}><Pressable accessibilityRole="button" onPress={() => void selectCurrentLocation()} disabled={selecting || gpsStatus === "loading"} style={({ pressed }) => [styles.quickAction, (pressed || selecting || gpsStatus === "loading") && styles.pressed]}><View style={styles.quickIcon}><MaterialIcons name="near-me" size={25} color="#0B1F3A" /></View><View style={styles.quickCopy}><Text style={styles.quickTitle}>Utiliser ma position actuelle</Text><Text style={styles.quickSubtitle}>{gpsStatus === "loading" || selecting ? "Identification en cours…" : "Adresse récupérée à partir de votre position GPS"}</Text></View>{gpsStatus === "loading" || selecting ? <ActivityIndicator color="#007B8B" /> : null}</Pressable><Pressable accessibilityRole="button" onPress={() => setShowAddresses(true)} style={({ pressed }) => [styles.quickAction, pressed && styles.pressed]}><View style={styles.savedIcon}><MaterialIcons name="bookmark" size={24} color="#A86600" /></View><View style={styles.quickCopy}><Text style={styles.quickTitle}>Mes adresses</Text><Text style={styles.quickSubtitle}>Choisissez une adresse enregistrée</Text></View><MaterialIcons name="chevron-right" size={28} color="#1D2A35" /></Pressable>{recentPlaces.length ? <View style={styles.recentBlock}><Text style={styles.recentHeading}>ADRESSES RÉCENTES</Text>{recentPlaces.map((place) => <Pressable key={`${place.latitude}:${place.longitude}`} accessibilityRole="button" onPress={() => commitSelection(place)} style={({ pressed }) => [styles.recentRow, pressed && styles.pressed]}><View style={styles.recentIcon}><MaterialIcons name="history" size={18} color="#007B8B" /></View><View style={styles.quickCopy}><Text style={styles.recentTitle} numberOfLines={1}>{locationTitle(place)}</Text><Text style={styles.recentMeta} numberOfLines={1}>{locationSubtitle(place)}</Text></View><MaterialIcons name="chevron-right" size={22} color="#A7B1BE" /></Pressable>)}</View> : null}</ScrollView> : null}
          {!hasQuery && showAddresses ? <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.resultsContent}><Pressable accessibilityRole="button" onPress={() => setShowAddresses(false)} style={({ pressed }) => [styles.addressBack, pressed && styles.pressed]}><MaterialIcons name="arrow-back" size={20} color="#007B8B" /><Text style={styles.addressBackText}>Retour</Text></Pressable><Text style={styles.addressesTitle}>Mes adresses</Text>{favorites.length ? favorites.map((favorite) => <Pressable key={favorite.id} accessibilityRole="button" onPress={() => selectSavedAddress(favorite.location)} style={({ pressed }) => [styles.savedRow, pressed && styles.pressed]}><View style={styles.savedRowIcon}><MaterialIcons name="bookmark" size={19} color="#A86600" /></View><View style={styles.savedRowCopy}><Text style={styles.savedRowTitle} numberOfLines={1}>{favorite.label}</Text><Text style={styles.savedRowMeta} numberOfLines={2}>{locationTitle(favorite.location)} · {locationSubtitle(favorite.location)}</Text></View><MaterialIcons name="chevron-right" size={20} color="#A7B1BE" /></Pressable>) : <View style={styles.empty}><MaterialIcons name="bookmark-border" size={34} color="#A7B1BE" /><Text style={styles.emptyTitle}>Aucune adresse enregistrée</Text><Text style={styles.emptyText}>Vous pourrez enregistrer une adresse depuis la carte après l’avoir positionnée.</Text></View>}</ScrollView> : null}
          {hasQuery ? <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.resultsContent}>{search.isPending ? <View style={styles.loadingResults}><ActivityIndicator color="#007B8B" /><Text style={styles.loadingText}>Recherche des adresses…</Text></View> : null}{results.map((place) => <Pressable key={place.id} accessibilityRole="button" onPress={() => void selectSuggestion(place)} disabled={selecting} style={({ pressed }) => [styles.result, (pressed || selecting) && styles.pressed]}><View style={styles.resultIcon}><MaterialIcons name={iconFor(place)} size={23} color="#657180" /></View><View style={styles.resultCopy}><Text style={styles.resultName} numberOfLines={1}>{locationTitle(place)}</Text><Text style={styles.resultMeta} numberOfLines={2}>{locationSubtitle(place)}{place.provider === "openstreetmap" ? " · OpenStreetMap" : ""}</Text></View>{selecting ? <ActivityIndicator color="#007B8B" /> : <MaterialIcons name="chevron-right" size={22} color="#A7B1BE" />}</Pressable>)}{message ? <Text style={styles.message}>{message}</Text> : null}{results.some((place) => place.provider === "openstreetmap") ? <Text style={styles.attribution}>Données © OpenStreetMap contributors</Text> : null}</ScrollView> : null}
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Animated.View></View>
  </Modal>
  <AddressMapPicker visible={mapVisible} targetTitle={title} initialPlace={value} countryCode={countryCode} onClose={() => setMapVisible(false)} onUse={(place) => { setMapVisible(false); commitSelection(place); }} onFavorite={onFavorite} />
  </>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(11,31,58,0.38)" }, backdrop: { ...StyleSheet.absoluteFillObject }, sheet: { height: "88%", backgroundColor: "#FFFFFF", borderTopLeftRadius: 32, borderTopRightRadius: 32, overflow: "hidden" }, dragZone: { height: 38, alignItems: "center", justifyContent: "center" }, handle: { width: 46, height: 5, borderRadius: 3, backgroundColor: "#AEB8C5" }, keyboard: { flex: 1 }, safe: { flex: 1 }, searchBox: { minHeight: 70, flexDirection: "row", alignItems: "center", marginHorizontal: 18, backgroundColor: "#FFFFFF", borderRadius: 18, paddingLeft: 16, paddingRight: 7, shadowColor: "#0B1F3A", shadowOpacity: 0.11, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 4 }, input: { flex: 1, minHeight: 64, color: "#11181C", fontSize: 19, paddingLeft: 13 }, clear: { width: 38, height: 44, alignItems: "center", justifyContent: "center" }, searchDivider: { width: 1, height: 36, backgroundColor: "#D9E0E7", marginLeft: 1 }, mapTextButton: { minHeight: 52, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" }, mapText: { color: "#1D2A35", fontWeight: "800", fontSize: 16 }, quickActions: { paddingHorizontal: 27, paddingTop: 24, paddingBottom: 36 }, recentBlock: { marginTop: 19, paddingTop: 2 }, recentHeading: { color: "#7D8794", fontSize: 10, fontWeight: "900", letterSpacing: 0.8, marginBottom: 7 }, recentRow: { minHeight: 59, flexDirection: "row", alignItems: "center", gap: 10, borderBottomColor: "#E5E9EE", borderBottomWidth: 1 }, recentIcon: { width: 33, height: 33, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: "#E7F6F7" }, recentTitle: { color: "#26313D", fontSize: 14, fontWeight: "800" }, recentMeta: { color: "#7D8794", fontSize: 11, marginTop: 2 }, quickAction: { minHeight: 89, flexDirection: "row", alignItems: "center", gap: 14, borderBottomColor: "#E5E9EE", borderBottomWidth: 1 }, quickIcon: { width: 42, alignItems: "center" }, savedIcon: { width: 42, alignItems: "center" }, quickCopy: { flex: 1 }, quickTitle: { color: "#141C26", fontSize: 17, fontWeight: "800" }, quickSubtitle: { color: "#7D8794", fontSize: 13, lineHeight: 18, marginTop: 3 }, resultsContent: { paddingHorizontal: 20, paddingTop: 15, paddingBottom: 44 }, loadingResults: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 14 }, loadingText: { color: "#657180", fontSize: 13, fontWeight: "700" }, result: { minHeight: 74, flexDirection: "row", alignItems: "center", gap: 12, borderBottomColor: "#E9EDF1", borderBottomWidth: 1 }, resultIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: "#F0F3F6", alignItems: "center", justifyContent: "center" }, resultCopy: { flex: 1, minWidth: 0 }, resultName: { color: "#1D2733", fontSize: 16, fontWeight: "800" }, resultMeta: { color: "#7C8794", fontSize: 12.5, lineHeight: 17, marginTop: 3 }, message: { color: "#A55A00", fontSize: 12, lineHeight: 17, marginTop: 15 }, attribution: { color: "#84909D", fontSize: 10, marginTop: 11 }, addressBack: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 34, alignSelf: "flex-start", marginBottom: 9 }, addressBackText: { color: "#007B8B", fontSize: 13, fontWeight: "900" }, addressesTitle: { color: "#11181C", fontSize: 22, fontWeight: "900", marginBottom: 10 }, savedRow: { flexDirection: "row", alignItems: "center", minHeight: 76, gap: 12, borderBottomColor: "#E9EDF1", borderBottomWidth: 1 }, savedRowIcon: { width: 39, height: 39, borderRadius: 12, backgroundColor: "#FFF4D8", alignItems: "center", justifyContent: "center" }, savedRowCopy: { flex: 1 }, savedRowTitle: { color: "#1D2733", fontSize: 15, fontWeight: "900" }, savedRowMeta: { color: "#7C8794", fontSize: 11.5, lineHeight: 16, marginTop: 3 }, empty: { alignItems: "center", paddingHorizontal: 38, paddingTop: 52 }, emptyTitle: { color: "#1D2733", fontSize: 16, fontWeight: "900", marginTop: 11 }, emptyText: { color: "#7C8794", textAlign: "center", fontSize: 12, lineHeight: 18, marginTop: 6 }, pressed: { opacity: 0.65 },
});
