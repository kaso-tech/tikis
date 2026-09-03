import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useState } from "react";
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { type ThemedColors, useThemeColors } from "@/lib/use-theme-colors";
import { trpc } from "@/lib/trpc";

type Session = {
  id: string;
  tokenLast4: string;
  deviceName: string | null;
  platform: "ios" | "android" | "web" | "unknown";
  appVersion: string | null;
  ipAddress: string | null;
  lastSeenAt: string;
  createdAt: string;
  isCurrent: boolean;
};

const PLATFORM_ICON: Record<Session["platform"], keyof typeof MaterialIcons.glyphMap> = {
  ios: "phone-iphone",
  android: "phone-android",
  web: "computer",
  unknown: "devices-other",
};

const PLATFORM_LABEL: Record<Session["platform"], string> = {
  ios: "iOS",
  android: "Android",
  web: "Web",
  unknown: "Appareil",
};

function formatRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "à l'instant";
  if (diff < 3_600_000) return `il y a ${Math.floor(diff / 60_000)} min`;
  if (diff < 86_400_000) return `il y a ${Math.floor(diff / 3_600_000)} h`;
  return `il y a ${Math.floor(diff / 86_400_000)} j`;
}

export function SessionsSection() {
  const { colors: theme } = useThemeColors();
  const styles = makeStyles(theme);
  const utils = trpc.useUtils();
  const query = trpc.sessions.list.useQuery();
  const registerCurrent = trpc.sessions.registerCurrent.useMutation();
  const revoke = trpc.sessions.revoke.useMutation();
  const revokeAll = trpc.sessions.revokeAllOthers.useMutation();
  const [busy, setBusy] = useState(false);

  async function registerNow() {
    setBusy(true);
    try {
      await registerCurrent.mutateAsync({ platform: Platform.OS === "web" ? "web" : (Platform.OS as "ios" | "android") });
      await utils.sessions.list.invalidate();
    } finally {
      setBusy(false);
    }
  }

  function confirmRevoke(session: Session) {
    Alert.alert(
      "Déconnecter cet appareil ?",
      `Cette session (${session.deviceName ?? PLATFORM_LABEL[session.platform]} · …${session.tokenLast4}) ne pourra plus se reconnecter sans un nouveau login.`,
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Déconnecter",
          style: "destructive",
          onPress: async () => {
            try {
              await revoke.mutateAsync({ sessionId: session.id });
              await utils.sessions.list.invalidate();
            } catch (cause) {
              Alert.alert("Erreur", cause instanceof Error ? cause.message : "Impossible de déconnecter cette session.");
            }
          },
        },
      ],
    );
  }

  function confirmRevokeAll() {
    Alert.alert(
      "Déconnecter tous les autres appareils ?",
      "Toutes les autres sessions actives seront révoquées. Tu resteras connecté uniquement sur cet appareil.",
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Tout déconnecter",
          style: "destructive",
          onPress: async () => {
            try {
              await revokeAll.mutateAsync();
              await utils.sessions.list.invalidate();
            } catch (cause) {
              Alert.alert("Erreur", cause instanceof Error ? cause.message : "Impossible de déconnecter les autres sessions.");
            }
          },
        },
      ],
    );
  }

  const sessions = (query.data ?? []) as Session[];

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <MaterialIcons name="devices" size={18} color={theme.primary} />
          <Text style={styles.title}>Appareils connectés</Text>
        </View>
        <Text style={styles.count}>{sessions.length}</Text>
      </View>
      <Text style={styles.subtitle}>Liste des sessions actives sur ton compte. Révoque celles que tu ne reconnais pas.</Text>

      <View style={styles.actions}>
        <Text style={styles.btnGhost} onPress={registerNow} disabled={busy}>{busy ? "..." : "Enregistrer cette session"}</Text>
        {sessions.length > 1 ? <Text style={styles.btnDanger} onPress={confirmRevokeAll}>Tout déconnecter (sauf ici)</Text> : null}
      </View>

      {query.isLoading ? <ActivityIndicator size="small" color={theme.primary} /> : null}
      {query.error ? <Text style={styles.errorText}>Impossible de charger les sessions actives.</Text> : null}

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {sessions.map((session) => (
          <View key={session.id} style={[styles.item, session.isCurrent && styles.itemCurrent]}>
            <View style={styles.itemIcon}>
              <MaterialIcons name={PLATFORM_ICON[session.platform] ?? "devices-other"} size={20} color={session.isCurrent ? theme.primary : theme.muted} />
            </View>
            <View style={styles.itemBody}>
              <Text style={styles.itemName} numberOfLines={1}>{session.deviceName ?? `${PLATFORM_LABEL[session.platform]} · …${session.tokenLast4}`}</Text>
              <Text style={styles.itemMeta} numberOfLines={1}>
                {PLATFORM_LABEL[session.platform]} · actif {formatRelative(session.lastSeenAt)}
                {session.ipAddress ? ` · ${session.ipAddress}` : ""}
              </Text>
            </View>
            {session.isCurrent ? (
              <View style={[styles.pill, { backgroundColor: theme.background }]}>
                <Text style={[styles.pillText, { color: theme.muted }]}>Cet appareil</Text>
              </View>
            ) : (
              <Text style={styles.btnItemDanger} onPress={() => confirmRevoke(session)}>Déconnecter</Text>
            )}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function makeStyles(theme: ThemedColors) {
  return StyleSheet.create({
    card: { backgroundColor: theme.surface, borderRadius: 10, borderWidth: 0, padding: 14, gap: 10, marginBottom: 12 },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    headerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
    title: { fontSize: 14, fontWeight: "600", color: theme.foreground },
    count: { fontSize: 13, fontWeight: "600", color: theme.muted },
    subtitle: { fontSize: 12, color: theme.muted, lineHeight: 18 },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    btnGhost: { fontSize: 12, fontWeight: "600", color: theme.primary, paddingVertical: 6, paddingHorizontal: 10, backgroundColor: theme.background, borderRadius: 6, overflow: "hidden" },
    btnDanger: { fontSize: 12, fontWeight: "600", color: theme.error, paddingVertical: 6, paddingHorizontal: 10, backgroundColor: theme.background, borderRadius: 6, overflow: "hidden" },
    list: { maxHeight: 260 },
    listContent: { gap: 8 },
    item: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, backgroundColor: theme.background, borderRadius: 8 },
    itemCurrent: { borderWidth: 1, borderColor: theme.primary },
    itemIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: theme.surface, alignItems: "center", justifyContent: "center" },
    itemBody: { flex: 1, minWidth: 0 },
    itemName: { fontSize: 13, fontWeight: "600", color: theme.foreground },
    itemMeta: { fontSize: 11, color: theme.muted, marginTop: 2 },
    pill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
    pillText: { fontSize: 10.5, fontWeight: "700" },
    btnItemDanger: { fontSize: 12, fontWeight: "600", color: theme.error, paddingVertical: 4, paddingHorizontal: 8 },
    errorText: { fontSize: 12, color: theme.error },
  });
}
