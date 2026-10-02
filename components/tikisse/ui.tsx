import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { haptic } from "@/lib/haptics";
import { themedStyleSheets, useDarkTone, useThemedStyles } from "@/lib/themed-styles";

/**
 * L'ambre des étoiles de notation : une convention universelle (Google, l'App Store la gardent
 * identique quel que soit leur thème), indépendante de la couleur de marque — elle ne doit jamais
 * suivre `theme.primary`. La marque est passée du brun à l'orange, puis au turquoise, puis de
 * nouveau au brun : sans ce découplage explicite, l'un de ces remplacements mécaniques aurait
 * rendu les étoiles turquoise, où plus personne ne les aurait lues comme une note.
 */
export const RATING_STAR_COLOR = "#FF9800";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

type ButtonPalette = { background: string; foreground: string; border?: string };

/** Ce que porte un bouton qu'on ne peut pas actionner : un gris franc, pas une transparence. */
const DISABLED_PALETTE: ButtonPalette = { background: "#F2E9E3", foreground: "#7B695E", border: "#E2D0C5" };

const buttonColors: Record<ButtonVariant, ButtonPalette> = {
  // L'action principale est le seul endroit de l'interface où la couleur de marque remplit une surface :
  // ailleurs elle se contente de border ou de marquer. Le texte posé dessus est sombre, jamais blanc —
  // Le brun est sombre : c'est donc le blanc qui s'y lit (5,10:1), pas l'encre (#241510, 3,71:1).
  // L'inverse exact de l'orange et du turquoise qui l'ont précédé — d'où le sens de ce couple.
  primary: { background: "#A95000", foreground: "#FFFFFF", border: "#A95000" },
  secondary: { background: "#FFFFFF", foreground: "#241510", border: "#E7D9CF" },
  ghost: { background: "#EEEDF3", foreground: "#241510", border: "#E7D9CF" },
  danger: { background: "#FFFFFF", foreground: "#A43F32", border: "#E7D9CF" },
};

export function TikisseButton({
  label,
  onPress,
  variant = "primary",
  loading = false,
  loadingLabel,
  disabled = false,
  icon,
  compact = false,
  style,
}: {
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
  const styles = useThemedStyles(styleSheets);
  const hue = useDarkTone();
  const blocked = disabled || loading;
  const activePalette: ButtonPalette = buttonColors[variant];
  // Un bouton bloqué ne recevait que `opacity: 0.84` : sur un fond saturé, seize
  // pour cent d'atténuation ne se voient pas, et l'écran proposait une action
  // qui ne répondait pas. En chargement, la palette reste celle de l'action :
  // c'est elle qui est en cours, pas une action refusée.
  const basePalette: ButtonPalette = disabled && !loading ? DISABLED_PALETTE : activePalette;
  // Mode sombre : le bouton principal garde son brun plein (le blanc s'y lit toujours) ; les autres
  // passent sur la surface brune, avec un texte clair, au lieu de rester des pastilles blanches.
  const palette: ButtonPalette = basePalette === buttonColors.primary ? basePalette : { background: hue(basePalette.background, "surface"), foreground: hue(basePalette.foreground), border: basePalette.border ? hue(basePalette.border, "border") : undefined };

  const textStyle = [styles.buttonText, compact && styles.buttonTextCompact, { color: palette.foreground }];

  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: blocked, busy: loading }} disabled={blocked} onPress={() => { haptic.light(); onPress(); }} style={({ pressed }) => [styles.button, compact && styles.buttonCompact, { backgroundColor: palette.background, borderColor: palette.border ?? palette.background }, style, pressed && !blocked && styles.buttonPressed]}>
    {loading ? <><ActivityIndicator color={palette.foreground} /><Text style={textStyle} numberOfLines={1}>{loadingLabel ?? (compact ? "…" : "Traitement en cours…")}</Text></> : <>{icon ? <MaterialIcons name={icon} size={compact ? 16 : 18} color={palette.foreground} /> : null}<Text style={textStyle} numberOfLines={1}>{label}</Text></>}
  </Pressable>;
}

export function TikisseIconButton({ icon, label, onPress, accent = "#241510" }: { icon: React.ComponentProps<typeof MaterialIcons>["name"]; label: string; onPress: () => void; accent?: string }) {
  const styles = useThemedStyles(styleSheets);
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => { haptic.light(); onPress(); }} style={({ pressed }) => [styles.iconButton, pressed && styles.iconButtonPressed]}><MaterialIcons name={icon} size={21} color={accent} /></Pressable>;
}

export function SurfaceCard({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const styles = useThemedStyles(styleSheets);
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionHeading({ title, action }: { title: string; action?: string }) {
  const styles = useThemedStyles(styleSheets);
  return <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>{title}</Text>{action ? <Text style={styles.sectionAction}>{action}</Text> : null}</View>;
}

export function StatusBadge({ label, color, background }: { label: string; color: string; background: string }) {
  const styles = useThemedStyles(styleSheets);
  return <View style={[styles.statusBadge, { backgroundColor: background }]}><View style={[styles.statusDot, { backgroundColor: color }]} /><Text style={[styles.statusText, { color }]}>{label}</Text></View>;
}

export function Avatar({ initials, color = "#241510", size = 44 }: { initials: string; color?: string; size?: number }) {
  const styles = useThemedStyles(styleSheets);
  return <View style={[styles.avatar, { backgroundColor: color, width: size, height: size, borderRadius: size / 2 }]}><Text style={[styles.avatarText, { fontSize: Math.max(12, size * 0.34) }]}>{initials}</Text></View>;
}

export const tikisseStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#EEEDF3" },
  screenContent: { paddingHorizontal: 16, paddingBottom: 104 },
  eyebrow: { color: "#76665E", fontSize: 12, fontWeight: "600", letterSpacing: 0.5, textTransform: "uppercase" },
  title: { color: "#241510", fontSize: 26, lineHeight: 32, fontWeight: "600", letterSpacing: -0.35 },
  subtitle: { color: "#76665E", fontSize: 14, lineHeight: 20 },
  body: { color: "#241510", fontSize: 14, lineHeight: 20 },
  muted: { color: "#76665E", fontSize: 12, lineHeight: 18 },
});

const styleSheets = themedStyleSheets({
  button: { minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 9, borderWidth: 1, paddingHorizontal: 15, flexDirection: "row", gap: 8 },
  buttonPressed: { opacity: 0.84, transform: [{ scale: 0.98 }] },
  buttonCompact: { minHeight: 44, paddingHorizontal: 10, gap: 5 },
  buttonText: { fontSize: 15, fontWeight: "600" },
  buttonTextCompact: { fontSize: 13.5 },
  iconButton: { width: 40, height: 40, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E7D9CF" },
  iconButtonPressed: { opacity: 0.68 },
  card: { backgroundColor: "#FFFFFF", borderRadius: 10, padding: 13, borderWidth: 1, borderColor: "#E7D9CF" },
  sectionHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  sectionTitle: { fontSize: 17, fontWeight: "600", color: "#241510", letterSpacing: -0.15 },
  sectionAction: { color: "#241510", fontSize: 13, fontWeight: "600" },
  statusBadge: { alignSelf: "flex-start", paddingHorizontal: 8, height: 24, borderRadius: 6, flexDirection: "row", alignItems: "center", gap: 5 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 11, fontWeight: "600" },
  avatar: { alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#FFFFFF", fontWeight: "600" },
});
