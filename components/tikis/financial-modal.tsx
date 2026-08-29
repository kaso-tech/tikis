import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { TikisButton } from "@/components/tikis/ui";
import { formatMoney } from "@/shared/tikis-domain";

export function FinancialConfirmationModal({
  visible,
  title,
  description,
  amount,
  confirmLabel,
  irreversible = false,
  loading = false,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  description: string;
  amount: number;
  confirmLabel: string;
  irreversible?: boolean;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onCancel} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.iconWrap}><MaterialIcons name="account-balance-wallet" size={24} color="#007B8B" /></View>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.description}>{description}</Text>
          <View style={styles.amountRow}>
            <Text style={styles.amountLabel}>Montant concerné</Text>
            <Text style={styles.amount}>{formatMoney(amount)}</Text>
          </View>
          <View style={styles.note}>
            <MaterialIcons name={irreversible ? "lock" : "info-outline"} size={17} color={irreversible ? "#9A6200" : "#007B8B"} />
            <Text style={[styles.noteText, irreversible ? styles.warningText : null]}>
              {irreversible ? "Cette étape rend la commission Tikis définitivement acquise après confirmation du livreur." : "Aucun débit définitif ne sera appliqué tant que la prochaine étape n’est pas confirmée."}
            </Text>
          </View>
          <TikisButton label={confirmLabel} onPress={onConfirm} loading={loading} style={styles.confirm} />
          <Pressable accessibilityRole="button" onPress={onCancel} style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}>
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
  amountRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "#EEEDF3", borderRadius: 9, padding: 12, marginTop: 14 },
  amountLabel: { color: "#666666", fontSize: 13, fontWeight: "500" },
  amount: { color: "#111111", fontSize: 16, fontWeight: "600" },
  note: { flexDirection: "row", gap: 8, marginTop: 12, paddingHorizontal: 3 },
  noteText: { flex: 1, color: "#666666", fontSize: 12, lineHeight: 18 },
  warningText: { color: "#9A6200" },
  confirm: { marginTop: 18 },
  cancel: { alignItems: "center", paddingVertical: 12 },
  cancelText: { color: "#666666", fontWeight: "600", fontSize: 14 },
  pressed: { opacity: 0.67 },
});

