import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { haptic } from "@/lib/haptics";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

type ButtonPalette = { background: string; foreground: string; border?: string };

/** Ce que porte un bouton qu'on ne peut pas actionner : un gris franc, pas une transparence. */
const DISABLED_PALETTE: ButtonPalette = { background: "#EEF1F6", foreground: "#7A8699", border: "#DDE3EC" };

const buttonColors: Record<ButtonVariant, ButtonPalette> = {
  primary: { background: "#FFFFFF", foreground: "#9A6201", border: "#E3E3E3" },
  secondary: { background: "#FFFFFF", foreground: "#111111", border: "#E3E3E3" },
  ghost: { background: "#F0F3F8", foreground: "#111111", border: "#E3E3E3" },
  danger: { background: "#FFFFFF", foreground: "#A43740", border: "#E3E3E3" },
};

export function TikisButton({
  label,
  onPress,
  variant = "primary",
  authStyle = false,
  loading = false,
  loadingLabel,
  disabled = false,
  icon,
  compact = false,
  style,
}: {
  authStyle?: boolean;
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  loadingLabel?: string;
  disabled?: boolean;
  icon?: React.ComponentProps<typeof MaterialIcons>["name"];
  /** Rogne les marges internes et la graisse pour qu'une rangée de trois actions
   *  tienne sur une ligne de téléphone. La palette, elle, ne change pas. */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const blocked = disabled || loading;
  const activePalette: ButtonPalette = authStyle && variant === "primary"
    ? { background: "#9A6201", foreground: "#FFFFFF", border: "#9A6201" }
    : buttonColors[variant];
  // Un bouton bloqué ne recevait que `opacity: 0.84` : sur un fond saturé, seize
  // pour cent d'atténuation ne se voient pas, et l'écran proposait une action
  // qui ne répondait pas. En chargement, la palette reste celle de l'action :
  // c'est elle qui est en cours, pas une action refusée.
  const palette: ButtonPalette = disabled && !loading ? DISABLED_PALETTE : activePalette;

  const textStyle = [styles.buttonText, compact && styles.buttonTextCompact, { color: palette.foreground }];

  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: blocked, busy: loading }} disabled={blocked} onPress={() => { haptic.light(); onPress(); }} style={({ pressed }) => [styles.button, compact && styles.buttonCompact, { backgroundColor: palette.background, borderColor: palette.border ?? palette.background }, style, pressed && !blocked && styles.buttonPressed]}>
    {loading ? <><ActivityIndicator color={palette.foreground} /><Text style={textStyle} numberOfLines={1}>{loadingLabel ?? (compact ? "…" : "Traitement en cours…")}</Text></> : <>{icon ? <MaterialIcons name={icon} size={compact ? 16 : 18} color={palette.foreground} /> : null}<Text style={textStyle} numberOfLines={1}>{label}</Text></>}
  </Pressable>;
}

export function TikisIconButton({ icon, label, onPress, accent = "#111111" }: { icon: React.ComponentProps<typeof MaterialIcons>["name"]; label: string; onPress: () => void; accent?: string }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => { haptic.light(); onPress(); }} style={({ pressed }) => [styles.iconButton, pressed && styles.iconButtonPressed]}><MaterialIcons name={icon} size={21} color={accent} /></Pressable>;
}

export function SurfaceCard({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
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
  screen: { flex: 1, backgroundColor: "#F0F3F8" },
  screenContent: { paddingHorizontal: 16, paddingBottom: 104 },
  eyebrow: { color: "#9A6201", fontSize: 12, fontWeight: "600", letterSpacing: 0.5, textTransform: "uppercase" },
  title: { color: "#111111", fontSize: 26, lineHeight: 32, fontWeight: "600", letterSpacing: -0.35 },
  subtitle: { color: "#667085", fontSize: 14, lineHeight: 20 },
  body: { color: "#111111", fontSize: 14, lineHeight: 20 },
  muted: { color: "#667085", fontSize: 12, lineHeight: 18 },
});

const styles = StyleSheet.create({
  button: { minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 9, borderWidth: 1, paddingHorizontal: 15, flexDirection: "row", gap: 8 },
  buttonPressed: { opacity: 0.84, transform: [{ scale: 0.98 }] },
  buttonCompact: { minHeight: 44, paddingHorizontal: 10, gap: 5 },
  buttonText: { fontSize: 15, fontWeight: "600" },
  buttonTextCompact: { fontSize: 13.5 },
  iconButton: { width: 40, height: 40, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E3E3E3" },
  iconButtonPressed: { opacity: 0.68 },
  card: { backgroundColor: "#FFFFFF", borderRadius: 10, padding: 13, borderWidth: 1, borderColor: "#E3E3E3" },
  sectionHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  sectionTitle: { fontSize: 17, fontWeight: "600", color: "#111111", letterSpacing: -0.15 },
  sectionAction: { color: "#9A6201", fontSize: 13, fontWeight: "600" },
  statusBadge: { alignSelf: "flex-start", paddingHorizontal: 8, height: 24, borderRadius: 6, flexDirection: "row", alignItems: "center", gap: 5 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 11, fontWeight: "600" },
  avatar: { alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#FFFFFF", fontWeight: "600" },
});
