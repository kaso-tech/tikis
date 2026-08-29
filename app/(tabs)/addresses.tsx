import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { TikisButton } from "@/components/tikis/ui";
import { sanitizePlaceText } from "@/lib/geo-rules";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";

type FavoriteRecord = { id: number | string; label: string; place: { placeName: string; district: string | null; city: string | null; formattedAddress: string; street: string | null } };

type AddressCategory = "maison" | "bureau" | "famille" | "autre";

function subtitle(place: FavoriteRecord["place"]) {
  return [place.street, place.district, place.city].filter(Boolean).join(" · ") || place.formattedAddress;
}

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
  const [filter, setFilter] = useState<"all" | AddressCategory>("all");

  const favorites = useMemo(() => (query.data ?? []) as FavoriteRecord[], [query.data]);

  const decorated = useMemo(() => favorites.map((favorite) => ({ ...favorite, category: categoryFor(favorite.label) })), [favorites]);

  const filtered = useMemo(() => {
    const normalized = search.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr-FR").trim();
    let list = decorated;
    if (filter !== "all") list = list.filter((favorite) => favorite.category === filter);
    if (!normalized) return list;
    return list.filter((favorite) => [favorite.label, favorite.place.placeName, subtitle(favorite.place)].join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr-FR").includes(normalized));
  }, [decorated, search, filter]);

  const counts = useMemo(() => ({
    all: decorated.length,
    maison: decorated.filter((f) => f.category === "maison").length,
    bureau: decorated.filter((f) => f.category === "bureau").length,
    famille: decorated.filter((f) => f.category === "famille").length,
    autre: decorated.filter((f) => f.category === "autre").length,
  }), [decorated]);

  async function saveRename() {
    if (!editing || !draft.trim() || saving) return;
    setSaving(true);
    try {
      await rename.mutateAsync({ favoriteId: Number(editing.id), label: draft.trim() });
      await utils.geography.favorites.list.invalidate();
      setEditing(null);
    } finally { setSaving(false); }
  }

  function requestRemove(favorite: FavoriteRecord) {
    Alert.alert("Supprimer cette adresse ?", `« ${favorite.label} » sera retirée de vos adresses enregistrées.`, [{ text: "Conserver", style: "cancel" }, { text: "Supprimer", style: "destructive", onPress: () => void deleteFavorite(favorite) }]);
  }

  async function deleteFavorite(favorite: FavoriteRecord) {
    setDeletingId(Number(favorite.id));
    try {
      await remove.mutateAsync({ favoriteId: Number(favorite.id) });
      await utils.geography.favorites.list.invalidate();
    } finally { setDeletingId(null); }
  }

  function handleAdd() {
    Alert.alert("Ajouter une adresse", "Pour ajouter une adresse, ouvrez la carte lors de la création d'une livraison et utilisez l'étoile pour l'enregistrer. Cette page vous permet ensuite de la gérer, la renommer ou la supprimer.");
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>GESTION</Text>
        <Text style={styles.pageTitle}>Mes adresses</Text>
        <Text style={styles.pageSub}>Vos lieux habituels pour publier des livraisons plus rapidement.</Text>
      </View>

      <View style={styles.searchRow}>
        <View style={styles.search}>
          <MaterialIcons name="search" size={16} color="#747474" />
          <TextInput value={search} onChangeText={(value) => setSearch(sanitizePlaceText(value, 80, { preserveTrailingSpace: true }))} placeholder="Rechercher une adresse" placeholderTextColor="#9AA5B6" style={styles.searchInput} maxLength={80} />
          {search ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Effacer la recherche" onPress={() => setSearch("")} style={styles.searchClear}>
              <MaterialIcons name="close" size={12} color="#747474" />
            </Pressable>
          ) : null}
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        <FilterChip label="Toutes" count={counts.all} active={filter === "all"} onPress={() => setFilter("all")} />
        <FilterChip label="Maison" count={counts.maison} active={filter === "maison"} onPress={() => setFilter("maison")} />
        <FilterChip label="Bureau" count={counts.bureau} active={filter === "bureau"} onPress={() => setFilter("bureau")} />
        <FilterChip label="Famille" count={counts.famille} active={filter === "famille"} onPress={() => setFilter("famille")} />
        <FilterChip label="Autres" count={counts.autre} active={filter === "autre"} onPress={() => setFilter("autre")} />
      </ScrollView>

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {query.isLoading ? (
          <View style={styles.loading}><ActivityIndicator color="#007B8B" /></View>
        ) : filtered.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <MaterialIcons name={search || filter !== "all" ? "search-off" : "bookmark-border"} size={28} color="#747474" />
            </View>
            <Text style={styles.emptyTitle}>{search || filter !== "all" ? "Aucun résultat" : "Aucune adresse enregistrée"}</Text>
            <Text style={styles.emptySub}>{search ? "Essayez un autre terme ou retirez les filtres." : "Ajoutez vos lieux habituels depuis la carte lors d'une nouvelle livraison."}</Text>
          </View>
        ) : (
          filtered.map((favorite, index) => (
            <View key={String(favorite.id)} style={styles.addressCard}>
              <View style={[styles.addressIcon, iconStyle(favorite.category)]}>
                <MaterialIcons name={categoryIcon(favorite.category)} size={18} color={iconColor(favorite.category)} />
              </View>
              <View style={styles.addressBody}>
                <View style={styles.addressLabelRow}>
                  <Text style={styles.addressLabel} numberOfLines={1}>{favorite.label}</Text>
                  {index === 0 && filter === "all" && !search ? <View style={styles.defaultBadge}><Text style={styles.defaultBadgeText}>Défaut</Text></View> : null}
                </View>
                <Text style={styles.addressName} numberOfLines={1}>{favorite.place.placeName}</Text>
                <Text style={styles.addressMeta} numberOfLines={1}>{subtitle(favorite.place)}</Text>
              </View>
              <View style={styles.addressActions}>
                <Pressable accessibilityRole="button" accessibilityLabel={`Renommer ${favorite.label}`} onPress={() => { setEditing(favorite); setDraft(favorite.label); }} style={({ pressed }) => [styles.addressAction, pressed && styles.pressed]}>
                  <MaterialIcons name="edit" size={15} color="#666666" />
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={`Supprimer ${favorite.label}`} onPress={() => requestRemove(favorite)} disabled={deletingId === Number(favorite.id)} style={({ pressed }) => [styles.addressAction, styles.addressActionDanger, (pressed || deletingId === Number(favorite.id)) && styles.pressed]}>
                  {deletingId === Number(favorite.id) ? <ActivityIndicator size="small" color="#B4232D" /> : <MaterialIcons name="delete-outline" size={15} color="#B4232D" />}
                </Pressable>
              </View>
            </View>
          ))
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable onPress={handleAdd} style={({ pressed }) => [styles.footerBtn, pressed && styles.pressed]}>
          <MaterialIcons name="add" size={16} color="#FFFFFF" />
          <Text style={styles.footerBtnText}>Ajouter une adresse</Text>
        </Pressable>
      </View>

      <Modal visible={Boolean(editing)} transparent animationType="slide" onRequestClose={() => !saving && setEditing(null)}>
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => !saving && setEditing(null)} />
          <View style={styles.sheet}>
            <View style={styles.sheetGrip} />
            <Text style={styles.sheetTitle}>Renommer l’adresse</Text>
            <Text style={styles.sheetSub}>Utilisez un nom simple, par exemple « Maison » ou « Bureau ».</Text>
            {editing ? (
              <View style={styles.renameCard}>
                <View style={[styles.renameIcon, iconStyle(categoryFor(editing.label))]}>
                  <MaterialIcons name={categoryIcon(categoryFor(editing.label))} size={18} color={iconColor(categoryFor(editing.label))} />
                </View>
                <View style={styles.renameInfo}>
                  <Text style={styles.renameName} numberOfLines={1}>{editing.place.placeName}</Text>
                  <Text style={styles.renameMeta} numberOfLines={1}>{subtitle(editing.place)}</Text>
                </View>
              </View>
            ) : null}
            <Text style={styles.fieldLabel}>NOM DE L’ADRESSE</Text>
            <TextInput
              value={draft}
              onChangeText={(value) => setDraft(sanitizePlaceText(value, 80, { preserveTrailingSpace: true }))}
              style={[styles.input, !draft.trim() ? null : null]}
              maxLength={80}
              autoFocus
              placeholder="Ex. Maison, Bureau, Pharmacie"
              placeholderTextColor="#9AA5B6"
            />
            <Text style={styles.helper}>Ce nom est utilisé dans la sélection rapide des livraisons.</Text>
            <View style={styles.modalActions}>
              <TikisButton label="Annuler" variant="secondary" onPress={() => setEditing(null)} disabled={saving} style={styles.modalAction} />
              <TikisButton label="Enregistrer" icon="check" onPress={() => void saveRename()} loading={saving} disabled={!draft.trim()} style={styles.modalAction} />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function iconStyle(category: AddressCategory) {
  if (category === "maison") return styles.iconHome;
  if (category === "bureau") return styles.iconWork;
  return styles.iconOther;
}

function iconColor(category: AddressCategory) {
  if (category === "maison") return "#007B8B";
  if (category === "bureau") return "#9A6200";
  return "#747474";
}

function FilterChip({ label, count, active, onPress }: { label: string; count: number; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && styles.pressed]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
      <View style={[styles.chipCount, active ? styles.chipCountActive : styles.chipCountInactive]}><Text style={[styles.chipCountText, active ? styles.chipCountTextActive : styles.chipCountTextInactive]}>{count}</Text></View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#EEEDF3" },

  pressed: { opacity: 0.7 },

  header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12 },
  eyebrow: { color: "#747474", fontSize: 10, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" },
  pageTitle: { color: "#111111", fontSize: 22, fontWeight: "700", marginTop: 4, lineHeight: 1.2 },
  pageSub: { color: "#666666", fontSize: 12, lineHeight: 18, marginTop: 6 },

  searchRow: { paddingHorizontal: 16, paddingBottom: 12 },
  search: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FFFFFF", borderRadius: 10, paddingHorizontal: 12, height: 40 },
  searchInput: { flex: 1, color: "#111111", fontSize: 13 },
  searchClear: { width: 22, height: 22, borderRadius: 11, backgroundColor: "#EEEDF3", alignItems: "center", justifyContent: "center" },

  filterRow: { flexDirection: "row", gap: 6, paddingHorizontal: 16, paddingBottom: 12 },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 99, backgroundColor: "#FFFFFF" },
  chipActive: { backgroundColor: "#111111" },
  chipText: { color: "#666666", fontSize: 11, fontWeight: "600" },
  chipTextActive: { color: "#FFFFFF" },
  chipCount: { paddingHorizontal: 6, borderRadius: 99, minWidth: 18, alignItems: "center" },
  chipCountActive: { backgroundColor: "rgba(255,255,255,0.2)" },
  chipCountInactive: { backgroundColor: "#EEEDF3" },
  chipCountText: { fontSize: 9, fontWeight: "600" },
  chipCountTextActive: { color: "#FFFFFF" },
  chipCountTextInactive: { color: "#747474" },

  list: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 100, gap: 8 },
  loading: { alignItems: "center", paddingVertical: 32 },

  addressCard: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#FFFFFF", borderRadius: 12, padding: 12 },
  addressIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: "#EEEDF3", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  iconHome: { backgroundColor: "#E2F3F4" },
  iconWork: { backgroundColor: "#FEF6E2" },
  iconOther: { backgroundColor: "#EEEDF3" },
  addressBody: { flex: 1, minWidth: 0 },
  addressLabelRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  addressLabel: { color: "#111111", fontSize: 13, fontWeight: "600" },
  defaultBadge: { backgroundColor: "#E2F3F4", paddingHorizontal: 6, paddingVertical: 1, borderRadius: 99 },
  defaultBadgeText: { color: "#007B8B", fontSize: 9, fontWeight: "700" },
  addressName: { color: "#666666", fontSize: 11, marginTop: 2 },
  addressMeta: { color: "#747474", fontSize: 10, marginTop: 1 },
  addressActions: { flexDirection: "row", gap: 4, flexShrink: 0 },
  addressAction: { width: 32, height: 32, borderRadius: 8, backgroundColor: "#EEEDF3", alignItems: "center", justifyContent: "center" },
  addressActionDanger: { backgroundColor: "#FDEBEC" },

  empty: { alignItems: "center", paddingVertical: 50, paddingHorizontal: 24 },
  emptyIcon: { width: 64, height: 64, borderRadius: 16, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", marginBottom: 14 },
  emptyTitle: { color: "#111111", fontSize: 15, fontWeight: "600" },
  emptySub: { color: "#666666", fontSize: 12, textAlign: "center", lineHeight: 18, marginTop: 6, maxWidth: 260 },

  footer: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: "#FFFFFF", borderTopWidth: 1, borderTopColor: "#ECECEC", padding: 12, paddingBottom: 18 },
  footerBtn: { backgroundColor: "#007B8B", borderRadius: 10, height: 46, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  footerBtnText: { color: "#FFFFFF", fontSize: 13, fontWeight: "600" },

  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.42)" },
  sheet: { backgroundColor: "#FFFFFF", borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, paddingTop: 8, paddingBottom: 24 },
  sheetGrip: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#D5D5DC", alignSelf: "center", marginBottom: 14 },
  sheetTitle: { color: "#111111", fontSize: 17, fontWeight: "600" },
  sheetSub: { color: "#666666", fontSize: 12, marginTop: 4 },

  renameCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, backgroundColor: "#E2F3F4", borderRadius: 10, marginTop: 14 },
  renameIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  renameInfo: { flex: 1, minWidth: 0 },
  renameName: { color: "#111111", fontSize: 12, fontWeight: "600" },
  renameMeta: { color: "#666666", fontSize: 10, marginTop: 1 },

  fieldLabel: { color: "#747474", fontSize: 10, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase", marginTop: 16, marginBottom: 6 },
  input: { backgroundColor: "#EEEDF3", borderRadius: 9, paddingHorizontal: 12, paddingVertical: 12, color: "#111111", fontSize: 13, fontWeight: "500" },
  helper: { color: "#747474", fontSize: 10, marginTop: 4 },
  modalActions: { flexDirection: "row", gap: 8, marginTop: 18 },
  modalAction: { flex: 1, minHeight: 42 },
});
