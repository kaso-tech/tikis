import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import Constants from "expo-constants";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import MapView from "react-native-maps";
import { TikisButton } from "@/components/tikis/ui";
import { SaveAddressDialog } from "@/components/tikis/save-address-dialog";
import { formatDeliveryDetailPlace } from "@/lib/geo-rules";
import { useThemeColors } from "@/lib/use-theme-colors";
import { useSearchLocationBias } from "@/hooks/use-search-location-bias";
import { trpc } from "@/lib/trpc";
import type { LocationLabel } from "@/shared/tikis-domain";

type Coordinate = { latitude: number; longitude: number };
const FALLBACK_REGION = { latitude: 12.3714, longitude: -1.5197, latitudeDelta: 0.09, longitudeDelta: 0.09 };
// En dessous de ce seuil, un nouveau glissement de carte ne redéclenche pas de géocodage inverse : la
// précision GPS/écran est de toute façon bien supérieure à 15 m, donc deux relâchements proches du même
// point n'apportent aucune information nouvelle — juste un appel Mapbox/OSM et une écriture DB en plus.
const MIN_REVERSE_DISTANCE_METERS = 15;

// react-native-maps ne fonctionne pas dans Expo Go depuis SDK 50+ : le module natif Google Maps n'est
// pas inclus. On détecte ce cas pour afficher un placeholder visuel et garder le mode "déplacer le point
//" via des boutons +/- plutôt que par pan de carte. En development build ou production, la carte
// native s'affiche normalement.
function isRunningInExpoGo(): boolean {
  return Constants.executionEnvironment === "storeClient" || Constants.appOwnership === "expo";
}

function distanceMeters(a: Coordinate, b: Coordinate): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadiusMeters = 6_371_000;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(h));
}

export function AddressMapPicker({ visible, targetTitle, initialPlace, onClose, onUse, onFavorite }: { visible: boolean; targetTitle: string; initialPlace: LocationLabel | null; countryCode?: string; onClose: () => void; onUse: (place: LocationLabel) => void; onFavorite: (place: LocationLabel, label: string) => Promise<void> }) {
  const mapRef = useRef<MapView>(null);
  const reverseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastResolvedRef = useRef<Coordinate | null>(null);
  const initializedForOpening = useRef(false);
  const [place, setPlace] = useState<LocationLabel | null>(initialPlace);
  const [isMoving, setIsMoving] = useState(false);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveDialogVisible, setSaveDialogVisible] = useState(false);
  const [expoGoFallbackCoord, setExpoGoFallbackCoord] = useState<Coordinate | null>(null);
  const reverse = trpc.geography.reverse.useMutation();
  const { colors } = useThemeColors();
  const { status: gpsStatus, requestBias } = useSearchLocationBias();
  const expoGoMode = isRunningInExpoGo();

  const resolveCenter = useCallback(async (coordinate: Coordinate) => {
    try {
      setMessage("Identification de l’adresse…");
      const result = await reverse.mutateAsync(coordinate);
      // Marqué "résolu" seulement en cas de succès : si on l'enregistrait avant l'appel, un échec réseau
      // laissait `lastResolvedRef` bloqué sur ce point pour le reste de la session de la modale — un
      // nudge du marqueur à moins de 15 m ne redéclenchait alors plus jamais de nouvelle tentative.
      lastResolvedRef.current = coordinate;
      setPlace(result ? { ...result, latitude: coordinate.latitude, longitude: coordinate.longitude, source: "reverse", precision: "exact" } : null);
      setMessage(result ? "" : "Adresse introuvable. Ajustez légèrement le marqueur.");
    } catch (cause) {
      lastResolvedRef.current = null;
      setMessage(cause instanceof Error ? cause.message : "Le géocodage inverse est momentanément indisponible.");
    }
  }, [reverse]);

  const moveToPosition = useCallback(async () => {
    const position = await requestBias();
    if (!position) {
      if (initialPlace) {
        const fallback = { latitude: initialPlace.latitude, longitude: initialPlace.longitude };
        setExpoGoFallbackCoord(fallback);
        mapRef.current?.animateToRegion({ ...fallback, latitudeDelta: 0.02, longitudeDelta: 0.02 }, 350);
        void resolveCenter(fallback);
      }
      setMessage("Position indisponible ou non autorisée. Déplacez la carte pour choisir un point.");
      return;
    }
    const next = { latitude: position.latitude, longitude: position.longitude };
    setExpoGoFallbackCoord(next);
    mapRef.current?.animateToRegion({ ...next, latitudeDelta: 0.02, longitudeDelta: 0.02 }, 350);
    void resolveCenter(next);
  }, [initialPlace, requestBias, resolveCenter]);

  useEffect(() => {
    if (!visible) { initializedForOpening.current = false; if (reverseTimer.current) clearTimeout(reverseTimer.current); return; }
    if (initializedForOpening.current) return;
    initializedForOpening.current = true;
    setPlace(initialPlace);
    void moveToPosition();
  }, [initialPlace, moveToPosition, visible]);

  function handleRegionChange() { setIsMoving((current) => current || true); }
  function handleRegionChangeComplete(region: Coordinate) {
    setIsMoving(false);
    setExpoGoFallbackCoord({ latitude: region.latitude, longitude: region.longitude });
    if (reverseTimer.current) clearTimeout(reverseTimer.current);
    if (lastResolvedRef.current && distanceMeters(lastResolvedRef.current, region) < MIN_REVERSE_DISTANCE_METERS) return;
    reverseTimer.current = setTimeout(() => { void resolveCenter({ latitude: region.latitude, longitude: region.longitude }); }, 240);
  }

  // Mode Expo Go : pas de MapView natif, on simule le déplacement via des boutons +/- autour d'un point.
  // Le pas est ~50 m pour un déplacement humain "à pied" dans la rue.
  function expoGoShift(direction: "north" | "south" | "east" | "west") {
    const base = expoGoFallbackCoord ?? (initialPlace ? { latitude: initialPlace.latitude, longitude: initialPlace.longitude } : FALLBACK_REGION);
    const delta = 0.0005; // ~50 m à l'équateur
    let next: Coordinate = base;
    if (direction === "north") next = { latitude: base.latitude + delta, longitude: base.longitude };
    if (direction === "south") next = { latitude: base.latitude - delta, longitude: base.longitude };
    if (direction === "east") next = { latitude: base.latitude, longitude: base.longitude + delta };
    if (direction === "west") next = { latitude: base.latitude, longitude: base.longitude - delta };
    setExpoGoFallbackCoord(next);
    setIsMoving(true);
    setTimeout(() => {
      setIsMoving(false);
      if (reverseTimer.current) clearTimeout(reverseTimer.current);
      if (lastResolvedRef.current && distanceMeters(lastResolvedRef.current, next) < MIN_REVERSE_DISTANCE_METERS) return;
      reverseTimer.current = setTimeout(() => { void resolveCenter(next); }, 240);
    }, 200);
  }
  async function saveFavorite(label: string) { if (!place || saving) return; setSaving(true); try { await onFavorite(place, label); setMessage("Adresse enregistrée dans Mes adresses."); } finally { setSaving(false); } }
  const presentation = place ? formatDeliveryDetailPlace(place) : null;

  return <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent><View style={styles.screen}>
    {expoGoMode ? (
      <View style={styles.expoGoFallback}>
        <MaterialIcons name="map" size={48} color={colors.primary} />
        <Text style={styles.expoGoTitle}>Carte indisponible dans Expo Go</Text>
        <Text style={styles.expoGoSubtitle}>
          {expoGoFallbackCoord ? `${expoGoFallbackCoord.latitude.toFixed(5)}, ${expoGoFallbackCoord.longitude.toFixed(5)}` : "Ajustez le point avec les flèches"}
        </Text>
        <View style={styles.expoGoControls}>
          <Pressable accessibilityRole="button" accessibilityLabel="Déplacer le point vers le nord" onPress={() => expoGoShift("north")} style={({ pressed }) => [styles.arrowButton, pressed && styles.pressed]}><MaterialIcons name="arrow-upward" size={22} color="#111111" /></Pressable>
          <View style={styles.expoGoControlsRow}>
            <Pressable accessibilityRole="button" accessibilityLabel="Déplacer le point vers l'ouest" onPress={() => expoGoShift("west")} style={({ pressed }) => [styles.arrowButton, pressed && styles.pressed]}><MaterialIcons name="arrow-back" size={22} color="#111111" /></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Déplacer le point vers l'est" onPress={() => expoGoShift("east")} style={({ pressed }) => [styles.arrowButton, pressed && styles.pressed]}><MaterialIcons name="arrow-forward" size={22} color="#111111" /></Pressable>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Déplacer le point vers le sud" onPress={() => expoGoShift("south")} style={({ pressed }) => [styles.arrowButton, pressed && styles.pressed]}><MaterialIcons name="arrow-downward" size={22} color="#111111" /></Pressable>
        </View>
      </View>
    ) : (
      <>
        <MapView ref={mapRef} style={styles.map} initialRegion={FALLBACK_REGION} onRegionChange={handleRegionChange} onRegionChangeComplete={handleRegionChangeComplete} showsUserLocation showsMyLocationButton={false} toolbarEnabled={false} scrollEnabled zoomEnabled pitchEnabled={false} rotateEnabled={false} />
        <View pointerEvents="none" style={styles.centerMarker}>
          <View style={styles.markerCircle}><MaterialIcons name="location-on" size={20} color="#FFFFFF" /></View>
          <View style={styles.markerTriangle} />
          <View style={styles.markerShadow} />
        </View>
      </>
    )}
    {!isMoving ? <SafeAreaView pointerEvents="box-none" style={styles.controls} edges={["top", "bottom"]}><Text style={styles.instruction}>{expoGoMode ? "Ajustez le point avec les flèches" : "Déplacez la carte pour choisir l’adresse"}</Text><View style={styles.floatingControls}><Pressable accessibilityRole="button" accessibilityLabel="Retour à la recherche" onPress={onClose} style={({ pressed }) => [styles.roundButton, pressed && styles.pressed]}><MaterialIcons name="arrow-back" size={25} color="#17212B" /></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Utiliser ma position actuelle" onPress={() => void moveToPosition()} disabled={gpsStatus === "loading" || reverse.isPending} style={({ pressed }) => [styles.roundButton, (pressed || gpsStatus === "loading" || reverse.isPending) && styles.pressed]}>{gpsStatus === "loading" ? <ActivityIndicator color="#17212B" /> : <MaterialIcons name="my-location" size={24} color="#17212B" />}</Pressable></View>
      <View style={styles.bottomSheet}><View style={styles.sheetHandle} /><Text style={styles.sheetEyebrow}>{targetTitle.toUpperCase()}</Text>{reverse.isPending ? <View style={styles.resolving}><ActivityIndicator size="small" color="#667085" /><Text style={styles.resolvingText}>Identification de l’adresse…</Text></View> : presentation ? <><Text style={styles.placeTitle} numberOfLines={1}>{presentation.title}</Text><Text style={styles.placeMeta} numberOfLines={2}>{presentation.subtitle}</Text></> : <Text style={styles.placePlaceholder}>Placez le marqueur sur une adresse précise.</Text>}{message ? <Text style={styles.message}>{message}</Text> : null}<View style={styles.sheetActions}><TikisButton label="Utiliser" icon="check" onPress={() => place && onUse(place)} disabled={!place || reverse.isPending} style={styles.useButton} /><Pressable accessibilityRole="button" accessibilityLabel="Ajouter aux adresses enregistrées" onPress={() => setSaveDialogVisible(true)} disabled={!place || saving} style={({ pressed }) => [styles.favoriteButton, (!place || saving || pressed) && styles.pressed]}>{saving ? <ActivityIndicator size="small" color="#667085" /> : <MaterialIcons name="bookmark-border" size={25} color="#667085" />}</Pressable></View></View>
    </SafeAreaView> : null}
    <SaveAddressDialog visible={saveDialogVisible} place={place} onClose={() => setSaveDialogVisible(false)} onSave={saveFavorite} />
  </View></Modal>;
}

const baseStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F0F3F8" }, map: { ...StyleSheet.absoluteFill },
  centerMarker: { position: "absolute", top: "48%", alignSelf: "center", alignItems: "center", width: 40, height: 52, marginTop: -52 },
  markerShadow: { position: "absolute", bottom: -2, width: 18, height: 5, borderRadius: 9, backgroundColor: "rgba(0,0,0,0.30)" },
  markerCircle: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#9A6201", alignItems: "center", justifyContent: "center", borderWidth: 2.5, borderColor: "#FFFFFF", shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
  markerTriangle: { width: 0, height: 0, borderLeftWidth: 7, borderRightWidth: 7, borderTopWidth: 9, borderLeftColor: "transparent", borderRightColor: "transparent", borderTopColor: "#9A6201", marginTop: -2 }, controls: { flex: 1, paddingTop: 12 }, instruction: { alignSelf: "center", color: "#111111", fontSize: 14, fontWeight: "600", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.92)", overflow: "hidden" }, floatingControls: { position: "absolute", left: 14, right: 14, bottom: 160, flexDirection: "row", justifyContent: "space-between" }, roundButton: { width: 48, height: 48, borderRadius: 9, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", shadowOpacity: 0, shadowRadius: 0, elevation: 0 }, bottomSheet: { marginTop: "auto", backgroundColor: "#FFFFFF", borderTopLeftRadius: 12, borderTopRightRadius: 12, padding: 14, paddingTop: 8, shadowOpacity: 0, shadowRadius: 0, elevation: 0 }, sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#CFCFCF", alignSelf: "center", marginBottom: 10 }, sheetEyebrow: { color: "#667085", fontSize: 10, letterSpacing: 0.7, fontWeight: "600" }, placeTitle: { color: "#111111", fontSize: 16, fontWeight: "600", marginTop: 4 }, placeMeta: { color: "#667085", fontSize: 12, lineHeight: 16, marginTop: 2 }, placePlaceholder: { color: "#667085", fontSize: 13, marginTop: 6 }, resolving: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: 8 }, resolvingText: { color: "#667085", fontSize: 12, fontWeight: "500" }, message: { color: "#667085", fontSize: 11, lineHeight: 16, marginTop: 6 }, sheetActions: { flexDirection: "row", gap: 7, marginTop: 12 }, useButton: { flex: 1, minHeight: 44, borderRadius: 8 }, favoriteButton: { width: 48, minHeight: 44, borderRadius: 8, backgroundColor: "#F0F3F8", alignItems: "center", justifyContent: "center" }, pressed: { opacity: 0.65 },
  expoGoFallback: { flex: 1, backgroundColor: "#F5F0E5", alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  expoGoTitle: { color: "#111111", fontSize: 18, fontWeight: "700", textAlign: "center" },
  expoGoSubtitle: { color: "#667085", fontSize: 13, textAlign: "center" },
  expoGoControls: { alignItems: "center", gap: 8, marginTop: 12 },
  expoGoControlsRow: { flexDirection: "row", gap: 16 },
  arrowButton: { width: 56, height: 56, borderRadius: 12, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#E3E3E3" },
});

const styles = baseStyles;
