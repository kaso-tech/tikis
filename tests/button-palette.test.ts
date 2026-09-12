import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const buttonSource = readFileSync(join(process.cwd(), "components/tikis/ui.tsx"), "utf8");
const authSource = readFileSync(join(process.cwd(), "components/tikis/auth-flow.tsx"), "utf8");
const nativeHomeSource = readFileSync(join(process.cwd(), "components/tikis/screens/home-screen.native.tsx"), "utf8");
const webHomeSource = readFileSync(join(process.cwd(), "components/tikis/screens/home-screen.web.tsx"), "utf8");
const deliverySource = readFileSync(join(process.cwd(), "app/delivery/[id].tsx"), "utf8");

describe("palette des boutons hors authentification", () => {
  it("utilise le fond crème et le texte brun pour le bouton primaire partagé", () => {
    expect(buttonSource).toContain('primary: { background: "#FFFFFF", foreground: "#9A6201"');
    expect(buttonSource).toContain('authStyle && variant === "primary"');
    expect(buttonSource).toContain('background: "#9A6201", foreground: "#FFFFFF"');
  });

  it("préserve explicitement les boutons du flux d’authentification", () => {
    expect((authSource.match(/<TikisButton authStyle/g) ?? []).length).toBe(6);
  });

  it("applique la même palette aux actions personnalisées hors authentification", () => {
    for (const source of [nativeHomeSource, webHomeSource]) {
      expect(source).toContain('rowBtnFilled: {');
      expect(["backgroundColor: \"#FFFFFF\"", "backgroundColor: \"#F5F5F5\"", "backgroundColor: theme.input"].some((token) => source.includes(token))).toBe(true);
      expect(source).toContain('rowBtnFilledText: { color: "#9A6201"');
    }
    expect(["trackButton: { backgroundColor: \"#FFFFFF\"", "trackButton: { backgroundColor: theme.input"].some((token) => deliverySource.includes(token))).toBe(true);
    expect(deliverySource).toContain('trackButtonText: { color: "#9A6201"');
  });
});
