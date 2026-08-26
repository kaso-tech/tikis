import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Tabs } from "expo-router";
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const bottomPadding = Platform.OS === "web" ? 10 : Math.max(9, insets.bottom);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#007B8B",
        tabBarInactiveTintColor: "#8A96A8",
        tabBarLabelStyle: { fontSize: 11, fontWeight: "800", marginTop: 2 },
        tabBarStyle: { height: 58 + bottomPadding, paddingTop: 7, paddingBottom: bottomPadding, borderTopWidth: 1, borderTopColor: "#E7ECF2", backgroundColor: "#FFFFFF" },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Accueil", tabBarIcon: ({ color, size }) => <MaterialIcons name="home-filled" size={size} color={color} /> }} />
      <Tabs.Screen name="deliveries" options={{ title: "Courses", tabBarIcon: ({ color, size }) => <MaterialIcons name="local-shipping" size={size} color={color} /> }} />
      <Tabs.Screen name="wallet" options={{ title: "Wallet", tabBarIcon: ({ color, size }) => <MaterialIcons name="account-balance-wallet" size={size} color={color} /> }} />
      <Tabs.Screen name="profile" options={{ title: "Profil", tabBarIcon: ({ color, size }) => <MaterialIcons name="person" size={size} color={color} /> }} />
    </Tabs>
  );
}

