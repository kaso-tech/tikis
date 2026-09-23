import { SchemeColors, type ColorScheme, type ThemeColorPalette } from "@/lib/_core/theme";
import { useThemeContext } from "@/lib/theme-provider";

export type ThemedColors = ThemeColorPalette & {
  text: string;
  background: string;
  tint: string;
  icon: string;
  border: string;
  input: string;
  placeholder: string;
  pressed: string;
  overlay: string;
  divider: string;
};

function buildThemed(scheme: ColorScheme): ThemedColors {
  const base = SchemeColors[scheme];
  return {
    ...base,
    text: base.foreground,
    background: base.background,
    tint: base.primary,
    icon: base.muted,
    tabIconDefault: base.muted,
    tabIconSelected: base.primary,
    border: base.border,
    // Fond de champ neutre : le crème #F7EFE5 venait du brun d'origine et teintait chaque saisie.
    // Les quatre usages posent tous une bordure par-dessus, donc un fond neutre reste visible.
    input: scheme === "light" ? "#F0F3F8" : "#3A2B1A",
    placeholder: base.muted,
    pressed: scheme === "light" ? "#E3DFEA" : "#2A2018",
    overlay: scheme === "light" ? "rgba(0,0,0,0.42)" : "rgba(0,0,0,0.62)",
    divider: scheme === "light" ? "#ECECEC" : "#33271B",
  };
}

export function useThemeColors(): { scheme: ColorScheme; isDark: boolean; colors: ThemedColors } {
  const { colorScheme } = useThemeContext();
  const scheme: ColorScheme = colorScheme;
  return { scheme, isDark: scheme === "dark", colors: buildThemed(scheme) };
}
