import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Avatar, SurfaceCard } from "@/components/tikis/ui";
import { useThemeColors } from "@/lib/use-theme-colors";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";

export default function ReviewsScreen() {
  const { colors: theme } = useThemeColors();
  const { role, profile } = useTikisStore();
  const reviewsQuery = trpc.reviews.list.useQuery(undefined, { enabled: Boolean(profile?.phone) });
  const visibleReviews = reviewsQuery.data ?? [];
  const average = visibleReviews.length ? (visibleReviews.reduce((sum, review) => sum + review.rating, 0) / visibleReviews.length).toFixed(1) : null;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={["top", "bottom"]}>
      <FlatList
        data={visibleReviews}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <>
            <View style={styles.top}>
              <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.back, { backgroundColor: theme.surface, borderColor: theme.border }, pressed && styles.pressed]}>
                <MaterialIcons name="arrow-back" size={22} color={theme.foreground} />
              </Pressable>
              <Text style={[styles.topTitle, { color: theme.foreground }]}>Mes avis</Text>
              <View style={styles.placeholder} />
            </View>
            <SurfaceCard style={styles.summary}>
              <View style={[styles.summaryIcon, { backgroundColor: theme.background }]}>
                <MaterialIcons name="star" size={25} color={theme.primary} />
              </View>
              <View>
                <Text style={[styles.summaryValue, { color: theme.foreground }]}>{average ? `${average}/5` : "—"}</Text>
                <Text style={[styles.summaryLabel, { color: theme.muted }]}>{visibleReviews.length ? `${visibleReviews.length} avis` : reviewsQuery.isLoading ? "Chargement…" : "Aucun avis pour le moment"}</Text>
              </View>
            </SurfaceCard>
          </>
        }
        renderItem={({ item }) => (
          <SurfaceCard style={styles.card}>
            <View style={styles.cardTop}>
              <Avatar initials={item.driverName.split(" ").map((part) => part[0]).join("")} color={theme.primary} size={40} />
              <View style={styles.cardInfo}>
                <Text style={[styles.cardName, { color: theme.foreground }]}>{role === "driver" ? "Expéditeur Tikis" : item.driverName}</Text>
                <Text style={[styles.date, { color: theme.muted }]}>{item.createdAt}</Text>
              </View>
              <View style={styles.rating}>
                <MaterialIcons name="star" size={15} color={theme.primary} />
                <Text style={[styles.ratingText, { color: theme.foreground }]}>{item.rating}/5</Text>
              </View>
            </View>
            {item.comment ? <Text style={[styles.comment, { color: theme.muted }]}>« {item.comment} »</Text> : <Text style={[styles.noComment, { color: theme.muted }]}>Aucun commentaire détaillé.</Text>}
          </SurfaceCard>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <MaterialIcons name="star-outline" size={35} color={theme.muted} />
            <Text style={[styles.emptyTitle, { color: theme.foreground }]}>{reviewsQuery.error ? "Chargement indisponible" : "Aucun avis pour le moment"}</Text>
            <Text style={[styles.emptyText, { color: theme.muted }]}>{reviewsQuery.error ? "Impossible de charger vos avis. Réessayez dans un instant." : role === "driver" ? "Les avis des expéditeurs apparaîtront après leurs livraisons terminées." : "Les avis envoyés apparaîtront ici après vos évaluations."}</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: 16, paddingBottom: 32, gap: 12 },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 17 },
  back: { width: 40, height: 40, borderRadius: 9, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth },
  topTitle: { fontSize: 16, fontWeight: "600" },
  placeholder: { width: 40 },
  summary: { flexDirection: "row", alignItems: "center", gap: 12 },
  summaryIcon: { width: 44, height: 44, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  summaryValue: { fontSize: 18, fontWeight: "700" },
  summaryLabel: { fontSize: 12, marginTop: 2 },
  card: { gap: 10 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  cardInfo: { flex: 1 },
  cardName: { fontSize: 14, fontWeight: "600" },
  date: { fontSize: 11, marginTop: 2 },
  rating: { flexDirection: "row", alignItems: "center", gap: 4 },
  ratingText: { fontSize: 12, fontWeight: "600" },
  comment: { fontSize: 13, lineHeight: 19, fontStyle: "italic" },
  noComment: { fontSize: 12, fontStyle: "italic" },
  empty: { alignItems: "center", paddingTop: 36, paddingHorizontal: 28, gap: 8 },
  emptyTitle: { fontSize: 15, fontWeight: "600" },
  emptyText: { fontSize: 13, lineHeight: 19, textAlign: "center" },
  pressed: { opacity: 0.7 },
});
