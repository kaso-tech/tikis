import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Avatar, SurfaceCard, TikisButton, tikisStyles } from "@/components/tikis/ui";
import { haptic } from "@/lib/haptics";
import { useTikisStore } from "@/lib/tikis-store";

export default function ProfileScreen() {
  const { role, setRole, notifications, markNotificationsRead } = useTikisStore();
  const unread = notifications.filter((item) => !item.read).length;
  const driver = role === "driver";
  const items = [
    { icon: "notifications-none" as const, label: "Notifications", detail: unread ? `${unread} nouvelle${unread > 1 ? "s" : ""}` : "À jour", action: markNotificationsRead },
    { icon: "verified-user" as const, label: driver ? "Compte vérifié" : "Sécurité du compte", detail: driver ? "Documents validés" : "Numéro confirmé", action: () => Alert.alert("Sécurité Tikis", "Votre numéro de téléphone est vérifié par code OTP dans cette démonstration.") },
    { icon: "help-outline" as const, label: "Assistance Tikis", detail: "Nous contacter", action: () => Alert.alert("Assistance", "Un canal d’assistance sera relié à ce bouton lors de l’intégration de production.") },
  ];

  return (
    <View style={tikisStyles.screen}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.label}
        contentContainerStyle={styles.list}
        ListHeaderComponent={<>
          <Text style={tikisStyles.eyebrow}>Votre espace</Text>
          <Text style={[tikisStyles.title, styles.title]}>Profil</Text>
          <SurfaceCard style={styles.profileCard}>
            <Avatar initials={driver ? "AK" : "AT"} color={driver ? "#007B8B" : "#0B1F3A"} size={56} />
            <View style={styles.profileInfo}><Text style={styles.name}>{driver ? "Antoine Kaboré" : "Aïcha Traoré"}</Text><Text style={styles.phone}>+226 70 00 00 00</Text></View>
            <MaterialIcons name="chevron-right" size={23} color="#9AA5B6" />
          </SurfaceCard>
          <Text style={styles.roleLabel}>MODE DE DÉMONSTRATION</Text>
          <View style={styles.roleSwitch}><Pressable onPress={() => { haptic.selection(); setRole("sender"); }} style={({ pressed }) => [styles.roleOption, role === "sender" && styles.roleActive, pressed && styles.pressed]}><MaterialIcons name="send" size={17} color={role === "sender" ? "#FFFFFF" : "#697386"} /><Text style={[styles.roleText, role === "sender" && styles.roleTextActive]}>Expéditeur</Text></Pressable><Pressable onPress={() => { haptic.selection(); setRole("driver"); }} style={({ pressed }) => [styles.roleOption, role === "driver" && styles.roleActive, pressed && styles.pressed]}><MaterialIcons name="two-wheeler" size={18} color={role === "driver" ? "#FFFFFF" : "#697386"} /><Text style={[styles.roleText, role === "driver" && styles.roleTextActive]}>Livreur</Text></Pressable></View>
          {driver ? <SurfaceCard style={styles.verificationCard}><MaterialIcons name="verified" size={22} color="#18A572" /><View style={styles.verificationTextWrap}><Text style={styles.verificationTitle}>Profil vérifié</Text><Text style={styles.verificationText}>Vous pouvez répondre aux courses compatibles avec vos engins.</Text></View></SurfaceCard> : null}
          <Text style={styles.sectionLabel}>PRÉFÉRENCES ET ASSISTANCE</Text>
        </>}
        renderItem={({ item }) => <Pressable onPress={() => { haptic.light(); item.action(); }} style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}><View style={styles.menuIcon}><MaterialIcons name={item.icon} size={21} color="#007B8B" /></View><View style={styles.menuInfo}><Text style={styles.menuLabel}>{item.label}</Text><Text style={styles.menuDetail}>{item.detail}</Text></View><MaterialIcons name="chevron-right" size={22} color="#A4AFBE" /></Pressable>}
        ListFooterComponent={<TikisButton label="Se déconnecter" variant="ghost" icon="logout" onPress={() => Alert.alert("Déconnexion", "Dans cette démonstration, ce bouton vous ramène au parcours de connexion.")} style={styles.logout} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: 20, paddingBottom: 115 }, title: { marginTop: 3, marginBottom: 18 },
  profileCard: { flexDirection: "row", alignItems: "center", gap: 12 }, profileInfo: { flex: 1 }, name: { color: "#0B1F3A", fontSize: 17, fontWeight: "900" }, phone: { color: "#697386", fontSize: 13, marginTop: 3 },
  roleLabel: { color: "#8A96A8", fontSize: 11, fontWeight: "900", letterSpacing: 0.7, marginTop: 26, marginBottom: 8 }, roleSwitch: { flexDirection: "row", padding: 4, borderRadius: 16, backgroundColor: "#E8EDF3", gap: 4 }, roleOption: { flex: 1, height: 43, borderRadius: 12, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center" }, roleActive: { backgroundColor: "#007B8B" }, roleText: { color: "#697386", fontSize: 13, fontWeight: "900" }, roleTextActive: { color: "#FFFFFF" },
  verificationCard: { marginTop: 13, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#F0FDF8", borderColor: "#D3F5E4" }, verificationTextWrap: { flex: 1 }, verificationTitle: { color: "#147A58", fontWeight: "900", fontSize: 14 }, verificationText: { color: "#4F7A6C", fontSize: 12, lineHeight: 17, marginTop: 2 },
  sectionLabel: { color: "#8A96A8", fontSize: 11, fontWeight: "900", letterSpacing: 0.7, marginTop: 26, marginBottom: 8 }, menuRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderColor: "#E7ECF2" }, menuIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#E5F6F7", marginRight: 11 }, menuInfo: { flex: 1 }, menuLabel: { color: "#0B1F3A", fontWeight: "800", fontSize: 14 }, menuDetail: { color: "#778398", fontSize: 12, marginTop: 2 }, logout: { marginTop: 28 }, pressed: { opacity: 0.67 },
});

