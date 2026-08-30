import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Redirect, Tabs } from "expo-router";
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TikisHeader } from "@/components/tikis/app-chrome";
import { useTikisStore } from "@/lib/tikis-store";

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const { profile } = useTikisStore();
  const bottomPadding = Platform.OS === "web" ? 8 : Math.max(8, insets.bottom);

  if (!profile) return <Redirect href="/auth" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        header: () => <TikisHeader />,
        tabBarActiveTintColor: "#007B8B",
        tabBarInactiveTintColor: "#767676",
        tabBarLabelStyle: { fontSize: 10, fontWeight: "600", marginTop: 1 },
        tabBarStyle: { height: 54 + bottomPadding, paddingTop: 5, paddingBottom: bottomPadding, borderTopWidth: 0, backgroundColor: "#FFFFFF" },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Accueil", tabBarIcon: ({ color, size }) => <MaterialIcons name="home-filled" size={size} color={color} /> }} />
      <Tabs.Screen name="wallet" options={{ href: profile.role === "driver" ? undefined : null, title: "Wallet", tabBarIcon: ({ color, size }) => <MaterialIcons name="account-balance-wallet" size={size} color={color} /> }} />
      <Tabs.Screen name="addresses" options={{ href: profile.role === "sender" ? undefined : null, title: "Adresses", tabBarIcon: ({ color, size }) => <MaterialIcons name="location-on" size={size} color={color} /> }} />
      <Tabs.Screen name="profile" options={{ title: "Profil", tabBarIcon: ({ color, size }) => <MaterialIcons name="person" size={size} color={color} /> }} />
    </Tabs>
  );
}
