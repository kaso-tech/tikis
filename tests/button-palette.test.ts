import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const buttonSource = readFileSync(join(process.cwd(), "components/tikis/ui.tsx"), "utf8");
const authSource = readFileSync(join(process.cwd(), "components/tikis/auth-flow.tsx"), "utf8");
const nativeHomeSource = readFileSync(join(process.cwd(), "components/tikis/screens/home-screen.native.tsx"), "utf8");
const webHomeSource = readFileSync(join(process.cwd(), "components/tikis/screens/home-screen.web.tsx"), "utf8");
const deliverySource = readFileSync(join(process.cwd(), "app/delivery/[id].tsx"), "utf8");

describe("palette des boutons", () => {
  it("l'action principale est le seul aplat de la couleur de marque, et son texte y est sombre", () => {
    // Le bouton existait en deux variantes, toutes deux sous le seuil lisible : fond blanc à texte
    // orange (2,16:1) hors authentification, fond orange à texte blanc (2,16:1) dans le parcours de
    // création de compte. Une seule palette désormais, et #111111 sur #FF9800 donne 8,76:1.
    expect(buttonSource).toContain('primary: { background: "#FF9800", foreground: "#111111", border: "#FF9800" }');
    expect(buttonSource).not.toContain('foreground: "#FF9800"');
    expect(buttonSource).not.toContain('foreground: "#FFFFFF"');
  });

  it("n'a plus de variante réservée à l'authentification", () => {
    // `authStyle` n'existait que pour donner un bouton plein au parcours de création de compte.
    // Tous les boutons principaux étant pleins, la prop ne distinguait plus rien.
    expect(buttonSource).not.toContain("authStyle");
    expect(authSource).not.toContain("authStyle");
    // Un bouton par écran du parcours : accueil, numéro, code, rôle, engins, nom.
    expect((authSource.match(/<TikisButton /g) ?? []).length).toBe(6);
  });

  it("les actions écrites en toutes lettres se lisent en neutre, pas en orange pâle", () => {
    // Les cartes de l'accueil — « Trajet » côté expéditeur, « Registre » côté livreur — portaient
    // leur libellé en #FF9800 sur fond blanc. La bordure suffit à marquer l'action.
    for (const source of [nativeHomeSource, webHomeSource]) {
      expect(source).toContain('backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#FF9800"');
      expect(source).toContain('tripCtaText: { fontSize: 12.5, fontWeight: "700", color: "#111111" }');
      expect(source).toContain('compactAction: { fontSize: 11.5, fontWeight: "700", color: "#111111" }');
    }
    expect(deliverySource).toContain('trackButtonText: { color: "#111111"');
  });

  it("donne au bouton bloqué un fond à lui, au lieu d'une transparence", () => {
    expect(buttonSource).toContain('DISABLED_PALETTE: ButtonPalette = { background: "#EEF1F6"');
    expect(buttonSource).toContain("disabled && !loading ? DISABLED_PALETTE : activePalette");
  });
});
