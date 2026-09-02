import { MaterialIcons } from "@expo/vector-icons";
import { Stack } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useThemeColors } from "@/lib/use-theme-colors";
import { trpc } from "@/lib/trpc";

export default function AdminDisputes() {
  const { colors: theme } = useThemeColors();
  const utils = trpc.useUtils();
  const query = trpc.adminConsole.disputes.useQuery({ page: 1, pageSize: 50 });
  const resolveMutation = trpc.adminConsole.disputeResolve.useMutation({
    onSuccess: () => {
      utils.admin.disputes.invalidate();
      utils.admin.overview.invalidate();
    },
  });

  function resolve(disputeId: string) {
    const resolution = (typeof window !== "undefined" ? window.prompt : (() => null))?.("Résolution : refund_sender | release_driver | split | no_action") ?? null;
    if (!resolution || !["refund_sender", "release_driver", "split", "no_action"].includes(resolution)) return;
    resolveMutation.mutate({ disputeId, resolution: resolution as any });
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 60 }}>
        <Text style={[styles.title, { color: theme.foreground }]}>Disputes</Text>
        <Text style={[styles.sub, { color: theme.muted }]}>{query.data?.total ?? 0} litiges en cours</Text>

        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border, marginTop: 16 }]}>
          {query.isLoading ? (
            <View style={{ padding: 32, alignItems: "center" }}><ActivityIndicator color={theme.primary} /></View>
          ) : (query.data?.items.length ?? 0) === 0 ? (
            <View style={{ padding: 40, alignItems: "center" }}>
              <MaterialIcons name="task-alt" size={32} color={theme.success} />
              <Text style={{ color: theme.muted, fontSize: 12.5, marginTop: 8 }}>Aucun litige ouvert.</Text>
            </View>
          ) : (
            <View>
              {query.data?.items.map((d) => (
                <View key={d.id} style={[styles.row, { borderBottomColor: theme.border }]}>
                  <View style={[styles.icon, { backgroundColor: theme.warning + "22" }]}>
                    <MaterialIcons name="gavel" size={16} color={theme.warning} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontSize: 12.5, fontWeight: "600", color: theme.foreground }} numberOfLines={1}>{d.reason}</Text>
                    <Text style={{ fontSize: 11, color: theme.muted, marginTop: 2 }} numberOfLines={2}>{d.description}</Text>
                    <Text style={{ fontSize: 10.5, color: theme.muted, marginTop: 2 }}>
                      {d.deliveryId} · ouvert par {d.openedByPhone}
                    </Text>
                  </View>
                  <Pressable onPress={() => resolve(d.id)} style={[styles.btn, { backgroundColor: theme.primary }]}>
                    <Text style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "600" }}>Résoudre</Text>
                  </Pressable>
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
  icon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  btn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
});
