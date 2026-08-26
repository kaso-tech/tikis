import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { haptic } from "@/lib/haptics";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const buttonColors: Record<ButtonVariant, { background: string; foreground: string; border?: string }> = {
  primary: { background: "#007B8B", foreground: "#FFFFFF" },
  secondary: { background: "#E5F6F7", foreground: "#006572" },
  ghost: { background: "#FFFFFF", foreground: "#007B8B", border: "#CDE4E7" },
  danger: { background: "#FDEBEC", foreground: "#C23B45" },
};

export function TikisButton({
  label,
  onPress,
  variant = "primary",
  loading = false,
  disabled = false,
  icon,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  icon?: React.ComponentProps<typeof MaterialIcons>["name"];
  style?: ViewStyle;
}) {
  const palette = buttonColors[variant];
  const blocked = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: blocked, busy: loading }}
      disabled={blocked}
      onPress={() => {
        haptic.light();
        onPress();
      }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: palette.background, borderColor: palette.border ?? palette.background },
        style,
        (pressed || blocked) && styles.buttonPressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.foreground} />
      ) : (
        <>
          {icon ? <MaterialIcons name={icon} size={19} color={palette.foreground} /> : null}
          <Text style={[styles.buttonText, { color: palette.foreground }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

export function TikisIconButton({
  icon,
  label,
  onPress,
  accent = "#0B1F3A",
}: {
  icon: React.ComponentProps<typeof MaterialIcons>["name"];
  label: string;
  onPress: () => void;
  accent?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        haptic.light();
        onPress();
      }}
      style={({ pressed }) => [styles.iconButton, pressed && styles.iconButtonPressed]}
    >
      <MaterialIcons name={icon} size={22} color={accent} />
    </Pressable>
  );
}

export function SurfaceCard({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionHeading({ title, action }: { title: string; action?: string }) {
  return (
    <View style={styles.sectionHeading}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action ? <Text style={styles.sectionAction}>{action}</Text> : null}
    </View>
  );
}

export function StatusBadge({ label, color, background }: { label: string; color: string; background: string }) {
  return (
    <View style={[styles.statusBadge, { backgroundColor: background }]}>
      <View style={[styles.statusDot, { backgroundColor: color }]} />
      <Text style={[styles.statusText, { color }]}>{label}</Text>
    </View>
  );
}

export function Avatar({ initials, color = "#0B1F3A", size = 44 }: { initials: string; color?: string; size?: number }) {
  return (
    <View style={[styles.avatar, { backgroundColor: color, width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.avatarText, { fontSize: Math.max(12, size * 0.34) }]}>{initials}</Text>
    </View>
  );
}

export const tikisStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F6F8FC" },
  screenContent: { paddingHorizontal: 20, paddingBottom: 120 },
  eyebrow: { color: "#007B8B", fontSize: 13, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase" },
  title: { color: "#0B1F3A", fontSize: 30, lineHeight: 36, fontWeight: "800", letterSpacing: -0.5 },
  subtitle: { color: "#697386", fontSize: 15, lineHeight: 22 },
  body: { color: "#354052", fontSize: 15, lineHeight: 22 },
  muted: { color: "#697386", fontSize: 13, lineHeight: 19 },
});

const styles = StyleSheet.create({
  button: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 18,
    flexDirection: "row",
    gap: 9,
  },
  buttonPressed: { opacity: 0.84, transform: [{ scale: 0.98 }] },
  buttonText: { fontSize: 16, fontWeight: "800" },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7ECF2",
  },
  iconButtonPressed: { opacity: 0.68 },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E7ECF2",
    shadowColor: "#0B1F3A",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.05,
    shadowRadius: 18,
    elevation: 2,
  },
  sectionHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  sectionTitle: { fontSize: 19, fontWeight: "800", color: "#0B1F3A", letterSpacing: -0.2 },
  sectionAction: { color: "#007B8B", fontSize: 14, fontWeight: "800" },
  statusBadge: { alignSelf: "flex-start", paddingHorizontal: 10, height: 26, borderRadius: 13, flexDirection: "row", alignItems: "center", gap: 6 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 12, fontWeight: "800" },
  avatar: { alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#FFFFFF", fontWeight: "800" },
});

