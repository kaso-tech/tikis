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
  const [counterEnabled, setCounterEnabled] = useState(false);
  const [counterInput, setCounterInput] = useState("");
  const [counterError, setCounterError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setCounterEnabled(false);
      setCounterInput("");
      setCounterError(null);
    }
  }, [visible]);

  const counterAmount = counterEnabled ? parseOfferedPrice(counterInput) : null;
  const counterValid = !counterEnabled || (counterAmount !== null && counterAmount !== undefined && offeredPriceError(String(counterAmount)) === undefined);

  function toggleCounter() {
    setCounterEnabled((v) => {
      const next = !v;
      if (!next) {
        setCounterInput("");
        setCounterError(null);
      }
      return next;
    });
  }

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
            <View style={[styles.counterBlock, { borderColor: theme.border }]}>
              <Pressable onPress={toggleCounter} style={({ pressed }) => [styles.counterToggle, pressed && { opacity: 0.7 }]} accessibilityRole="switch" accessibilityState={{ checked: counterEnabled }} accessibilityLabel="Proposer un montant différent">
                <View style={[styles.counterCheckbox, { borderColor: theme.border, backgroundColor: counterEnabled ? theme.primary : "transparent" }]}>
                  {counterEnabled ? <MaterialIcons name="check" size={12} color="#FFFFFF" /> : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.counterToggleText, { color: theme.foreground }]}>Proposer un montant différent</Text>
                  <Text style={[styles.counterToggleSub, { color: theme.muted }]}>Optionnel · Prix client {formatMoney(amount)}</Text>
                </View>
              </Pressable>
              {counterEnabled ? (
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
                    style={[styles.counterInput, { color: theme.foreground, borderColor: counterError ? theme.error : theme.border, backgroundColor: theme.background }]}
                    accessibilityLabel="Montant de la contre-proposition"
                  />
                </View>
              ) : null}
              {counterError && counterEnabled ? <Text style={[styles.counterError, { color: theme.error }]}>{counterError}</Text> : null}
            </View>
          ) : null}

          <View style={styles.note}>
            <MaterialIcons name={irreversible ? "lock" : "info-outline"} size={17} color={irreversible ? theme.warning : theme.primary} />
            <Text style={[styles.noteText, { color: theme.muted }, irreversible ? { color: theme.warning } : null]}>
              {irreversible ? "Cette étape rend la commission Tikis définitivement acquise après confirmation du livreur." : "Aucun débit définitif ne sera appliqué tant que la prochaine étape n'est pas confirmée."}
            </Text>
          </View>
          <TikisButton label={confirmLabel} onPress={() => onConfirm(counterEnabled && counterAmount !== null ? { amount: counterAmount } : undefined)} loading={loading} disabled={!counterValid} style={styles.confirm} />
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
  counterBlock: { marginTop: 12, borderRadius: 9, borderWidth: 1, padding: 10 },
  counterToggle: { flexDirection: "row", alignItems: "center", gap: 10 },
  counterCheckbox: { width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  counterToggleText: { fontSize: 13, fontWeight: "600" },
  counterToggleSub: { fontSize: 11, marginTop: 1 },
  counterInputWrap: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 },
  counterInputPrefix: { fontSize: 11, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase" },
  counterInput: { flex: 1, height: 40, borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, fontSize: 14, fontWeight: "600" },
  counterError: { fontSize: 11, marginTop: 6 },
  note: { flexDirection: "row", gap: 8, marginTop: 12, paddingHorizontal: 3 },
  noteText: { flex: 1, fontSize: 12, lineHeight: 18 },
  confirm: { marginTop: 18 },
  cancel: { alignItems: "center", paddingVertical: 12 },
  cancelText: { fontWeight: "600", fontSize: 14 },
  pressed: { opacity: 0.67 },
});
