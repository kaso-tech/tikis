import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PRIMARY = "#FF9800";

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
 * #FF9800 sur blanc donne 2,16:1, et blanc sur #FF9800 le même 2,16:1, là où le seuil lisible est 4,5:1.
 * L'ancien brun #9A6201 tenait le rôle parce qu'il était la même teinte assombrie (30 % de luminosité
 * contre 50 %) : il donnait 5,10:1 dans les deux sens. En passant à l'orange sans changer la répartition,
 * on avait gardé 93 textes, tous les champs de saisie et les deux variantes du bouton principal sous le
 * seuil — d'où l'impression d'une application saturée de couleur, doublée d'un vrai problème de lecture
 * en plein soleil, là où ces livreurs travaillent.
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
    // Le piège à éviter : la forme ternaire `color={actif ? "#FF9800" : …}`, qu'une recherche sur
    // `color="#FF9800"` laisse passer entièrement.
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
