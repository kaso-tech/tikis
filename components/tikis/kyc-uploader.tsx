import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import { haptic } from "@/lib/haptics";

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
  const hasCapture = Boolean(capture?.uri);
  return (
    <View style={[styles.card, hasCapture && styles.cardReady]}>
      <View style={styles.heading}>
        <View style={styles.iconWrap}><MaterialIcons name={ICONS[kind]} size={18} color={hasCapture ? "#167A55" : "#007B8B"} /></View>
        <View style={styles.headingCopy}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.description}>{description}</Text>
        </View>
      </View>
      {hasCapture ? (
        <View style={styles.previewWrap}>
          <Image source={{ uri: capture?.uri }} style={styles.preview} accessibilityLabel={`Aperçu ${title}`} />
          <View style={styles.previewActions}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Reprendre ${title.toLowerCase()}`} onPress={() => { haptic.light(); onPick(); }} style={({ pressed }) => [styles.previewButton, pressed && styles.pressed]}>
              <MaterialIcons name="refresh" size={16} color="#007B8B" />
              <Text style={styles.previewButtonText}>Reprendre</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Retirer ${title.toLowerCase()}`} onPress={() => { haptic.light(); onClear(); }} style={({ pressed }) => [styles.previewButton, styles.previewButtonDanger, pressed && styles.pressed]}>
              <MaterialIcons name="delete-outline" size={16} color="#B4232D" />
              <Text style={[styles.previewButtonText, styles.previewButtonTextDanger]}>Retirer</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable accessibilityRole="button" accessibilityLabel={`Ajouter ${title.toLowerCase()}`} onPress={() => { haptic.light(); onPick(); }} disabled={loading} style={({ pressed }) => [styles.dropzone, (pressed || loading) && styles.pressed]}>
          {loading ? (
            <View style={styles.dropzoneLoading}>
              <MaterialIcons name="hourglass-top" size={22} color="#007B8B" />
              <Text style={styles.dropzoneText}>Chargement de l’image…</Text>
            </View>
          ) : (
            <>
              <MaterialIcons name="add-a-photo" size={26} color="#007B8B" />
              <Text style={styles.dropzoneText}>Ajouter une photo</Text>
              <Text style={styles.dropzoneHint}>JPEG, PNG ou WebP, 5 Mo maximum.</Text>
            </>
          )}
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#FFFFFF", borderRadius: 10, padding: 13, gap: 11 },
  cardReady: { backgroundColor: "#FFFFFF" },
  heading: { flexDirection: "row", alignItems: "center", gap: 10 },
  iconWrap: { width: 36, height: 36, borderRadius: 8, backgroundColor: "#EEEDF3", alignItems: "center", justifyContent: "center" },
  headingCopy: { flex: 1 },
  title: { color: "#111111", fontSize: 14, fontWeight: "600" },
  description: { color: "#666666", fontSize: 12, marginTop: 2, lineHeight: 16 },
  previewWrap: { gap: 10 },
  preview: { width: "100%", aspectRatio: 16 / 10, borderRadius: 9, backgroundColor: "#EEEDF3" },
  previewActions: { flexDirection: "row", gap: 8 },
  previewButton: { flex: 1, height: 38, borderRadius: 8, backgroundColor: "#EEEDF3", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  previewButtonDanger: { backgroundColor: "#FFF3F3" },
  previewButtonText: { color: "#007B8B", fontSize: 12, fontWeight: "600" },
  previewButtonTextDanger: { color: "#B4232D" },
  dropzone: { minHeight: 120, borderRadius: 9, backgroundColor: "#EEEDF3", alignItems: "center", justifyContent: "center", padding: 12, gap: 4 },
  dropzoneLoading: { alignItems: "center", gap: 5 },
  dropzoneText: { color: "#111111", fontSize: 13, fontWeight: "600" },
  dropzoneHint: { color: "#666666", fontSize: 11 },
  pressed: { opacity: 0.67 },
});
