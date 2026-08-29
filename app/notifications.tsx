import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useMemo } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
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
  const { profile } = useTikisStore();
  const notificationsQuery = trpc.notifications.list.useQuery(undefined, { enabled: Boolean(profile?.phone), refetchInterval: 12_000 });
  const markReadMutation = trpc.notifications.markRead.useMutation({ onSuccess: () => void notificationsQuery.refetch() });
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

  const markAllRead = () => {
    if (unreadCount === 0 || markReadMutation.isPending) return;
    markReadMutation.mutate();
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => null} style={styles.iconBtn} accessibilityLabel="Ouvrir le menu">
          <MaterialIcons name="menu" size={20} color="#111111" />
        </Pressable>
        <Text style={styles.topTitle}>Notifications</Text>
        {unreadCount > 0 ? (
          <Pressable onPress={markAllRead} disabled={markReadMutation.isPending} style={({ pressed }) => [styles.topAction, pressed && styles.pressed]}>
            <Text style={styles.topActionText}>Tout lire</Text>
          </Pressable>
        ) : (
          <View style={styles.iconBtnSpacer} />
        )}
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {notificationsQuery.isLoading ? (
          <View style={styles.loading}><ActivityIndicator color="#007B8B" /></View>
        ) : notificationsQuery.error ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}><MaterialIcons name="cloud-off" size={28} color="#747474" /></View>
            <Text style={styles.emptyTitle}>Chargement indisponible</Text>
            <Text style={styles.emptySub}>Réessayez dans un instant.</Text>
          </View>
        ) : notifications.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}><MaterialIcons name="notifications-none" size={28} color="#747474" /></View>
            <Text style={styles.emptyTitle}>Aucune notification</Text>
            <Text style={styles.emptySub}>Vos premiers événements apparaîtront ici dès que vous publierez une livraison ou recevrez un avis.</Text>
          </View>
        ) : (
          groups.map((group, gIdx) => (
            <View key={group.label + gIdx} style={styles.dateSection}>
              <View style={styles.dateLabelRow}>
                <Text style={styles.dateLabel}>{group.label}</Text>
                <View style={styles.dateCount}><Text style={styles.dateCountText}>{group.items.length}</Text></View>
              </View>
              <View style={styles.list}>
                {group.items.map((notif, idx) => {
                  const tone = ICON_BY_TONE[notif.tone];
                  const created = new Date(notif.createdAt);
                  const isLast = idx === group.items.length - 1;
                  return (
                    <Pressable
                      key={notif.id}
                      onPress={() => { if (!notif.read) markReadMutation.mutate(); }}
                      disabled={markReadMutation.isPending}
                      style={({ pressed }) => [styles.notif, !notif.read && styles.notifUnread, !isLast && styles.notifDivider, pressed && styles.pressed]}
                    >
                      <View style={[styles.notifIndicator, notif.read && styles.notifIndicatorRead]} />
                      <View style={[styles.notifIcon, tone.bgClass === "primary" ? styles.iconBgPrimary : tone.bgClass === "success" ? styles.iconBgSuccess : styles.iconBgWarning]}>
                        <MaterialIcons name={tone.icon} size={14} color={tone.bgClass === "primary" ? "#007B8B" : tone.bgClass === "success" ? "#167A55" : "#9A6200"} />
                      </View>
                      <View style={styles.notifBody}>
                        <View style={styles.notifLine1}>
                          <Text style={styles.notifTitle} numberOfLines={1}>{notif.title}</Text>
                          <Text style={styles.notifTime}>{sameDay(created, new Date()) ? formatRelativeDate(notif.createdAt) : timeShort(created)}</Text>
                        </View>
                        <View style={styles.notifLine2}>
                          <Text style={styles.notifSource} numberOfLines={1}>{notif.tone === "info" ? "Notification" : notif.tone === "success" ? "Validé" : "Attention"}</Text>
                          <Text style={styles.notifText} numberOfLines={1}>{notif.body}</Text>
                        </View>
                      </View>
                      <MaterialIcons name="chevron-right" size={14} color="#747474" />
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
  safe: { flex: 1, backgroundColor: "#EEEDF3" },

  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4, gap: 8 },
  iconBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  iconBtnSpacer: { width: 36 },
  topTitle: { flex: 1, color: "#111111", fontSize: 15, fontWeight: "600", textAlign: "center" },
  topAction: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  topActionText: { color: "#007B8B", fontSize: 12, fontWeight: "600" },
  pressed: { opacity: 0.7 },

  scroll: { padding: 8, paddingBottom: 24, gap: 12 },
  loading: { paddingVertical: 60, alignItems: "center" },

  dateSection: { paddingHorizontal: 4 },
  dateLabelRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, paddingTop: 8, paddingBottom: 6 },
  dateLabel: { color: "#747474", fontSize: 10, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" },
  dateCount: { backgroundColor: "#FFFFFF", paddingHorizontal: 7, paddingVertical: 1, borderRadius: 99, minWidth: 22, alignItems: "center" },
  dateCountText: { color: "#666666", fontSize: 9, fontWeight: "600" },

  list: { backgroundColor: "#FFFFFF", borderRadius: 12, overflow: "hidden" },

  notif: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11, paddingHorizontal: 12 },
  notifUnread: { backgroundColor: "#F4F4F6" },
  notifDivider: { borderBottomWidth: 1, borderBottomColor: "#ECECEC" },

  notifIndicator: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#007B8B", flexShrink: 0 },
  notifIndicatorRead: { backgroundColor: "transparent" },

  notifIcon: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  iconBgPrimary: { backgroundColor: "#E2F3F4" },
  iconBgSuccess: { backgroundColor: "#E2F3F4" },
  iconBgWarning: { backgroundColor: "#FEF6E2" },

  notifBody: { flex: 1, minWidth: 0 },
  notifLine1: { flexDirection: "row", alignItems: "center", gap: 6 },
  notifTitle: { color: "#111111", fontSize: 12, fontWeight: "600", flex: 1 },
  notifTime: { color: "#747474", fontSize: 10, flexShrink: 0 },
  notifLine2: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  notifSource: { color: "#747474", fontSize: 9, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase", flexShrink: 0 },
  notifText: { color: "#666666", fontSize: 11, flex: 1, lineHeight: 14 },

  empty: { alignItems: "center", paddingVertical: 50, paddingHorizontal: 24 },
  emptyIcon: { width: 64, height: 64, borderRadius: 16, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", marginBottom: 14 },
  emptyTitle: { color: "#111111", fontSize: 15, fontWeight: "600" },
  emptySub: { color: "#666666", fontSize: 12, textAlign: "center", lineHeight: 18, marginTop: 6, maxWidth: 260 },
});
