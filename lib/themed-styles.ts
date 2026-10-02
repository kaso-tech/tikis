import { StyleSheet, type ImageStyle, type TextStyle, type ViewStyle } from "react-native";
import { useThemeColors } from "@/lib/use-theme-colors";

/**
 * Mode sombre des écrans écrits avec les couleurs du thème clair en dur.
 *
 * Une seule table dit ce que devient chaque couleur claire en mode sombre, selon son rôle : un fond blanc
 * devient la surface brune, un texte foncé devient clair, une bordure claire devient la bordure sombre.
 * Le rôle compte : le blanc reste blanc quand il colore un texte ou une icône (posé sur un bouton
 * plein), et les couleurs vives (orange, rouge, vert) restent telles quelles en fond, où elles portent
 * du texte blanc, mais s'éclaircissent en texte, pour rester lisibles sur le brun.
 */
const DARK_TEXT: Record<string, string> = {
  "#241510": "#FFF9F2", "#2B0D02": "#FFF9F2", "#111111": "#FFF9F2", "#1A0702": "#FFF9F2", "#240900": "#FFF9F2",
  "#76665E": "#D7B79C", "#705D53": "#D7B79C", "#7B695E": "#B89A84", "#9B8478": "#C9AE97", "#A48B7B": "#C9AE97", "#4C342B": "#E8D2C0",
  "#A95000": "#F8A008", "#C65A00": "#F1B653", "#C96900": "#F1B653", "#7A3000": "#F8A008",
  "#A43F32": "#F09286", "#C75145": "#F09286", "#8D362B": "#F09286",
  "#367552": "#72C497", "#3C8B60": "#72C497", "#2E704E": "#72C497", "#145C45": "#72C497", "#4D9B72": "#8DD5AD",
  "#EEEDF3": "#2B211C", "#E7D9CF": "#3E322B", "#F1E7E0": "#3E322B",
};

const DARK_SURFACE: Record<string, string> = {
  "#FFFFFF": "#211915", "#FFF": "#211915", "#FAF8F5": "#2B211C", "#FFF9F2": "#211915",
  "#EEEDF3": "#2B211C", "#F2E9E3": "#2B211C", "#F0E5DE": "#2B211C", "#F2E7E0": "#2B211C",
  "#FFF0D8": "#382A18", "#FFF7ED": "#382A18", "#FFF5E7": "#382A18", "#F7EFE5": "#30251B",
  "#F8E7E3": "#3A201C", "#F9E7E2": "#3A201C", "#F9E8E4": "#3A201C", "#FBE9E5": "#3A201C",
  "#E7F2EC": "#1F3B2A", "#E6F4ED": "#1F3B2A", "#E8F2EE": "#1F3B2A",
  // Tons de bordure employés en fond (pistes de progression, blocs du fond de carte, séparateurs pleins).
  "#E7D9CF": "#3A2E27", "#F1E7E0": "#2B211C", "#E2D4CB": "#3A2E27", "#E2D3CC": "#3A2E27", "#D7C3B8": "#3A2E27",
};

const DARK_BORDER: Record<string, string> = {
  "#E7D9CF": "#3E322B", "#F1E7E0": "#3E322B", "#EFE5DF": "#342A24", "#EEEDF3": "#342A24",
  "#E2D4CB": "#3E322B", "#E2D3CC": "#3E322B", "#D7C3B8": "#3E322B", "#E2D0C5": "#342A24", "#DCCAC0": "#3E322B",
  "#CBB8AB": "#5A4A40", "#C9B6AA": "#5A4A40", "#E9B8AF": "#6A3A33", "#FFFFFF": "#3E322B",
};

export type ColorRole = "text" | "surface" | "border";

/** Couleur à utiliser en mode sombre pour une couleur claire écrite en dur, selon son rôle. */
export function darkColor(color: string, role: ColorRole): string {
  const key = color.toUpperCase();
  const table = role === "text" ? DARK_TEXT : role === "surface" ? DARK_SURFACE : DARK_BORDER;
  return table[key] ?? color;
}

const SURFACE_PROPS = new Set(["backgroundColor"]);
const TEXT_PROPS = new Set(["color", "tintColor", "textDecorationColor"]);

function roleOf(prop: string): ColorRole | null {
  if (SURFACE_PROPS.has(prop)) return "surface";
  if (TEXT_PROPS.has(prop)) return "text";
  if (/^border(Top|Bottom|Left|Right|Start|End|Block|Inline)?Color$/.test(prop)) return "border";
  return null;
}

type AnyStyle = ViewStyle | TextStyle | ImageStyle;

export function darkenStyle<T extends AnyStyle>(style: T): T {
  const result: Record<string, unknown> = {};
  for (const [prop, value] of Object.entries(style)) {
    const role = roleOf(prop);
    result[prop] = role && typeof value === "string" && value.startsWith("#") ? darkColor(value, role) : value;
  }
  return result as T;
}

/** Feuilles de style claire et sombre d'un même jeu de styles (couleurs du thème clair en dur). */
export function themedStyleSheets<T extends StyleSheet.NamedStyles<T>>(styles: T & StyleSheet.NamedStyles<T>) {
  const dark = {} as Record<string, AnyStyle>;
  for (const [name, style] of Object.entries(styles as Record<string, AnyStyle>)) dark[name] = darkenStyle(style);
  return { light: StyleSheet.create(styles), dark: StyleSheet.create(dark as T) };
}

/** La feuille du thème actif. */
export function useThemedStyles<T>(sheets: { light: T; dark: T }): T {
  return useThemeColors().isDark ? sheets.dark : sheets.light;
}

/** Pour les couleurs passées directement aux icônes ou en style en ligne : `tone("#76665E")`. */
export function useDarkTone() {
  const { isDark } = useThemeColors();
  return (color: string, role: ColorRole = "text") => (isDark ? darkColor(color, role) : color);
}
