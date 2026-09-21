import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const buttonSource = readFileSync(join(process.cwd(), "components/tikis/ui.tsx"), "utf8");
const authSource = readFileSync(join(process.cwd(), "components/tikis/auth-flow.tsx"), "utf8");
const nativeHomeSource = readFileSync(join(process.cwd(), "components/tikis/screens/home-screen.native.tsx"), "utf8");
const webHomeSource = readFileSync(join(process.cwd(), "components/tikis/screens/home-screen.web.tsx"), "utf8");
const deliverySource = readFileSync(join(process.cwd(), "app/delivery/[id].tsx"), "utf8");

describe("palette des boutons hors authentification", () => {
  it("utilise le fond blanc et le texte brun pour le bouton primaire partagé", () => {
    expect(buttonSource).toContain('primary: { background: "#FFFFFF", foreground: "#9A6201"');
    expect(buttonSource).toContain('authStyle && variant === "primary"');
    expect(buttonSource).toContain('background: "#9A6201", foreground: "#FFFFFF"');
  });

  it("préserve explicitement les boutons du flux d’authentification", () => {
    // Cinq depuis la fusion de l'écran de bienvenue avec celui du numéro : le
    // « Accepter et continuer » de l'accueil n'a plus d'écran à lui.
    expect((authSource.match(/<TikisButton authStyle/g) ?? []).length).toBe(5);
  });

  it("donne au bouton bloqué un fond à lui, au lieu d’une transparence", () => {
    // `opacity: 0.84` sur un fond saturé ne se voit pas : l'écran proposait une
    // action qui ne répondait pas, sur l'authentification comme ailleurs.
    expect(buttonSource).toContain('DISABLED_PALETTE: ButtonPalette = { background: "#EEF1F6"');
    expect(buttonSource).toContain("disabled && !loading ? DISABLED_PALETTE : activePalette");
  });

  it("applique la même palette aux actions personnalisées hors authentification", () => {
    // Les cartes de l'accueil ont changé de forme — « Trajet » côté expéditeur,
    // « Registre » côté livreur — mais pas de palette : l'action primaire y reste
    // blanche à texte brun, l'emphase passant par la bordure.
    for (const source of [nativeHomeSource, webHomeSource]) {
      expect(source).toContain('tripCta: {');
      expect(source).toContain('backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#9A6201"');
      expect(source).toContain('tripCtaText: { fontSize: 12.5, fontWeight: "700", color: "#9A6201" }');
      expect(source).toContain('compactAction: { fontSize: 11.5, fontWeight: "700", color: "#9A6201" }');
    }
    expect(deliverySource).toContain('trackButton: { backgroundColor: "#FFFFFF"');
    expect(deliverySource).toContain('trackButtonText: { color: "#9A6201"');
  });
});
