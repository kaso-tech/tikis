import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PRIMARY = "#01A7BD";

function sources(dir: string): string[] {
  return readdirSync(join(process.cwd(), dir)).flatMap((entry) => {
    const chemin = join(dir, entry);
    if (statSync(join(process.cwd(), chemin)).isDirectory()) return sources(chemin);
    return /\.tsx?$/.test(entry) && !entry.endsWith(".d.ts") ? [chemin] : [];
  });
}

const ecrans = [...sources("app"), ...sources("components")];

/**
 * La règle de la palette, en un mot : la couleur de marque remplit, borde et marque — elle ne se lit pas.
 *
 * Elle a été écrite pour l'orange #FF9800 (69fec0b), qui ne donnait que 2,16:1 en texte sur blanc — sous
 * le seuil lisible de 4,5:1 — là où l'ancien brun #9A6201 en donnait 5,10:1, à la même teinte mais assombrie
 * (30 % de luminosité contre 50 %). Avant cette règle, l'app gardait 93 textes, tous les champs de saisie
 * et les deux variantes du bouton principal sous le seuil : impression de saturation, doublée d'un vrai
 * problème de lecture en plein soleil, là où ces livreurs travaillent.
 *
 * Le turquoise #01A7BD qui a suivi confirme que la règle protège au-delà d'une seule couleur : 2,89:1 en
 * texte sur blanc, de nouveau sous le seuil — un remplacement brut aurait reproduit le même défaut avec
 * une teinte différente. La discipline (fills/bordures/icônes justifiées, jamais de texte) a suffi à
 * absorber le second changement sans repasser par cette analyse.
 */
describe("sobriété de la palette", () => {
  it("aucun écran ne pose la couleur de marque comme couleur de texte", () => {
    const fautifs = ecrans.filter((f) => readFileSync(join(process.cwd(), f), "utf8").includes(`color: "${PRIMARY}"`));
    expect(fautifs).toEqual([]);
  });

  it("les icônes orange restantes sont toutes justifiées", () => {
    // Trois cas seulement : l'étoile de notation (convention universelle), l'icône d'ouverture des
    // écrans d'authentification (size 30, seul accent de sa page), et une icône qui marque un état
    // sélectionné ou distingue collecte et destination — la couleur y porte du sens, pas du décor.
    // Le piège à éviter : la forme ternaire `color={actif ? "#01A7BD" : …}`, qu'une recherche sur
    // `color="#01A7BD"` laisse passer entièrement.
    const justifiee = (balise: string) =>
      balise.includes('name="star"') || balise.includes("star <= rating")
      || balise.includes("size={30}")
      || /\b(active|selected|isPickup)\b/.test(balise);
    const orphelines = ecrans.flatMap((f) => {
      const source = readFileSync(join(process.cwd(), f), "utf8");
      return (source.match(new RegExp(`<MaterialIcons[^>]*?${PRIMARY}[^>]*?>`, "g")) ?? [])
        .filter((balise) => !justifiee(balise))
        .map((balise) => `${f} → ${balise.slice(0, 80)}`);
    });
    expect(orphelines).toEqual([]);
  });

  it("rien de blanc ne se pose sur un aplat de la couleur de marque", () => {
    // Le solde du Wallet était le pire cas : blanc à 55 % d'opacité sur orange, soit 1,51:1.
    for (const fichier of ["app/(tabs)/wallet.tsx", "app/(tabs)/earnings.tsx"]) {
      const source = readFileSync(join(process.cwd(), fichier), "utf8");
      expect(source).toMatch(/balanceCard: \{[^}]*backgroundColor: "#111111"/);
      expect(source).not.toContain('color: "rgba(255,255,255,0.55)"');
    }
  });

  it("la couleur de marque reste présente, en aplat et en bordure", () => {
    // La sobriété n'est pas l'effacement : l'orange doit continuer à marquer l'action et la sélection.
    const aplats = ecrans.filter((f) => {
      const source = readFileSync(join(process.cwd(), f), "utf8");
      return source.includes(`backgroundColor: "${PRIMARY}"`) || source.includes(`borderColor: "${PRIMARY}"`);
    });
    expect(aplats.length).toBeGreaterThan(8);
  });
});
