import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { haptic } from "@/lib/haptics";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const buttonColors: Record<ButtonVariant, { background: string; foreground: string; border?: string }> = {
  primary: { background: "#007B8B", foreground: "#FFFFFF" },
  secondary: { background: "#FFFFFF", foreground: "#111111", border: "#D7D7D7" },
  ghost: { background: "#F7F7F7", foreground: "#111111", border: "#E3E3E3" },
  danger: { background: "#FFFFFF", foreground: "#B4232D", border: "#EAB4B8" },
};

export function TikisButton({
  label,
  onPress,
  variant = "primary",
  loading = false,
  loadingLabel,
  disabled = false,
  icon,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  loadingLabel?: string;
  disabled?: boolean;
  icon?: React.ComponentProps<typeof MaterialIcons>["name"];
  style?: ViewStyle;
}) {
  const palette = buttonColors[variant];
  const blocked = disabled || loading;

  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: blocked, busy: loading }} disabled={blocked} onPress={() => { haptic.light(); onPress(); }} style={({ pressed }) => [styles.button, { backgroundColor: palette.background, borderColor: palette.border ?? palette.background }, style, (pressed || blocked) && styles.buttonPressed]}>
    {loading ? <><ActivityIndicator color={palette.foreground} /><Text style={[styles.buttonText, { color: palette.foreground }]}>{loadingLabel ?? "Traitement en cours…"}</Text></> : <>{icon ? <MaterialIcons name={icon} size={18} color={palette.foreground} /> : null}<Text style={[styles.buttonText, { color: palette.foreground }]}>{label}</Text></>}
  </Pressable>;
}

export function TikisIconButton({ icon, label, onPress, accent = "#111111" }: { icon: React.ComponentProps<typeof MaterialIcons>["name"]; label: string; onPress: () => void; accent?: string }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => { haptic.light(); onPress(); }} style={({ pressed }) => [styles.iconButton, pressed && styles.iconButtonPressed]}><MaterialIcons name={icon} size={21} color={accent} /></Pressable>;
}

export function SurfaceCard({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionHeading({ title, action }: { title: string; action?: string }) {
  return <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>{title}</Text>{action ? <Text style={styles.sectionAction}>{action}</Text> : null}</View>;
}

export function StatusBadge({ label, color, background }: { label: string; color: string; background: string }) {
  return <View style={[styles.statusBadge, { backgroundColor: background }]}><View style={[styles.statusDot, { backgroundColor: color }]} /><Text style={[styles.statusText, { color }]}>{label}</Text></View>;
}

export function Avatar({ initials, color = "#111111", size = 44 }: { initials: string; color?: string; size?: number }) {
  return <View style={[styles.avatar, { backgroundColor: color, width: size, height: size, borderRadius: size / 2 }]}><Text style={[styles.avatarText, { fontSize: Math.max(12, size * 0.34) }]}>{initials}</Text></View>;
}

export const tikisStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F7F7F7" },
  screenContent: { paddingHorizontal: 16, paddingBottom: 104 },
  eyebrow: { color: "#007B8B", fontSize: 12, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase" },
  title: { color: "#111111", fontSize: 26, lineHeight: 32, fontWeight: "700", letterSpacing: -0.35 },
  subtitle: { color: "#667085", fontSize: 14, lineHeight: 20 },
  body: { color: "#252525", fontSize: 14, lineHeight: 20 },
  muted: { color: "#667085", fontSize: 12, lineHeight: 18 },
});

const styles = StyleSheet.create({
  button: { minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 10, borderWidth: 1, paddingHorizontal: 15, flexDirection: "row", gap: 8 },
  buttonPressed: { opacity: 0.84, transform: [{ scale: 0.98 }] },
  buttonText: { fontSize: 15, fontWeight: "700" },
  iconButton: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "#F7F7F7", borderWidth: 1, borderColor: "#E3E3E3" },
  iconButtonPressed: { opacity: 0.68 },
  card: { backgroundColor: "#FFFFFF", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#E3E3E3", elevation: 0 },
  sectionHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  sectionTitle: { fontSize: 17, fontWeight: "700", color: "#111111", letterSpacing: -0.15 },
  sectionAction: { color: "#007B8B", fontSize: 13, fontWeight: "700" },
  statusBadge: { alignSelf: "flex-start", paddingHorizontal: 8, height: 24, borderRadius: 6, flexDirection: "row", alignItems: "center", gap: 5 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 11, fontWeight: "700" },
  avatar: { alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#FFFFFF", fontWeight: "700" },
});
