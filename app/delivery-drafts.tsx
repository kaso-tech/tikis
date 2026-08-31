import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { TikisButton } from "@/components/tikis/ui";
import { deleteDeliveryDraft, listDeliveryDrafts, type DeliveryDraft } from "@/lib/delivery-drafts";
import { haptic } from "@/lib/haptics";
import { useTikisStore } from "@/lib/tikis-store";

export default function DeliveryDraftsScreen() {
  const router = useRouter();
  const { profile } = useTikisStore();
  const [drafts, setDrafts] = useState<DeliveryDraft[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      async function load() {
        if (!profile?.phone) {
          if (active) {
            setDrafts([]);
            setLoading(false);
          }
          return;
        }
        setLoading(true);
        const list = await listDeliveryDrafts(profile.phone);
        if (active) {
          setDrafts(list);
          setLoading(false);
        }
      }
      void load();
      return () => {
        active = false;
      };
    }, [profile?.phone]),
  );

  async function handleDelete(draft: DeliveryDraft) {
    if (!profile?.phone) return;
    Alert.alert("Supprimer ce brouillon ?", `« ${draft.title || "Brouillon sans titre"} » sera définitivement supprimé.`, [
      { text: "Annuler", style: "cancel" },
      { text: "Supprimer", style: "destructive", onPress: async () => {
        await deleteDeliveryDraft(profile.phone, draft.id);
        const list = await listDeliveryDrafts(profile.phone);
        setDrafts(list);
        haptic.success();
      } },
    ]);
  }

  function handleRestore(draft: DeliveryDraft) {
    haptic.selection();
    router.push({ pathname: "/create-delivery" as any, params: { draftId: draft.id } });
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]} accessibilityLabel="Retour">
          <MaterialIcons name="arrow-back" size={20} color="#111111" />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.eyebrow}>BROUILLONS</Text>
          <Text style={styles.title}>Mes courses enregistrées</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#9A6201" />
        </View>
      ) : drafts.length === 0 ? (
        <View style={styles.center}>
          <View style={styles.emptyIcon}>
            <MaterialIcons name="folder-open" size={28} color="#9A6201" />
          </View>
          <Text style={styles.emptyTitle}>Aucun brouillon</Text>
          <Text style={styles.emptyText}>Vos livraisons non publiées sont sauvegardées ici automatiquement depuis la page de création.</Text>
          <TikisButton label="Créer une livraison" icon="add" onPress={() => router.push("/create-delivery" as any)} style={styles.emptyCta} />
        </View>
      ) : (
        <FlatList
          data={drafts}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          renderItem={({ item, index }) => (
            <DraftRow draft={item} onRestore={() => handleRestore(item)} onDelete={() => handleDelete(item)} index={index} />
          )}
        />
      )}
    </SafeAreaView>
  );
}

function DraftRow({ draft, onRestore, onDelete, index }: { draft: DeliveryDraft; onRestore: () => void; onDelete: () => void; index: number }) {
  const typeLabel = draft.deliveryType;
  const pickupLabel = draft.pickup?.name ?? "Récupération non définie";
  const dropoffLabel = draft.dropoff?.name ?? "Destination non définie";
  const dateLabel = new Date(draft.updatedAt).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <View style={styles.draftCard}>
      <View style={styles.draftTop}>
        <View style={styles.draftBadge}>
          <MaterialIcons name="bookmark" size={12} color="#9A6201" />
          <Text style={styles.draftBadgeText}>BROUILLON #{index + 1}</Text>
        </View>
        <Text style={styles.draftDate}>{dateLabel}</Text>
      </View>
      <Text style={styles.draftTitle} numberOfLines={1}>{draft.title || "Sans titre"}</Text>
      <View style={styles.draftMeta}>
        <MaterialIcons name="local-shipping" size={12} color="#9A6201" />
        <Text style={styles.draftMetaText}>{typeLabel}</Text>
      </View>
      <View style={styles.draftRoute}>
        <View style={[styles.draftRouteDot, styles.draftRouteDotFrom]} />
        <Text style={styles.draftRouteText} numberOfLines={1}>{pickupLabel}</Text>
      </View>
      <View style={styles.draftRoute}>
        <View style={[styles.draftRouteDot, styles.draftRouteDotTo]} />
        <Text style={styles.draftRouteText} numberOfLines={1}>{dropoffLabel}</Text>
      </View>
      {draft.offeredPriceInput ? (
        <View style={styles.draftPriceRow}>
          <Text style={styles.draftPriceLabel}>Prix saisi</Text>
          <Text style={styles.draftPriceValue}>{Number(draft.offeredPriceInput).toLocaleString("fr-FR")} FCFA</Text>
        </View>
      ) : null}
      <View style={styles.draftActions}>
        <Pressable onPress={onDelete} style={({ pressed }) => [styles.draftDelete, pressed && styles.pressed]} accessibilityLabel="Supprimer le brouillon">
          <MaterialIcons name="delete-outline" size={15} color="#B4232D" />
          <Text style={styles.draftDeleteText}>Supprimer</Text>
        </Pressable>
        <Pressable onPress={onRestore} style={({ pressed }) => [styles.draftRestore, pressed && styles.pressed]} accessibilityLabel="Reprendre le brouillon">
          <MaterialIcons name="edit" size={15} color="#FFFFFF" />
          <Text style={styles.draftRestoreText}>Reprendre</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#EEEDF3" },
  pressed: { opacity: 0.7 },

  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, gap: 8 },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  headerText: { flex: 1 },
  headerSpacer: { width: 36 },
  eyebrow: { color: "#747474", fontSize: 10, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" },
  title: { color: "#111111", fontSize: 18, fontWeight: "700", marginTop: 2 },

  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 30, gap: 8 },
  emptyIcon: { width: 64, height: 64, borderRadius: 16, backgroundColor: "#F7EFE5", alignItems: "center", justifyContent: "center", marginBottom: 8 },
  emptyTitle: { color: "#111111", fontSize: 16, fontWeight: "700", marginTop: 4 },
  emptyText: { color: "#6B6B6B", fontSize: 13, lineHeight: 19, textAlign: "center", marginTop: 2 },
  emptyCta: { marginTop: 16, minWidth: 220 },

  list: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 32, gap: 10 },

  draftCard: { backgroundColor: "#FFFFFF", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#ECECEC", gap: 8 },
  draftTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  draftBadge: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#F7EFE5", paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  draftBadgeText: { color: "#9A6201", fontSize: 9, fontWeight: "800", letterSpacing: 0.4 },
  draftDate: { color: "#9A9A9A", fontSize: 10, fontWeight: "500" },
  draftTitle: { color: "#111111", fontSize: 14, fontWeight: "700" },
  draftMeta: { flexDirection: "row", alignItems: "center", gap: 5 },
  draftMetaText: { color: "#6B6B6B", fontSize: 11, fontWeight: "500" },
  draftRoute: { flexDirection: "row", alignItems: "center", gap: 8 },
  draftRouteDot: { width: 6, height: 6, borderRadius: 3 },
  draftRouteDotFrom: { backgroundColor: "#9A6201" },
  draftRouteDotTo: { backgroundColor: "#B4232D" },
  draftRouteText: { color: "#111111", fontSize: 12, fontWeight: "500", flex: 1 },
  draftPriceRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 6, borderTopWidth: 1, borderTopColor: "#ECECEC", marginTop: 4 },
  draftPriceLabel: { color: "#747474", fontSize: 10, fontWeight: "600", textTransform: "uppercase" },
  draftPriceValue: { color: "#9A6201", fontSize: 14, fontWeight: "700", fontVariant: ["tabular-nums"] },
  draftActions: { flexDirection: "row", gap: 8, marginTop: 6 },
  draftDelete: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 10, borderRadius: 7, backgroundColor: "#FDEBEC" },
  draftDeleteText: { color: "#B4232D", fontSize: 12, fontWeight: "600" },
  draftRestore: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 10, borderRadius: 7, backgroundColor: "#9A6201" },
  draftRestoreText: { color: "#FFFFFF", fontSize: 12, fontWeight: "600" },
});
