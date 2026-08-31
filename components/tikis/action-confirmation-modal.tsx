import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { TikisButton } from "@/components/tikis/ui";
import { useThemeColors } from "@/lib/use-theme-colors";

export function ActionConfirmationModal({
  visible,
  title,
  description,
  confirmLabel,
  icon = "check-circle",
  tone = "primary",
  loading = false,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  icon?: React.ComponentProps<typeof MaterialIcons>["name"];
  tone?: "primary" | "danger" | "success";
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { colors: theme } = useThemeColors();
  const color = tone === "danger" ? theme.error : tone === "success" ? theme.success : theme.primary;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onCancel} />
        <View style={[styles.sheet, { backgroundColor: theme.surface }]}>
          <View style={[styles.handle, { backgroundColor: theme.border }]} />
          <View style={[styles.iconWrap, { backgroundColor: theme.background }]}><MaterialIcons name={icon} size={24} color={color} /></View>
          <Text style={[styles.title, { color: theme.foreground }]}>{title}</Text>
          <Text style={[styles.description, { color: theme.muted }]}>{description}</Text>
          <TikisButton label={confirmLabel} onPress={onConfirm} loading={loading} disabled={loading} style={styles.confirm} />
          <Pressable accessibilityRole="button" disabled={loading} onPress={onCancel} style={({ pressed }) => [styles.cancel, pressed && !loading && styles.pressed, loading && styles.disabled]}>
            <Text style={[styles.cancelText, { color: theme.muted }]}>Annuler</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0, 0, 0, 0.42)" },
  backdrop: { ...StyleSheet.absoluteFillObject },
  sheet: { borderTopLeftRadius: 14, borderTopRightRadius: 14, paddingHorizontal: 18, paddingBottom: 24, paddingTop: 10 },
  handle: { width: 38, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 14 },
  iconWrap: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 10, marginBottom: 12 },
  title: { fontSize: 20, fontWeight: "600", letterSpacing: -0.25 },
  description: { fontSize: 13, lineHeight: 20, marginTop: 6 },
  confirm: { marginTop: 18 },
  cancel: { alignItems: "center", paddingVertical: 12 },
  cancelText: { fontWeight: "600", fontSize: 14 },
  pressed: { opacity: 0.67 },
  disabled: { opacity: 0.5 },
});
