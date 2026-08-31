import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { SafeAreaView } from "react-native-safe-area-context";
import { SaveAddressDialog } from "@/components/tikis/save-address-dialog";
import { type SavedFavorite } from "@/components/tikis/place-sheets";
import { TikisButton } from "@/components/tikis/ui";
import { YangoAddressPicker } from "@/components/tikis/yango-address-picker";
import { formatFavoritePlace, locationSubtitle, locationTitle, sanitizePlaceText } from "@/lib/geo-rules";
import { favoriteToLocation, toPlacePayload, type StoredFavoritePlace } from "@/lib/place-favorites";
import { useThemeColors } from "@/lib/use-theme-colors";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";
import type { LocationLabel } from "@/shared/tikis-domain";

type FavoriteRecord = StoredFavoritePlace;
type AddressCategory = "maison" | "bureau" | "famille" | "autre";

function categoryFor(label: string): AddressCategory {
  const normalized = label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr-FR").trim();
  if (normalized.startsWith("maison") || normalized.startsWith("home") || normalized.startsWith("chez moi")) return "maison";
  if (normalized.startsWith("bureau") || normalized.startsWith("travail") || normalized.startsWith("office") || normalized.startsWith("work")) return "bureau";
  if (normalized.startsWith("famille") || normalized.startsWith("parent") || normalized.startsWith("frere") || normalized.startsWith("soeur") || normalized.startsWith("family")) return "famille";
  return "autre";
}

function categoryIcon(category: AddressCategory): React.ComponentProps<typeof MaterialIcons>["name"] {
  return category === "maison" ? "home" : category === "bureau" ? "business" : category === "famille" ? "person" : "location-on";
}

export default function AddressesScreen() {
  const { colors: theme, isDark } = useThemeColors();
  const { profile } = useTikisStore();
  const utils = trpc.useUtils();
  const query = trpc.geography.favorites.list.useQuery(undefined, { enabled: Boolean(profile?.phone) });
  const savePlace = trpc.geography.savePlace.useMutation();
  const addFavorite = trpc.geography.favorites.add.useMutation();
  const rename = trpc.geography.favorites.rename.useMutation();
  const remove = trpc.geography.favorites.remove.useMutation();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<FavoriteRecord | null>(null);
  const [draft, setDraft] = useState("");
  const [renameError, setRenameError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [filter, setFilter] = useState<"all" | AddressCategory>("all");
  const [pickerVisible, setPickerVisible] = useState(false);
  const [placeToSave, setPlaceToSave] = useState<LocationLabel | null>(null);

  const favorites = useMemo(() => (query.data ?? []) as FavoriteRecord[], [query.data]);
  const decorated = useMemo(() => favorites.map((favorite) => ({ ...favorite, location: favoriteToLocation(favorite), category: categoryFor(favorite.label) })), [favorites]);
  const pickerFavorites = useMemo<SavedFavorite[]>(() => decorated.map((favorite) => ({ id: favorite.id, label: favorite.label, location: favorite.location })), [decorated]);
  const filtered = useMemo(() => {
    const normalized = search.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr-FR").trim();
    let list = decorated;
    if (filter !== "all") list = list.filter((favorite) => favorite.category === filter);
    if (!normalized) return list;
    return list.filter((favorite) => [favorite.label, locationTitle(favorite.location), locationSubtitle(favorite.location)].join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr-FR").includes(normalized));
  }, [decorated, search, filter]);
  const counts = useMemo(() => ({
    all: decorated.length,
    maison: decorated.filter((favorite) => favorite.category === "maison").length,
    bureau: decorated.filter((favorite) => favorite.category === "bureau").length,
    famille: decorated.filter((favorite) => favorite.category === "famille").length,
    autre: decorated.filter((favorite) => favorite.category === "autre").length,
  }), [decorated]);

  async function saveFavorite(place: LocationLabel, label: string) {
    if (!profile?.phone) throw new Error("Votre session doit être active pour enregistrer une adresse.");
    const safeLabel = sanitizePlaceText(label, 80);
    if (!safeLabel) throw new Error("Saisissez un libellé d’adresse valide.");
    const persisted = await savePlace.mutateAsync(toPlacePayload(place));
    await addFavorite.mutateAsync({ placeId: persisted.id, label: safeLabel || formatFavoritePlace(place) || "Lieu favori" });
    await utils.geography.favorites.list.invalidate();
  }

  async function saveRename() {
    const safeLabel = sanitizePlaceText(draft, 80);
    if (!editing || !safeLabel || saving) return;
    setSaving(true);
    setRenameError("");
    try {
      await rename.mutateAsync({ favoriteId: Number(editing.id), label: safeLabel });
      await utils.geography.favorites.list.invalidate();
      setEditing(null);
    } catch (cause) {
      setRenameError(cause instanceof Error ? cause.message : "Impossible de renommer cette adresse.");
    } finally {
      setSaving(false);
    }
  }

  function requestRemove(favorite: FavoriteRecord) {
    Alert.alert("Supprimer cette adresse ?", `« ${favorite.label} » sera retirée de vos adresses enregistrées.`, [
      { text: "Conserver", style: "cancel" },
      { text: "Supprimer", style: "destructive", onPress: () => void deleteFavorite(favorite) },
    ]);
  }

  async function deleteFavorite(favorite: FavoriteRecord) {
    setDeletingId(Number(favorite.id));
    try {
      await remove.mutateAsync({ favoriteId: Number(favorite.id) });
      await utils.geography.favorites.list.invalidate();
    } finally {
      setDeletingId(null);
    }
  }

  function receiveSelectedPlace(place: LocationLabel) {
    setPickerVisible(false);
    setPlaceToSave(place);
  }

  async function confirmNewAddress(label: string) {
    if (!placeToSave) throw new Error("Sélectionnez une adresse avant de l’enregistrer.");
    await saveFavorite(placeToSave, label);
    setPlaceToSave(null);
  }

  return <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={["left", "right"]}>
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <View style={styles.header}><Text style={[styles.eyebrow, { color: theme.primary }]}>GESTION</Text><Text style={[styles.pageTitle, { color: theme.foreground }]} numberOfLines={2}>Mes adresses</Text></View>
      <View style={styles.searchRow}><View style={[styles.search, { backgroundColor: theme.surface, borderColor: theme.border }]}><MaterialIcons name="search" size={16} color={theme.muted} /><TextInput value={search} onChangeText={(value) => setSearch(sanitizePlaceText(value, 80, { preserveTrailingSpace: true }))} placeholder="Rechercher une adresse" placeholderTextColor={theme.muted} style={[styles.searchInput, { color: theme.foreground }]} maxLength={80} returnKeyType="search" />{search ? <Pressable accessibilityRole="button" accessibilityLabel="Effacer la recherche" onPress={() => setSearch("")} style={({ pressed }) => [styles.searchClear, { backgroundColor: theme.pressed }, pressed && styles.pressed]}><MaterialIcons name="close" size={14} color={theme.muted} /></Pressable> : null}</View></View>
      <View style={styles.filterScrollWrap}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow} style={styles.filterScroll}><FilterChip label="Toutes" count={counts.all} active={filter === "all"} onPress={() => setFilter("all")} theme={theme} /><FilterChip label="Maison" count={counts.maison} active={filter === "maison"} onPress={() => setFilter("maison")} theme={theme} /><FilterChip label="Bureau" count={counts.bureau} active={filter === "bureau"} onPress={() => setFilter("bureau")} theme={theme} /><FilterChip label="Famille" count={counts.famille} active={filter === "famille"} onPress={() => setFilter("famille")} theme={theme} /><FilterChip label="Autres" count={counts.autre} active={filter === "autre"} onPress={() => setFilter("autre")} theme={theme} /></ScrollView></View>
      <View style={styles.listWrap}>{query.isLoading ? <View style={styles.loading}><ActivityIndicator color={theme.primary} /></View> : filtered.length === 0 ? <View style={styles.empty}><View style={[styles.emptyIcon, { backgroundColor: theme.surface }]}><MaterialIcons name={search || filter !== "all" ? "search-off" : "bookmark-border"} size={28} color={theme.primary} /></View><Text style={[styles.emptyTitle, { color: theme.foreground }]}>{search || filter !== "all" ? "Aucun résultat" : "Aucune adresse enregistrée"}</Text><Text style={[styles.emptySub, { color: theme.muted }]}>{search ? "Essayez un autre terme ou retirez les filtres." : "Ajoutez un lieu par recherche, carte ou position actuelle."}</Text>{!search && filter === "all" ? <TikisButton label="Ajouter une adresse" icon="add" onPress={() => setPickerVisible(true)} style={styles.emptyButton} /> : null}</View> : filtered.map((favorite, index) => {
        const iconBackground = favorite.category === "autre" ? theme.pressed : isDark ? "#312515" : "#F8E8CE";
        const iconColor = favorite.category === "autre" ? theme.muted : theme.primary;
        return <View key={String(favorite.id)} style={[styles.addressCard, { backgroundColor: theme.surface }]}><View style={[styles.addressIcon, { backgroundColor: iconBackground }]}><MaterialIcons name={categoryIcon(favorite.category)} size={18} color={iconColor} /></View><View style={styles.addressBody}><View style={styles.addressLabelRow}><Text style={[styles.addressLabel, { color: theme.foreground }]} numberOfLines={1}>{favorite.label}</Text>{index === 0 && filter === "all" && !search ? <View style={[styles.defaultBadge, { backgroundColor: isDark ? "#312515" : "#F8E8CE" }]}><Text style={[styles.defaultBadgeText, { color: theme.primary }]}>Défaut</Text></View> : null}</View><Text style={[styles.addressName, { color: theme.muted }]} numberOfLines={1}>{locationTitle(favorite.location)}</Text><Text style={[styles.addressMeta, { color: theme.muted }]} numberOfLines={1}>{locationSubtitle(favorite.location)}</Text></View><View style={styles.addressActions}><Pressable accessibilityRole="button" accessibilityLabel={`Renommer ${favorite.label}`} onPress={() => { setEditing(favorite); setDraft(favorite.label); setRenameError(""); }} style={({ pressed }) => [styles.addressAction, { borderColor: theme.border }, pressed && styles.pressed]}><MaterialIcons name="edit" size={15} color={theme.foreground} /></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Supprimer ${favorite.label}`} onPress={() => requestRemove(favorite)} disabled={deletingId === Number(favorite.id)} style={({ pressed }) => [styles.addressAction, { borderColor: theme.border }, (pressed || deletingId === Number(favorite.id)) && styles.pressed]}>{deletingId === Number(favorite.id) ? <ActivityIndicator size="small" color={theme.error} /> : <MaterialIcons name="delete-outline" size={16} color={theme.error} />}</Pressable></View></View>;
      })}</View>
    </ScrollView>
    <View style={[styles.footer, { backgroundColor: theme.surface, borderTopColor: theme.border }]}><TikisButton label="Ajouter une adresse" icon="add" onPress={() => setPickerVisible(true)} style={styles.footerBtn} /></View>
    <Modal visible={Boolean(editing)} transparent animationType="slide" onRequestClose={() => !saving && setEditing(null)}><View style={[styles.modalOverlay, { backgroundColor: theme.overlay }]}><Pressable style={StyleSheet.absoluteFill} onPress={() => !saving && setEditing(null)} /><KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}><View style={[styles.sheet, { backgroundColor: theme.surface }]}><View style={[styles.sheetGrip, { backgroundColor: theme.border }]} /><Text style={[styles.sheetTitle, { color: theme.foreground }]}>Renommer l’adresse</Text>{editing ? <View style={[styles.renameCard, { backgroundColor: theme.input }]}><View style={[styles.renameIcon, { backgroundColor: isDark ? "#312515" : "#F8E8CE" }]}><MaterialIcons name={categoryIcon(categoryFor(editing.label))} size={18} color={theme.primary} /></View><View style={styles.renameInfo}><Text style={[styles.renameName, { color: theme.foreground }]} numberOfLines={1}>{locationTitle(favoriteToLocation(editing))}</Text><Text style={[styles.renameMeta, { color: theme.muted }]} numberOfLines={1}>{locationSubtitle(favoriteToLocation(editing))}</Text></View></View> : null}<Text style={[styles.fieldLabel, { color: theme.muted }]}>NOM DE L’ADRESSE</Text><TextInput value={draft} onChangeText={(value) => { setDraft(sanitizePlaceText(value, 80, { preserveTrailingSpace: true })); setRenameError(""); }} style={[styles.input, { backgroundColor: theme.input, color: theme.foreground, borderColor: renameError ? theme.error : theme.border }]} maxLength={80} autoFocus placeholder="Ex. Maison, Bureau, Pharmacie" placeholderTextColor={theme.muted} returnKeyType="done" onSubmitEditing={() => void saveRename()} />{renameError ? <Text style={[styles.error, { color: theme.error }]}>{renameError}</Text> : null}<View style={styles.modalActions}><TikisButton label="Annuler" variant="secondary" onPress={() => setEditing(null)} disabled={saving} style={styles.modalAction} /><TikisButton label="Enregistrer" icon="check" onPress={() => void saveRename()} loading={saving} loadingLabel="Enregistrement…" disabled={!sanitizePlaceText(draft, 80)} style={styles.modalAction} /></View></View></KeyboardAvoidingView></View></Modal>
    <YangoAddressPicker visible={pickerVisible} target="address" value={null} countryCode={profile?.countryCode} profilePhone={profile?.phone} favorites={pickerFavorites} onClose={() => setPickerVisible(false)} onSelect={receiveSelectedPlace} onFavorite={saveFavorite} />
    <SaveAddressDialog visible={Boolean(placeToSave)} place={placeToSave} onClose={() => setPlaceToSave(null)} onSave={confirmNewAddress} />
  </SafeAreaView>;
}

function FilterChip({ label, count, active, onPress, theme }: { label: string; count: number; active: boolean; onPress: () => void; theme: { primary: string; surface: string; foreground: string; muted: string; border: string; pressed: string } }) {
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.chip, { backgroundColor: active ? theme.primary : theme.surface, borderColor: active ? theme.primary : theme.border }, pressed && styles.pressed]}><Text style={[styles.chipText, { color: active ? "#FFFFFF" : theme.foreground }]} numberOfLines={1}>{label}</Text><View style={[styles.chipCount, { backgroundColor: active ? "rgba(255,255,255,0.18)" : theme.pressed }]}><Text style={[styles.chipCountText, { color: active ? "#FFFFFF" : theme.muted }]}>{count}</Text></View></Pressable>;
}

const styles = StyleSheet.create({
  safe: { flex: 1 }, scrollContent: { paddingBottom: 98 }, pressed: { opacity: 0.68 },
  header: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 }, eyebrow: { fontSize: 10, fontWeight: "600", letterSpacing: 0.7 }, pageTitle: { fontSize: 23, fontWeight: "600", marginTop: 4, lineHeight: 29 },
  searchRow: { paddingHorizontal: 16, paddingBottom: 10 }, search: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 9, borderWidth: 1, paddingHorizontal: 12, height: 42 }, searchInput: { flex: 1, fontSize: 13, paddingVertical: 0 }, searchClear: { width: 24, height: 24, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  filterScrollWrap: { paddingBottom: 12 }, filterScroll: { flexGrow: 0 }, filterRow: { flexDirection: "row", gap: 6, paddingHorizontal: 16, alignItems: "center" }, chip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, height: 31, borderRadius: 7, borderWidth: 1 }, chipText: { fontSize: 11, fontWeight: "600" }, chipCount: { paddingHorizontal: 5, borderRadius: 5, minWidth: 17, height: 17, alignItems: "center", justifyContent: "center" }, chipCountText: { fontSize: 9, fontWeight: "600" },
  listWrap: { paddingHorizontal: 16, gap: 8 }, loading: { alignItems: "center", paddingVertical: 32 }, addressCard: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 9, padding: 12 }, addressIcon: { width: 38, height: 38, borderRadius: 8, alignItems: "center", justifyContent: "center", flexShrink: 0 }, addressBody: { flex: 1, minWidth: 0 }, addressLabelRow: { flexDirection: "row", alignItems: "center", gap: 6 }, addressLabel: { fontSize: 13, fontWeight: "600" }, defaultBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 }, defaultBadgeText: { fontSize: 9, fontWeight: "600" }, addressName: { fontSize: 11, marginTop: 2 }, addressMeta: { fontSize: 10, marginTop: 1 }, addressActions: { flexDirection: "row", gap: 5, flexShrink: 0 }, addressAction: { width: 32, height: 32, borderRadius: 7, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", paddingVertical: 50, paddingHorizontal: 24 }, emptyIcon: { width: 62, height: 62, borderRadius: 11, alignItems: "center", justifyContent: "center", marginBottom: 12 }, emptyTitle: { fontSize: 15, fontWeight: "600" }, emptySub: { fontSize: 12, textAlign: "center", lineHeight: 18, marginTop: 6, maxWidth: 280 }, emptyButton: { marginTop: 16, minHeight: 44 },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, borderTopWidth: StyleSheet.hairlineWidth, padding: 12, paddingBottom: 18 }, footerBtn: { minHeight: 46 },
  modalOverlay: { flex: 1, justifyContent: "flex-end" }, sheet: { borderTopLeftRadius: 12, borderTopRightRadius: 12, padding: 16, paddingTop: 8, paddingBottom: 24 }, sheetGrip: { width: 38, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 14 }, sheetTitle: { fontSize: 17, fontWeight: "600" }, renameCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 8, marginTop: 14 }, renameIcon: { width: 40, height: 40, borderRadius: 8, alignItems: "center", justifyContent: "center" }, renameInfo: { flex: 1, minWidth: 0 }, renameName: { fontSize: 12, fontWeight: "600" }, renameMeta: { fontSize: 10, marginTop: 1 }, fieldLabel: { fontSize: 10, fontWeight: "600", letterSpacing: 0.5, marginTop: 16, marginBottom: 6 }, input: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 12, fontSize: 13 }, error: { fontSize: 11, lineHeight: 16, marginTop: 6 }, modalActions: { flexDirection: "row", gap: 8, marginTop: 18 }, modalAction: { flex: 1, minHeight: 42 },
});
