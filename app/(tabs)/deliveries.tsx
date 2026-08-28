import { router } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { DeliveryCard } from "@/components/tikis/delivery-card";
import { TikisButton, tikisStyles } from "@/components/tikis/ui";
import { activeDriverDeliveryFilterCount, defaultDriverDeliveryFilters, distanceOptions, filterAndSortDriverDeliveries, rewardOptions, sortOptions, type DriverDeliveryFilters } from "@/lib/delivery-filters";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";
import type { DeliveryStatus, SelectableVehicleType } from "@/shared/tikis-domain";

type FilterKey = "all" | DeliveryStatus;

const senderFilters: { key: FilterKey; label: string }[] = [
  { key: "all", label: "Toutes" }, { key: "open", label: "Actives" }, { key: "pending_confirmation", label: "À confirmer" }, { key: "active", label: "Attribuées" }, { key: "completed", label: "Terminées" },
];
const driverFilters: { key: FilterKey; label: string }[] = [
  { key: "all", label: "Demandes" }, { key: "pending_confirmation", label: "Attribuées" }, { key: "active", label: "En cours" }, { key: "completed", label: "Terminées" },
];

export default function DeliveriesScreen() {
  const { role, profile } = useTikisStore();
  const deliveriesQuery = trpc.deliveries.list.useQuery(undefined, { enabled: Boolean(profile?.phone) });
  const [filter, setFilter] = useState<FilterKey>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [appliedFilters, setAppliedFilters] = useState<DriverDeliveryFilters>(defaultDriverDeliveryFilters);
  const [draftFilters, setDraftFilters] = useState<DriverDeliveryFilters>(defaultDriverDeliveryFilters);
  const [applyingFilters, setApplyingFilters] = useState(false);
  const filters = role === "sender" ? senderFilters : driverFilters;
  const vehicles = useMemo(() => [...new Set((profile?.vehicles ?? []).filter((vehicle): vehicle is SelectableVehicleType => vehicle !== "Fourgonnette"))], [profile?.vehicles]);
  const baseData = useMemo(() => (deliveriesQuery.data ?? []).filter((delivery) => filter === "all" || delivery.status === filter), [deliveriesQuery.data, filter]);
  const data = useMemo(() => role === "driver" ? filterAndSortDriverDeliveries(baseData, appliedFilters) : baseData, [appliedFilters, baseData, role]);
  const activeFilterCount = activeDriverDeliveryFilterCount(appliedFilters);

  function openFilters() {
    setDraftFilters(appliedFilters);
    setFiltersOpen(true);
  }

  function applyFilters() {
    setApplyingFilters(true);
    setTimeout(() => {
      setAppliedFilters(draftFilters);
      setApplyingFilters(false);
      setFiltersOpen(false);
    }, 140);
  }

  return (
    <View style={tikisStyles.screen}>
      <FlatList
        data={data}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => <DeliveryCard delivery={item} onPress={() => router.push(`/delivery/${item.id}` as any)} onMap={() => router.push(`/delivery/${item.id}/map` as any)} />}
        ListHeaderComponent={<>
          <View style={styles.headingRow}><Text style={[tikisStyles.title, styles.title]}>{role === "sender" ? "Vos courses" : "Vos livraisons"}</Text>{role === "driver" ? <Pressable accessibilityRole="button" accessibilityLabel="Ouvrir les filtres avancés" onPress={openFilters} style={({ pressed }) => [styles.advancedButton, activeFilterCount > 0 && styles.advancedButtonActive, pressed && styles.pressed]}><MaterialIcons name="tune" size={18} color={activeFilterCount > 0 ? "#FFFFFF" : "#007B8B"} /><Text style={[styles.advancedButtonText, activeFilterCount > 0 && styles.advancedButtonTextActive]}>{activeFilterCount ? `${activeFilterCount} filtre${activeFilterCount > 1 ? "s" : ""}` : "Filtrer"}</Text></Pressable> : null}</View>
          <View style={styles.filters}>{filters.map((item) => <Pressable key={item.key} onPress={() => setFilter(item.key)} style={({ pressed }) => [styles.filter, filter === item.key && styles.filterActive, pressed && styles.pressed]}><Text style={[styles.filterText, filter === item.key && styles.filterTextActive]}>{item.label}</Text></Pressable>)}</View>
          {role === "driver" ? <Text style={styles.resultSummary}>{data.length} opportunité{data.length > 1 ? "s" : ""} {activeFilterCount ? "correspondent à vos critères" : "classée(s) par proximité"}</Text> : null}
        </>}
        ListEmptyComponent={<Text style={styles.empty}>{deliveriesQuery.isLoading ? "Chargement de vos livraisons…" : deliveriesQuery.error ? "Impossible de charger les livraisons. Réessayez dans un instant." : role === "driver" && activeFilterCount ? "Aucune opportunité ne correspond à vos filtres. Modifiez ou réinitialisez vos critères." : "Aucune livraison pour le moment."}</Text>}
      />
      <Modal visible={filtersOpen} transparent animationType="slide" onRequestClose={() => !applyingFilters && setFiltersOpen(false)}>
        <View style={styles.overlay}><Pressable style={styles.backdrop} onPress={() => !applyingFilters && setFiltersOpen(false)} /><View style={styles.sheet}><View style={styles.sheetHandle} /><View style={styles.sheetHeader}><View><Text style={styles.sheetTitle}>Filtrer les opportunités</Text><Text style={styles.sheetSubtitle}>Affinez les courses affichées pour vous.</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Fermer les filtres" onPress={() => setFiltersOpen(false)} style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}><MaterialIcons name="close" size={20} color="#111111" /></Pressable></View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetContent}>
            <FilterSection title="Distance de la course"><View style={styles.optionWrap}>{distanceOptions.map((option) => <FilterPill key={String(option.value)} label={option.label} selected={draftFilters.maxDistanceKm === option.value} onPress={() => setDraftFilters((current) => ({ ...current, maxDistanceKm: option.value }))} />)}</View></FilterSection>
            <FilterSection title="Type d’engin"><View style={styles.optionWrap}><FilterPill label="Tous vos engins" selected={draftFilters.vehicle === "all"} onPress={() => setDraftFilters((current) => ({ ...current, vehicle: "all" }))} />{vehicles.map((vehicle) => <FilterPill key={vehicle} label={vehicle} selected={draftFilters.vehicle === vehicle} onPress={() => setDraftFilters((current) => ({ ...current, vehicle }))} />)}</View>{vehicles.length === 0 ? <Text style={styles.inlineHint}>Aucun engin n’est disponible dans votre profil. Complétez votre profil pour appliquer ce critère.</Text> : null}</FilterSection>
            <FilterSection title="Rémunération minimale"><View style={styles.optionWrap}>{rewardOptions.map((option) => <FilterPill key={String(option.value)} label={option.label} selected={draftFilters.minReward === option.value} onPress={() => setDraftFilters((current) => ({ ...current, minReward: option.value }))} />)}</View></FilterSection>
            <FilterSection title="Trier par"><View style={styles.sortStack}>{sortOptions.map((option) => <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ selected: draftFilters.sortBy === option.value }} onPress={() => setDraftFilters((current) => ({ ...current, sortBy: option.value }))} style={({ pressed }) => [styles.sortOption, draftFilters.sortBy === option.value && styles.sortOptionActive, pressed && styles.pressed]}><View style={styles.sortRadio}>{draftFilters.sortBy === option.value ? <View style={styles.sortRadioSelected} /> : null}</View><View style={styles.sortCopy}><Text style={styles.sortLabel}>{option.label}</Text><Text style={styles.sortDescription}>{option.description}</Text></View></Pressable>)}</View></FilterSection>
          </ScrollView>
          <View style={styles.sheetActions}><TikisButton label="Réinitialiser" icon="restart-alt" variant="ghost" onPress={() => setDraftFilters(defaultDriverDeliveryFilters)} disabled={applyingFilters} style={styles.resetButton} /><TikisButton label="Appliquer" icon="check" onPress={applyFilters} loading={applyingFilters} loadingLabel="Application…" style={styles.applyButton} /></View>
        </View>
        </View>
      </Modal>
    </View>
  );
}

function FilterSection({ title, children }: { title: string; children: React.ReactNode }) { return <View style={styles.filterSection}><Text style={styles.filterSectionTitle}>{title}</Text>{children}</View>; }
function FilterPill({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) { return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected }} onPress={onPress} style={({ pressed }) => [styles.optionPill, selected && styles.optionPillActive, pressed && styles.pressed]}><Text style={[styles.optionPillText, selected && styles.optionPillTextActive]}>{label}</Text>{selected ? <MaterialIcons name="check" size={14} color="#FFFFFF" /> : null}</Pressable>; }

const styles = StyleSheet.create({
  list: { padding: 16, paddingBottom: 98 },
  headingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  title: { marginTop: 2, marginBottom: 13, flex: 1 },
  advancedButton: { minHeight: 36, paddingHorizontal: 10, borderRadius: 8, backgroundColor: "#F1F1F1", borderWidth: 1, borderColor: "#E3E3E3", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 5, marginBottom: 13 },
  advancedButtonActive: { backgroundColor: "#007B8B" },
  advancedButtonText: { color: "#111111", fontWeight: "700", fontSize: 11 },
  advancedButtonTextActive: { color: "#FFFFFF" },
  filters: { flexDirection: "row", gap: 7, marginBottom: 14, flexWrap: "wrap" },
  filter: { paddingHorizontal: 11, paddingVertical: 7, borderRadius: 8, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E3E3E3" },
  filterActive: { backgroundColor: "#007B8B", borderColor: "#007B8B" },
  filterText: { color: "#666666", fontWeight: "700", fontSize: 12 },
  filterTextActive: { color: "#FFFFFF" },
  pressed: { opacity: 0.7 },
  empty: { color: "#666666", textAlign: "center", marginTop: 32, fontSize: 13 },
  resultSummary: { color: "#666666", fontSize: 12, fontWeight: "600", marginTop: -5, marginBottom: 12 },
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.38)" },
  backdrop: { ...StyleSheet.absoluteFillObject },
  sheet: { maxHeight: "88%", backgroundColor: "#FFFFFF", borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingTop: 9 },
  sheetHandle: { height: 4, width: 38, borderRadius: 2, backgroundColor: "#C7C7C7", alignSelf: "center", marginBottom: 11 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: "#E7E7E7" },
  sheetTitle: { color: "#111111", fontSize: 19, fontWeight: "700", letterSpacing: -0.2 },
  sheetSubtitle: { color: "#666666", fontSize: 12, lineHeight: 17, marginTop: 2 },
  closeButton: { width: 36, height: 36, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: "#F3F3F3" },
  sheetContent: { padding: 16, paddingBottom: 10 },
  filterSection: { marginBottom: 19 },
  filterSectionTitle: { color: "#111111", fontSize: 14, fontWeight: "700", marginBottom: 9 },
  optionWrap: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  optionPill: { minHeight: 36, borderRadius: 8, paddingHorizontal: 10, borderWidth: 1, borderColor: "#D7D7D7", backgroundColor: "#FFFFFF", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  optionPillActive: { backgroundColor: "#007B8B", borderColor: "#007B8B" },
  optionPillText: { color: "#444444", fontSize: 12, fontWeight: "700" },
  optionPillTextActive: { color: "#FFFFFF" },
  inlineHint: { color: "#8A5A0E", fontSize: 11, lineHeight: 16, marginTop: 9 },
  sortStack: { gap: 7 },
  sortOption: { minHeight: 54, borderWidth: 1, borderColor: "#E3E3E3", backgroundColor: "#FFFFFF", borderRadius: 10, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  sortOptionActive: { borderColor: "#007B8B", backgroundColor: "#F5FBFB" },
  sortRadio: { height: 19, width: 19, borderRadius: 10, borderWidth: 2, borderColor: "#9AA8B8", alignItems: "center", justifyContent: "center" },
  sortRadioSelected: { width: 9, height: 9, borderRadius: 5, backgroundColor: "#007B8B" },
  sortCopy: { flex: 1 },
  sortLabel: { color: "#111111", fontSize: 13, fontWeight: "700" },
  sortDescription: { color: "#666666", fontSize: 11, marginTop: 2 },
  sheetActions: { borderTopWidth: 1, borderTopColor: "#E7E7E7", padding: 12, paddingBottom: 16, flexDirection: "row", gap: 8 },
  resetButton: { flex: 1, minHeight: 46, borderRadius: 9 },
  applyButton: { flex: 1.25, minHeight: 46, borderRadius: 9 },
});
