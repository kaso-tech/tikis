import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useCallback, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { PlacePicker } from "@/components/tikis/place-picker";
import { SurfaceCard, TikisButton } from "@/components/tikis/ui";
import { formatDeliveryDetailPlace, formatNavigationTarget, locationSubtitle, locationTitle } from "@/lib/geo-rules";
import { useThemeColors } from "@/lib/use-theme-colors";
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
  const { colors: theme } = useThemeColors();
  const title = target === "pickup" ? "Choisir la récupération" : "Choisir la destination";
  const [pendingPlace, setPendingPlace] = useState<LocationLabel | null>(null);
  const [confirming, setConfirming] = useState(false);
  const formattedPendingPlace = pendingPlace ? formatDeliveryDetailPlace(pendingPlace) : null;
  const receivePendingPlace = useCallback((place: LocationLabel) => {
    setPendingPlace((current) => current?.mapboxId === place.mapboxId && current?.latitude === place.latitude && current?.longitude === place.longitude ? current : place);
  }, []);

  // Ajustement pendant le rendu, comparé au rendu précédent, plutôt qu'un setState synchrone dans
  // le corps d'un effet (react-hooks/set-state-in-effect) : réinitialise la sélection à la fermeture.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (!visible) {
      setPendingPlace(null);
      setConfirming(false);
    }
  }

  function confirmPlace() {
    if (!pendingPlace || confirming) return;
    setConfirming(true);
    onSelect(pendingPlace);
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={["top", "bottom"]}>
        <View style={[styles.header, { backgroundColor: theme.surface }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Fermer" onPress={onClose} style={({ pressed }) => [styles.close, { backgroundColor: theme.background }, pressed && styles.pressed]}>
            <MaterialIcons name="close" size={22} color={theme.foreground} />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={[styles.eyebrow, { color: theme.primary }]}>LIEU DE LIVRAISON</Text>
            <Text style={[styles.title, { color: theme.foreground }]}>{title}</Text>
          </View>
          <View style={styles.closeSpacer} />
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {target ? (
            <PlacePicker
              label={target === "pickup" ? "Adresse de récupération" : "Adresse de destination"}
              tone={target}
              value={pendingPlace ?? value}
              countryCode={countryCode}
              onChange={receivePendingPlace}
            />
          ) : null}
          {pendingPlace && formattedPendingPlace ? (
            <SurfaceCard style={[styles.confirmationCard, { backgroundColor: theme.background }]}>
              <View style={styles.confirmationHeading}>
                <View style={[styles.confirmationIcon, { backgroundColor: theme.surface }]}><MaterialIcons name="verified" size={18} color={theme.success} /></View>
                <View style={styles.confirmationCopy}>
                  <Text style={[styles.confirmationEyebrow, { color: theme.success }]}>LIEU SÉLECTIONNÉ</Text>
                  <Text style={[styles.confirmationTitle, { color: theme.foreground }]}>{formattedPendingPlace.title}</Text>
                </View>
              </View>
              <Text style={[styles.confirmationMeta, { color: theme.success }]}>{formattedPendingPlace.subtitle}</Text>
              <Text style={[styles.confirmationAddress, { color: theme.muted }]} numberOfLines={2}>{formatNavigationTarget(pendingPlace)}</Text>
              <View style={styles.confirmationFacts}>
                <Text style={[styles.confirmationFact, { color: theme.success, backgroundColor: theme.background }]}>{pendingPlace.precision === "exact" ? "Position précise" : pendingPlace.precision === "street" ? "Niveau rue" : pendingPlace.precision === "area" ? "Niveau quartier" : "Position GPS enregistrée"}</Text>
                {pendingPlace.country ? <Text style={[styles.confirmationFact, { color: theme.success, backgroundColor: theme.background }]}>{pendingPlace.country}</Text> : null}
              </View>
              <View style={styles.confirmationActions}>
                <TikisButton label="Modifier" variant="secondary" onPress={() => setPendingPlace(null)} disabled={confirming} style={styles.confirmationAction} />
                <TikisButton label="Confirmer ce lieu" icon="check" onPress={confirmPlace} loading={confirming} loadingLabel="Validation…" style={styles.confirmationAction} />
              </View>
            </SurfaceCard>
          ) : null}
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
  const { colors: theme } = useThemeColors();
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
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={["top", "bottom"]}>
        <View style={[styles.header, { backgroundColor: theme.surface }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Fermer les favoris" onPress={onClose} style={({ pressed }) => [styles.close, { backgroundColor: theme.background }, pressed && styles.pressed]}>
            <MaterialIcons name="close" size={22} color={theme.foreground} />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={[styles.eyebrow, { color: theme.primary }]}>ADRESSES ENREGISTRÉES</Text>
            <Text style={[styles.title, { color: theme.foreground }]}>Vos favoris</Text>
          </View>
          <View style={styles.closeSpacer} />
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={[styles.searchBox, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <MaterialIcons name="search" size={19} color={theme.muted} />
            <TextInput value={query} onChangeText={(value) => setQuery(value.replace(/[^\p{L}\p{N} .,'’()\-]/gu, "").replace(/\s{2,}/g, " "))} placeholder="Rechercher un favori" placeholderTextColor={theme.muted} style={[styles.searchInput, { color: theme.foreground }]} maxLength={80} />
            {query ? <Pressable accessibilityRole="button" accessibilityLabel="Effacer la recherche" onPress={() => setQuery("")} style={({ pressed }) => [styles.clearSearch, { backgroundColor: theme.background }, pressed && styles.pressed]}><MaterialIcons name="close" size={16} color={theme.muted} /></Pressable> : null}
          </View>
          {actionError ? <Text style={[styles.actionError, { color: theme.error }]}>{actionError}</Text> : null}
          {filteredFavorites.length ? (
            filteredFavorites.map((favorite) => (
              <View key={favorite.id} style={[styles.favoriteCard, { backgroundColor: theme.surface }]}>
                <View style={styles.favoriteTop}>
                  <View style={[styles.favoriteIcon, { backgroundColor: theme.background }]}>
                    <MaterialIcons name="star" size={18} color={theme.primary} />
                  </View>
                  <View style={styles.favoriteCopy}>
                    <Text style={[styles.favoriteTitle, { color: theme.foreground }]} numberOfLines={1}>{favorite.label}</Text>
                    <Text style={[styles.favoriteMeta, { color: theme.muted }]} numberOfLines={2}>{locationTitle(favorite.location)} · {locationSubtitle(favorite.location)}</Text>
                  </View>
                </View>
                <View style={styles.favoriteActions}>
                  <TikisButton label="Récupération" variant="secondary" icon="trip-origin" onPress={() => { onPickup(favorite.location); onClose(); }} style={styles.favoriteAction} />
                  <TikisButton label="Destination" icon="location-on" onPress={() => { onDropoff(favorite.location); onClose(); }} style={styles.favoriteAction} />
                </View>
                <View style={styles.manageActions}>
                  <Pressable accessibilityRole="button" onPress={() => { setActionError(""); setDraftLabel(favorite.label); setEditing(favorite); }} style={({ pressed }) => [styles.manageButton, { backgroundColor: theme.background }, pressed && styles.pressed]}>
                    <MaterialIcons name="edit" size={16} color={theme.primary} />
                    <Text style={[styles.manageText, { color: theme.primary }]}>Renommer</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" onPress={() => { setActionError(""); setRemoving(favorite); }} style={({ pressed }) => [styles.manageButton, { backgroundColor: theme.error + "14" }, pressed && styles.pressed]}>
                    <MaterialIcons name="delete-outline" size={16} color={theme.error} />
                    <Text style={[styles.manageText, { color: theme.error }]}>Supprimer</Text>
                  </Pressable>
                </View>
              </View>
            ))
          ) : (
            <View style={[styles.empty, { backgroundColor: theme.surface }]}>
              <MaterialIcons name="star-outline" size={30} color={theme.muted} />
              <Text style={[styles.emptyTitle, { color: theme.foreground }]}>{favorites.length ? "Aucun résultat" : "Aucun lieu favori"}</Text>
              <Text style={[styles.emptyText, { color: theme.muted }]}>{favorites.length ? "Essayez une autre recherche." : "Après avoir choisi une adresse, utilisez l’icône étoile dans la création de livraison pour l’enregistrer ici."}</Text>
            </View>
          )}
        </ScrollView>
        <Modal visible={Boolean(editing)} transparent animationType="fade" onRequestClose={() => !saving && setEditing(null)}>
          <View style={[styles.dialogOverlay, { backgroundColor: theme.overlay }]}>
            <View style={[styles.dialog, { backgroundColor: theme.surface }]}>
              <Text style={[styles.dialogTitle, { color: theme.foreground }]}>Renommer ce favori</Text>
              <Text style={[styles.dialogText, { color: theme.muted }]}>Utilisez un libellé clair, par exemple « Maison » ou « Bureau centre ».</Text>
              <TextInput value={draftLabel} onChangeText={(value) => setDraftLabel(value.replace(/[^\p{L}\p{N} .,'’()\-]/gu, "").replace(/\s{2,}/g, " "))} style={[styles.renameInput, { backgroundColor: theme.surface, borderColor: theme.border, color: theme.foreground }]} maxLength={80} autoFocus placeholderTextColor={theme.muted} />
              <View style={styles.dialogActions}>
                <TikisButton label="Annuler" variant="secondary" onPress={() => setEditing(null)} disabled={saving} style={styles.dialogAction} />
                <TikisButton label="Enregistrer" icon="check" onPress={() => void saveRename()} loading={saving} disabled={!draftLabel.trim()} style={styles.dialogAction} />
              </View>
            </View>
          </View>
        </Modal>
        <Modal visible={Boolean(removing)} transparent animationType="fade" onRequestClose={() => !deleting && setRemoving(null)}>
          <View style={[styles.dialogOverlay, { backgroundColor: theme.overlay }]}>
            <View style={[styles.dialog, { backgroundColor: theme.surface }]}>
              <View style={[styles.dangerIcon, { backgroundColor: theme.error + "14" }]}><MaterialIcons name="delete-outline" size={24} color={theme.error} /></View>
              <Text style={[styles.dialogTitle, { color: theme.foreground }]}>Supprimer ce favori ?</Text>
              <Text style={[styles.dialogText, { color: theme.muted }]}>« {removing?.label} » sera retiré de vos favoris. Cette action est irréversible.</Text>
              <View style={styles.dialogActions}>
                <TikisButton label="Conserver" variant="secondary" onPress={() => setRemoving(null)} disabled={deleting} style={styles.dialogAction} />
                <TikisButton label="Supprimer" icon="delete-outline" onPress={() => void confirmRemove()} loading={deleting} style={[styles.dialogAction, styles.dangerAction, { backgroundColor: theme.error }]} />
              </View>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { minHeight: 62, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 0 },
  close: { width: 40, height: 40, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  closeSpacer: { width: 40 },
  headerCopy: { flex: 1 },
  eyebrow: { fontSize: 10, fontWeight: "600", letterSpacing: 0.7 },
  title: { fontSize: 17, fontWeight: "600", marginTop: 2 },
  content: { padding: 16, paddingBottom: 30 },
  subtitle: { fontSize: 13, lineHeight: 19, marginBottom: 14 },
  confirmationCard: { marginTop: 4, borderWidth: 0 },
  confirmationHeading: { flexDirection: "row", alignItems: "center", gap: 9 },
  confirmationIcon: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  confirmationCopy: { flex: 1 },
  confirmationEyebrow: { fontSize: 9, fontWeight: "600", letterSpacing: 0.7 },
  confirmationTitle: { fontSize: 14, fontWeight: "600", marginTop: 2 },
  confirmationMeta: { fontSize: 12, fontWeight: "600", marginTop: 8 },
  confirmationAddress: { fontSize: 11, lineHeight: 16, marginTop: 3 },
  confirmationFacts: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 9 },
  confirmationFact: { fontSize: 10, fontWeight: "600", borderRadius: 6, overflow: "hidden", paddingHorizontal: 7, paddingVertical: 3 },
  confirmationActions: { flexDirection: "row", gap: 8, marginTop: 14 },
  confirmationAction: { flex: 1, minHeight: 42 },
  searchBox: { height: 44, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, borderRadius: 9, borderWidth: 1, marginBottom: 12 },
  searchInput: { flex: 1, fontSize: 14, fontWeight: "500", height: "100%" },
  clearSearch: { width: 24, height: 24, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  actionError: { fontSize: 12, fontWeight: "600", lineHeight: 18, marginBottom: 8 },
  favoriteCard: { borderRadius: 10, padding: 12, marginBottom: 10 },
  favoriteTop: { flexDirection: "row", alignItems: "center", gap: 9 },
  favoriteIcon: { width: 32, height: 32, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  favoriteCopy: { flex: 1 },
  favoriteTitle: { fontSize: 14, fontWeight: "600" },
  favoriteMeta: { fontSize: 11, lineHeight: 16, marginTop: 3 },
  favoriteActions: { flexDirection: "row", gap: 8, marginTop: 12 },
  favoriteAction: { flex: 1, minHeight: 40 },
  manageActions: { flexDirection: "row", gap: 7, marginTop: 8 },
  manageButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, flex: 1, minHeight: 34, borderRadius: 8 },
  manageText: { fontSize: 11, fontWeight: "600" },
  empty: { alignItems: "center", paddingVertical: 38, paddingHorizontal: 24, borderRadius: 10 },
  emptyTitle: { fontSize: 15, fontWeight: "600", marginTop: 10 },
  emptyText: { fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 5 },
  dialogOverlay: { flex: 1, alignItems: "center", justifyContent: "center", padding: 22 },
  dialog: { width: "100%", maxWidth: 400, borderRadius: 14, padding: 18 },
  dialogTitle: { fontSize: 17, fontWeight: "600", textAlign: "center" },
  dialogText: { fontSize: 13, lineHeight: 19, textAlign: "center", marginTop: 6 },
  renameInput: { minHeight: 44, borderRadius: 9, borderWidth: 1, fontSize: 14, fontWeight: "500", paddingHorizontal: 12, marginTop: 14 },
  dialogActions: { flexDirection: "row", gap: 8, marginTop: 16 },
  dialogAction: { flex: 1, minHeight: 42 },
  dangerIcon: { width: 44, height: 44, borderRadius: 10, alignItems: "center", justifyContent: "center", alignSelf: "center", marginBottom: 10 },
  dangerAction: {},
  pressed: { opacity: 0.7 },
});
