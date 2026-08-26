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
            <MaterialIcons name={irreversible ? "lock" : "info-outline"} size={17} color={irreversible ? "#B45309" : "#006572"} />
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
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(11, 31, 58, 0.36)" },
  backdrop: { ...StyleSheet.absoluteFillObject },
  sheet: { backgroundColor: "#FFFFFF", borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 22, paddingBottom: 30, paddingTop: 10 },
  handle: { width: 40, height: 4, borderRadius: 4, backgroundColor: "#D8E0EA", alignSelf: "center", marginBottom: 18 },
  iconWrap: { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: 16, backgroundColor: "#E5F6F7", marginBottom: 14 },
  title: { color: "#0B1F3A", fontSize: 22, fontWeight: "900", letterSpacing: -0.3 },
  description: { color: "#5E6B7C", fontSize: 14, lineHeight: 21, marginTop: 7 },
  amountRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "#F6F8FC", borderRadius: 15, padding: 14, marginTop: 18 },
  amountLabel: { color: "#697386", fontSize: 13, fontWeight: "700" },
  amount: { color: "#0B1F3A", fontSize: 17, fontWeight: "900" },
  note: { flexDirection: "row", gap: 9, marginTop: 15, paddingHorizontal: 3 },
  noteText: { flex: 1, color: "#35656C", fontSize: 12, lineHeight: 18 },
  warningText: { color: "#8A5A09" },
  confirm: { marginTop: 21 },
  cancel: { alignItems: "center", paddingVertical: 16 },
  cancelText: { color: "#697386", fontWeight: "800", fontSize: 15 },
  pressed: { opacity: 0.65 },
});

