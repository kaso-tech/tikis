import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// La page profil, puis la page de création de livraison, avaient un fond figé (#FAFAFA) au lieu de
// theme.background : visible dès qu'on changeait de thème, ou simplement parce que #FAFAFA ne
// correspond à aucun des deux tokens réels (#F0F3F8 clair, #171108 sombre — theme.config.js). Ce
// test garde les écrans principaux alignés sur le même fond dynamique.
const SCREENS = [
  "app/(tabs)/profile.tsx",
  "app/(tabs)/wallet.tsx",
  "app/(tabs)/earnings.tsx",
  "app/(tabs)/addresses.tsx",
  "app/create-delivery.tsx",
];

describe("fond des écrans principaux", () => {
  it.each(SCREENS)("%s applique theme.background à son SafeAreaView racine, pas une couleur figée", (path) => {
    const source = readFileSync(join(process.cwd(), path), "utf8");
    expect(source).toContain("backgroundColor: theme.background");
  });
});
