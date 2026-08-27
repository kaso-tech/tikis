import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import MapView from "react-native-maps";
import { TikisButton } from "@/components/tikis/ui";
import { SaveAddressDialog } from "@/components/tikis/save-address-dialog";
import { formatDeliveryDetailPlace } from "@/lib/geo-rules";
import { useSearchLocationBias } from "@/hooks/use-search-location-bias";
import { trpc } from "@/lib/trpc";
import type { LocationLabel } from "@/shared/tikis-domain";

type Coordinate = { latitude: number; longitude: number };
const FALLBACK_REGION = { latitude: 12.3714, longitude: -1.5197, latitudeDelta: 0.09, longitudeDelta: 0.09 };

export function AddressMapPicker({ visible, targetTitle, initialPlace, onClose, onUse, onFavorite }: { visible: boolean; targetTitle: string; initialPlace: LocationLabel | null; countryCode?: string; onClose: () => void; onUse: (place: LocationLabel) => void; onFavorite: (place: LocationLabel, label: string) => Promise<void> }) {
  const mapRef = useRef<MapView>(null);
  const reverseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initializedForOpening = useRef(false);
  const [place, setPlace] = useState<LocationLabel | null>(initialPlace);
  const [isMoving, setIsMoving] = useState(false);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveDialogVisible, setSaveDialogVisible] = useState(false);
  const reverse = trpc.geography.reverse.useMutation();
  const { status: gpsStatus, requestBias } = useSearchLocationBias();

  const resolveCenter = useCallback(async (coordinate: Coordinate) => {
    try {
      setMessage("Identification de l’adresse…");
      const result = await reverse.mutateAsync(coordinate);
      setPlace(result ?? null);
      setMessage(result ? "" : "Adresse introuvable. Ajustez légèrement le marqueur.");
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Le géocodage inverse est momentanément indisponible."); }
  }, [reverse]);

  const moveToPosition = useCallback(async () => {
    const position = await requestBias();
    if (!position) {
      if (initialPlace) {
        const fallback = { latitude: initialPlace.latitude, longitude: initialPlace.longitude };
        mapRef.current?.animateToRegion({ ...fallback, latitudeDelta: 0.02, longitudeDelta: 0.02 }, 350);
        void resolveCenter(fallback);
      }
      setMessage("Position indisponible ou non autorisée. Déplacez la carte pour choisir un point.");
      return;
    }
    const next = { latitude: position.latitude, longitude: position.longitude };
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
    if (reverseTimer.current) clearTimeout(reverseTimer.current);
    reverseTimer.current = setTimeout(() => { void resolveCenter({ latitude: region.latitude, longitude: region.longitude }); }, 240);
  }
  async function saveFavorite(label: string) { if (!place || saving) return; setSaving(true); try { await onFavorite(place, label); setMessage("Adresse enregistrée dans Mes adresses."); } finally { setSaving(false); } }
  const presentation = place ? formatDeliveryDetailPlace(place) : null;

  return <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent><View style={styles.screen}>
    <MapView ref={mapRef} style={styles.map} initialRegion={FALLBACK_REGION} onRegionChange={handleRegionChange} onRegionChangeComplete={handleRegionChangeComplete} showsUserLocation showsMyLocationButton={false} toolbarEnabled={false} rotateEnabled={false} />
    <View pointerEvents="none" style={styles.centerMarker}><View style={styles.markerBubble}><MaterialIcons name="location-on" size={34} color="#FFFFFF" /></View><View style={styles.markerStem} /><View style={styles.markerShadow} /></View>
    {!isMoving ? <SafeAreaView style={styles.controls} edges={["top", "bottom"]}><Text style={styles.instruction}>Déplacez la carte pour choisir l’adresse</Text><View style={styles.floatingControls}><Pressable accessibilityRole="button" accessibilityLabel="Retour à la recherche" onPress={onClose} style={({ pressed }) => [styles.roundButton, pressed && styles.pressed]}><MaterialIcons name="arrow-back" size={25} color="#17212B" /></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Utiliser ma position actuelle" onPress={() => void moveToPosition()} disabled={gpsStatus === "loading" || reverse.isPending} style={({ pressed }) => [styles.roundButton, (pressed || gpsStatus === "loading" || reverse.isPending) && styles.pressed]}>{gpsStatus === "loading" ? <ActivityIndicator color="#17212B" /> : <MaterialIcons name="my-location" size={24} color="#17212B" />}</Pressable></View>
      <View style={styles.bottomSheet}><View style={styles.sheetHandle} /><Text style={styles.sheetEyebrow}>{targetTitle.toUpperCase()}</Text>{reverse.isPending ? <View style={styles.resolving}><ActivityIndicator size="small" color="#007B8B" /><Text style={styles.resolvingText}>Identification de l’adresse…</Text></View> : presentation ? <><Text style={styles.placeTitle} numberOfLines={1}>{presentation.title}</Text><Text style={styles.placeMeta} numberOfLines={2}>{presentation.subtitle}</Text></> : <Text style={styles.placePlaceholder}>Placez le marqueur sur une adresse précise.</Text>}{message ? <Text style={styles.message}>{message}</Text> : null}<View style={styles.sheetActions}><TikisButton label="Utiliser" icon="check" onPress={() => place && onUse(place)} disabled={!place || reverse.isPending} style={styles.useButton} /><Pressable accessibilityRole="button" accessibilityLabel="Ajouter aux adresses enregistrées" onPress={() => setSaveDialogVisible(true)} disabled={!place || saving} style={({ pressed }) => [styles.favoriteButton, (!place || saving || pressed) && styles.pressed]}>{saving ? <ActivityIndicator size="small" color="#A86600" /> : <MaterialIcons name="bookmark-border" size={25} color="#A86600" />}</Pressable></View></View>
    </SafeAreaView> : null}
    <SaveAddressDialog visible={saveDialogVisible} place={place} onClose={() => setSaveDialogVisible(false)} onSave={saveFavorite} />
  </View></Modal>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#DDE6E2" }, map: { ...StyleSheet.absoluteFillObject }, centerMarker: { position: "absolute", top: "48%", alignSelf: "center", alignItems: "center", marginTop: -37 }, markerBubble: { width: 57, height: 57, borderRadius: 20, backgroundColor: "#007B8B", alignItems: "center", justifyContent: "center", borderWidth: 4, borderColor: "#FFFFFF", shadowColor: "#0B1F3A", shadowOpacity: 0.22, shadowRadius: 10, elevation: 8 }, markerStem: { width: 3, height: 22, backgroundColor: "#007B8B" }, markerShadow: { width: 19, height: 7, borderRadius: 10, backgroundColor: "rgba(11,31,58,0.24)" }, controls: { flex: 1, paddingTop: 16 }, instruction: { alignSelf: "center", color: "#17212B", fontSize: 15, fontWeight: "900", paddingHorizontal: 16, paddingVertical: 9, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.92)", overflow: "hidden" }, floatingControls: { position: "absolute", left: 18, right: 18, bottom: 190, flexDirection: "row", justifyContent: "space-between" }, roundButton: { width: 54, height: 54, borderRadius: 27, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", shadowColor: "#0B1F3A", shadowOpacity: 0.16, shadowRadius: 9, elevation: 5 }, bottomSheet: { marginTop: "auto", backgroundColor: "#FFFFFF", borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 19, paddingTop: 10, shadowColor: "#0B1F3A", shadowOpacity: 0.15, shadowRadius: 15, elevation: 8 }, sheetHandle: { width: 40, height: 4, borderRadius: 3, backgroundColor: "#D5DDE6", alignSelf: "center", marginBottom: 14 }, sheetEyebrow: { color: "#007B8B", fontSize: 10, letterSpacing: 0.8, fontWeight: "900" }, placeTitle: { color: "#101923", fontSize: 18, fontWeight: "900", marginTop: 6 }, placeMeta: { color: "#6F7B89", fontSize: 12, lineHeight: 17, marginTop: 4 }, placePlaceholder: { color: "#6F7B89", fontSize: 14, marginTop: 8 }, resolving: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 9 }, resolvingText: { color: "#657180", fontSize: 13, fontWeight: "800" }, message: { color: "#A55A00", fontSize: 11, lineHeight: 16, marginTop: 8 }, sheetActions: { flexDirection: "row", gap: 10, marginTop: 17 }, useButton: { flex: 1, minHeight: 51, borderRadius: 15 }, favoriteButton: { width: 52, minHeight: 51, borderRadius: 15, backgroundColor: "#FFF4D8", alignItems: "center", justifyContent: "center" }, pressed: { opacity: 0.62 },
});
