import { MaterialIcons } from "@expo/vector-icons";
import { Stack } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useThemeColors } from "@/lib/use-theme-colors";
import { trpc } from "@/lib/trpc";

export default function AdminSettings() {
  const { colors: theme } = useThemeColors();
  const utils = trpc.useUtils();
  const settingsQuery = trpc.adminConsole.settings.useQuery();
  const healthQuery = trpc.adminConsole.health.useQuery();
  const auditQuery = trpc.adminConsole.auditLog.useQuery({ page: 1, pageSize: 30 });
  const updateMutation = trpc.adminConsole.updateSettings.useMutation({ onSuccess: () => utils.admin.settings.invalidate() });

  const [commissionRateBp, setCommissionRateBp] = useState("0");
  const [expirationHours, setExpirationHours] = useState("0");
  const [maxDistanceKm, setMaxDistanceKm] = useState("0");
  useEffect(() => {
    if (settingsQuery.data) {
      setCommissionRateBp(String(settingsQuery.data.commissionRateBp));
      setExpirationHours(String(settingsQuery.data.expirationHours));
      setMaxDistanceKm(String(settingsQuery.data.maxDistanceKm));
    }
  }, [settingsQuery.data]);

  function save() {
    updateMutation.mutate({
      commissionRateBp: Number(commissionRateBp) || 0,
      expirationHours: Number(expirationHours) || 0,
      maxDistanceKm: Number(maxDistanceKm) || 0,
    });
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 60 }}>
        <Text style={[styles.title, { color: theme.foreground }]}>Configuration</Text>
        <Text style={[styles.sub, { color: theme.muted }]}>Paramètres plateforme et journal d'audit</Text>

        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border, marginTop: 16, padding: 16 }]}>
          <Text style={[styles.cardTitle, { color: theme.foreground }]}>Paramètres généraux</Text>
          {settingsQuery.isLoading ? (
            <ActivityIndicator color={theme.primary} style={{ marginVertical: 20 }} />
          ) : (
            <View style={{ marginTop: 12, gap: 12 }}>
              <Field label="Commission plateforme (basis points, 100 = 1%)" value={commissionRateBp} onChange={setCommissionRateBp} theme={theme} />
              <Field label="Expiration livraison (heures)" value={expirationHours} onChange={setExpirationHours} theme={theme} />
              <Field label="Distance max (km)" value={maxDistanceKm} onChange={setMaxDistanceKm} theme={theme} />
              <Pressable onPress={save} disabled={updateMutation.isPending} style={[styles.saveBtn, { backgroundColor: theme.primary, opacity: updateMutation.isPending ? 0.6 : 1 }]}>
                <Text style={{ color: "#FFFFFF", fontSize: 12.5, fontWeight: "600" }}>{updateMutation.isPending ? "Enregistrement…" : "Enregistrer"}</Text>
              </Pressable>
            </View>
          )}
        </View>

        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border, marginTop: 12, padding: 16 }]}>
          <Text style={[styles.cardTitle, { color: theme.foreground }]}>Journaux d'audit</Text>
          <Text style={[styles.sub, { color: theme.muted, marginTop: 2 }]}>Toutes les actions opérateur sont tracées de manière immuable.</Text>
          <View style={{ marginTop: 12 }}>
            {auditQuery.isLoading ? <ActivityIndicator color={theme.primary} /> : auditQuery.data?.items.length === 0 ? (
              <Text style={{ color: theme.muted, fontSize: 12.5, padding: 16, textAlign: "center" }}>Aucune action enregistrée.</Text>
            ) : (
              auditQuery.data?.items.map((entry) => (
                <View key={entry.id} style={[styles.auditRow, { borderBottomColor: theme.border }]}>
                  <MaterialIcons name="history" size={14} color={theme.muted} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontSize: 12, fontWeight: "500", color: theme.foreground }} numberOfLines={1}>{entry.kind}</Text>
                    <Text style={{ fontSize: 11, color: theme.muted }} numberOfLines={1}>{entry.targetId} · {entry.actorPhone}</Text>
                  </View>
                  <Text style={{ fontSize: 11, color: theme.muted }}>{new Date(entry.createdAt).toISOString().slice(0, 16).replace("T", " ")}</Text>
                </View>
              ))
            )}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function Field({ label, value, onChange, theme }: { label: string; value: string; onChange: (v: string) => void; theme: any }) {
  return (
    <View>
      <Text style={{ fontSize: 11, color: theme.muted, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} keyboardType="numeric" style={[styles.input, { backgroundColor: theme.background, borderColor: theme.border, color: theme.foreground }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 20, fontWeight: "600", letterSpacing: -0.4 },
  sub: { fontSize: 12.5, marginTop: 4 },
  card: { borderRadius: 10, borderWidth: StyleSheet.hairlineWidth },
  cardTitle: { fontSize: 13.5, fontWeight: "600" },
  input: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, fontSize: 13, borderWidth: StyleSheet.hairlineWidth },
  saveBtn: { paddingVertical: 10, borderRadius: 8, alignItems: "center" },
  auditRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
});
