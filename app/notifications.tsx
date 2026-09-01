import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useThemeColors } from "@/lib/use-theme-colors";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";
import { formatRelativeDate, type InAppNotification } from "@/shared/tikis-domain";

const ICON_BY_TONE: Record<InAppNotification["tone"], { icon: React.ComponentProps<typeof MaterialIcons>["name"]; bgClass: "primary" | "success" | "warning" }> = {
  info: { icon: "notifications", bgClass: "primary" },
  success: { icon: "check-circle", bgClass: "success" },
  warning: { icon: "info", bgClass: "warning" },
};

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function dayKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayLabel(date: Date, now: Date) {
  if (sameDay(date, now)) return "Aujourd'hui";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return "Hier";
  const dayMs = 24 * 60 * 60 * 1000;
  if (now.getTime() - date.getTime() < 7 * dayMs) {
    return new Intl.DateTimeFormat("fr-FR", { weekday: "long" }).format(date).replace(/^./, (c) => c.toLocaleUpperCase("fr-FR"));
  }
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" }).format(date);
}

function timeShort(date: Date) {
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(date);
}

export default function NotificationsScreen() {
  const { colors: theme } = useThemeColors();
  const router = useRouter();
  const { profile } = useTikisStore();
  const notificationsQuery = trpc.notifications.list.useQuery(undefined, { enabled: Boolean(profile?.phone), refetchInterval: 8_000 });
  const markAllReadMutation = trpc.notifications.markRead.useMutation({ onSuccess: () => void notificationsQuery.refetch() });
  const markOneReadMutation = trpc.notifications.markOneRead.useMutation({ onSuccess: () => void notificationsQuery.refetch() });
  const notifications = useMemo(() => notificationsQuery.data ?? [], [notificationsQuery.data]);
  const unreadCount = notifications.filter((n) => !n.read).length;

  const groups = useMemo(() => {
    const now = new Date();
    const map = new Map<string, { label: string; date: Date; items: InAppNotification[] }>();
    for (const n of notifications) {
      const created = new Date(n.createdAt);
      const key = dayKey(created);
      let group = map.get(key);
      if (!group) {
        group = { label: dayLabel(created, now), date: created, items: [] };
        map.set(key, group);
      }
      group.items.push(n);
    }
    return Array.from(map.values()).sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [notifications]);

  function handleOpen(notif: InAppNotification) {
    if (!notif.read && !markOneReadMutation.isPending) {
      markOneReadMutation.mutate({ notificationId: notif.id });
    }
    if (notif.deliveryId) {
      router.push(`/delivery/${notif.deliveryId}` as any);
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={["top"]}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.iconBtn, { backgroundColor: theme.surface, borderColor: theme.border }, pressed && styles.pressed]}
          accessibilityLabel="Retour"
          accessibilityRole="button"
        >
          <MaterialIcons name="arrow-back" size={20} color={theme.foreground} />
        </Pressable>
        <Text style={[styles.topTitle, { color: theme.foreground }]}>Notifications</Text>
        {unreadCount > 0 ? (
          <Pressable
            onPress={() => { if (!markAllReadMutation.isPending) markAllReadMutation.mutate(); }}
            disabled={markAllReadMutation.isPending}
            style={({ pressed }) => [styles.topAction, pressed && styles.pressed]}
            accessibilityLabel="Marquer toutes les notifications comme lues"
          >
            <Text style={[styles.topActionText, { color: theme.primary }]}>Tout lire</Text>
          </Pressable>
        ) : (
          <View style={styles.iconBtnSpacer} />
        )}
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {notificationsQuery.isLoading ? (
          <View style={styles.loading}><ActivityIndicator color={theme.primary} /></View>
        ) : notificationsQuery.error ? (
          <View style={styles.empty}>
            <View style={[styles.emptyIcon, { backgroundColor: theme.surface, borderColor: theme.border }]}><MaterialIcons name="cloud-off" size={28} color={theme.muted} /></View>
            <Text style={[styles.emptyTitle, { color: theme.foreground }]}>Chargement indisponible</Text>
            <Text style={[styles.emptySub, { color: theme.muted }]}>Réessayez dans un instant.</Text>
          </View>
        ) : notifications.length === 0 ? (
          <View style={styles.empty}>
            <View style={[styles.emptyIcon, { backgroundColor: theme.surface, borderColor: theme.border }]}><MaterialIcons name="notifications-none" size={28} color={theme.muted} /></View>
            <Text style={[styles.emptyTitle, { color: theme.foreground }]}>Aucune notification</Text>
            <Text style={[styles.emptySub, { color: theme.muted }]}>Vos premiers événements apparaîtront ici dès que vous publierez une livraison ou recevrez un avis.</Text>
          </View>
        ) : (
          groups.map((group, gIdx) => (
            <View key={group.label + gIdx} style={styles.dateSection}>
              <View style={styles.dateLabelRow}>
                <Text style={[styles.dateLabel, { color: theme.muted }]}>{group.label}</Text>
                <View style={[styles.dateCount, { backgroundColor: theme.surface, borderColor: theme.border }]}><Text style={[styles.dateCountText, { color: theme.muted }]}>{group.items.length}</Text></View>
              </View>
              <View style={[styles.list, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                {group.items.map((notif, idx) => {
                  const tone = ICON_BY_TONE[notif.tone];
                  const created = new Date(notif.createdAt);
                  const isLast = idx === group.items.length - 1;
                  const toneBg = tone.bgClass === "primary" ? theme.primary + "22" : tone.bgClass === "success" ? theme.success + "22" : theme.warning + "22";
                  const toneFg = tone.bgClass === "primary" ? theme.primary : tone.bgClass === "success" ? theme.success : theme.warning;
                  return (
                    <Pressable
                      key={notif.id}
                      onPress={() => handleOpen(notif)}
                      disabled={markOneReadMutation.isPending}
                      style={({ pressed }) => [
                        styles.notif,
                        !notif.read && { backgroundColor: theme.pressed + "66" },
                        !isLast && { marginBottom: 2 },
                        pressed && { backgroundColor: theme.pressed },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`${notif.title}. ${notif.read ? "Lue" : "Non lue"}. Appuyer pour ouvrir.`}
                    >
                      <View style={[styles.notifIndicator, { backgroundColor: theme.primary }, notif.read && { backgroundColor: "transparent" }]} />
                      <View style={[styles.notifIcon, { backgroundColor: toneBg }]}>
                        <MaterialIcons name={tone.icon} size={14} color={toneFg} />
                      </View>
                      <View style={styles.notifBody}>
                        <View style={styles.notifLine1}>
                          <Text style={[styles.notifTitle, { color: theme.foreground }, !notif.read && { fontWeight: "700" }]} numberOfLines={1}>{notif.title}</Text>
                          <Text style={[styles.notifTime, { color: theme.muted }]}>{sameDay(created, new Date()) ? formatRelativeDate(notif.createdAt) : timeShort(created)}</Text>
                        </View>
                        <View style={styles.notifLine2}>
                          <Text style={[styles.notifSource, { color: theme.muted }]} numberOfLines={1}>{notif.tone === "info" ? "Notification" : notif.tone === "success" ? "Validé" : "Attention"}</Text>
                          <Text style={[styles.notifText, { color: theme.muted }]} numberOfLines={2}>{notif.body}</Text>
                        </View>
                      </View>
                      <MaterialIcons name="chevron-right" size={14} color={theme.muted} />
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },

  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4, gap: 8 },
  iconBtn: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  iconBtnSpacer: { width: 36 },
  topTitle: { flex: 1, fontSize: 15, fontWeight: "600", textAlign: "center" },
  topAction: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  topActionText: { fontSize: 12, fontWeight: "600" },
  pressed: { opacity: 0.7 },

  scroll: { padding: 8, paddingBottom: 24, gap: 12 },
  loading: { paddingVertical: 60, alignItems: "center" },

  dateSection: { paddingHorizontal: 4 },
  dateLabelRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, paddingTop: 8, paddingBottom: 6 },
  dateLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" },
  dateCount: { paddingHorizontal: 7, paddingVertical: 1, borderRadius: 99, minWidth: 22, alignItems: "center" },
  dateCountText: { fontSize: 9, fontWeight: "600" },

  list: { borderRadius: 12, overflow: "hidden", borderWidth: 1 },

  notif: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11, paddingHorizontal: 12 },

  notifIndicator: { width: 6, height: 6, borderRadius: 3, flexShrink: 0 },

  notifIcon: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  iconBgPrimary: {},
  iconBgSuccess: {},
  iconBgWarning: {},

  notifBody: { flex: 1, minWidth: 0 },
  notifLine1: { flexDirection: "row", alignItems: "center", gap: 6 },
  notifTitle: { fontSize: 12, fontWeight: "600", flex: 1 },
  notifTime: { fontSize: 10, flexShrink: 0 },
  notifLine2: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  notifSource: { fontSize: 9, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase", flexShrink: 0 },
  notifText: { fontSize: 11, flex: 1, lineHeight: 14 },

  empty: { alignItems: "center", paddingVertical: 50, paddingHorizontal: 24 },
  emptyIcon: { width: 64, height: 64, borderRadius: 16, alignItems: "center", justifyContent: "center", marginBottom: 14, borderWidth: 1 },
  emptyTitle: { fontSize: 15, fontWeight: "600" },
  emptySub: { fontSize: 12, textAlign: "center", lineHeight: 18, marginTop: 6, maxWidth: 260 },
});
