import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router, usePathname } from "expo-router";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "@/components/tikis/ui";
import { haptic } from "@/lib/haptics";
import { useTikisNavigation } from "@/lib/tikis-navigation";
import { useTikisLogout } from "@/lib/tikis-logout";
import { useTikisStore } from "@/lib/tikis-store";
import type { UserRole } from "@/shared/tikis-domain";

type DrawerItem = { key: string; label: string; caption?: string; icon: React.ComponentProps<typeof MaterialIcons>["name"]; route: string; badge?: number };

const primaryItems = (role: UserRole, unread: number): DrawerItem[] => {
  const items: DrawerItem[] = [
    { key: "notifications", label: "Notifications", caption: "Activité de vos courses", icon: "notifications", route: "/notifications", badge: unread },
    { key: "history", label: "Historique", caption: "Courses terminées", icon: "history", route: "/history" },
    { key: "reviews", label: "Mes avis", caption: role === "driver" ? "Évaluations reçues" : "Évaluations envoyées", icon: "star-outline", route: "/reviews" },
  ];
  if (role === "driver") {
    items.push({ key: "referrals", label: "Parrainage", caption: "Code et récompenses", icon: "group-add", route: "/referrals" });
  }
  return items;
};

const supportItems: DrawerItem[] = [
  { key: "faq", label: "FAQ", caption: "Réponses aux questions courantes", icon: "help-outline", route: "/faq" },
  { key: "contact", label: "Contactez-nous", caption: "Support direct Tikis", icon: "support-agent", route: "/contact" },
  { key: "terms", label: "Conditions d’utilisation", caption: "Règles d’usage de la plateforme", icon: "description", route: "/legal/terms" },
  { key: "privacy", label: "Politique de confidentialité", caption: "Traitement de vos données", icon: "privacy-tip", route: "/legal/privacy" },
];

function unreadLabel(count: number) { return count > 9 ? "9+" : String(count); }

export function TikisHeader() {
  const { openDrawer } = useTikisNavigation();
  const insets = useSafeAreaInsets();
  const { role, notifications } = useTikisStore();
  const unread = notifications.filter((item) => !item.read).length;
  const roleLabel = role === "sender" ? "Espace expéditeur" : "Espace livreur";

  return <View style={[styles.header, { height: 58 + Math.max(insets.top, 8), paddingTop: Math.max(insets.top, 8) }]}><Pressable accessibilityRole="button" accessibilityLabel="Ouvrir le menu" onPress={() => { haptic.light(); openDrawer(); }} style={({ pressed }) => [styles.headerIcon, pressed && styles.pressed]}><MaterialIcons name="menu" size={24} color="#111111" /></Pressable><View style={styles.brand}><View style={styles.brandMark}><MaterialIcons name="local-shipping" size={16} color="#FFFFFF" /></View><View><Text style={styles.brandName}>tIKIS</Text><Text style={styles.brandContext}>{roleLabel}</Text></View></View><Pressable accessibilityRole="button" accessibilityLabel="Ouvrir les notifications" onPress={() => { haptic.light(); router.push("/notifications" as any); }} style={({ pressed }) => [styles.headerIcon, pressed && styles.pressed]}><MaterialIcons name="notifications-none" size={23} color="#111111" />{unread > 0 ? <View style={styles.headerBadge}><Text style={styles.headerBadgeText}>{unreadLabel(unread)}</Text></View> : null}</Pressable></View>;
}

export function TikisDrawer() {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { isDrawerOpen, closeDrawer } = useTikisNavigation();
  const { role, profile, notifications } = useTikisStore();
  const { openLogoutConfirmation } = useTikisLogout();
  const unread = notifications.filter((item) => !item.read).length;
  const items = primaryItems(role, unread);
  const name = profile?.fullName ?? "";
  const initials = name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase();

  function navigate(route: string) { closeDrawer(); router.push(route as any); }
  if (!profile) return null;

  return <Modal visible={isDrawerOpen} transparent animationType="slide" onRequestClose={closeDrawer} statusBarTranslucent><View style={styles.drawerModal}><View style={[styles.drawerPanel, { paddingTop: Math.max(insets.top, 16) }]}><View style={styles.drawerTop}><Text style={styles.drawerEyebrow}>MENU</Text><Pressable accessibilityRole="button" accessibilityLabel="Fermer le menu" onPress={closeDrawer} style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}><MaterialIcons name="close" size={21} color="#111111" /></Pressable></View><Pressable accessibilityRole="button" accessibilityLabel="Ouvrir mon profil" onPress={() => navigate("/(tabs)/profile")} style={({ pressed }) => [styles.profileBlock, pressed && styles.pressed]}><Avatar initials={initials} color="#111111" /><View style={styles.profileText}><Text style={styles.profileName} numberOfLines={1}>{name}</Text><View style={styles.rolePill}><View style={styles.roleDot} /><Text style={styles.roleLabel}>{role === "sender" ? "Expéditeur vérifié" : "Livreur vérifié"}</Text></View></View><MaterialIcons name="chevron-right" size={18} color="#9B9B9B" /></Pressable><View style={styles.lockedAccount}><MaterialIcons name="lock" size={15} color="#444444" /><Text style={styles.lockedAccountText}>Type de compte définitif : {role === "sender" ? "Expéditeur" : "Livreur"}</Text></View><Text style={styles.menuLabel}>VOTRE ACTIVITÉ</Text><View style={styles.menu}>{items.map((item) => <DrawerRow key={item.key} item={item} active={pathname === item.route} onPress={() => navigate(item.route)} />)}</View><Text style={styles.menuLabel}>ASSISTANCE</Text><View style={styles.menu}>{supportItems.map((item) => <DrawerRow key={item.key} item={item} active={pathname === item.route} onPress={() => navigate(item.route)} />)}</View><View style={styles.drawerFooter}><View style={styles.securityRow}><MaterialIcons name="verified-user" size={16} color="#007B8B" /><Text style={styles.securityText}>Compte sécurisé par Tikis</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Se déconnecter" onPress={openLogoutConfirmation} style={({ pressed }) => [styles.signOut, pressed && styles.pressed]}><MaterialIcons name="logout" size={18} color="#B4232D" /><Text style={styles.signOutText}>Se déconnecter</Text></Pressable></View></View><Pressable accessibilityRole="button" accessibilityLabel="Fermer le menu" onPress={closeDrawer} style={styles.scrim} /></View></Modal>;
}

function DrawerRow({ item, active, onPress }: { item: DrawerItem; active: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.menuRow, active && styles.menuRowActive, pressed && styles.pressed]}><View style={[styles.menuIcon, active && styles.menuIconActive]}><MaterialIcons name={item.icon} size={18} color={active ? "#FFFFFF" : "#007B8B"} /></View><View style={styles.menuText}><Text style={[styles.menuTitle, active && styles.menuTitleActive]} numberOfLines={1}>{item.label}</Text>{item.caption ? <Text style={[styles.menuCaption, active && styles.menuCaptionActive]} numberOfLines={1}>{item.caption}</Text> : null}</View>{item.badge && item.badge > 0 ? <View style={styles.menuBadge}><Text style={styles.menuBadgeText}>{unreadLabel(item.badge)}</Text></View> : <MaterialIcons name="chevron-right" size={18} color={active ? "#C9C9C9" : "#BBBBBB"} />}</Pressable>;
}

const styles = StyleSheet.create({
  header: { backgroundColor: "#FFFFFF", paddingHorizontal: 14, paddingBottom: 6, flexDirection: "row", alignItems: "center" },
  headerIcon: { width: 40, height: 40, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "#EEEDF3" },
  brand: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 11 },
  brandMark: { width: 30, height: 30, borderRadius: 7, alignItems: "center", justifyContent: "center", backgroundColor: "#007B8B" },
  brandName: { color: "#111111", fontSize: 17, fontWeight: "600", letterSpacing: -0.25 },
  brandContext: { color: "#707070", fontSize: 10, fontWeight: "500", marginTop: -1 },
  headerBadge: { position: "absolute", right: 3, top: 3, minWidth: 17, height: 17, borderRadius: 9, backgroundColor: "#B4232D", alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
  headerBadgeText: { color: "#FFFFFF", fontWeight: "600", fontSize: 9 },
  drawerModal: { flex: 1, flexDirection: "row" },
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.42)" },
  drawerPanel: { width: "100%", maxWidth: 308, minHeight: "100%", backgroundColor: "#FFFFFF", paddingHorizontal: 14, paddingBottom: 14 },
  drawerTop: { height: 40, alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  drawerEyebrow: { color: "#747474", fontSize: 10, fontWeight: "600", letterSpacing: 0.9 },
  closeButton: { width: 34, height: 34, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "#EEEDF3" },
  profileBlock: { flexDirection: "row", alignItems: "center", gap: 9, paddingTop: 12, paddingBottom: 11, backgroundColor: "#EEEDF3", borderRadius: 10, paddingHorizontal: 10 },
  profileText: { flex: 1 },
  profileName: { color: "#111111", fontSize: 15, fontWeight: "600" },
  rolePill: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3 },
  roleDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#007B8B" },
  roleLabel: { color: "#666666", fontSize: 11, fontWeight: "500" },
  lockedAccount: { padding: 8, backgroundColor: "#FFFFFF", borderRadius: 8, flexDirection: "row", alignItems: "center", gap: 7, marginTop: 8 },
  lockedAccountText: { color: "#444444", fontSize: 11, fontWeight: "500", flex: 1 },
  menuLabel: { color: "#747474", fontSize: 10, fontWeight: "600", letterSpacing: 0.9, marginTop: 16, marginBottom: 6 },
  menu: { gap: 2 },
  menuRow: { minHeight: 48, borderRadius: 8, paddingHorizontal: 9, flexDirection: "row", alignItems: "center", gap: 9 },
  menuRowActive: { backgroundColor: "#111111" },
  menuIcon: { width: 32, height: 32, borderRadius: 7, alignItems: "center", justifyContent: "center", backgroundColor: "#EEEDF3" },
  menuIconActive: { backgroundColor: "#007B8B" },
  menuText: { flex: 1 },
  menuTitle: { color: "#111111", fontSize: 13, fontWeight: "600" },
  menuTitleActive: { color: "#FFFFFF" },
  menuCaption: { color: "#747474", fontSize: 11, marginTop: 1 },
  menuCaptionActive: { color: "#C9C9C9" },
  menuBadge: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: "#B4232D", paddingHorizontal: 5, alignItems: "center", justifyContent: "center" },
  menuBadgeText: { color: "#FFFFFF", fontSize: 10, fontWeight: "600" },
  drawerFooter: { marginTop: "auto", paddingTop: 12 },
  securityRow: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 10 },
  securityText: { color: "#666666", fontSize: 11, fontWeight: "500" },
  signOut: { height: 42, borderRadius: 8, backgroundColor: "#F8E8E9", alignItems: "center", justifyContent: "center", gap: 7, flexDirection: "row" },
  signOutText: { color: "#B4232D", fontSize: 12, fontWeight: "600" },
  pressed: { opacity: 0.67 },
});
