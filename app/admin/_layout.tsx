import { Stack } from "expo-router";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { usePathname, Slot, useRouter, useSegments } from "expo-router";
import { useThemeColors } from "@/lib/use-theme-colors";
import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { clearAdminSessionToken } from "@/lib/admin-session";

type NavItem = { label: string; href: string; icon: string; badge?: "kyc" | "disputes" | "expiring" | "reports"; group: "ops" | "people" | "trust" | "system" };

const NAV_ITEMS: NavItem[] = [
  { label: "Vue d'ensemble", href: "/admin", icon: "dashboard", group: "ops" },
  { label: "Carte temps réel", href: "/admin/map", icon: "my-location", group: "ops" },
  { label: "Courses", href: "/admin/deliveries", icon: "local-shipping", group: "ops" },
  { label: "Expirations", href: "/admin/deliveries", icon: "schedule", badge: "expiring", group: "ops" },
  { label: "Utilisateurs", href: "/admin/users", icon: "people", group: "people" },
  { label: "Validations KYC", href: "/admin/kyc", icon: "verified-user", badge: "kyc", group: "people" },
  { label: "Signalements", href: "/admin/disputes", icon: "gavel", badge: "reports", group: "trust" },
  { label: "Transactions", href: "/admin/transactions", icon: "receipt-long", group: "trust" },
  { label: "Configuration", href: "/admin/settings", icon: "settings", group: "system" },
];

const GROUP_LABELS: Record<NavItem["group"], string> = {
  ops: "Opérations",
  people: "Personnes",
  trust: "Confiance & finance",
  system: "Système",
};
const GROUP_ORDER: NavItem["group"][] = ["ops", "people", "trust", "system"];

export default function AdminLayout() {
  const { colors: theme } = useThemeColors();
  const pathname = usePathname();
  const segments = useSegments();
  const router = useRouter();
  const meQuery = trpc.adminConsole.auth.me.useQuery(undefined, { retry: false });

  const isLoginPage = pathname === "/admin/login" || segments[segments.length - 1] === "login";

  if (isLoginPage) {
    return (
      <View style={{ flex: 1 }}>
        <Stack.Screen options={{ headerShown: false }} />
        <Slot />
      </View>
    );
  }

  if (meQuery.isLoading) {
    return (
      <View style={[styles.loadingRoot, { backgroundColor: theme.background }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={{ color: theme.muted, fontSize: 12.5 }}>Chargement…</Text>
      </View>
    );
  }

  if (meQuery.error || !meQuery.data) {
    if (typeof window !== "undefined") {
      router.replace("/admin/login" as any);
    }
    return (
      <View style={[styles.loadingRoot, { backgroundColor: theme.background }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={{ color: theme.muted, fontSize: 12.5 }}>Redirection vers la connexion…</Text>
      </View>
    );
  }

  const overviewQuery = trpc.adminConsole.overview.useQuery({ rangeDays: 30 }, { refetchInterval: 30_000 });
  const reportsQuery = trpc.adminConsole.reports.useQuery({ page: 1, pageSize: 1 });

  const badges = useMemo(() => ({
    kyc: overviewQuery.data?.kpis.kycPending ?? 0,
    disputes: reportsQuery.data?.total ?? 0,
    expiring: overviewQuery.data?.kpis.expiringSoon ?? 0,
  }), [overviewQuery.data, reportsQuery.data]);

  const grouped = useMemo(() => {
    const map = new Map<NavItem["group"], NavItem[]>();
    for (const g of GROUP_ORDER) map.set(g, []);
    for (const item of NAV_ITEMS) {
      const arr = map.get(item.group);
      if (arr) arr.push(item);
    }
    return map;
  }, []);

  const admin = meQuery.data;
  const initials = (admin.email[0] ?? "?").toUpperCase() + (admin.email[1] ?? "").toUpperCase();

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.sidebar, { backgroundColor: theme.surface, borderRightColor: theme.border }]}>
        <View style={[styles.brand, { borderBottomColor: theme.border }]}>
          <View style={[styles.brandMark, { backgroundColor: theme.primary }]}>
            <Text style={styles.brandMarkText}>T</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.brandTitle, { color: theme.foreground }]}>Tikis Admin</Text>
            <Text style={[styles.brandSub, { color: theme.muted }]}>Console opérateur</Text>
          </View>
        </View>
        <ScrollView style={styles.nav} contentContainerStyle={{ padding: 8 }}>
          {GROUP_ORDER.map((group) => {
            const items = grouped.get(group) ?? [];
            if (items.length === 0) return null;
            return (
              <View key={group} style={{ marginBottom: 14 }}>
                <Text style={[styles.navGroupLabel, { color: theme.muted }]}>{GROUP_LABELS[group]}</Text>
                {items.map((item) => {
                  const active = pathname === item.href || (item.href !== "/admin" && pathname.startsWith(item.href));
                  const badge = item.badge === "kyc" ? badges.kyc : item.badge === "disputes" ? badges.disputes : item.badge === "expiring" ? badges.expiring : 0;
                  return (
                    <AdminNavLink key={item.label} href={item.href} label={item.label} icon={item.icon} active={active} badge={badge} />
                  );
                })}
              </View>
            );
          })}
        </ScrollView>
        <View style={[styles.foot, { borderTopColor: theme.border }]}>
          <View style={[styles.avatar, { backgroundColor: theme.primary + "22" }]}>
            <Text style={[styles.avatarText, { color: theme.primary }]}>{initials}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.footName, { color: theme.foreground }]} numberOfLines={1}>{admin.email}</Text>
            <Text style={[styles.footRole, { color: theme.muted }]} numberOfLines={1}>{admin.role.replace("_", " ")}</Text>
          </View>
          <Pressable
            onPress={async () => {
              await clearAdminSessionToken();
              if (typeof window !== "undefined") {
                window.location.assign("/admin/login");
              }
            }}
            style={({ pressed }) => [styles.icoBtn, { borderColor: theme.border }, pressed && { opacity: 0.7 }]}
            title="Se déconnecter"
          >
            <MaterialIcons name="logout" size={14} color={theme.muted} />
          </Pressable>
        </View>
      </View>
      <View style={styles.main}>
        <Slot />
      </View>
    </View>
  );
}

function AdminNavLink({ href, label, icon, active, badge }: { href: string; label: string; icon: string; active: boolean; badge: number }) {
  const { colors: theme } = useThemeColors();
  return (
    <Pressable
      onPress={() => {
        if (typeof window !== "undefined") {
          window.location.assign(href);
        }
      }}
      style={({ pressed }) => [styles.navItem, active && { backgroundColor: theme.primary + "1F" }, pressed && { opacity: 0.7 }]}
    >
      <MaterialIcons name={icon as any} size={16} color={active ? theme.primary : theme.muted} />
      <Text style={[styles.navItemText, { color: active ? theme.primary : theme.foreground }]}>{label}</Text>
      {badge > 0 ? (
        <View style={[styles.navBadge, { backgroundColor: theme.error }]}>
          <Text style={styles.navBadgeText}>{badge > 99 ? "99+" : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: "row" },
  loadingRoot: { flex: 1, alignItems: "center", justifyContent: "center" },
  sidebar: { width: 232, borderRightWidth: StyleSheet.hairlineWidth, height: "100%" as any, ...Platform.select({ web: { position: "sticky" as any, top: 0, alignSelf: "flex-start", height: "100vh" as any }, default: {} }) },
  brand: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  brandMark: { width: 28, height: 28, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  brandMarkText: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },
  brandTitle: { fontSize: 14, fontWeight: "600", letterSpacing: -0.2 },
  brandSub: { fontSize: 11, marginTop: -1 },
  nav: { flex: 1 },
  navGroupLabel: { fontSize: 10, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.6, paddingHorizontal: 10, paddingTop: 6, paddingBottom: 8 },
  navItem: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 6, marginBottom: 1 },
  navItemText: { flex: 1, fontSize: 13, fontWeight: "500" },
  navBadge: { minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 99, alignItems: "center", justifyContent: "center" },
  navBadgeText: { color: "#FFFFFF", fontSize: 10, fontWeight: "700" },
  foot: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderTopWidth: StyleSheet.hairlineWidth },
  avatar: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 11, fontWeight: "600" },
  footName: { fontSize: 12.5, fontWeight: "600" },
  footRole: { fontSize: 11 },
  icoBtn: { width: 28, height: 28, borderRadius: 6, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth },
  main: { flex: 1, minWidth: 0 },
});
