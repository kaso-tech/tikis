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
import { locationSubtitle, locationTitle, type LocationLabel, type PlaceSuggestion, type SavedFavorite } from "@/shared/tikis-domain";
import { useThemeColors, type ThemedColors } from "@/lib/use-theme-colors";
import { createStyles } from "@/lib/create-styles";

type LocationTarget = "pickup" | "dropoff" | "address";

/**
 * En dessous de ce nombre de suggestions, la recherche ordinaire est jugée trop maigre et le repli
 * élargi (Search Box forward, puis OpenStreetMap) prend le relais.
 *
 * Le seuil n'est pas à zéro : la couverture Mapbox des commerces à Ouagadougou est mince, et une
 * unique rue vaguement approchante ne répond pas à « Pharmacie du Progrès ». Il reste bas parce que
 * l'élargissement coûte deux appels Mapbox de plus et ramène des résultats plus lâches.
 */
const EXPANDED_SEARCH_FROM_BELOW = 3;

export function YangoAddressPicker({ visible, target, value, countryCode, profilePhone, favorites, onClose, onSelect, onFavorite }: { visible: boolean; target: LocationTarget | null; value: LocationLabel | null; countryCode?: string; profilePhone?: string; favorites: SavedFavorite[]; onClose: () => void; onSelect: (place: LocationLabel) => void; onFavorite: (place: LocationLabel, label: string) => Promise<void> }) {
  const { colors: theme } = useThemeColors();
  const styles = useMemo(() => stylesFor(theme), [theme]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceSuggestion[]>([]);
  const [message, setMessage] = useState("");
  const [showAddresses, setShowAddresses] = useState(false);
  const [mapVisible, setMapVisible] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [recentPlaces, setRecentPlaces] = useState<LocationLabel[]>([]);
  // useState plutôt que useRef(...).current : une valeur Animated stable, créée une seule fois, lue
  // pendant le rendu (styles/PanResponder ci-dessous) — ce que le React Compiler interdit à un ref
  // (react-hooks/refs), pas à un state dont on n'appelle jamais le setter.
  const [translateY] = useState(() => new Animated.Value(0));
  const search = trpc.geography.search.useMutation();
  const resolve = trpc.geography.resolve.useMutation();
  const reverse = trpc.geography.reverse.useMutation();
  const latestSearch = useRef(0);
  const searchMutationRef = useRef(search.mutateAsync);
  const valueRef = useRef(value);
  // Écrit hors du rendu : affecter `.current` directement dans le corps du composant est aussi
  // interdit par le compilateur qu'une lecture — seul un effet ou un gestionnaire le peut.
  useEffect(() => {
    valueRef.current = value;
    searchMutationRef.current = search.mutateAsync;
  });
  const { bias, status: gpsStatus, requestBias } = useSearchLocationBias();
  const hasQuery = Boolean(query.trim());
  const title = target === "pickup" ? "Adresse de récupération" : target === "dropoff" ? "Adresse de destination" : "Nouvelle adresse";

  // Ajustement pendant le rendu, comparé au rendu précédent, plutôt qu'un setState synchrone dans
  // le corps d'un effet (react-hooks/set-state-in-effect) : réinitialise l'écran à la fermeture.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (!visible) { setQuery(""); setResults([]); setMessage(""); setShowAddresses(false); setSelecting(false); setMapVisible(false); }
  }

  // Ce qui reste dans un effet : uniquement l'appel impératif à Animated, un système externe.
  useEffect(() => {
    if (visible) return;
    translateY.setValue(0);
  }, [translateY, visible]);

  useEffect(() => {
    if (!visible || !profilePhone) return;
    let active = true;
    void loadRecentPlaces(profilePhone).then((places) => { if (active) setRecentPlaces(places); });
    return () => { active = false; };
  }, [profilePhone, visible]);

  /** Nombre de suggestions obtenues, ou `null` si la recherche n'a pas abouti (requête vide,
   *  réponse périmée, erreur réseau) — c'est ce qui décide d'élargir ou non, plus bas. */
  const runSearch = useCallback(async (raw: string, includeCommunityFallback = false): Promise<number | null> => {
    const clean = autocompleteQuery(raw);
    if (!clean) { setResults([]); return null; }
    const requestId = ++latestSearch.current;
    try {
      setMessage("");
      const preferredBias = bias ?? (valueRef.current ? { latitude: valueRef.current.latitude, longitude: valueRef.current.longitude } : null);
      const places = await searchMutationRef.current({ query: clean, ...(countryCode ? { countryCode } : {}), ...(preferredBias ? { biasLatitude: preferredBias.latitude, biasLongitude: preferredBias.longitude } : {}), ...(includeCommunityFallback ? { includeCommunityFallback: true } : {}) });
      if (requestId !== latestSearch.current) return null;
      setResults((current) => haveSameSuggestionIds(current, places) ? current : places);
      // Annoncé seulement une fois l'élargissement tenté : le dire dès la recherche ordinaire
      // faisait clignoter « aucune adresse » juste avant que le repli en trouve.
      if (!places.length && includeCommunityFallback) setMessage("Aucune adresse trouvée. Essayez une formulation plus précise ou ouvrez la carte.");
      return places.length;
    } catch (cause) {
      if (requestId === latestSearch.current) setMessage(cause instanceof Error ? cause.message : "La recherche est momentanément indisponible.");
      return null;
    }
  }, [bias, countryCode]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- `setResults` retourne la même référence si déjà vide (updater ci-dessus) : React ignore alors ce rendu, aucune cascade réelle. Nécessaire ici pour invalider en même temps toute recherche en vol via `latestSearch`, une écriture de ref qui doit elle aussi rester hors du rendu.
    if (!hasQuery) { latestSearch.current += 1; setResults((current) => current.length ? [] : current); return; }
    let active = true;
    const suggestionTimer = setTimeout(() => {
      void (async () => {
        const found = await runSearch(query);
        // L'élargissement partait avant sur son propre minuteur, systématiquement et en parallèle :
        // chaque requête saisie coûtait trois appels Mapbox facturés (le suggest ordinaire, puis le
        // suggest + le forward de l'élargissement) là où un seul suffit quand la recherche ordinaire
        // répond. Il ne part plus que lorsqu'elle ne répond pas, et l'utilisateur garde la touche
        // « Rechercher » du clavier pour le déclencher lui-même.
        if (!active || found === null || found >= EXPANDED_SEARCH_FROM_BELOW) return;
        await runSearch(query, true);
      })();
    }, PLACE_AUTOCOMPLETE_DEBOUNCE_MS);
    return () => { active = false; clearTimeout(suggestionTimer); };
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
  function clearSearch() { latestSearch.current += 1; setQuery(""); setResults([]); setMessage(""); setShowAddresses(false); }
  function iconFor(place: PlaceSuggestion) { if (place.featureType === "poi") return "storefront"; if (place.featureType === "address" || place.featureType === "secondary_address") return "home-work"; if (place.featureType === "street") return "add-road"; if (place.featureType === "neighborhood") return "location-city"; return "place"; }

  return <><Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
    <View style={styles.overlay}><Pressable style={styles.backdrop} onPress={onClose} /><Animated.View style={[styles.sheet, { backgroundColor: theme.surface, transform: [{ translateY }] }]}>
      <View style={styles.dragZone} {...panResponder.panHandlers}><View style={styles.handle} /></View>
      <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <SafeAreaView style={styles.safe} edges={["top"]}>
          <View style={[styles.searchBox, { backgroundColor: theme.input, borderColor: theme.border }]}><MaterialIcons name="search" size={27} color={theme.primary} /><TextInput value={query} onChangeText={(text) => { setQuery(sanitizePlaceText(text, 120, { preserveTrailingSpace: true })); setMessage(""); setShowAddresses(false); }} placeholder={target === "pickup" ? "Point de récupération" : target === "dropoff" ? "Destination" : "Rechercher une adresse"} placeholderTextColor={theme.muted} style={[styles.input, { color: theme.primary }]} autoFocus autoCorrect={false} maxLength={120} returnKeyType="search" onSubmitEditing={() => void runSearch(query, true)} />{query ? <Pressable accessibilityRole="button" accessibilityLabel="Effacer la recherche" accessibilityHint="Réaffiche la position actuelle, les adresses enregistrées et les adresses récentes" onPress={clearSearch} hitSlop={6} style={({ pressed }) => [styles.clear, { backgroundColor: theme.pressed }, pressed && styles.pressed]}><MaterialIcons name="close" size={20} color={theme.primary} /></Pressable> : null}<View style={styles.searchDivider} /><Pressable accessibilityRole="button" accessibilityLabel="Choisir sur la carte" onPress={() => { Keyboard.dismiss(); setMapVisible(true); }} style={({ pressed }) => [styles.mapTextButton, pressed && styles.pressed]}><Text style={[styles.mapText, { color: theme.primary }]}>Carte</Text></Pressable></View>
          {!hasQuery && !showAddresses ? <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.quickActions}><Pressable accessibilityRole="button" onPress={() => void selectCurrentLocation()} disabled={selecting || gpsStatus === "loading"} style={({ pressed }) => [styles.quickAction, (pressed || selecting || gpsStatus === "loading") && styles.pressed]}><View style={styles.quickIcon}><MaterialIcons name="near-me" size={25} color={theme.foreground} /></View><View style={styles.quickCopy}><Text style={styles.quickTitle}>Utiliser ma position actuelle</Text><Text style={styles.quickSubtitle}>{gpsStatus === "loading" || selecting ? "Identification en cours…" : "Adresse récupérée à partir de votre position GPS"}</Text></View>{gpsStatus === "loading" || selecting ? <ActivityIndicator color={theme.primary} /> : null}</Pressable><Pressable accessibilityRole="button" onPress={() => setShowAddresses(true)} style={({ pressed }) => [styles.quickAction, pressed && styles.pressed]}><View style={styles.savedIcon}><MaterialIcons name="bookmark" size={24} color={theme.primary} /></View><View style={styles.quickCopy}><Text style={styles.quickTitle}>Mes adresses</Text><Text style={styles.quickSubtitle}>Choisissez une adresse enregistrée</Text></View><MaterialIcons name="chevron-right" size={28} color={theme.muted} /></Pressable>{recentPlaces.length ? <View style={styles.recentBlock}><Text style={styles.recentHeading}>ADRESSES RÉCENTES</Text>{recentPlaces.map((place) => <Pressable key={`${place.latitude}:${place.longitude}`} accessibilityRole="button" onPress={() => commitSelection(place)} style={({ pressed }) => [styles.recentRow, pressed && styles.pressed]}><View style={styles.recentIcon}><MaterialIcons name="history" size={18} color={theme.primary} /></View><View style={styles.quickCopy}><Text style={styles.recentTitle} numberOfLines={1}>{locationTitle(place)}</Text><Text style={styles.recentMeta} numberOfLines={1}>{locationSubtitle(place)}</Text></View><MaterialIcons name="chevron-right" size={22} color={theme.muted} /></Pressable>)}</View> : null}</ScrollView> : null}
          {!hasQuery && showAddresses ? <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.resultsContent}><Pressable accessibilityRole="button" onPress={() => setShowAddresses(false)} style={({ pressed }) => [styles.addressBack, pressed && styles.pressed]}><MaterialIcons name="arrow-back" size={20} color={theme.primary} /><Text style={styles.addressBackText}>Retour</Text></Pressable><Text style={styles.addressesTitle}>Mes adresses</Text>{favorites.length ? favorites.map((favorite) => <Pressable key={favorite.id} accessibilityRole="button" onPress={() => selectSavedAddress(favorite.location)} style={({ pressed }) => [styles.savedRow, pressed && styles.pressed]}><View style={styles.savedRowIcon}><MaterialIcons name="bookmark" size={19} color={theme.warning} /></View><View style={styles.savedRowCopy}><Text style={styles.savedRowTitle} numberOfLines={1}>{favorite.label}</Text><Text style={styles.savedRowMeta} numberOfLines={2}>{locationTitle(favorite.location)} · {locationSubtitle(favorite.location)}</Text></View><MaterialIcons name="chevron-right" size={20} color={theme.muted} /></Pressable>) : <View style={styles.empty}><MaterialIcons name="bookmark-border" size={34} color={theme.muted} /><Text style={styles.emptyTitle}>Aucune adresse enregistrée</Text><Text style={styles.emptyText}>Vous pourrez enregistrer une adresse depuis la carte après l’avoir positionnée.</Text></View>}</ScrollView> : null}
          {hasQuery ? <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.resultsContent}>{search.isPending ? <View style={styles.loadingResults}><ActivityIndicator color={theme.primary} /><Text style={styles.loadingText}>Recherche des adresses…</Text></View> : null}{results.map((place) => <Pressable key={place.id} accessibilityRole="button" onPress={() => void selectSuggestion(place)} disabled={selecting} style={({ pressed }) => [styles.result, (pressed || selecting) && styles.pressed]}><View style={styles.resultIcon}><MaterialIcons name={iconFor(place)} size={23} color={theme.muted} /></View><View style={styles.resultCopy}><Text style={styles.resultName} numberOfLines={1}>{locationTitle(place)}</Text><Text style={styles.resultMeta} numberOfLines={2}>{locationSubtitle(place)}{place.provider === "openstreetmap" ? " · OpenStreetMap" : ""}</Text></View>{selecting ? <ActivityIndicator color={theme.primary} /> : <MaterialIcons name="chevron-right" size={22} color={theme.muted} />}</Pressable>)}{message ? <Text style={styles.message}>{message}</Text> : null}{results.some((place) => place.provider === "openstreetmap") ? <Text style={styles.attribution}>Données © OpenStreetMap contributors</Text> : null}</ScrollView> : null}
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Animated.View></View>
  </Modal>
  <AddressMapPicker visible={mapVisible} targetTitle={title} initialPlace={value} countryCode={countryCode} onClose={() => setMapVisible(false)} onUse={(place) => { setMapVisible(false); commitSelection(place); }} onFavorite={onFavorite} />
  </>;
}

const stylesFor = createStyles((theme: ThemedColors) => ({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.42)" }, backdrop: { ...StyleSheet.absoluteFill }, sheet: { height: "88%", backgroundColor: theme.surface, borderTopLeftRadius: 12, borderTopRightRadius: 12, overflow: "hidden" }, dragZone: { height: 32, alignItems: "center", justifyContent: "center" }, handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: theme.border }, keyboard: { flex: 1 }, safe: { flex: 1 }, searchBox: { minHeight: 56, flexDirection: "row", alignItems: "center", marginHorizontal: 14, backgroundColor: theme.surface, borderRadius: 9, borderWidth: 1, borderColor: theme.border, paddingLeft: 12, paddingRight: 6 }, input: { flex: 1, minHeight: 54, color: theme.foreground, fontSize: 16, paddingLeft: 10, fontWeight: "500" }, clear: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: theme.background, marginHorizontal: 4 }, searchDivider: { width: 1, height: 28, backgroundColor: theme.border, marginLeft: 1 }, mapTextButton: { minHeight: 44, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" }, mapText: { color: theme.primary, fontWeight: "600", fontSize: 14 }, quickActions: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 24 }, recentBlock: { marginTop: 14, paddingTop: 2 }, recentHeading: { color: theme.muted, fontSize: 10, fontWeight: "600", letterSpacing: 0.7, marginBottom: 6 }, recentRow: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 9, borderBottomColor: theme.divider, borderBottomWidth: 1 }, recentIcon: { width: 30, height: 30, borderRadius: 7, alignItems: "center", justifyContent: "center", backgroundColor: theme.background }, recentTitle: { color: theme.foreground, fontSize: 13, fontWeight: "600" }, recentMeta: { color: theme.muted, fontSize: 11, marginTop: 2 }, quickAction: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 12, borderBottomColor: theme.divider, borderBottomWidth: 1 }, quickIcon: { width: 36, alignItems: "center" }, savedIcon: { width: 36, alignItems: "center" }, quickCopy: { flex: 1 }, quickTitle: { color: theme.foreground, fontSize: 15, fontWeight: "600" }, quickSubtitle: { color: theme.muted, fontSize: 12, lineHeight: 17, marginTop: 2 }, resultsContent: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 30 }, loadingResults: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12 }, loadingText: { color: theme.muted, fontSize: 12, fontWeight: "500" }, result: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: 10, borderBottomColor: theme.divider, borderBottomWidth: 1 }, resultIcon: { width: 36, height: 36, borderRadius: 8, backgroundColor: theme.background, alignItems: "center", justifyContent: "center" }, resultCopy: { flex: 1, minWidth: 0 }, resultName: { color: theme.foreground, fontSize: 14, fontWeight: "600" }, resultMeta: { color: theme.muted, fontSize: 12, lineHeight: 16, marginTop: 2 }, message: { color: theme.primary, fontSize: 12, lineHeight: 17, marginTop: 12 }, attribution: { color: theme.muted, fontSize: 10, marginTop: 9 }, addressBack: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 30, alignSelf: "flex-start", marginBottom: 7 }, addressBackText: { color: theme.primary, fontSize: 12, fontWeight: "600" }, addressesTitle: { color: theme.foreground, fontSize: 20, fontWeight: "600", marginBottom: 8 }, savedRow: { flexDirection: "row", alignItems: "center", minHeight: 60, gap: 10, borderBottomColor: theme.divider, borderBottomWidth: 1 }, savedRowIcon: { width: 34, height: 34, borderRadius: 8, backgroundColor: theme.background, alignItems: "center", justifyContent: "center" }, savedRowCopy: { flex: 1 }, savedRowTitle: { color: theme.foreground, fontSize: 14, fontWeight: "600" }, savedRowMeta: { color: theme.muted, fontSize: 11, lineHeight: 15, marginTop: 2 }, empty: { alignItems: "center", paddingHorizontal: 28, paddingTop: 36 }, emptyTitle: { color: theme.foreground, fontSize: 15, fontWeight: "600", marginTop: 9 }, emptyText: { color: theme.muted, textAlign: "center", fontSize: 12, lineHeight: 17, marginTop: 5 }, pressed: { opacity: 0.67 },
}));
