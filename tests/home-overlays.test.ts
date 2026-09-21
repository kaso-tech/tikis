import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const homes = {
  natif: read("components/tikis/screens/home-screen.native.tsx"),
  web: read("components/tikis/screens/home-screen.web.tsx"),
};
const candidatesScreen = read("app/delivery/[id]/candidates.tsx");

/**
 * La liste des candidatures était une feuille glissante empilée par-dessus la feuille
 * d'accueil. Sur Android, `elevation` décide seul de l'ordre de peinture entre frères :
 * elle passait dessous, invisible sous un fond blanc opaque, et le bouton « Candidats »
 * paraissait sans effet. Le correctif d'alors ajustait les rangs de profondeur ; celui-ci
 * supprime la superposition, donc le problème.
 */
describe("la liste des candidatures est un écran, pas une surcouche", () => {
  it.each(Object.entries(homes))("sur %s, l'accueil y navigue au lieu d'empiler une feuille", (_name, home) => {
    expect(home).toContain("/candidates` as any)");
    expect(home).not.toContain("CandidatesSheet");
    expect(home).not.toContain("candidateDelivery");
  });

  it("un échec de chargement ne s'y lit pas comme une absence de candidat", () => {
    expect(candidatesScreen).toContain("candidatesQuery.isLoading");
    expect(candidatesScreen).toContain("Liste des candidatures indisponible");
    expect(candidatesScreen).toContain("En attente de candidatures");
    expect(candidatesScreen).toContain("candidatesQuery.refetch()");
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
