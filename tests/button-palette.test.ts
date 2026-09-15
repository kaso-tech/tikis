import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const buttonSource = readFileSync(join(process.cwd(), "components/tikis/ui.tsx"), "utf8");
const authSource = readFileSync(join(process.cwd(), "components/tikis/auth-flow.tsx"), "utf8");
const nativeHomeSource = readFileSync(join(process.cwd(), "components/tikis/screens/home-screen.native.tsx"), "utf8");
const webHomeSource = readFileSync(join(process.cwd(), "components/tikis/screens/home-screen.web.tsx"), "utf8");
const deliverySource = readFileSync(join(process.cwd(), "app/delivery/[id].tsx"), "utf8");

describe("palette des boutons hors authentification", () => {
  it("utilise une surface claire et le texte brun pour le bouton primaire partagé", () => {
    // Le fond est passé du crème (#F7EFE5) au blanc lors de l'harmonisation du thème ; ce qui compte
    // et qui est vérifié ici reste l'invariant : hors authentification le bouton primaire est une
    // surface claire à texte brun, et le flux d'authentification inverse cette palette.
    expect(buttonSource).toContain('primary: { background: "#FFFFFF", foreground: "#9A6201"');
    expect(buttonSource).toContain('authStyle && variant === "primary"');
    expect(buttonSource).toContain('background: "#9A6201", foreground: "#FFFFFF"');
  });

  it("préserve explicitement les boutons du flux d’authentification", () => {
    expect((authSource.match(/<TikisButton authStyle/g) ?? []).length).toBe(6);
  });

  it("applique la même palette aux actions personnalisées hors authentification", () => {
    // Ces actions passent désormais par les jetons de thème plutôt que par des hex figés : c'est ce
    // niveau-là qu'on verrouille, pour qu'un écran ne puisse pas redevenir sourd au mode sombre en
    // réintroduisant une couleur en dur.
    for (const source of [nativeHomeSource, webHomeSource]) {
      expect(source).toContain("rowBtnFilled: { paddingHorizontal");
      expect(source).toContain("backgroundColor: theme.surface");
      expect(source).toContain("rowBtnFilledText: { color: theme.primary");
    }
    expect(deliverySource).toContain("trackButton: { backgroundColor: theme.surface");
    expect(deliverySource).toContain("trackButtonText: { color: theme.primary");
  });
});
