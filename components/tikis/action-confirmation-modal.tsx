import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { TikisButton } from "@/components/tikis/ui";

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
  const color = tone === "danger" ? "#A43740" : tone === "success" ? "#176C52" : "#9A6201";
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onCancel} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.iconWrap}><MaterialIcons name={icon} size={24} color={color} /></View>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.description}>{description}</Text>
          <TikisButton label={confirmLabel} onPress={onConfirm} loading={loading} disabled={loading} style={styles.confirm} />
          <Pressable accessibilityRole="button" disabled={loading} onPress={onCancel} style={({ pressed }) => [styles.cancel, pressed && !loading && styles.pressed, loading && styles.disabled]}>
            <Text style={styles.cancelText}>Annuler</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0, 0, 0, 0.42)" },
  backdrop: { ...StyleSheet.absoluteFillObject },
  sheet: { backgroundColor: "#FFFFFF", borderTopLeftRadius: 14, borderTopRightRadius: 14, paddingHorizontal: 18, paddingBottom: 24, paddingTop: 10 },
  handle: { width: 38, height: 4, borderRadius: 2, backgroundColor: "#CFCFCF", alignSelf: "center", marginBottom: 14 },
  iconWrap: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: "#EEEDF3", marginBottom: 12 },
  title: { color: "#111111", fontSize: 20, fontWeight: "600", letterSpacing: -0.25 },
  description: { color: "#666666", fontSize: 13, lineHeight: 20, marginTop: 6 },
  confirm: { marginTop: 18 },
  cancel: { alignItems: "center", paddingVertical: 12 },
  cancelText: { color: "#666666", fontWeight: "600", fontSize: 14 },
  pressed: { opacity: 0.67 },
  disabled: { opacity: 0.5 },
});
