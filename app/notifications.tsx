import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTikisStore } from "@/lib/tikis-store";

const tones = {
  info: { icon: "notifications" as const, color: "#007B8B", background: "#E5F6F7" },
  success: { icon: "check-circle" as const, color: "#18A572", background: "#DCFCE7" },
  warning: { icon: "account-balance-wallet" as const, color: "#B45309", background: "#FEF3C7" },
};

export default function NotificationsScreen() {
  const { notifications, markNotificationsRead } = useTikisStore();

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <FlatList
        data={notifications}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={<View style={styles.header}><View><Text style={styles.eyebrow}>Centre d’activité</Text><Text style={styles.title}>Notifications</Text></View><Pressable onPress={() => router.back()} style={({ pressed }) => [styles.close, pressed && styles.pressed]}><MaterialIcons name="close" size={22} color="#0B1F3A" /></Pressable></View>}
        renderItem={({ item }) => {
          const tone = tones[item.tone];
          return <Pressable onPress={markNotificationsRead} style={({ pressed }) => [styles.item, !item.read && styles.itemUnread, pressed && styles.pressed]}><View style={[styles.icon, { backgroundColor: tone.background }]}><MaterialIcons name={tone.icon} size={20} color={tone.color} /></View><View style={styles.itemBody}><View style={styles.itemTop}><Text style={styles.itemTitle}>{item.title}</Text>{!item.read ? <View style={styles.unread} /> : null}</View><Text style={styles.itemText}>{item.body}</Text><Text style={styles.itemTime}>{item.createdAt}</Text></View></Pressable>;
        }}
        ListFooterComponent={<Pressable onPress={markNotificationsRead} style={({ pressed }) => [styles.markAll, pressed && styles.pressed]}><Text style={styles.markAllText}>Tout marquer comme lu</Text></Pressable>}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F6F8FC" }, content: { padding: 20, paddingBottom: 35 }, header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 22 }, eyebrow: { color: "#007B8B", fontSize: 12, fontWeight: "900", letterSpacing: 0.7, textTransform: "uppercase" }, title: { color: "#0B1F3A", fontSize: 28, fontWeight: "900", marginTop: 3, letterSpacing: -0.5 }, close: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 21, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E7ECF2" }, item: { flexDirection: "row", gap: 12, padding: 14, borderRadius: 18, marginBottom: 9, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E7ECF2" }, itemUnread: { borderColor: "#B9DDE1", backgroundColor: "#FBFFFF" }, icon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" }, itemBody: { flex: 1 }, itemTop: { flexDirection: "row", alignItems: "center", gap: 8 }, itemTitle: { color: "#0B1F3A", fontSize: 14, fontWeight: "900", flex: 1 }, unread: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#007B8B" }, itemText: { color: "#697386", fontSize: 12, lineHeight: 18, marginTop: 3 }, itemTime: { color: "#9AA5B6", fontSize: 11, marginTop: 6 }, markAll: { alignItems: "center", paddingVertical: 18 }, markAllText: { color: "#007B8B", fontWeight: "900", fontSize: 14 }, pressed: { opacity: 0.67 },
});

