import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router, usePathname } from "expo-router";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "@/components/tikis/ui";
import { haptic } from "@/lib/haptics";
import { useTikisNavigation } from "@/lib/tikis-navigation";
import { useTikisStore } from "@/lib/tikis-store";
import type { UserRole } from "@/shared/tikis-domain";

type DrawerItem = {
  key: string;
  label: string;
  caption?: string;
  icon: React.ComponentProps<typeof MaterialIcons>["name"];
  route: string;
  badge?: number;
};

const drawerItems = (role: UserRole, unread: number): DrawerItem[] => {
  const shared: DrawerItem[] = [
    { key: "home", label: "Accueil", caption: "Vue d’ensemble", icon: "home-filled", route: "/(tabs)" },
    { key: "deliveries", label: role === "sender" ? "Mes livraisons" : "Opportunités", caption: role === "sender" ? "Suivi de vos courses" : "Courses compatibles", icon: "local-shipping", route: "/(tabs)/deliveries" },
  ];
  if (role === "driver") {
    shared.push({ key: "wallet", label: "Mon Wallet", caption: "Solde et mouvements", icon: "account-balance-wallet", route: "/(tabs)/wallet" });
  }
  return [
    ...shared,
    { key: "notifications", label: "Notifications", caption: "Activité de vos courses", icon: "notifications", route: "/notifications", badge: unread },
    { key: "history", label: "Historique", caption: "Courses terminées", icon: "history", route: "/history" },
    { key: "reviews", label: "Mes avis", caption: role === "driver" ? "Évaluations reçues" : "Évaluations envoyées", icon: "star-outline", route: "/reviews" },
    { key: "profile", label: "Profil et préférences", caption: "Compte, rôle et assistance", icon: "person", route: "/(tabs)/profile" },
  ];
};

function unreadLabel(count: number) {
  return count > 9 ? "9+" : String(count);
}

export function TikisHeader() {
  const { openDrawer } = useTikisNavigation();
  const insets = useSafeAreaInsets();
  const { role, notifications } = useTikisStore();
  const unread = notifications.filter((item) => !item.read).length;
  const roleLabel = role === "sender" ? "Espace expéditeur" : "Espace livreur";

  return <View style={[styles.header, { height: 58 + Math.max(insets.top, 8), paddingTop: Math.max(insets.top, 8) }]}><Pressable accessibilityRole="button" accessibilityLabel="Ouvrir le menu" onPress={() => { haptic.light(); openDrawer(); }} style={({ pressed }) => [styles.headerIcon, pressed && styles.pressed]}><MaterialIcons name="menu" size={25} color="#0B1F3A" /></Pressable><View style={styles.brand}><View style={styles.brandMark}><MaterialIcons name="local-shipping" size={16} color="#FFFFFF" /></View><View><Text style={styles.brandName}>tIKIS</Text><Text style={styles.brandContext}>{roleLabel}</Text></View></View><Pressable accessibilityRole="button" accessibilityLabel="Ouvrir les notifications" onPress={() => { haptic.light(); router.push("/notifications" as any); }} style={({ pressed }) => [styles.headerIcon, pressed && styles.pressed]}><MaterialIcons name="notifications-none" size={24} color="#0B1F3A" />{unread > 0 ? <View style={styles.headerBadge}><Text style={styles.headerBadgeText}>{unreadLabel(unread)}</Text></View> : null}</Pressable></View>;
}

export function TikisDrawer() {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { isDrawerOpen, closeDrawer } = useTikisNavigation();
  const { role, profile, logout, notifications } = useTikisStore();
  const unread = notifications.filter((item) => !item.read).length;
  const items = drawerItems(role, unread);
  const name = profile?.fullName ?? (role === "sender" ? "Aïcha Traoré" : "Antoine Kaboré");
  const initials = name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase();

  function navigate(route: string) {
    closeDrawer();
    router.push(route as any);
  }

  return <Modal visible={isDrawerOpen} transparent animationType="fade" onRequestClose={closeDrawer} statusBarTranslucent><View style={styles.drawerModal}><View style={[styles.drawerPanel, { paddingTop: Math.max(insets.top, 16) }]}><View style={styles.drawerTop}><Text style={styles.drawerEyebrow}>NAVIGATION</Text><Pressable accessibilityRole="button" accessibilityLabel="Fermer le menu" onPress={closeDrawer} style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}><MaterialIcons name="close" size={21} color="#0B1F3A" /></Pressable></View><View style={styles.profileBlock}><Avatar initials={initials} color={role === "sender" ? "#7657A7" : "#007B8B"} /><View style={styles.profileText}><Text style={styles.profileName}>{name}</Text><View style={styles.rolePill}><View style={styles.roleDot} /><Text style={styles.roleLabel}>{role === "sender" ? "Expéditeur vérifié" : "Livreur vérifié"}</Text></View></View></View><View style={styles.lockedAccount}><MaterialIcons name="lock" size={16} color="#8A5A0E" /><Text style={styles.lockedAccountText}>Type de compte définitif : {role === "sender" ? "Expéditeur" : "Livreur"}</Text></View><Text style={styles.menuLabel}>ESPACE TIKIS</Text><View style={styles.menu}>{items.map((item) => <DrawerRow key={item.key} item={item} active={pathname === item.route || (item.key === "home" && pathname === "/")} onPress={() => navigate(item.route)} />)}</View><View style={styles.drawerFooter}><View style={styles.securityRow}><MaterialIcons name="verified-user" size={17} color="#18A572" /><Text style={styles.securityText}>Votre compte est sécurisé par Tikis</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Se déconnecter" onPress={() => { logout(); closeDrawer(); router.replace("/" as any); }} style={({ pressed }) => [styles.signOut, pressed && styles.pressed]}><MaterialIcons name="logout" size={19} color="#C23B45" /><Text style={styles.signOutText}>Se déconnecter</Text></Pressable></View></View><Pressable accessibilityRole="button" accessibilityLabel="Fermer le menu" onPress={closeDrawer} style={styles.scrim} /></View></Modal>;
}

function DrawerRow({ item, active, onPress }: { item: DrawerItem; active: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.menuRow, active && styles.menuRowActive, pressed && styles.pressed]}><View style={[styles.menuIcon, active && styles.menuIconActive]}><MaterialIcons name={item.icon} size={20} color={active ? "#FFFFFF" : "#007B8B"} /></View><View style={styles.menuText}><Text style={[styles.menuTitle, active && styles.menuTitleActive]}>{item.label}</Text>{item.caption ? <Text style={[styles.menuCaption, active && styles.menuCaptionActive]}>{item.caption}</Text> : null}</View>{item.badge && item.badge > 0 ? <View style={styles.menuBadge}><Text style={styles.menuBadgeText}>{unreadLabel(item.badge)}</Text></View> : <MaterialIcons name="chevron-right" size={20} color={active ? "#B9E1E6" : "#B0BBC8"} />}</Pressable>;
}

const styles = StyleSheet.create({
  header: { backgroundColor: "#FFFFFF", borderBottomWidth: 1, borderColor: "#E7ECF2", paddingHorizontal: 16, paddingBottom: 8, flexDirection: "row", alignItems: "center" }, headerIcon: { width: 43, height: 43, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "#F6F8FC", borderWidth: 1, borderColor: "#E7ECF2" }, brand: { flex: 1, flexDirection: "row", alignItems: "center", gap: 9, paddingLeft: 13 }, brandMark: { width: 31, height: 31, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "#007B8B" }, brandName: { color: "#0B1F3A", fontSize: 18, fontWeight: "900", letterSpacing: -0.4 }, brandContext: { color: "#78869A", fontSize: 10, fontWeight: "700", marginTop: -1 }, headerBadge: { position: "absolute", right: 4, top: 4, minWidth: 17, height: 17, borderRadius: 9, backgroundColor: "#C23B45", alignItems: "center", justifyContent: "center", paddingHorizontal: 3, borderWidth: 1.5, borderColor: "#FFFFFF" }, headerBadgeText: { color: "#FFFFFF", fontWeight: "900", fontSize: 9 }, drawerModal: { flex: 1, flexDirection: "row" }, scrim: { flex: 1, backgroundColor: "rgba(8,22,42,0.48)" }, drawerPanel: { width: "100%", maxWidth: 380, minHeight: "100%", backgroundColor: "#FFFFFF", paddingHorizontal: 18, paddingBottom: 20 }, drawerTop: { height: 44, alignItems: "center", flexDirection: "row", justifyContent: "space-between" }, drawerEyebrow: { color: "#8A96A8", fontSize: 10, fontWeight: "900", letterSpacing: 1 }, closeButton: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "#F6F8FC" }, profileBlock: { flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 15, paddingBottom: 14 }, profileText: { flex: 1 }, profileName: { color: "#0B1F3A", fontSize: 17, fontWeight: "900" }, rolePill: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4 }, roleDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#18A572" }, roleLabel: { color: "#697386", fontSize: 12, fontWeight: "700" }, lockedAccount: { padding: 11, backgroundColor: "#FFF7E6", borderRadius: 14, flexDirection: "row", alignItems: "center", gap: 8 }, lockedAccountText: { color: "#8A5A0E", fontSize: 12, fontWeight: "800", flex: 1 }, menuLabel: { color: "#8A96A8", fontSize: 10, fontWeight: "900", letterSpacing: 0.9, marginTop: 25, marginBottom: 8 }, menu: { gap: 4 }, menuRow: { minHeight: 66, borderRadius: 17, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 10 }, menuRowActive: { backgroundColor: "#0B1F3A" }, menuIcon: { width: 39, height: 39, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "#E5F6F7" }, menuIconActive: { backgroundColor: "#007B8B" }, menuText: { flex: 1 }, menuTitle: { color: "#0B1F3A", fontSize: 14, fontWeight: "900" }, menuTitleActive: { color: "#FFFFFF" }, menuCaption: { color: "#8A96A8", fontSize: 11, marginTop: 2 }, menuCaptionActive: { color: "#C1D4E5" }, menuBadge: { minWidth: 21, height: 21, borderRadius: 11, backgroundColor: "#C23B45", paddingHorizontal: 5, alignItems: "center", justifyContent: "center" }, menuBadgeText: { color: "#FFFFFF", fontSize: 10, fontWeight: "900" }, drawerFooter: { marginTop: "auto", paddingTop: 18, borderTopWidth: 1, borderColor: "#E7ECF2" }, securityRow: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 14 }, securityText: { color: "#697386", fontSize: 11, fontWeight: "700" }, signOut: { height: 46, borderRadius: 14, backgroundColor: "#FFF3F3", alignItems: "center", justifyContent: "center", gap: 8, flexDirection: "row" }, signOutText: { color: "#C23B45", fontSize: 13, fontWeight: "900" }, pressed: { opacity: 0.67 },
});
