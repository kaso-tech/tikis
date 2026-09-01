import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import { haptic } from "@/lib/haptics";
import { useThemeColors } from "@/lib/use-theme-colors";

export type KycDocumentKind = "id-front" | "id-back" | "selfie";

export type KycCapture = {
  kind: KycDocumentKind;
  uri: string;
  base64: string;
  mime: "image/jpeg" | "image/png" | "image/webp";
};

type Props = {
  kind: KycDocumentKind;
  title: string;
  description: string;
  capture: KycCapture | null;
  loading: boolean;
  onPick: () => void;
  onClear: () => void;
};

const ICONS: Record<KycDocumentKind, React.ComponentProps<typeof MaterialIcons>["name"]> = {
  "id-front": "badge",
  "id-back": "credit-card",
  selfie: "face",
};

export function KycUploader({ kind, title, description, capture, loading, onPick, onClear }: Props) {
  const { colors: theme } = useThemeColors();
  const hasCapture = Boolean(capture?.uri);
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={styles.heading}>
        <View style={[styles.iconWrap, { backgroundColor: hasCapture ? theme.success + "22" : theme.primary + "22" }]}>
          <MaterialIcons name={ICONS[kind]} size={18} color={hasCapture ? theme.success : theme.primary} />
        </View>
        <View style={styles.headingCopy}>
          <Text style={[styles.title, { color: theme.foreground }]}>{title}</Text>
          <Text style={[styles.description, { color: theme.muted }]}>{description}</Text>
        </View>
      </View>
      {hasCapture ? (
        <View style={styles.previewWrap}>
          <Image source={{ uri: capture?.uri }} style={[styles.preview, { backgroundColor: theme.background }]} accessibilityLabel={`Aperçu ${title}`} />
          <View style={styles.previewActions}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Reprendre ${title.toLowerCase()}`} onPress={() => { haptic.light(); onPick(); }} style={({ pressed }) => [styles.previewButton, { backgroundColor: theme.background }, pressed && styles.pressed]}>
              <MaterialIcons name="refresh" size={16} color={theme.primary} />
              <Text style={[styles.previewButtonText, { color: theme.primary }]}>Reprendre</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Retirer ${title.toLowerCase()}`} onPress={() => { haptic.light(); onClear(); }} style={({ pressed }) => [styles.previewButton, { backgroundColor: theme.error + "22" }, pressed && styles.pressed]}>
              <MaterialIcons name="delete-outline" size={16} color={theme.error} />
              <Text style={[styles.previewButtonText, { color: theme.error }]}>Retirer</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable accessibilityRole="button" accessibilityLabel={`Ajouter ${title.toLowerCase()}`} onPress={() => { haptic.light(); onPick(); }} disabled={loading} style={({ pressed }) => [styles.dropzone, { backgroundColor: theme.background, borderColor: theme.border }, (pressed || loading) && styles.pressed]}>
          {loading ? (
            <View style={styles.dropzoneLoading}>
              <MaterialIcons name="hourglass-top" size={22} color={theme.primary} />
              <Text style={[styles.dropzoneText, { color: theme.foreground }]}>Chargement de l'image…</Text>
            </View>
          ) : (
            <>
              <MaterialIcons name="add-a-photo" size={26} color={theme.primary} />
              <Text style={[styles.dropzoneText, { color: theme.foreground }]}>Ajouter une photo</Text>
              <Text style={[styles.dropzoneHint, { color: theme.muted }]}>JPEG, PNG ou WebP, 5 Mo maximum.</Text>
            </>
          )}
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 10, padding: 13, gap: 11, borderWidth: 1 },
  cardReady: {},
  heading: { flexDirection: "row", alignItems: "center", gap: 10 },
  iconWrap: { width: 36, height: 36, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  headingCopy: { flex: 1 },
  title: { fontSize: 14, fontWeight: "600" },
  description: { fontSize: 12, marginTop: 2, lineHeight: 16 },
  previewWrap: { gap: 10 },
  preview: { width: "100%", aspectRatio: 16 / 10, borderRadius: 9 },
  previewActions: { flexDirection: "row", gap: 8 },
  previewButton: { flex: 1, height: 38, borderRadius: 8, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  previewButtonDanger: {},
  previewButtonText: { fontSize: 12, fontWeight: "600" },
  previewButtonTextDanger: {},
  dropzone: { minHeight: 120, borderRadius: 9, alignItems: "center", justifyContent: "center", padding: 12, gap: 4, borderWidth: 1 },
  dropzoneLoading: { alignItems: "center", gap: 5 },
  dropzoneText: { fontSize: 13, fontWeight: "600" },
  dropzoneHint: { fontSize: 11 },
  pressed: { opacity: 0.67 },
});
