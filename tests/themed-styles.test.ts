import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ StyleSheet: { create: <T,>(styles: T) => styles } }));
vi.mock("@/lib/use-theme-colors", () => ({ useThemeColors: () => ({ isDark: false }) }));

const { darkColor, darkenStyle, themedStyleSheets } = await import("../lib/themed-styles");

describe("mode sombre des couleurs écrites en dur", () => {
  it("un fond blanc devient la surface brune ; un texte blanc (sur bouton plein) reste blanc", () => {
    expect(darkColor("#FFFFFF", "surface")).toBe("#581E08");
    expect(darkColor("#FFFFFF", "text")).toBe("#FFFFFF");
  });

  it("textes foncés éclaircis, couleurs vives conservées en fond mais éclaircies en texte", () => {
    expect(darkColor("#241510", "text")).toBe("#FFF9F2");
    expect(darkColor("#76665E", "text")).toBe("#D7B79C");
    expect(darkColor("#A95000", "surface")).toBe("#A95000");
    expect(darkColor("#A95000", "text")).toBe("#F8A008");
  });

  it("ne touche qu'aux propriétés de couleur", () => {
    expect(darkenStyle({ backgroundColor: "#FFFFFF", color: "#241510", borderColor: "#E7D9CF", fontSize: 14 })).toEqual({ backgroundColor: "#581E08", color: "#FFF9F2", borderColor: "#7A4A2D", fontSize: 14 });
  });

  it("la feuille claire reste exactement celle d'origine", () => {
    const sheets = themedStyleSheets({ card: { backgroundColor: "#FFFFFF", padding: 4 } });
    expect(sheets.light.card).toEqual({ backgroundColor: "#FFFFFF", padding: 4 });
    expect(sheets.dark.card).toEqual({ backgroundColor: "#581E08", padding: 4 });
  });
});
