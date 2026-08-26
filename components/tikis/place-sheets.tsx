import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { PlacePicker } from "@/components/tikis/place-picker";
import { TikisButton } from "@/components/tikis/ui";
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
  onClose,
  onSelect,
}: {
  visible: boolean;
  target: LocationTarget | null;
  value: LocationLabel | null;
  onClose: () => void;
  onSelect: (place: LocationLabel) => void;
}) {
  const title = target === "pickup" ? "Choisir la récupération" : "Choisir la destination";

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Fermer" onPress={onClose} style={({ pressed }) => [styles.close, pressed && styles.pressed]}>
            <MaterialIcons name="close" size={22} color="#0B1F3A" />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>LIEU DE LIVRAISON</Text>
            <Text style={styles.title}>{title}</Text>
          </View>
          <View style={styles.closeSpacer} />
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.subtitle}>Recherchez une adresse ou sélectionnez un point directement sur la carte.</Text>
          {target ? (
            <PlacePicker
              label={target === "pickup" ? "Adresse de récupération" : "Adresse de destination"}
              tone={target}
              value={value}
              onChange={(place) => {
                onSelect(place);
                onClose();
              }}
            />
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
            <MaterialIcons name="close" size={22} color="#0B1F3A" />
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
            <TextInput value={query} onChangeText={(value) => setQuery(value.replace(/[^\p{L}\p{N} .,'’()\-]/gu, "").replace(/\s{2,}/g, " "))} placeholder="Rechercher un favori" placeholderTextColor="#9AA5B6" style={styles.searchInput} maxLength={80} />
            {query ? <Pressable accessibilityRole="button" accessibilityLabel="Effacer la recherche" onPress={() => setQuery("")} style={({ pressed }) => [styles.clearSearch, pressed && styles.pressed]}><MaterialIcons name="close" size={16} color="#697386" /></Pressable> : null}
          </View>
          {actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}
          {filteredFavorites.length ? (
            filteredFavorites.map((favorite) => (
              <View key={favorite.id} style={styles.favoriteCard}>
                <View style={styles.favoriteTop}>
                  <View style={styles.favoriteIcon}>
                    <MaterialIcons name="star" size={18} color="#A86600" />
                  </View>
                  <View style={styles.favoriteCopy}>
                    <Text style={styles.favoriteTitle} numberOfLines={1}>{favorite.label}</Text>
                    <Text style={styles.favoriteMeta} numberOfLines={2}>{[favorite.location.district, favorite.location.city, favorite.location.formattedAddress].filter(Boolean).join(" · ") || favorite.location.name}</Text>
                  </View>
                </View>
                <View style={styles.favoriteActions}>
                  <TikisButton label="Récupération" variant="secondary" icon="trip-origin" onPress={() => { onPickup(favorite.location); onClose(); }} style={styles.favoriteAction} />
                  <TikisButton label="Destination" icon="location-on" onPress={() => { onDropoff(favorite.location); onClose(); }} style={styles.favoriteAction} />
                </View>
                <View style={styles.manageActions}>
                  <Pressable accessibilityRole="button" onPress={() => { setActionError(""); setDraftLabel(favorite.label); setEditing(favorite); }} style={({ pressed }) => [styles.manageButton, pressed && styles.pressed]}><MaterialIcons name="edit" size={16} color="#007B8B" /><Text style={styles.manageText}>Renommer</Text></Pressable>
                  <Pressable accessibilityRole="button" onPress={() => { setActionError(""); setRemoving(favorite); }} style={({ pressed }) => [styles.manageButton, styles.manageDelete, pressed && styles.pressed]}><MaterialIcons name="delete-outline" size={16} color="#C23B45" /><Text style={[styles.manageText, styles.deleteText]}>Supprimer</Text></Pressable>
                </View>
              </View>
            ))
          ) : (
            <View style={styles.empty}>
              <MaterialIcons name="star-outline" size={30} color="#A1ADBC" />
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
            <View style={styles.dangerIcon}><MaterialIcons name="delete-outline" size={24} color="#C23B45" /></View><Text style={styles.dialogTitle}>Supprimer ce favori ?</Text><Text style={styles.dialogText}>« {removing?.label} » sera retiré de vos favoris. Cette action est irréversible.</Text>
            <View style={styles.dialogActions}><TikisButton label="Conserver" variant="secondary" onPress={() => setRemoving(null)} disabled={deleting} style={styles.dialogAction} /><TikisButton label="Supprimer" icon="delete-outline" onPress={() => void confirmRemove()} loading={deleting} style={{ ...styles.dialogAction, ...styles.dangerAction }} /></View>
          </View></View>
        </Modal>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F6F8FC" },
  header: { minHeight: 76, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#FFFFFF", borderBottomWidth: 1, borderBottomColor: "#E7ECF2" },
  close: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: "#F3F6FA" },
  closeSpacer: { width: 42 },
  headerCopy: { flex: 1 },
  eyebrow: { color: "#007B8B", fontSize: 10, fontWeight: "900", letterSpacing: 0.8 },
  title: { color: "#0B1F3A", fontSize: 18, fontWeight: "900", marginTop: 2 },
  content: { padding: 20, paddingBottom: 38 },
  subtitle: { color: "#697386", fontSize: 13, lineHeight: 19, marginBottom: 18 },
  searchBox: { height: 48, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 13, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#DDE5ED", borderRadius: 14, marginBottom: 13 },
  searchInput: { flex: 1, color: "#0B1F3A", fontSize: 14, fontWeight: "700", height: "100%" },
  clearSearch: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "#EEF2F6" },
  actionError: { color: "#C23B45", fontSize: 12, fontWeight: "700", lineHeight: 18, marginBottom: 10 },
  favoriteCard: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E7ECF2", borderRadius: 18, padding: 14, marginBottom: 12 },
  favoriteTop: { flexDirection: "row", alignItems: "center", gap: 11 },
  favoriteIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#FFF4D8" },
  favoriteCopy: { flex: 1 },
  favoriteTitle: { color: "#0B1F3A", fontSize: 14, fontWeight: "900" },
  favoriteMeta: { color: "#778398", fontSize: 11, lineHeight: 16, marginTop: 3 },
  favoriteActions: { flexDirection: "row", gap: 9, marginTop: 14 },
  favoriteAction: { flex: 1, minHeight: 43 },
  manageActions: { flexDirection: "row", gap: 8, marginTop: 10 },
  manageButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, flex: 1, minHeight: 36, backgroundColor: "#E6F5F6", borderRadius: 10 },
  manageDelete: { backgroundColor: "#FFF0F1" },
  manageText: { color: "#007B8B", fontSize: 11, fontWeight: "900" },
  deleteText: { color: "#C23B45" },
  empty: { alignItems: "center", paddingVertical: 54, paddingHorizontal: 28, backgroundColor: "#FFFFFF", borderRadius: 20, borderWidth: 1, borderColor: "#E7ECF2" },
  emptyTitle: { color: "#0B1F3A", fontSize: 16, fontWeight: "900", marginTop: 12 },
  emptyText: { color: "#778398", fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 6 },
  dialogOverlay: { flex: 1, backgroundColor: "rgba(11,31,58,0.42)", alignItems: "center", justifyContent: "center", padding: 24 },
  dialog: { width: "100%", maxWidth: 400, backgroundColor: "#FFFFFF", borderRadius: 22, padding: 20 },
  dialogTitle: { color: "#0B1F3A", fontSize: 18, fontWeight: "900", textAlign: "center" },
  dialogText: { color: "#697386", fontSize: 13, lineHeight: 19, textAlign: "center", marginTop: 7 },
  renameInput: { minHeight: 48, borderRadius: 13, borderWidth: 1, borderColor: "#DDE5ED", color: "#0B1F3A", fontSize: 14, fontWeight: "700", paddingHorizontal: 13, marginTop: 16 },
  dialogActions: { flexDirection: "row", gap: 10, marginTop: 18 },
  dialogAction: { flex: 1, minHeight: 45 },
  dangerIcon: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center", alignSelf: "center", backgroundColor: "#FFF0F1", marginBottom: 10 },
  dangerAction: { backgroundColor: "#C23B45" },
  pressed: { opacity: 0.65 },
});
