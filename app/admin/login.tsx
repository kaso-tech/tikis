import { MaterialIcons } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useThemeColors } from "@/lib/use-theme-colors";
import { trpc } from "@/lib/trpc";
import { setAdminSessionToken } from "@/lib/admin-session";

export default function AdminLogin() {
  const { colors: theme } = useThemeColors();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const loginMutation = trpc.adminConsole.auth.login.useMutation({
    onSuccess: async (data) => {
      await setAdminSessionToken(data.sessionToken);
      router.replace("/admin" as any);
    },
    onError: (err) => {
      Alert.alert("Connexion impossible", err.message);
    },
  });

  function submit() {
    if (!email.trim() || password.length < 1) {
      Alert.alert("Champs requis", "Saisissez votre email et votre mot de passe administrateur.");
      return;
    }
    loginMutation.mutate({ email: email.trim().toLowerCase(), password });
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <View style={[styles.icon, { backgroundColor: theme.primary + "1F" }]}>
          <MaterialIcons name="admin-panel-settings" size={28} color={theme.primary} />
        </View>
        <Text style={[styles.title, { color: theme.foreground }]}>Console opérateur</Text>
        <Text style={[styles.sub, { color: theme.muted }]}>
          Accès réservé aux administrateurs Tikis. Authentification par email et mot de passe.
        </Text>

        <View style={{ width: "100%", marginTop: 16, gap: 10 }}>
          <View>
            <Text style={[styles.label, { color: theme.muted }]}>Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              placeholder="admin@tikis.app"
              placeholderTextColor={theme.muted}
              style={[styles.input, { backgroundColor: theme.background, borderColor: theme.border, color: theme.foreground }]}
            />
          </View>
          <View>
            <Text style={[styles.label, { color: theme.muted }]}>Mot de passe</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="Mot de passe"
              placeholderTextColor={theme.muted}
              style={[styles.input, { backgroundColor: theme.background, borderColor: theme.border, color: theme.foreground }]}
            />
          </View>
          <Pressable onPress={submit} disabled={loginMutation.isPending} style={[styles.btn, { backgroundColor: theme.primary, opacity: loginMutation.isPending ? 0.6 : 1 }]}>
            {loginMutation.isPending ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.btnText}>Se connecter</Text>}
          </Pressable>
        </View>

        <Text style={[styles.hint, { color: theme.muted }]}>
          Première utilisation ? Le bootstrap admin se fait via la CLI (`pnpm admin:bootstrap email@tikis.app`).
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  card: { width: "100%", maxWidth: 420, padding: 28, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", gap: 8 },
  icon: { width: 56, height: 56, borderRadius: 14, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  title: { fontSize: 20, fontWeight: "600" },
  sub: { fontSize: 12.5, textAlign: "center", lineHeight: 18 },
  label: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 },
  input: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8, fontSize: 13, borderWidth: StyleSheet.hairlineWidth },
  btn: { paddingVertical: 11, borderRadius: 8, alignItems: "center", marginTop: 4 },
  btnText: { color: "#FFFFFF", fontSize: 13, fontWeight: "600" },
  hint: { fontSize: 11, textAlign: "center", marginTop: 16 },
});
