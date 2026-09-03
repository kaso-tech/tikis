import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useThemeColors } from "@/lib/use-theme-colors";
import { trpc } from "@/lib/trpc";
import { isValidReviewText, sanitizeReviewText } from "@/lib/review-rules";

type Props = {
  visible: boolean;
  deliveryId: string | null;
  driverName: string;
  onClose: () => void;
  onRated: () => void;
};

const COMMENT_LIMIT = 500;
const RATING_LABELS: Record<number, string> = {
  1: "Très décevant",
  2: "Peut mieux faire",
  3: "Correct",
  4: "Bien",
  5: "Excellent",
};

export function RateDeliveryDialog({ visible, deliveryId, driverName, onClose, onRated }: Props) {
  const { colors: theme } = useThemeColors();
  const styles = makeStyles(theme);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const submit = trpc.reviews.submit.useMutation({
    onSuccess: () => {
      utils.reviews.list.invalidate();
      utils.reviews.getForDelivery.invalidate({ deliveryId: deliveryId ?? "" });
      onRated();
      reset();
    },
    onError: (cause) => {
      setError(cause.message);
    },
  });

  function reset() {
    setRating(5);
    setComment("");
    setError(null);
  }

  function close() {
    if (submit.isPending) return;
    reset();
    onClose();
  }

  function submitRating() {
    if (!deliveryId) return;
    if (submit.isPending) return;
    if (comment && !isValidReviewText(comment)) {
      setError("Caractères non autorisés dans le commentaire.");
      return;
    }
    setError(null);
    const trimmed = comment.trim();
    submit.mutate({
      deliveryId,
      rating,
      ...(trimmed ? { comment: sanitizeReviewText(trimmed) } : {}),
    });
  }

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={close}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Pressable style={styles.backdropPress} onPress={close} />
        <View style={[styles.sheet, { backgroundColor: theme.surface }]}>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.title}>Comment était cette course ?</Text>
              <Text style={styles.subtitle}>avec {driverName}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Fermer" onPress={close} hitSlop={8} style={styles.closeBtn}>
              <MaterialIcons name="close" size={20} color={theme.muted} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
            <View style={styles.stars}>
              {[1, 2, 3, 4, 5].map((value) => (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityLabel={`${value} étoile${value > 1 ? "s" : ""} — ${RATING_LABELS[value]}`}
                  onPress={() => setRating(value)}
                  hitSlop={6}
                  style={styles.starBtn}
                >
                  <MaterialIcons name={value <= rating ? "star" : "star-border"} size={32} color={value <= rating ? theme.primary : theme.muted} />
                </Pressable>
              ))}
            </View>
            <Text style={styles.ratingLabel}>{RATING_LABELS[rating]}</Text>
            <Text style={styles.fieldLabel}>Commentaire (optionnel)</Text>
            <TextInput
              value={comment}
              onChangeText={setComment}
              maxLength={COMMENT_LIMIT}
              placeholder="Décrivez votre expérience en quelques mots…"
              placeholderTextColor={theme.muted}
              multiline
              style={styles.input}
            />
            <Text style={styles.counter}>{comment.length} / {COMMENT_LIMIT}</Text>
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </ScrollView>
          <View style={styles.footer}>
            <Pressable
              onPress={close}
              disabled={submit.isPending}
              style={({ pressed }) => [styles.btnOutline, pressed && styles.pressed]}
            >
              <Text style={styles.btnOutlineText}>Plus tard</Text>
            </Pressable>
            <Pressable
              onPress={submitRating}
              disabled={submit.isPending}
              style={({ pressed }) => [styles.btnFilled, submit.isPending && styles.disabled, pressed && !submit.isPending && styles.pressed]}
            >
              {submit.isPending ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.btnFilledText}>Envoyer</Text>}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function makeStyles(theme: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: theme.overlay, justifyContent: "flex-end" },
    backdropPress: { flex: 1 },
    sheet: { borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingTop: 18, paddingBottom: 24, paddingHorizontal: 18, gap: 14 },
    header: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
    headerText: { flex: 1, gap: 2 },
    title: { fontSize: 16, fontWeight: "600", color: theme.foreground },
    subtitle: { fontSize: 12, color: theme.muted },
    closeBtn: { padding: 4, borderRadius: 6 },
    body: { gap: 10, paddingBottom: 8 },
    stars: { flexDirection: "row", justifyContent: "center", gap: 8, marginTop: 4 },
    starBtn: { padding: 4 },
    ratingLabel: { textAlign: "center", fontSize: 13, fontWeight: "600", color: theme.primary },
    fieldLabel: { fontSize: 12, fontWeight: "600", color: theme.muted, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 6 },
    input: { borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border, borderRadius: 10, padding: 12, fontSize: 14, color: theme.foreground, backgroundColor: theme.background, minHeight: 84, textAlignVertical: "top" },
    counter: { fontSize: 11, color: theme.muted, textAlign: "right" },
    error: { fontSize: 12, color: theme.error, fontWeight: "600" },
    footer: { flexDirection: "row", gap: 8, marginTop: 4 },
    btnOutline: { flex: 1, paddingVertical: 12, borderRadius: 9, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border, alignItems: "center" },
    btnOutlineText: { fontSize: 14, fontWeight: "600", color: theme.foreground },
    btnFilled: { flex: 1.4, paddingVertical: 12, borderRadius: 9, backgroundColor: theme.primary, alignItems: "center" },
    btnFilledText: { fontSize: 14, fontWeight: "600", color: "#FFFFFF" },
    pressed: { opacity: 0.7 },
    disabled: { opacity: 0.5 },
  });
}
