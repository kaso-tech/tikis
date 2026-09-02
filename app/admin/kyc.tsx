import { MaterialIcons } from "@expo/vector-icons";
import { Stack } from "expo-router";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useThemeColors } from "@/lib/use-theme-colors";
import { trpc } from "@/lib/trpc";

export default function AdminKyc() {
  const { colors: theme } = useThemeColors();
  const utils = trpc.useUtils();
  const query = trpc.adminConsole.kycList.useQuery({ page: 1, pageSize: 50 });
  const decideMutation = trpc.adminConsole.kycDecide.useMutation({
    onSuccess: () => {
      utils.admin.kycList.invalidate();
      utils.admin.overview.invalidate();
    },
  });

  function decide(phone: string, decision: "approve" | "reject") {
    const reason = (typeof window !== "undefined" ? window.prompt : (() => null))?.(decision === "approve" ? "Raison (optionnel)" : "Raison du refus") ?? undefined;
    if (decision === "reject" && !reason) return;
    decideMutation.mutate({ phone, decision, reason: reason ?? undefined });
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 60 }}>
        <Text style={[styles.title, { color: theme.foreground }]}>Validations KYC</Text>
        <Text style={[styles.sub, { color: theme.muted }]}>{query.data?.total ?? 0} livreurs en attente</Text>

        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border, marginTop: 16 }]}>
          {query.isLoading ? (
            <View style={{ padding: 32, alignItems: "center" }}><ActivityIndicator color={theme.primary} /></View>
          ) : (query.data?.items.length ?? 0) === 0 ? (
            <View style={{ padding: 40, alignItems: "center" }}>
              <MaterialIcons name="check-circle-outline" size={32} color={theme.success} />
              <Text style={{ color: theme.muted, fontSize: 12.5, marginTop: 8 }}>Aucun dossier en attente.</Text>
            </View>
          ) : (
            <View>
              {query.data?.items.map((u) => (
                <View key={u.phone} style={[styles.row, { borderBottomColor: theme.border }]}>
                  <View style={[styles.avatar, { backgroundColor: theme.primary + "22" }]}>
                    <Text style={{ color: theme.primary, fontSize: 11, fontWeight: "600" }}>{(u.fullName[0] ?? "?").toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontSize: 12.5, fontWeight: "600", color: theme.foreground }} numberOfLines={1}>{u.fullName}</Text>
                    <Text style={{ fontSize: 11, color: theme.muted, marginTop: 2 }} numberOfLines={1}>{u.phone}</Text>
                  </View>
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    <Pressable onPress={() => decide(u.phone, "reject")} style={[styles.rejectBtn, { borderColor: theme.error }]}>
                      <MaterialIcons name="close" size={14} color={theme.error} />
                      <Text style={{ color: theme.error, fontSize: 12, fontWeight: "600" }}>Rejeter</Text>
                    </Pressable>
                    <Pressable onPress={() => decide(u.phone, "approve")} style={[styles.approveBtn, { backgroundColor: theme.primary }]}>
                      <MaterialIcons name="check" size={14} color="#FFFFFF" />
                      <Text style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "600" }}>Valider</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 20, fontWeight: "600", letterSpacing: -0.4 },
  sub: { fontSize: 12.5, marginTop: 4 },
  card: { borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  row: { flexDirection: "row", padding: 12, borderBottomWidth: StyleSheet.hairlineWidth, gap: 10, alignItems: "center" },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  rejectBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth },
  approveBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
});
