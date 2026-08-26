import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router } from "expo-router";
import { createContext, useContext, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { TikisButton } from "@/components/tikis/ui";
import { haptic } from "@/lib/haptics";
import { useTikisNavigation } from "@/lib/tikis-navigation";
import { useTikisStore } from "@/lib/tikis-store";
import { trpc } from "@/lib/trpc";

type LogoutContextValue = { openLogoutConfirmation: () => void };
const LogoutContext = createContext<LogoutContextValue | null>(null);

export function TikisLogoutProvider({ children }: { children: React.ReactNode }) {
  const { logout } = useTikisStore();
  const { closeDrawer } = useTikisNavigation();
  const logoutMutation = trpc.auth.logout.useMutation();
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);

  async function confirmLogout() {
    if (loading) return;
    setLoading(true);
    try {
      await logoutMutation.mutateAsync();
    } catch {
      // The local session still needs to be cleared when the server is unavailable.
    } finally {
      logout();
      closeDrawer();
      haptic.success();
      setVisible(false);
      setLoading(false);
      router.replace("/" as any);
    }
  }

  return <LogoutContext.Provider value={{ openLogoutConfirmation: () => { setVisible(true); haptic.light(); } }}>{children}<Modal visible={visible} transparent animationType="fade" onRequestClose={() => !loading && setVisible(false)} statusBarTranslucent><View style={styles.overlay}><Pressable disabled={loading} style={styles.scrim} onPress={() => setVisible(false)} /><View style={styles.dialog}><View style={styles.icon}><MaterialIcons name="logout" size={25} color="#C23B45" /></View><Text style={styles.title}>Se déconnecter ?</Text><Text style={styles.description}>Vous devrez saisir à nouveau votre numéro de téléphone et votre code de vérification pour accéder à Tikis.</Text>{loading ? <View style={styles.loading}><ActivityIndicator color="#007B8B" /><Text style={styles.loadingText}>Fermeture sécurisée de la session…</Text></View> : <View style={styles.actions}><TikisButton label="Annuler" variant="secondary" onPress={() => setVisible(false)} style={styles.cancelButton} /><TikisButton label="Se déconnecter" icon="logout" onPress={() => void confirmLogout()} style={styles.confirmButton} /></View>}</View></View></Modal></LogoutContext.Provider>;
}

export function useTikisLogout() {
  const value = useContext(LogoutContext);
  if (!value) throw new Error("useTikisLogout must be used inside TikisLogoutProvider");
  return value;
}

const styles = StyleSheet.create({ overlay: { flex: 1, justifyContent: "center", padding: 24 }, scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(8,22,42,0.56)" }, dialog: { backgroundColor: "#FFFFFF", borderRadius: 26, padding: 24, shadowColor: "#0B1F3A", shadowOpacity: 0.22, shadowOffset: { width: 0, height: 12 }, shadowRadius: 24, elevation: 8 }, icon: { width: 52, height: 52, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: "#FFF1F1" }, title: { color: "#0B1F3A", fontSize: 22, fontWeight: "900", marginTop: 17 }, description: { color: "#697386", fontSize: 13, lineHeight: 20, marginTop: 7 }, actions: { flexDirection: "row", gap: 10, marginTop: 24 }, cancelButton: { flex: 1, minHeight: 48 }, confirmButton: { flex: 1, minHeight: 48, backgroundColor: "#C23B45" }, loading: { minHeight: 76, marginTop: 22, borderRadius: 16, backgroundColor: "#F3F8FA", alignItems: "center", justifyContent: "center", gap: 10 }, loadingText: { color: "#006572", fontSize: 12, fontWeight: "800" } });
