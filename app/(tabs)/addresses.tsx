import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { TikisButton, tikisStyles } from "@/components/tikis/ui";
import { sanitizePlaceText } from "@/lib/geo-rules";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";

type FavoriteRecord = { id: number | string; label: string; place: { placeName: string; district: string | null; city: string | null; formattedAddress: string; street: string | null } };

function subtitle(place: FavoriteRecord["place"]) { return [place.street, place.district, place.city].filter(Boolean).join(" · ") || place.formattedAddress; }

export default function AddressesScreen() {
  const { profile } = useTikisStore();
  const utils = trpc.useUtils();
  const query = trpc.geography.favorites.list.useQuery(undefined, { enabled: Boolean(profile?.phone) });
  const rename = trpc.geography.favorites.rename.useMutation();
  const remove = trpc.geography.favorites.remove.useMutation();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<FavoriteRecord | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const favorites = useMemo(() => (query.data ?? []) as FavoriteRecord[], [query.data]);
  const filtered = useMemo(() => {
    const normalized = search.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr-FR").trim();
    if (!normalized) return favorites;
    return favorites.filter((favorite) => [favorite.label, favorite.place.placeName, subtitle(favorite.place)].join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr-FR").includes(normalized));
  }, [favorites, search]);

  async function saveRename() {
    if (!editing || !draft.trim() || saving) return;
    setSaving(true);
    try { await rename.mutateAsync({ favoriteId: Number(editing.id), label: draft.trim() }); await utils.geography.favorites.list.invalidate(); setEditing(null); }
    finally { setSaving(false); }
  }
  function requestRemove(favorite: FavoriteRecord) {
    Alert.alert("Supprimer cette adresse ?", `« ${favorite.label} » sera retirée de vos adresses enregistrées.`, [{ text: "Conserver", style: "cancel" }, { text: "Supprimer", style: "destructive", onPress: () => void deleteFavorite(favorite) }]);
  }
  async function deleteFavorite(favorite: FavoriteRecord) {
    setDeletingId(Number(favorite.id));
    try { await remove.mutateAsync({ favoriteId: Number(favorite.id) }); await utils.geography.favorites.list.invalidate(); }
    finally { setDeletingId(null); }
  }

  return <View style={tikisStyles.screen}><FlatList data={filtered} keyExtractor={(item) => String(item.id)} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" ListHeaderComponent={<><Text style={tikisStyles.eyebrow}>ADRESSES ENREGISTRÉES</Text><Text style={[tikisStyles.title, styles.title]}>Mes adresses</Text><Text style={styles.subtitle}>Gérez vos lieux habituels pour les retrouver rapidement lors d’une nouvelle livraison.</Text><View style={styles.search}><MaterialIcons name="search" size={20} color="#657180" /><TextInput value={search} onChangeText={(value) => setSearch(sanitizePlaceText(value, 80, { preserveTrailingSpace: true }))} placeholder="Rechercher une adresse" placeholderTextColor="#9AA5B6" style={styles.searchInput} maxLength={80} />{search ? <Pressable accessibilityRole="button" accessibilityLabel="Effacer la recherche" onPress={() => setSearch("")} style={styles.clear}><MaterialIcons name="close" size={17} color="#657180" /></Pressable> : null}</View></>} renderItem={({ item }) => <View style={styles.addressCard}><View style={styles.addressIcon}><MaterialIcons name="bookmark" size={20} color="#A86600" /></View><View style={styles.addressCopy}><Text style={styles.addressLabel} numberOfLines={1}>{item.label}</Text><Text style={styles.addressName} numberOfLines={1}>{item.place.placeName}</Text><Text style={styles.addressMeta} numberOfLines={2}>{subtitle(item.place)}</Text></View><View style={styles.addressActions}><Pressable accessibilityRole="button" accessibilityLabel={`Renommer ${item.label}`} onPress={() => { setEditing(item); setDraft(item.label); }} style={({ pressed }) => [styles.iconAction, pressed && styles.pressed]}><MaterialIcons name="edit" size={19} color="#007B8B" /></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Supprimer ${item.label}`} onPress={() => requestRemove(item)} disabled={deletingId === Number(item.id)} style={({ pressed }) => [styles.iconAction, styles.deleteAction, (pressed || deletingId === Number(item.id)) && styles.pressed]}>{deletingId === Number(item.id) ? <ActivityIndicator size="small" color="#C23B45" /> : <MaterialIcons name="delete-outline" size={19} color="#C23B45" />}</Pressable></View></View>} ListEmptyComponent={<View style={styles.empty}>{query.isLoading ? <ActivityIndicator color="#007B8B" /> : <><MaterialIcons name={search ? "search-off" : "bookmark-border"} size={35} color="#A1ADBC" /><Text style={styles.emptyTitle}>{search ? "Aucune adresse trouvée" : "Aucune adresse enregistrée"}</Text><Text style={styles.emptyText}>{search ? "Essayez un autre terme." : "Ajoutez une adresse depuis la carte pendant la création d’une livraison."}</Text></>}</View>} />
    <Modal visible={Boolean(editing)} transparent animationType="fade" onRequestClose={() => !saving && setEditing(null)}><View style={styles.overlay}><View style={styles.dialog}><Text style={styles.dialogTitle}>Renommer l’adresse</Text><Text style={styles.dialogText}>Utilisez un nom simple, par exemple « Maison » ou « Bureau ».</Text><TextInput value={draft} onChangeText={(value) => setDraft(sanitizePlaceText(value, 80, { preserveTrailingSpace: true }))} style={styles.renameInput} maxLength={80} autoFocus /><View style={styles.dialogActions}><TikisButton label="Annuler" variant="secondary" onPress={() => setEditing(null)} disabled={saving} style={styles.dialogAction} /><TikisButton label="Enregistrer" icon="check" onPress={() => void saveRename()} loading={saving} disabled={!draft.trim()} style={styles.dialogAction} /></View></View></View></Modal>
  </View>;
}

const styles = StyleSheet.create({ content: { padding: 20, paddingBottom: 118 }, title: { marginTop: 3 }, subtitle: { color: "#697386", fontSize: 13, lineHeight: 19, marginTop: 8, marginBottom: 18 }, search: { minHeight: 49, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 9, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#DDE5ED", borderRadius: 15, marginBottom: 17 }, searchInput: { flex: 1, color: "#0B1F3A", fontSize: 14, minHeight: 46 }, clear: { width: 29, height: 29, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "#EEF2F6" }, addressCard: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E4EAF0", borderRadius: 19, padding: 14, marginBottom: 11, flexDirection: "row", alignItems: "center", gap: 11 }, addressIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: "#FFF4D8", alignItems: "center", justifyContent: "center" }, addressCopy: { flex: 1, minWidth: 0 }, addressLabel: { color: "#0B1F3A", fontSize: 14, fontWeight: "900" }, addressName: { color: "#4D5969", fontSize: 12, fontWeight: "800", marginTop: 3 }, addressMeta: { color: "#8190A0", fontSize: 11, lineHeight: 16, marginTop: 2 }, addressActions: { gap: 7 }, iconAction: { width: 35, height: 35, borderRadius: 11, backgroundColor: "#E5F6F7", alignItems: "center", justifyContent: "center" }, deleteAction: { backgroundColor: "#FDEBEC" }, empty: { paddingVertical: 58, paddingHorizontal: 30, alignItems: "center" }, emptyTitle: { color: "#0B1F3A", fontSize: 16, fontWeight: "900", marginTop: 12 }, emptyText: { color: "#778398", fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 6 }, overlay: { flex: 1, backgroundColor: "rgba(11,31,58,0.42)", alignItems: "center", justifyContent: "center", padding: 24 }, dialog: { width: "100%", maxWidth: 400, backgroundColor: "#FFFFFF", borderRadius: 22, padding: 20 }, dialogTitle: { color: "#0B1F3A", fontSize: 18, fontWeight: "900", textAlign: "center" }, dialogText: { color: "#697386", fontSize: 13, lineHeight: 19, textAlign: "center", marginTop: 7 }, renameInput: { minHeight: 48, borderRadius: 13, borderWidth: 1, borderColor: "#DDE5ED", color: "#0B1F3A", fontSize: 14, fontWeight: "700", paddingHorizontal: 13, marginTop: 16 }, dialogActions: { flexDirection: "row", gap: 10, marginTop: 18 }, dialogAction: { flex: 1, minHeight: 45 }, pressed: { opacity: 0.66 } });
