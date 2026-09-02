import { MaterialIcons } from "@expo/vector-icons";
import { Stack } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useThemeColors } from "@/lib/use-theme-colors";
import { trpc } from "@/lib/trpc";

const ROLES = ["all", "sender", "driver", "operator"] as const;
const ROLE_LABELS: Record<(typeof ROLES)[number], string> = {
  all: "Tous rôles",
  sender: "Expéditeur",
  driver: "Livreur",
  operator: "Opérateur",
};

export default function AdminUsers() {
  const { colors: theme } = useThemeColors();
  const [page, setPage] = useState(1);
  const [role, setRole] = useState<(typeof ROLES)[number]>("all");
  const [search, setSearch] = useState("");

  const query = trpc.adminConsole.users.useQuery({ page, pageSize: 25, role, search: search || undefined });
  const utils = trpc.useUtils();
  const actionMutation = trpc.adminConsole.userAction.useMutation({
    onSuccess: () => {
      utils.admin.users.invalidate();
      utils.admin.overview.invalidate();
    },
  });

  function handleAction(phone: string, action: "suspend" | "reinstate" | "set_kyc_verified" | "clear_kyc") {
    const labels = {
      suspend: "Suspendre ce profil ?",
      reinstate: "Réactiver ce profil ?",
      set_kyc_verified: "Valider le KYC manuellement ?",
      clear_kyc: "Remettre le KYC en attente ?",
    };
    const confirm = (typeof window !== "undefined" ? window.confirm : ((m: string) => Alert.alert(m)))(labels[action]);
    if (!confirm) return;
    actionMutation.mutate({ phone, action });
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 60 }}>
        <Text style={[styles.title, { color: theme.foreground }]}>Utilisateurs</Text>
        <Text style={[styles.sub, { color: theme.muted }]}>{query.data?.total ?? 0} profils Tikis</Text>

        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border, marginTop: 16 }]}>
          <View style={[styles.tabsRow, { borderBottomColor: theme.border }]}>
            {ROLES.map((r) => (
              <Pressable key={r} onPress={() => { setRole(r); setPage(1); }} style={[styles.tab, role === r && { backgroundColor: theme.primary + "1F" }]}>
                <Text style={{ fontSize: 12, fontWeight: "600", color: role === r ? theme.primary : theme.muted }}>{ROLE_LABELS[r]}</Text>
              </Pressable>
            ))}
          </View>
          <View style={{ padding: 12, flexDirection: "row", gap: 8 }}>
            <TextInput
              value={search}
              onChangeText={(v) => { setSearch(v); setPage(1); }}
              placeholder="Rechercher par téléphone ou nom…"
              placeholderTextColor={theme.muted}
              style={[styles.input, { backgroundColor: theme.background, borderColor: theme.border, color: theme.foreground }]}
            />
          </View>

          {query.isLoading ? (
            <View style={{ padding: 32, alignItems: "center" }}><ActivityIndicator color={theme.primary} /></View>
          ) : (
            <View>
              {query.data?.items.map((u) => (
                <View key={u.phone} style={[styles.row, { borderBottomColor: theme.border }]}>
                  <View style={[styles.avatar, { backgroundColor: theme.primary + "22" }]}>
                    <Text style={{ color: theme.primary, fontSize: 11, fontWeight: "600" }}>{(u.fullName[0] ?? "?").toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={{ fontSize: 12.5, fontWeight: "600", color: theme.foreground }} numberOfLines={1}>{u.fullName}</Text>
                      {u.suspended ? <Badge text="Suspendu" bg={theme.error + "1A"} fg={theme.error} /> : null}
                    </View>
                    <Text style={{ fontSize: 11, color: theme.muted, marginTop: 2 }} numberOfLines={1}>
                      {u.phone} · {ROLE_LABELS[u.accountType as (typeof ROLES)[number]] ?? u.accountType} · KYC {u.kycStatus}
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", gap: 4 }}>
                    {u.suspended ? (
                      <Pressable onPress={() => handleAction(u.phone, "reinstate")} style={[styles.iconBtn, { borderColor: theme.success }]}>
                        <MaterialIcons name="undo" size={14} color={theme.success} />
                      </Pressable>
                    ) : (
                      <Pressable onPress={() => handleAction(u.phone, "suspend")} style={[styles.iconBtn, { borderColor: theme.error }]}>
                        <MaterialIcons name="block" size={14} color={theme.error} />
                      </Pressable>
                    )}
                    {u.accountType === "driver" && u.kycStatus !== "verified" ? (
                      <Pressable onPress={() => handleAction(u.phone, "set_kyc_verified")} style={[styles.iconBtn, { borderColor: theme.primary }]}>
                        <MaterialIcons name="verified" size={14} color={theme.primary} />
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              ))}
            </View>
          )}

          <View style={[styles.pagination, { borderTopColor: theme.border }]}>
            <Text style={{ fontSize: 11.5, color: theme.muted }}>Page {query.data?.page ?? 1} · {query.data?.total ?? 0} résultats</Text>
            <View style={{ flexDirection: "row", gap: 4 }}>
              <Pressable onPress={() => setPage((p) => Math.max(1, p - 1))} style={[styles.pageBtn, { borderColor: theme.border }]}>
                <MaterialIcons name="chevron-left" size={14} color={theme.foreground} />
              </Pressable>
              <Pressable onPress={() => setPage((p) => p + 1)} style={[styles.pageBtn, { borderColor: theme.border }]}>
                <MaterialIcons name="chevron-right" size={14} color={theme.foreground} />
              </Pressable>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function Badge({ text, bg, fg }: { text: string; bg: string; fg: string }) {
  return <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, backgroundColor: bg }}><Text style={{ fontSize: 10, fontWeight: "600", color: fg }}>{text}</Text></View>;
}

const styles = StyleSheet.create({
  title: { fontSize: 20, fontWeight: "600", letterSpacing: -0.4 },
  sub: { fontSize: 12.5, marginTop: 4 },
  card: { borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  tabsRow: { flexDirection: "row", padding: 8, gap: 4, borderBottomWidth: StyleSheet.hairlineWidth, flexWrap: "wrap" },
  tab: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  input: { flex: 1, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, fontSize: 12.5, borderWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: "row", padding: 12, borderBottomWidth: StyleSheet.hairlineWidth, gap: 10, alignItems: "center" },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  iconBtn: { width: 28, height: 28, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
  pagination: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 12, borderTopWidth: StyleSheet.hairlineWidth },
  pageBtn: { width: 28, height: 28, borderRadius: 6, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth },
});
