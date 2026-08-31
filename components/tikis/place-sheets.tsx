import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { PlacePicker } from "@/components/tikis/place-picker";
import { SurfaceCard, TikisButton } from "@/components/tikis/ui";
import { formatDeliveryDetailPlace, formatNavigationTarget, locationSubtitle, locationTitle } from "@/lib/geo-rules";
import type { LocationLabel } from "@/shared/tikis-domain";

type LocationTarget = "pickup" | "dropoff";

export type SavedFavorite = {
  id: number | string;
  label: string;
  location: LocationLabel;
};

export function FloatingPlacePicker({
  visible,
  target,
  value,
  countryCode,
  onClose,
  onSelect,
}: {
  visible: boolean;
  target: LocationTarget | null;
  value: LocationLabel | null;
  countryCode?: string;
  onClose: () => void;
  onSelect: (place: LocationLabel) => void;
}) {
  const title = target === "pickup" ? "Choisir la récupération" : "Choisir la destination";
  const [pendingPlace, setPendingPlace] = useState<LocationLabel | null>(null);
  const [confirming, setConfirming] = useState(false);
  const formattedPendingPlace = pendingPlace ? formatDeliveryDetailPlace(pendingPlace) : null;
  const receivePendingPlace = useCallback((place: LocationLabel) => {
    setPendingPlace((current) => current?.mapboxId === place.mapboxId && current?.latitude === place.latitude && current?.longitude === place.longitude ? current : place);
  }, []);

  useEffect(() => {
    if (!visible) {
      setPendingPlace(null);
      setConfirming(false);
    }
  }, [visible]);

  function confirmPlace() {
    if (!pendingPlace || confirming) return;
    setConfirming(true);
    onSelect(pendingPlace);
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Fermer" onPress={onClose} style={({ pressed }) => [styles.close, pressed && styles.pressed]}>
            <MaterialIcons name="close" size={22} color="#111111" />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>LIEU DE LIVRAISON</Text>
            <Text style={styles.title}>{title}</Text>
          </View>
          <View style={styles.closeSpacer} />
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.subtitle}>Recherchez une adresse ou sélectionnez un point directement sur la carte, puis confirmez le lieu.</Text>
          {target ? (
            <PlacePicker
              label={target === "pickup" ? "Adresse de récupération" : "Adresse de destination"}
              tone={target}
              value={pendingPlace ?? value}
              countryCode={countryCode}
              onChange={receivePendingPlace}
            />
          ) : null}
          {pendingPlace && formattedPendingPlace ? <SurfaceCard style={styles.confirmationCard}>
            <View style={styles.confirmationHeading}><View style={styles.confirmationIcon}><MaterialIcons name="verified" size={18} color="#167A55" /></View><View style={styles.confirmationCopy}><Text style={styles.confirmationEyebrow}>LIEU SÉLECTIONNÉ</Text><Text style={styles.confirmationTitle}>{formattedPendingPlace.title}</Text></View></View>
            <Text style={styles.confirmationMeta}>{formattedPendingPlace.subtitle}</Text>
            <Text style={styles.confirmationAddress} numberOfLines={2}>{formatNavigationTarget(pendingPlace)}</Text>
            <View style={styles.confirmationFacts}><Text style={styles.confirmationFact}>{pendingPlace.precision === "exact" ? "Position précise" : pendingPlace.precision === "street" ? "Niveau rue" : pendingPlace.precision === "area" ? "Niveau quartier" : "Position GPS enregistrée"}</Text>{pendingPlace.country ? <Text style={styles.confirmationFact}>{pendingPlace.country}</Text> : null}</View>
            <View style={styles.confirmationActions}><TikisButton label="Modifier" variant="secondary" onPress={() => setPendingPlace(null)} disabled={confirming} style={styles.confirmationAction} /><TikisButton label="Confirmer ce lieu" icon="check" onPress={confirmPlace} loading={confirming} loadingLabel="Validation…" style={styles.confirmationAction} /></View>
          </SurfaceCard> : null}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

export function FavoritePlacesSheet({
  visible,
  favorites,
  onClose,
  onPickup,
  onDropoff,
  onRename,
  onRemove,
}: {
  visible: boolean;
  favorites: SavedFavorite[];
  onClose: () => void;
  onPickup: (place: LocationLabel) => void;
  onDropoff: (place: LocationLabel) => void;
  onRename: (favorite: SavedFavorite, label: string) => Promise<void>;
  onRemove: (favorite: SavedFavorite) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<SavedFavorite | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [removing, setRemoving] = useState<SavedFavorite | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState("");
  const cleanQuery = query.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr-FR").trim();
  const filteredFavorites = useMemo(() => favorites.filter((favorite) => {
    if (!cleanQuery) return true;
    const searchable = [favorite.label, favorite.location.name, favorite.location.district, favorite.location.city, favorite.location.formattedAddress].filter(Boolean).join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr-FR");
    return searchable.includes(cleanQuery);
  }), [favorites, cleanQuery]);

  async function saveRename() {
    if (!editing || !draftLabel.trim()) return;
    setSaving(true); setActionError("");
    try { await onRename(editing, draftLabel.trim()); setEditing(null); }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : "Impossible de renommer ce favori."); }
    finally { setSaving(false); }
  }

  async function confirmRemove() {
    if (!removing) return;
    setDeleting(true); setActionError("");
    try { await onRemove(removing); setRemoving(null); }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : "Impossible de supprimer ce favori."); }
    finally { setDeleting(false); }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Fermer les favoris" onPress={onClose} style={({ pressed }) => [styles.close, pressed && styles.pressed]}>
            <MaterialIcons name="close" size={22} color="#111111" />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>ADRESSES ENREGISTRÉES</Text>
            <Text style={styles.title}>Vos favoris</Text>
          </View>
          <View style={styles.closeSpacer} />
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.subtitle}>Retrouvez, renommez ou choisissez un lieu pour votre course.</Text>
          <View style={styles.searchBox}>
            <MaterialIcons name="search" size={19} color="#697386" />
            <TextInput value={query} onChangeText={(value) => setQuery(value.replace(/[^\p{L}\p{N} .,'’()\-]/gu, "").replace(/\s{2,}/g, " "))} placeholder="Rechercher un favori" placeholderTextColor="#B48753" style={styles.searchInput} maxLength={80} />
            {query ? <Pressable accessibilityRole="button" accessibilityLabel="Effacer la recherche" onPress={() => setQuery("")} style={({ pressed }) => [styles.clearSearch, pressed && styles.pressed]}><MaterialIcons name="close" size={16} color="#697386" /></Pressable> : null}
          </View>
          {actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}
          {filteredFavorites.length ? (
            filteredFavorites.map((favorite) => (
              <View key={favorite.id} style={styles.favoriteCard}>
                <View style={styles.favoriteTop}>
                  <View style={styles.favoriteIcon}>
                    <MaterialIcons name="star" size={18} color="#9A6200" />
                  </View>
                  <View style={styles.favoriteCopy}>
                    <Text style={styles.favoriteTitle} numberOfLines={1}>{favorite.label}</Text>
                    <Text style={styles.favoriteMeta} numberOfLines={2}>{locationTitle(favorite.location)} · {locationSubtitle(favorite.location)}</Text>
                  </View>
                </View>
                <View style={styles.favoriteActions}>
                  <TikisButton label="Récupération" variant="secondary" icon="trip-origin" onPress={() => { onPickup(favorite.location); onClose(); }} style={styles.favoriteAction} />
                  <TikisButton label="Destination" icon="location-on" onPress={() => { onDropoff(favorite.location); onClose(); }} style={styles.favoriteAction} />
                </View>
                <View style={styles.manageActions}>
                  <Pressable accessibilityRole="button" onPress={() => { setActionError(""); setDraftLabel(favorite.label); setEditing(favorite); }} style={({ pressed }) => [styles.manageButton, pressed && styles.pressed]}><MaterialIcons name="edit" size={16} color="#9A6201" /><Text style={styles.manageText}>Renommer</Text></Pressable>
                  <Pressable accessibilityRole="button" onPress={() => { setActionError(""); setRemoving(favorite); }} style={({ pressed }) => [styles.manageButton, styles.manageDelete, pressed && styles.pressed]}><MaterialIcons name="delete-outline" size={16} color="#B4232D" /><Text style={[styles.manageText, styles.deleteText]}>Supprimer</Text></Pressable>
                </View>
              </View>
            ))
          ) : (
            <View style={styles.empty}>
              <MaterialIcons name="star-outline" size={30} color="#9AA5B6" />
              <Text style={styles.emptyTitle}>{favorites.length ? "Aucun résultat" : "Aucun lieu favori"}</Text>
              <Text style={styles.emptyText}>{favorites.length ? "Essayez une autre recherche." : "Après avoir choisi une adresse, utilisez l’icône étoile dans la création de livraison pour l’enregistrer ici."}</Text>
            </View>
          )}
        </ScrollView>
        <Modal visible={Boolean(editing)} transparent animationType="fade" onRequestClose={() => !saving && setEditing(null)}>
          <View style={styles.dialogOverlay}><View style={styles.dialog}>
            <Text style={styles.dialogTitle}>Renommer ce favori</Text><Text style={styles.dialogText}>Utilisez un libellé clair, par exemple « Maison » ou « Bureau centre ».</Text>
            <TextInput value={draftLabel} onChangeText={(value) => setDraftLabel(value.replace(/[^\p{L}\p{N} .,'’()\-]/gu, "").replace(/\s{2,}/g, " "))} style={styles.renameInput} maxLength={80} autoFocus />
            <View style={styles.dialogActions}><TikisButton label="Annuler" variant="secondary" onPress={() => setEditing(null)} disabled={saving} style={styles.dialogAction} /><TikisButton label="Enregistrer" icon="check" onPress={() => void saveRename()} loading={saving} disabled={!draftLabel.trim()} style={styles.dialogAction} /></View>
          </View></View>
        </Modal>
        <Modal visible={Boolean(removing)} transparent animationType="fade" onRequestClose={() => !deleting && setRemoving(null)}>
          <View style={styles.dialogOverlay}><View style={styles.dialog}>
            <View style={styles.dangerIcon}><MaterialIcons name="delete-outline" size={24} color="#B4232D" /></View><Text style={styles.dialogTitle}>Supprimer ce favori ?</Text><Text style={styles.dialogText}>« {removing?.label} » sera retiré de vos favoris. Cette action est irréversible.</Text>
            <View style={styles.dialogActions}><TikisButton label="Conserver" variant="secondary" onPress={() => setRemoving(null)} disabled={deleting} style={styles.dialogAction} /><TikisButton label="Supprimer" icon="delete-outline" onPress={() => void confirmRemove()} loading={deleting} style={{ ...styles.dialogAction, ...styles.dangerAction }} /></View>
          </View></View>
        </Modal>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#EEEDF3" },
  header: { minHeight: 62, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#FFFFFF", borderBottomWidth: 0 },
  close: { width: 40, height: 40, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "#EEEDF3" },
  closeSpacer: { width: 40 },
  headerCopy: { flex: 1 },
  eyebrow: { color: "#007B8B", fontSize: 10, fontWeight: "600", letterSpacing: 0.7 },
  title: { color: "#111111", fontSize: 17, fontWeight: "600", marginTop: 2 },
  content: { padding: 16, paddingBottom: 30 },
  subtitle: { color: "#666666", fontSize: 13, lineHeight: 19, marginBottom: 14 },
  confirmationCard: { marginTop: 4, borderWidth: 0, backgroundColor: "#EEEDF3" },
  confirmationHeading: { flexDirection: "row", alignItems: "center", gap: 9 },
  confirmationIcon: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "#EEEDF3" },
  confirmationCopy: { flex: 1 },
  confirmationEyebrow: { color: "#167A55", fontSize: 9, fontWeight: "600", letterSpacing: 0.7 },
  confirmationTitle: { color: "#111111", fontSize: 14, fontWeight: "600", marginTop: 2 },
  confirmationMeta: { color: "#167A55", fontSize: 12, fontWeight: "600", marginTop: 8 },
  confirmationAddress: { color: "#666666", fontSize: 11, lineHeight: 16, marginTop: 3 },
  confirmationFacts: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 9 },
  confirmationFact: { color: "#167A55", fontSize: 10, fontWeight: "600", backgroundColor: "#EEEDF3", borderRadius: 6, overflow: "hidden", paddingHorizontal: 7, paddingVertical: 3 },
  confirmationActions: { flexDirection: "row", gap: 8, marginTop: 14 },
  confirmationAction: { flex: 1, minHeight: 42 },
  searchBox: { height: 44, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, backgroundColor: "#F7EFE5", borderRadius: 9, borderWidth: 1, borderColor: "#E5D2B9", marginBottom: 12 },
  searchInput: { flex: 1, color: "#9A6201", fontSize: 14, fontWeight: "500", height: "100%" },
  clearSearch: { width: 24, height: 24, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: "#F7EFE5" },
  actionError: { color: "#B4232D", fontSize: 12, fontWeight: "600", lineHeight: 18, marginBottom: 8 },
  favoriteCard: { backgroundColor: "#FFFFFF", borderRadius: 10, padding: 12, marginBottom: 10 },
  favoriteTop: { flexDirection: "row", alignItems: "center", gap: 9 },
  favoriteIcon: { width: 32, height: 32, borderRadius: 7, alignItems: "center", justifyContent: "center", backgroundColor: "#EEEDF3" },
  favoriteCopy: { flex: 1 },
  favoriteTitle: { color: "#111111", fontSize: 14, fontWeight: "600" },
  favoriteMeta: { color: "#666666", fontSize: 11, lineHeight: 16, marginTop: 3 },
  favoriteActions: { flexDirection: "row", gap: 8, marginTop: 12 },
  favoriteAction: { flex: 1, minHeight: 40 },
  manageActions: { flexDirection: "row", gap: 7, marginTop: 8 },
  manageButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, flex: 1, minHeight: 34, backgroundColor: "#EEEDF3", borderRadius: 8 },
  manageDelete: { backgroundColor: "#FFF3F3" },
  manageText: { color: "#9A6201", fontSize: 11, fontWeight: "600" },
  deleteText: { color: "#B4232D" },
  empty: { alignItems: "center", paddingVertical: 38, paddingHorizontal: 24, backgroundColor: "#FFFFFF", borderRadius: 10 },
  emptyTitle: { color: "#111111", fontSize: 15, fontWeight: "600", marginTop: 10 },
  emptyText: { color: "#666666", fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 5 },
  dialogOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.42)", alignItems: "center", justifyContent: "center", padding: 22 },
  dialog: { width: "100%", maxWidth: 400, backgroundColor: "#FFFFFF", borderRadius: 14, padding: 18 },
  dialogTitle: { color: "#111111", fontSize: 17, fontWeight: "600", textAlign: "center" },
  dialogText: { color: "#666666", fontSize: 13, lineHeight: 19, textAlign: "center", marginTop: 6 },
  renameInput: { minHeight: 44, borderRadius: 9, borderWidth: 1, borderColor: "#E5D2B9", backgroundColor: "#F7EFE5", color: "#9A6201", fontSize: 14, fontWeight: "500", paddingHorizontal: 12, marginTop: 14 },
  dialogActions: { flexDirection: "row", gap: 8, marginTop: 16 },
  dialogAction: { flex: 1, minHeight: 42 },
  dangerIcon: { width: 44, height: 44, borderRadius: 10, alignItems: "center", justifyContent: "center", alignSelf: "center", backgroundColor: "#FFF3F3", marginBottom: 10 },
  dangerAction: { backgroundColor: "#B4232D" },
  pressed: { opacity: 0.67 },
});
