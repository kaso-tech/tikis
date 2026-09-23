import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const buttonSource = source("components/tikis/ui.tsx");
const themeSource = source("lib/use-theme-colors.ts");
const createDeliverySource = source("app/create-delivery.tsx");
const addressesSource = source("app/(tabs)/addresses.tsx");
const contactSource = source("app/contact.tsx");
const reviewSource = source("app/review/[id].tsx");
const reportSource = source("app/report/[id].tsx");
const profileSource = source("app/(tabs)/profile.tsx");
const walletSource = source("app/(tabs)/wallet.tsx");
const nativeHomeSource = source("components/tikis/screens/home-screen.native.tsx");
const webHomeSource = source("components/tikis/screens/home-screen.web.tsx");
const yangoSource = source("components/tikis/yango-address-picker.tsx");
const authSource = source("components/tikis/auth-flow.tsx");

describe("palette des champs et menus", () => {
  it("expose un fond de champ neutre, pas une teinte de la couleur de marque", () => {
    // Le crème #F7EFE5 venait du brun d'origine : chaque champ arrivait teinté. Les quatre écrans
    // qui lisent ce token posent tous une bordure par-dessus, donc un fond neutre reste visible.
    expect(themeSource).toContain('input: scheme === "light" ? "#F0F3F8" : "#3A2B1A"');
  });

  it("rend en noir le texte que l'utilisateur tape, jamais dans la couleur de marque", () => {
    // Numéro de téléphone, code reçu, nom, montant, recherche, commentaire d'avis, description d'un
    // signalement : tous s'affichaient dans la couleur de marque (#FF9800 à l'époque, 2,16:1 sur
    // fond blanc). La règle vaut pour n'importe quelle couleur de marque, pas seulement celle-là.
    for (const formSource of [createDeliverySource, contactSource, reviewSource, reportSource, profileSource, walletSource]) {
      expect(formSource).toMatch(/#FFFFFF|backgroundColor: theme\.input/);
      expect(formSource).not.toMatch(/(input|textarea|comment)[a-zA-Z]*: \{[^}]*color: "#01A7BD"/);
    }
  });

  it("harmonise les recherches et sélecteurs de lieux sur mobile et web", () => {
    expect(addressesSource).toContain("backgroundColor: theme.input");
    expect(yangoSource).toContain("backgroundColor: theme.input");
    for (const pickerSource of [nativeHomeSource, webHomeSource]) {
      expect(pickerSource).toContain("#FFFFFF");
      expect(pickerSource).toContain('searchInput: { flex: 1, color: "#111111"');
    }
  });

  it("le parcours d'authentification prend la palette commune, sans variante à lui", () => {
    // Un bouton par écran : accueil, numéro, code, rôle, engins, nom. Ils avaient leur propre palette
    // (fond orange, texte blanc, 2,16:1) ; ils prennent maintenant celle de tout le monde.
    expect((authSource.match(/<TikisButton /g) ?? []).length).toBe(6);
    expect(buttonSource).toContain('primary: { background: "#01A7BD", foreground: "#111111"');
  });
});
