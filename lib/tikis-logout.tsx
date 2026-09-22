import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router } from "expo-router";
import { createContext, useContext, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { TikisButton } from "@/components/tikis/ui";
import { haptic } from "@/lib/haptics";
import { useTikisNavigation } from "@/lib/tikis-navigation";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";
import { clearTikisSessionToken } from "@/lib/tikis-session";
import { clearSupabaseSession } from "@/lib/supabase-tracking";
import { clearStoredPushRegistration, getStoredPushRegistration } from "@/hooks/use-push-registration";

type LogoutContextValue = { openLogoutConfirmation: () => void };
const LogoutContext = createContext<LogoutContextValue | null>(null);

export function TikisLogoutProvider({ children }: { children: React.ReactNode }) {
  const { logout, profile } = useTikisStore();
  const { closeDrawer } = useTikisNavigation();
  const logoutMutation = trpc.auth.logout.useMutation();
  const unregisterPushMutation = trpc.notifications.unregisterPushToken.useMutation();
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);

  async function confirmLogout() {
    if (loading) return;
    setLoading(true);
    try {
      const storedPush = await getStoredPushRegistration();
      if (storedPush && (profile?.phone === storedPush.phone || !profile?.phone)) {
        await unregisterPushMutation.mutateAsync({ token: storedPush.token });
      }
      await logoutMutation.mutateAsync();
    } catch {
      // The local session still needs to be cleared when the server is unavailable.
    } finally {
      await clearStoredPushRegistration();
      await clearTikisSessionToken();
      await clearSupabaseSession();
      logout();
      closeDrawer();
      haptic.success();
      setVisible(false);
      setLoading(false);
      router.replace("/auth" as any);
    }
  }

  return (
    <LogoutContext.Provider value={{ openLogoutConfirmation: () => { setVisible(true); haptic.light(); } }}>
      {children}
      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => !loading && setVisible(false)} statusBarTranslucent>
        <View style={styles.overlay}>
          <Pressable disabled={loading} style={styles.scrim} onPress={() => setVisible(false)} />
          <View style={styles.dialog}>
            <View style={styles.icon}><MaterialIcons name="logout" size={25} color="#B4232D" /></View>
            <Text style={styles.title}>Se déconnecter ?</Text>
            <Text style={styles.description}>Vous devrez ressaisir votre numéro et le code de vérification.</Text>
            {loading ? (
              <View style={styles.loading}>
                <ActivityIndicator color="#B4232D" />
                <Text style={styles.loadingText}>Fermeture sécurisée de la session…</Text>
              </View>
            ) : (
              <View style={styles.actions}>
                <Pressable onPress={() => setVisible(false)} style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]} accessibilityRole="button">
                  <Text style={styles.cancelButtonText}>Annuler</Text>
                </Pressable>
                <Pressable onPress={() => void confirmLogout()} style={({ pressed }) => [styles.confirmButton, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel="Se déconnecter">
                  <MaterialIcons name="logout" size={16} color="#FFFFFF" />
                  <Text style={styles.confirmButtonText}>Se déconnecter</Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </LogoutContext.Provider>
  );
}

export function useTikisLogout() {
  const value = useContext(LogoutContext);
  if (!value) throw new Error("useTikisLogout must be used inside TikisLogoutProvider");
  return value;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "center", padding: 24 },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(8,22,42,0.56)" },
  dialog: { backgroundColor: "#FFFFFF", borderRadius: 18, padding: 24, borderWidth: 1, borderColor: "#E3E3E3" },
  icon: { width: 52, height: 52, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: "#FFF1F1" },
  title: { color: "#0B1F3A", fontSize: 22, fontWeight: "900", marginTop: 17 },
  description: { color: "#697386", fontSize: 13, lineHeight: 20, marginTop: 7 },
  actions: { flexDirection: "row", gap: 10, marginTop: 24 },
  cancelButton: { flex: 1, minHeight: 48, borderRadius: 9, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#D7D5DE", alignItems: "center", justifyContent: "center", flexDirection: "row" },
  cancelButtonText: { color: "#111111", fontSize: 14, fontWeight: "600" },
  confirmButton: { flex: 1, minHeight: 48, borderRadius: 9, backgroundColor: "#B4232D", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 },
  confirmButtonText: { color: "#FFFFFF", fontSize: 14, fontWeight: "600" },
  pressed: { opacity: 0.7 },
  loading: { minHeight: 76, marginTop: 22, borderRadius: 16, backgroundColor: "#F3F8FA", alignItems: "center", justifyContent: "center", gap: 10 },
  loadingText: { color: "#B4232D", fontSize: 12, fontWeight: "800" },
});
