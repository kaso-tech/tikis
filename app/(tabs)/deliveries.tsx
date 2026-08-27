import { router } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { DeliveryCard } from "@/components/tikis/delivery-card";
import { tikisStyles } from "@/components/tikis/ui";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";
import type { DeliveryStatus } from "@/shared/tikis-domain";

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
  const filters = role === "sender" ? senderFilters : driverFilters;
  const data = useMemo(() => (deliveriesQuery.data ?? []).filter((delivery) => filter === "all" || delivery.status === filter), [deliveriesQuery.data, filter]);

  return (
    <View style={tikisStyles.screen}>
      <FlatList
        data={data}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => <DeliveryCard delivery={item} onPress={() => router.push(`/delivery/${item.id}` as any)} />}
        ListHeaderComponent={<>
          <Text style={tikisStyles.eyebrow}>{role === "sender" ? "Gestion des demandes" : "Vos missions"}</Text>
          <Text style={[tikisStyles.title, styles.title]}>{role === "sender" ? "Vos courses" : "Vos livraisons"}</Text>
          <View style={styles.filters}>{filters.map((item) => <Pressable key={item.key} onPress={() => setFilter(item.key)} style={({ pressed }) => [styles.filter, filter === item.key && styles.filterActive, pressed && styles.pressed]}><Text style={[styles.filterText, filter === item.key && styles.filterTextActive]}>{item.label}</Text></Pressable>)}</View>
        </>}
        ListEmptyComponent={<Text style={styles.empty}>{deliveriesQuery.isLoading ? "Chargement de vos livraisons…" : deliveriesQuery.error ? "Impossible de charger les livraisons. Réessayez dans un instant." : "Aucune livraison pour le moment."}</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: 20, paddingBottom: 115 },
  title: { marginTop: 3, marginBottom: 18 },
  filters: { flexDirection: "row", gap: 8, marginBottom: 18, flexWrap: "wrap" },
  filter: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E7ECF2" },
  filterActive: { backgroundColor: "#007B8B", borderColor: "#007B8B" },
  filterText: { color: "#697386", fontWeight: "800", fontSize: 12 },
  filterTextActive: { color: "#FFFFFF" },
  pressed: { opacity: 0.7 },
  empty: { color: "#697386", textAlign: "center", marginTop: 42, fontSize: 13 },
});
