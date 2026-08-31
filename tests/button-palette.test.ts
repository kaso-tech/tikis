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
    expect(buttonSource).toContain('primary: { background: "#F7EFE5", foreground: "#9A6201"');
    expect(buttonSource).toContain('authStyle && variant === "primary"');
    expect(buttonSource).toContain('background: "#9A6201", foreground: "#FFFFFF"');
  });

  it("préserve explicitement les boutons du flux d’authentification", () => {
    expect((authSource.match(/<TikisButton authStyle/g) ?? []).length).toBe(6);
  });

  it("applique la même palette aux actions personnalisées hors authentification", () => {
    for (const source of [nativeHomeSource, webHomeSource]) {
      expect(source).toContain('rowBtnFilled: {');
      expect(source).toContain('backgroundColor: "#F7EFE5"');
      expect(source).toContain('rowBtnFilledText: { color: "#9A6201"');
    }
    expect(deliverySource).toContain('trackButton: { backgroundColor: "#F7EFE5"');
    expect(deliverySource).toContain('trackButtonText: { color: "#9A6201"');
  });
});
