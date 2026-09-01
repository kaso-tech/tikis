import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { TikisButton } from "@/components/tikis/ui";
import { useThemeColors } from "@/lib/use-theme-colors";
import { formatMoney } from "@/shared/tikis-domain";
import { offeredPriceError, parseOfferedPrice, sanitizeOfferedPriceInput } from "@/lib/delivery-price";

type CounterOfferPayload = { amount: number | null };

export function FinancialConfirmationModal({
  visible,
  title,
  description,
  amount,
  confirmLabel,
  irreversible = false,
  loading = false,
  allowCounterOffer = false,
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
  allowCounterOffer?: boolean;
  onCancel: () => void;
  onConfirm: (counterOffer?: CounterOfferPayload) => void;
}) {
  const { colors: theme } = useThemeColors();
  const [counterInput, setCounterInput] = useState("");
  const [counterError, setCounterError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setCounterInput("");
      setCounterError(null);
    }
  }, [visible]);

  const counterAmount = counterInput.trim().length > 0 ? parseOfferedPrice(counterInput) : null;
  const counterValid = counterAmount === null || (counterAmount !== undefined && offeredPriceError(String(counterAmount)) === undefined);
  const hasCounter = counterInput.trim().length > 0 && counterAmount !== null && counterValid;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onCancel} />
        <View style={[styles.sheet, { backgroundColor: theme.surface }]}>
          <View style={[styles.handle, { backgroundColor: theme.border }]} />
          <View style={[styles.iconWrap, { backgroundColor: theme.background }]}><MaterialIcons name="account-balance-wallet" size={24} color={theme.primary} /></View>
          <Text style={[styles.title, { color: theme.foreground }]}>{title}</Text>
          <Text style={[styles.description, { color: theme.muted }]}>{description}</Text>
          <View style={[styles.amountRow, { backgroundColor: theme.background }]}>
            <Text style={[styles.amountLabel, { color: theme.muted }]}>Montant concerné</Text>
            <Text style={[styles.amount, { color: theme.foreground }]}>{formatMoney(amount)}</Text>
          </View>

          {allowCounterOffer ? (
            <View style={[styles.counterBlock, { borderColor: theme.border, backgroundColor: theme.background }]}>
              <View style={styles.counterHeader}>
                <MaterialIcons name="edit" size={14} color={theme.primary} />
                <Text style={[styles.counterTitle, { color: theme.foreground }]}>Votre prix (optionnel)</Text>
                <Text style={[styles.counterSub, { color: theme.muted }]}>Prix client {formatMoney(amount)}</Text>
              </View>
              <View style={styles.counterInputWrap}>
                <Text style={[styles.counterInputPrefix, { color: theme.muted }]}>FCFA</Text>
                <TextInput
                  value={counterInput}
                  onChangeText={(value) => {
                    const sanitized = sanitizeOfferedPriceInput(value);
                    setCounterInput(sanitized);
                    const err = offeredPriceError(sanitized);
                    setCounterError(err ?? null);
                  }}
                  placeholder="Ex : 2 000"
                  placeholderTextColor={theme.muted}
                  keyboardType="numeric"
                  style={[styles.counterInput, { color: theme.foreground, borderColor: counterError ? theme.error : theme.border, backgroundColor: theme.surface }]}
                  accessibilityLabel="Montant de votre proposition"
                />
              </View>
              {counterError ? <Text style={[styles.counterError, { color: theme.error }]}>{counterError}</Text> : null}
            </View>
          ) : null}

          <View style={styles.note}>
            <MaterialIcons name={irreversible ? "lock" : "info-outline"} size={17} color={irreversible ? theme.warning : theme.primary} />
            <Text style={[styles.noteText, { color: theme.muted }, irreversible ? { color: theme.warning } : null]}>
              {irreversible ? "Cette étape rend la commission Tikis définitivement acquise après confirmation du livreur." : "Aucun débit définitif ne sera appliqué tant que la prochaine étape n'est pas confirmée."}
            </Text>
          </View>
          <TikisButton label={confirmLabel} onPress={() => onConfirm(hasCounter ? { amount: counterAmount } : undefined)} loading={loading} disabled={!counterValid} style={styles.confirm} />
          <Pressable accessibilityRole="button" onPress={onCancel} style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}>
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
  amountRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderRadius: 9, padding: 12, marginTop: 14 },
  amountLabel: { fontSize: 13, fontWeight: "500" },
  amount: { fontSize: 16, fontWeight: "600" },
  counterBlock: { marginTop: 12, borderRadius: 10, borderWidth: 1, padding: 12, gap: 8 },
  counterHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  counterTitle: { fontSize: 12, fontWeight: "600", flex: 1 },
  counterSub: { fontSize: 10, fontWeight: "500" },
  counterInputWrap: { flexDirection: "row", alignItems: "center", gap: 6 },
  counterInputPrefix: { fontSize: 11, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase" },
  counterInput: { flex: 1, height: 40, borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, fontSize: 14, fontWeight: "600" },
  counterError: { fontSize: 11, marginTop: 2 },
  note: { flexDirection: "row", gap: 8, marginTop: 12, paddingHorizontal: 3 },
  noteText: { flex: 1, fontSize: 12, lineHeight: 18 },
  confirm: { marginTop: 18 },
  cancel: { alignItems: "center", paddingVertical: 12 },
  cancelText: { fontWeight: "600", fontSize: 14 },
  pressed: { opacity: 0.67 },
});
