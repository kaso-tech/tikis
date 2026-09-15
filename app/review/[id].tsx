import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Avatar, SurfaceCard, TikisButton } from "@/components/tikis/ui";
import { haptic } from "@/lib/haptics";
import { isValidReviewText } from "@/lib/review-rules";
import { useThemeColors } from "@/lib/use-theme-colors";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";

export default function ReviewDeliveryScreen() {
  const { colors: theme } = useThemeColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useTikisStore();
  const safeDeliveryId = id ?? "00000000-0000-4000-8000-000000000000";
  const deliveryQuery = trpc.deliveries.get.useQuery({ id: safeDeliveryId }, { enabled: Boolean(id && profile?.phone) });
  const reviewQuery = trpc.analytics.getForDelivery.useQuery({ deliveryId: safeDeliveryId }, { enabled: Boolean(id && profile?.phone) });
  const submitReviewMutation = trpc.analytics.submit.useMutation();
  const delivery = deliveryQuery.data;
  const existing = reviewQuery.data;
  const [rating, setRating] = useState<1 | 2 | 3 | 4 | 5>(5);
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  if (deliveryQuery.isLoading || reviewQuery.isLoading) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
        <View style={styles.missing}>
          <Text style={[styles.missingTitle, { color: theme.foreground }]}>Chargement de l’évaluation…</Text>
        </View>
      </SafeAreaView>
    );
  }
  if (!delivery) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
        <View style={styles.missing}>
          <Text style={[styles.missingTitle, { color: theme.foreground }]}>Livraison introuvable</Text>
          <TikisButton label="Retour" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  async function save() {
    if (comment && !isValidReviewText(comment)) {
      setError("Caractères non autorisés");
      haptic.error();
      return;
    }
    setSaving(true);
    try {
      await submitReviewMutation.mutateAsync({ deliveryId: safeDeliveryId, rating, ...(comment.trim() ? { comment } : {}) });
      haptic.success();
      router.replace(`/delivery/${safeDeliveryId}` as any);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "L’avis n’a pas pu être enregistré.");
      haptic.error();
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.top}>
          <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.back, { backgroundColor: theme.surface, borderColor: theme.border }, pressed && styles.pressed]}>
            <MaterialIcons name="arrow-back" size={22} color={theme.foreground} />
          </Pressable>
          <Text style={[styles.topTitle, { color: theme.foreground }]}>Évaluer la course</Text>
          <View style={styles.placeholder} />
        </View>
        {existing ? (
          <SurfaceCard style={styles.doneCard}>
            <MaterialIcons name="task-alt" size={28} color={theme.success} />
            <Text style={[styles.doneTitle, { color: theme.foreground }]}>Avis déjà envoyé</Text>
            <Text style={[styles.doneText, { color: theme.muted }]}>Vous avez attribué {existing.rating}/5 à {existing.driverName}.</Text>
            {existing.comment ? <Text style={[styles.quote, { color: theme.muted }]}>« {existing.comment} »</Text> : null}
          </SurfaceCard>
        ) : (
          <>
            <Text style={[styles.eyebrow, { color: theme.primary }]}>LIVRAISON TERMINÉE</Text>
            <Text style={[styles.title, { color: theme.foreground }]}>Comment s’est passée la prestation ?</Text>
            <Text style={[styles.subtitle, { color: theme.muted }]}>Votre avis aide la communauté Tikis à choisir des livreurs de confiance.</Text>
            <SurfaceCard style={styles.driverCard}>
              <Avatar initials={(delivery.driverName ?? "LT").split(" ").map((part) => part[0]).join("")} color={theme.primary} size={56} />
              <View>
                <Text style={[styles.driverName, { color: theme.foreground }]}>{delivery.driverName ?? "Livreur Tikis"}</Text>
                <Text style={[styles.deliveryName, { color: theme.muted }]}>{delivery.title}</Text>
              </View>
            </SurfaceCard>
            <Text style={[styles.label, { color: theme.muted }]}>VOTRE NOTE</Text>
            <View style={[styles.stars, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              {[1, 2, 3, 4, 5].map((star) => (
                <Pressable
                  key={star}
                  accessibilityRole="button"
                  accessibilityLabel={`${star} étoiles`}
                  onPress={() => { setRating(star as 1 | 2 | 3 | 4 | 5); haptic.selection(); }}
                  style={({ pressed }) => [styles.starButton, pressed && styles.pressed]}
                >
                  <MaterialIcons name={star <= rating ? "star" : "star-outline"} size={39} color={star <= rating ? theme.primary : theme.muted} />
                </Pressable>
              ))}
            </View>
            <Text style={[styles.ratingCaption, { color: theme.primary }]}>{rating === 5 ? "Excellente prestation" : rating >= 4 ? "Très bonne prestation" : rating >= 3 ? "Prestation correcte" : "Prestation à améliorer"}</Text>
            <Text style={[styles.label, { color: theme.muted }]}>VOTRE AVIS <Text style={[styles.optional, { color: theme.muted }]}>(facultatif)</Text></Text>
            <TextInput
              multiline
              maxLength={500}
              value={comment}
              onChangeText={(value) => { setComment(value); setError(""); }}
              placeholder="Partagez votre expérience avec ce livreur…"
              placeholderTextColor={theme.muted}
              style={[styles.comment, { backgroundColor: theme.surface, borderColor: theme.border, color: theme.foreground }, error && { borderColor: theme.error }]}
              textAlignVertical="top"
            />
            {error ? <Text style={[styles.error, { color: theme.error }]}>{error}</Text> : <Text style={[styles.helper, { color: theme.muted }]}>{comment.length}/500 · Votre avis doit rester respectueux et utile.</Text>}
            <TikisButton label="Publier mon avis" icon="send" onPress={() => void save()} loading={saving} style={styles.save} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: 16, paddingBottom: 28 },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 17 },
  back: { width: 40, height: 40, borderRadius: 9, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
  topTitle: { fontSize: 16, fontWeight: "600" },
  placeholder: { width: 40 },
  eyebrow: { fontSize: 11, fontWeight: "600", letterSpacing: 0.7 },
  title: { fontSize: 24, lineHeight: 30, fontWeight: "700", letterSpacing: -0.4, marginTop: 6 },
  subtitle: { fontSize: 13, lineHeight: 20, marginTop: 6 },
  driverCard: { marginTop: 17, flexDirection: "row", alignItems: "center", gap: 11 },
  driverName: { fontSize: 16, fontWeight: "600" },
  deliveryName: { fontSize: 12, marginTop: 3 },
  label: { fontSize: 11, fontWeight: "600", letterSpacing: 0.7, marginTop: 19, marginBottom: 8 },
  optional: { fontWeight: "500" },
  stars: { flexDirection: "row", justifyContent: "space-between", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 13, borderWidth: StyleSheet.hairlineWidth },
  starButton: { padding: 2 },
  ratingCaption: { fontSize: 13, fontWeight: "600", textAlign: "center", marginTop: 8 },
  comment: { minHeight: 130, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, padding: 13, fontSize: 14, lineHeight: 20 },
  helper: { fontSize: 11, marginTop: 7 },
  error: { fontSize: 12, marginTop: 7, fontWeight: "600" },
  save: { marginTop: 18 },
  doneCard: { alignItems: "center", paddingVertical: 24 },
  doneTitle: { fontSize: 18, fontWeight: "700", marginTop: 12 },
  doneText: { fontSize: 13, textAlign: "center", marginTop: 5 },
  quote: { fontSize: 13, fontStyle: "italic", textAlign: "center", lineHeight: 20, marginTop: 13 },
  missing: { flex: 1, alignItems: "center", justifyContent: "center", gap: 18 },
  missingTitle: { fontSize: 18, fontWeight: "600" },
  pressed: { opacity: 0.7 },
});
