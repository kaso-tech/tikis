import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router, usePathname } from "expo-router";
import { useEffect, useState } from "react";
import { Animated, Easing, Image, Modal, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "@/components/tikisse/ui";
import { haptic } from "@/lib/haptics";
import { useThemeContext } from "@/lib/theme-provider";
import { useThemeColors } from "@/lib/use-theme-colors";
import { useTikisseNavigation } from "@/lib/tikisse-navigation";
import { useTikisseLogout } from "@/lib/tikisse-logout";
import { useTikisseStore } from "@/lib/tikisse-store";
import { trpc } from "@/lib/trpc";

type DrawerItem = { key: string; label: string; caption?: string; icon: React.ComponentProps<typeof MaterialIcons>["name"]; route: string; badge?: number };

const supportItems: DrawerItem[] = [
  { key: "faq", label: "FAQ", caption: "Réponses aux questions courantes", icon: "help-outline", route: "/faq" },
  { key: "contact", label: "Contactez-nous", caption: "Support direct Tikisse", icon: "support-agent", route: "/contact" },
  { key: "terms", label: "Conditions d’utilisation", caption: "Règles d’usage de la plateforme", icon: "description", route: "/legal/terms" },
  { key: "privacy", label: "Politique de confidentialité", caption: "Traitement de vos données", icon: "privacy-tip", route: "/legal/privacy" },
];

function unreadLabel(count: number) { return count > 9 ? "9+" : String(count); }

export function TikisseHeader() {
  const { openDrawer } = useTikisseNavigation();
  const insets = useSafeAreaInsets();
  const { profile } = useTikisseStore();
  const { colors: theme } = useThemeColors();
  const notificationsQuery = trpc.notifications.list.useQuery(undefined, { enabled: Boolean(profile?.phone), refetchInterval: 60_000 });
  const unread = (notificationsQuery.data ?? []).filter((item) => !item.read).length;

  return (
    <View style={[styles.header, { backgroundColor: theme.surface, height: 58 + Math.max(insets.top, 8), paddingTop: Math.max(insets.top, 8) }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Ouvrir le menu" onPress={() => { haptic.light(); openDrawer(); }} style={({ pressed }) => [styles.headerIcon, { backgroundColor: theme.background }, pressed && styles.pressed]}>
        <MaterialIcons name="menu" size={24} color={theme.foreground} />
      </Pressable>
      <View style={styles.brand}>
        <Image accessibilityLabel="Logo Tikisse" source={require("../../assets/images/tikisse-logo.png")} style={styles.brandLogo} />
        <Text style={[styles.brandName, { color: theme.foreground }]}>Tikisse</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Ouvrir les notifications" onPress={() => { haptic.light(); router.push("/notifications" as any); }} style={({ pressed }) => [styles.headerIcon, { backgroundColor: theme.background }, pressed && styles.pressed]}>
        <MaterialIcons name="notifications-none" size={23} color={theme.foreground} />
        {unread > 0 ? <View style={styles.headerBadge}><Text style={styles.headerBadgeText}>{unreadLabel(unread)}</Text></View> : null}
      </Pressable>
    </View>
  );
}

const DRAWER_WIDTH = 308;
const ANIM_DURATION = 240;

export function TikisseDrawer() {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { isDrawerOpen, closeDrawer } = useTikisseNavigation();
  const { role, profile } = useTikisseStore();
  const { openLogoutConfirmation } = useTikisseLogout();
  const { colorScheme, setColorScheme } = useThemeContext();
  // useState plutôt que useRef(...).current : une valeur Animated stable, créée une seule fois, lue
  // pendant le rendu (style ci-dessous) — ce que le React Compiler interdit à un ref (react-hooks/refs),
  // pas à un state dont on n'appelle jamais le setter.
  const [slide] = useState(() => new Animated.Value(-DRAWER_WIDTH));
  const [scrimOpacity] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.parallel([
      Animated.timing(slide, {
        toValue: isDrawerOpen ? 0 : -DRAWER_WIDTH,
        duration: ANIM_DURATION,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(scrimOpacity, {
        toValue: isDrawerOpen ? 1 : 0,
        duration: ANIM_DURATION,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [isDrawerOpen, slide, scrimOpacity]);

  const name = profile?.fullName ?? "";
  const initials = name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase();
  const isDark = colorScheme === "dark";

  function navigate(route: string) { closeDrawer(); router.push(route as any); }
  function toggleDarkMode(value: boolean) {
    haptic.selection();
    setColorScheme(value ? "dark" : "light");
  }
  if (!profile) return null;

  return (
    <Modal visible={isDrawerOpen} transparent animationType="none" onRequestClose={closeDrawer} statusBarTranslucent>
      <View style={styles.drawerRoot}>
        <Animated.View style={[styles.scrim, { opacity: scrimOpacity }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Fermer le menu" onPress={closeDrawer} style={StyleSheet.absoluteFill} />
        </Animated.View>
        <Animated.View
          style={[
            styles.drawerPanel,
            { paddingTop: Math.max(insets.top, 16), transform: [{ translateX: slide }] },
            isDark && styles.drawerPanelDark,
          ]}
        >
          <View style={styles.drawerTop}>
            <Text style={[styles.drawerEyebrow, isDark && styles.drawerEyebrowDark]}>MENU</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Fermer le menu" onPress={closeDrawer} style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}>
              <MaterialIcons name="close" size={21} color={isDark ? "#FFF9F2" : "#241510"} />
            </Pressable>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Ouvrir mon profil" onPress={() => navigate("/(tabs)/profile")} style={({ pressed }) => [styles.profileBlock, isDark && styles.profileBlockDark, pressed && styles.pressed]}>
            <Avatar initials={initials} color={isDark ? "#FFF9F2" : "#241510"} />
            <View style={styles.profileText}>
              <Text style={[styles.profileName, isDark && styles.profileNameDark]} numberOfLines={1}>{name}</Text>
              <View style={styles.rolePill}>
                <View style={[styles.roleDot, isDark && styles.roleDotDark]} />
                <Text style={[styles.roleLabel, isDark && styles.roleLabelDark]}>{role === "sender" ? "Expéditeur vérifié" : "Livreur vérifié"}</Text>
              </View>
            </View>
            <MaterialIcons name="chevron-right" size={18} color={isDark ? "#D7B79C" : "#9B8478"} />
          </Pressable>

          <View style={[styles.themeRow, isDark && styles.themeRowDark]}>
            <View style={styles.themeText}>
              <Text style={[styles.themeTitle, isDark && styles.themeTitleDark]}>Apparence</Text>
              <Text style={[styles.themeSub, isDark && styles.themeSubDark]}>{isDark ? "Mode sombre activé" : "Mode clair activé"}</Text>
            </View>
            <Switch
              accessibilityLabel="Activer le mode sombre"
              value={isDark}
              onValueChange={toggleDarkMode}
              trackColor={{ false: "#E7D9CF", true: "#A95000" }}
              thumbColor={isDark ? "#FFF9F2" : "#FFFFFF"}
            />
          </View>

          <Text style={[styles.menuLabel, isDark && styles.menuLabelDark]}>ASSISTANCE</Text>
          <View style={styles.menu}>
            {supportItems.map((item) => (
              <DrawerRow
                key={item.key}
                item={item}
                active={pathname === item.route}
                onPress={() => navigate(item.route)}
                isDark={isDark}
              />
            ))}
          </View>
          <View style={styles.drawerFooter}>
            <View style={styles.securityRow}>
              <MaterialIcons name="verified-user" size={16} color="#76665E" />
              <Text style={[styles.securityText, isDark && styles.securityTextDark]}>Compte sécurisé par Tikisse</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Se déconnecter" onPress={openLogoutConfirmation} style={({ pressed }) => [styles.signOut, isDark && styles.signOutDark, pressed && styles.pressed]}>
              <MaterialIcons name="logout" size={18} color={isDark ? "#F09286" : "#A43F32"} />
              <Text style={[styles.signOutText, isDark && styles.signOutTextDark]}>Se déconnecter</Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function DrawerRow({ item, active, onPress, isDark }: { item: DrawerItem; active: boolean; onPress: () => void; isDark: boolean }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.menuRow, active && styles.menuRowActive, isDark && styles.menuRowDark, active && isDark && styles.menuRowActiveDark, pressed && styles.pressed]}>
      <View style={[styles.menuIcon, active && styles.menuIconActive, isDark && !active && styles.menuIconDark]}>
        <MaterialIcons name={item.icon} size={18} color={active ? "#FFFFFF" : "#76665E"} />
      </View>
      <View style={styles.menuText}>
        <Text style={[styles.menuTitle, active && styles.menuTitleActive, active && isDark && styles.menuTitleActiveDark, isDark && !active && styles.menuTitleDark]} numberOfLines={1}>{item.label}</Text>
        {item.caption ? (
          <Text style={[styles.menuCaption, active && styles.menuCaptionActive, active && isDark && styles.menuCaptionActiveDark, isDark && !active && styles.menuCaptionDark]} numberOfLines={1}>{item.caption}</Text>
        ) : null}
      </View>
      {item.badge && item.badge > 0 ? (
        <View style={styles.menuBadge}><Text style={styles.menuBadgeText}>{unreadLabel(item.badge)}</Text></View>
      ) : (
        <MaterialIcons name="chevron-right" size={18} color={active ? "#D7C3B8" : (isDark ? "#76665E" : "#C9B6AA")} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: "#FFFFFF", paddingHorizontal: 14, paddingBottom: 6, flexDirection: "row", alignItems: "center" },
  headerIcon: { width: 40, height: 40, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "#EEEDF3" },
  brand: { flex: 1, flexDirection: "row", alignItems: "center", paddingLeft: 11, gap: 8 },
  brandLogo: { width: 30, height: 30, borderRadius: 7 },
  brandName: { color: "#241510", fontSize: 19, fontWeight: "700", letterSpacing: -0.4 },
  headerBadge: { position: "absolute", right: 3, top: 3, minWidth: 17, height: 17, borderRadius: 9, backgroundColor: "#A43F32", alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
  headerBadgeText: { color: "#FFFFFF", fontWeight: "600", fontSize: 9 },
  drawerRoot: { flex: 1, flexDirection: "row" },
  scrim: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,0.42)" },
  drawerPanel: { position: "absolute", top: 0, bottom: 0, left: 0, width: DRAWER_WIDTH, maxWidth: "85%", backgroundColor: "#FFFFFF", paddingHorizontal: 14, paddingBottom: 14, borderRightWidth: 1, borderRightColor: "#E7D9CF" },
  drawerPanelDark: { backgroundColor: "#401000", borderRightColor: "#7A4A2D" },
  drawerTop: { height: 40, alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  drawerEyebrow: { color: "#76665E", fontSize: 10, fontWeight: "600", letterSpacing: 0.9 },
  drawerEyebrowDark: { color: "#D7B79C" },
  closeButton: { width: 34, height: 34, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "#EEEDF3" },
  profileBlock: { flexDirection: "row", alignItems: "center", gap: 9, paddingTop: 12, paddingBottom: 11, backgroundColor: "#EEEDF3", borderRadius: 10, paddingHorizontal: 10 },
  profileBlockDark: { backgroundColor: "#581E08" },
  profileText: { flex: 1 },
  profileName: { color: "#241510", fontSize: 15, fontWeight: "600" },
  profileNameDark: { color: "#FFF9F2" },
  rolePill: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3 },
  roleDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#A95000" },
  roleDotDark: { backgroundColor: "#F8A008" },
  roleLabel: { color: "#76665E", fontSize: 11, fontWeight: "500" },
  roleLabelDark: { color: "#D7B79C" },
  themeRow: { marginTop: 14, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, backgroundColor: "#FFFFFF", flexDirection: "row", alignItems: "center", gap: 10 },
  themeRowDark: { backgroundColor: "#581E08" },
  themeText: { flex: 1 },
  themeTitle: { color: "#241510", fontSize: 13, fontWeight: "600" },
  themeTitleDark: { color: "#FFF9F2" },
  themeSub: { color: "#76665E", fontSize: 11, marginTop: 2 },
  themeSubDark: { color: "#D7B79C" },
  menuLabel: { color: "#76665E", fontSize: 10, fontWeight: "600", letterSpacing: 0.9, marginTop: 16, marginBottom: 6 },
  menuLabelDark: { color: "#D7B79C" },
  menu: { gap: 2 },
  menuRow: { minHeight: 48, borderRadius: 8, paddingHorizontal: 9, flexDirection: "row", alignItems: "center", gap: 9 },
  menuRowActive: { backgroundColor: "#241510" },
  menuRowDark: { backgroundColor: "transparent" },
  menuRowActiveDark: { backgroundColor: "#F8A008" },
  menuIcon: { width: 32, height: 32, borderRadius: 7, alignItems: "center", justifyContent: "center", backgroundColor: "#EEEDF3" },
  menuIconActive: { backgroundColor: "#A95000" },
  menuIconDark: { backgroundColor: "#581E08" },
  menuText: { flex: 1 },
  menuTitle: { color: "#241510", fontSize: 13, fontWeight: "600" },
  menuTitleActive: { color: "#FFFFFF" },
  // La rangée active est noire en clair, dorée en sombre : son libellé ne peut pas être le même.
  // #FFFFFF donne 18,88:1 sur le noir mais 2,26:1 sur l'or ; #241510 y donne 8,35:1.
  menuTitleActiveDark: { color: "#241510" },
  menuTitleDark: { color: "#FFF9F2" },
  menuCaption: { color: "#76665E", fontSize: 11, marginTop: 1 },
  menuCaptionActive: { color: "#D7C3B8" },
  menuCaptionActiveDark: { color: "#4A1C0B" },
  menuCaptionDark: { color: "#D7B79C" },
  menuBadge: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: "#A43F32", paddingHorizontal: 5, alignItems: "center", justifyContent: "center" },
  menuBadgeText: { color: "#FFFFFF", fontSize: 10, fontWeight: "600" },
  drawerFooter: { marginTop: "auto", paddingTop: 12 },
  securityRow: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 10 },
  securityText: { color: "#76665E", fontSize: 11, fontWeight: "500" },
  securityTextDark: { color: "#D7B79C" },
  signOut: { height: 42, borderRadius: 8, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", gap: 7, flexDirection: "row" },
  signOutDark: { backgroundColor: "#401000" },
  signOutText: { color: "#A43F32", fontSize: 12, fontWeight: "600" },
  signOutTextDark: { color: "#F09286" },
  pressed: { opacity: 0.67 },
});
