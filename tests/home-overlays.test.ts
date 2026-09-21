import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const sheet = read("components/tikis/candidates-sheet.tsx");
const homes = {
  natif: read("components/tikis/screens/home-screen.native.tsx"),
  web: read("components/tikis/screens/home-screen.web.tsx"),
};

/** Le rang de profondeur déclaré sur un style nommé, ou 0 s'il n'en porte pas. */
function depthOf(source: string, style: string, token: "zIndex" | "elevation") {
  const block = new RegExp(`\\b${style}: \\{[^}]*\\}`).exec(source)?.[0] ?? "";
  return Number(new RegExp(`${token}: (\\d+)`).exec(block)?.[1] ?? 0);
}

describe("la liste des candidatures passe au-dessus de la feuille d'accueil", () => {
  it.each(Object.entries(homes))("sur %s, elle a un rang de profondeur supérieur", (_name, home) => {
    for (const token of ["zIndex", "elevation"] as const) {
      expect(depthOf(sheet, "overlay", token)).toBeGreaterThan(depthOf(home, "sheet", token));
    }
  });

  it("s'ancre sur ce rang plutôt que sur l'ordre du JSX", () => {
    // Elle est rendue après la feuille d'accueil dans l'arbre, ce qui suffirait
    // sur le web ; sur Android, `elevation` décide seul et la faisait passer
    // dessous, sous un fond blanc opaque.
    expect(sheet).toContain("StyleSheet.absoluteFill, styles.overlay");
  });

  it.each(Object.entries(homes))("sur %s, un échec de chargement ne se lit pas comme une absence de candidat", (_name, home) => {
    expect(home).toContain("isLoading={candidatesQuery.isLoading}");
    expect(home).toContain("errorMessage={candidatesQuery.error");
    expect(home).toContain("onRetry={");
  });
});

describe("la carte du livreur mène toujours à la fiche", () => {
  it.each(Object.entries(homes))("sur %s, « Détails » ne dépend pas de l'action en cours", (_name, home) => {
    const compact = home.slice(home.indexOf("styles.compactRight"), home.indexOf("styles.compactRight") + 1800);
    expect(compact).toContain("onPress={onDetails}");
    // Le lien vivait dans la branche `: (` du ternaire de l'action, donc
    // seulement sur les courses terminées — les seules sans action.
    expect(compact).not.toMatch(/\) : \(\s*<Pressable\s+onPress=\{onDetails\}/);
  });
});
