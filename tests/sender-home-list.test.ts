import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const nativeSource = readFileSync(join(process.cwd(), "components/tikis/screens/home-screen.native.tsx"), "utf8");
const webSource = readFileSync(join(process.cwd(), "components/tikis/screens/home-screen.web.tsx"), "utf8");

/**
 * Sur la variante native, la liste du sheet parcourait `filteredList` en entier,
 * puis un second bloc réaffichait `filteredList` privée de la course
 * sélectionnée : chaque carte non sélectionnée apparaissait donc deux fois.
 *
 * La variante web n'a jamais eu ce défaut — son premier bloc ne rend que la
 * course sélectionnée, le second rend les autres. Les deux fichiers ne peuvent
 * pas être vérifiés de la même façon, et c'est le point de ce test.
 */
describe("liste des livraisons de l’accueil", () => {
  it("ne rend chaque livraison qu’une fois sur la variante native", () => {
    // Un seul parcours par rôle (livreur, expéditeur), et aucune liste dérivée
    // qui réaffiche les mêmes livraisons à côté.
    expect(nativeSource.match(/filteredList\.map\(/g) ?? []).toHaveLength(2);
    expect(nativeSource).not.toContain("otherDeliveries");
  });

  it("garde sur la variante web la course sélectionnée puis les autres", () => {
    expect(webSource).toContain("const otherDeliveries = useMemo");
    expect(webSource).toContain("otherDeliveries.map((delivery)");
    // Le bloc principal ne rend que la sélection : c'est ce qui fait que le
    // second bloc n'est pas un doublon.
    expect(webSource).not.toMatch(/filteredList\.map\(/);
  });
});
