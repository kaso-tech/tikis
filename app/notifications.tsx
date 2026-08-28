import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";
import { formatRelativeDate } from "@/shared/tikis-domain";

const tones = {
  info: { icon: "notifications" as const, color: "#007B8B", background: "#EEEDF3" },
  success: { icon: "check-circle" as const, color: "#167A55", background: "#EEEDF3" },
  warning: { icon: "account-balance-wallet" as const, color: "#9A6200", background: "#EEEDF3" },
};

export default function NotificationsScreen() {
  const { profile } = useTikisStore();
  const notificationsQuery = trpc.notifications.list.useQuery(undefined, { enabled: Boolean(profile?.phone), refetchInterval: 12_000 });
  const markReadMutation = trpc.notifications.markRead.useMutation({ onSuccess: () => void notificationsQuery.refetch() });
  const notifications = notificationsQuery.data ?? [];
  const markRead = () => { if (!markReadMutation.isPending) markReadMutation.mutate(); };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <FlatList
        data={notifications}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={<View style={styles.header}><View><Text style={styles.eyebrow}>Centre d’activité</Text><Text style={styles.title}>Notifications</Text></View><Pressable onPress={() => router.back()} style={({ pressed }) => [styles.close, pressed && styles.pressed]}><MaterialIcons name="close" size={22} color="#111111" /></Pressable></View>}
        renderItem={({ item }) => {
          const tone = tones[item.tone];
          return <Pressable onPress={markRead} disabled={markReadMutation.isPending} style={({ pressed }) => [styles.item, !item.read && styles.itemUnread, pressed && styles.pressed]}><View style={[styles.icon, { backgroundColor: tone.background }]}><MaterialIcons name={tone.icon} size={20} color={tone.color} /></View><View style={styles.itemBody}><View style={styles.itemTop}><Text style={styles.itemTitle}>{item.title}</Text>{!item.read ? <View style={styles.unread} /> : null}</View><Text style={styles.itemText}>{item.body}</Text><Text style={styles.itemTime}>{formatRelativeDate(item.createdAt)}</Text></View></Pressable>;
        }}
        ListEmptyComponent={<View style={styles.empty}><MaterialIcons name={notificationsQuery.isLoading ? "hourglass-empty" : "notifications-none"} size={32} color="#8A96A8" /><Text style={styles.emptyTitle}>{notificationsQuery.error ? "Chargement indisponible" : notificationsQuery.isLoading ? "Chargement…" : "Aucune notification"}</Text><Text style={styles.emptyText}>{notificationsQuery.error ? "Réessayez dans un instant." : "Les changements liés à vos livraisons apparaîtront ici."}</Text></View>}
        ListFooterComponent={notifications.length ? <Pressable onPress={markRead} disabled={markReadMutation.isPending} style={({ pressed }) => [styles.markAll, pressed && styles.pressed]}><Text style={styles.markAllText}>{markReadMutation.isPending ? "Marquage en cours…" : "Tout marquer comme lu"}</Text></Pressable> : null}
      />
    </SafeAreaView>
  );
}

const baseStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F6F8FC" }, content: { padding: 20, paddingBottom: 35, flexGrow: 1 }, header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 22 }, eyebrow: { color: "#007B8B", fontSize: 12, fontWeight: "900", letterSpacing: 0.7, textTransform: "uppercase" }, title: { color: "#0B1F3A", fontSize: 28, fontWeight: "900", marginTop: 3, letterSpacing: -0.5 }, close: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 21, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E7ECF2" }, item: { flexDirection: "row", gap: 12, padding: 14, borderRadius: 18, marginBottom: 9, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E7ECF2" }, itemUnread: { borderColor: "#B9DDE1", backgroundColor: "#FBFFFF" }, icon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" }, itemBody: { flex: 1 }, itemTop: { flexDirection: "row", alignItems: "center", gap: 8 }, itemTitle: { color: "#0B1F3A", fontSize: 14, fontWeight: "900", flex: 1 }, unread: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#007B8B" }, itemText: { color: "#697386", fontSize: 12, lineHeight: 18, marginTop: 3 }, itemTime: { color: "#9AA5B6", fontSize: 11, marginTop: 6 }, markAll: { alignItems: "center", paddingVertical: 18 }, markAllText: { color: "#007B8B", fontWeight: "900", fontSize: 14 }, empty: { alignItems: "center", justifyContent: "center", paddingTop: 70, paddingHorizontal: 35 }, emptyTitle: { color: "#0B1F3A", fontSize: 16, fontWeight: "900", marginTop: 12 }, emptyText: { color: "#697386", fontSize: 13, textAlign: "center", marginTop: 5 }, pressed: { opacity: 0.67 },
});

const styles = StyleSheet.create({
  ...baseStyles,
  safe: { ...baseStyles.safe, backgroundColor: "#EEEDF3" },
  content: { ...baseStyles.content, padding: 16, paddingBottom: 28 },
  header: { ...baseStyles.header, marginBottom: 16 },
  eyebrow: { ...baseStyles.eyebrow, fontWeight: "600" },
  title: { ...baseStyles.title, color: "#111111", fontWeight: "600", fontSize: 25 },
  close: { ...baseStyles.close, borderRadius: 8, borderWidth: 0 },
  item: { ...baseStyles.item, gap: 10, padding: 12, borderRadius: 10, marginBottom: 7, borderWidth: 0 },
  itemUnread: { ...baseStyles.itemUnread, borderWidth: 0, backgroundColor: "#FFFFFF" },
  icon: { ...baseStyles.icon, borderRadius: 8 },
  itemTitle: { ...baseStyles.itemTitle, color: "#111111", fontWeight: "600" },
  markAllText: { ...baseStyles.markAllText, fontWeight: "600" },
  emptyTitle: { ...baseStyles.emptyTitle, color: "#111111", fontWeight: "600" },
});
