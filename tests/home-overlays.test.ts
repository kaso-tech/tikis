import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const homes = {
  natif: read("components/tikis/screens/home-screen.native.tsx"),
  web: read("components/tikis/screens/home-screen.web.tsx"),
};
const sheet = read("components/tikis/candidates-sheet.tsx");

/**
 * La feuille des candidatures passait *sous* la feuille d'accueil sur Android :
 * entre frères, `elevation` décide seul de l'ordre de peinture, et le bouton
 * « Candidats » paraissait donc sans effet. Le correctif d'alors ajustait les
 * rangs de profondeur ; celui-ci rend la feuille dans sa propre fenêtre, où
 * aucun frère ne peut passer devant.
 */
describe("la feuille des candidatures ne peut plus passer sous l'accueil", () => {
  it("est rendue dans un Modal, pas empilée dans l'arbre de l'accueil", () => {
    expect(sheet).toContain('<Modal visible transparent animationType="none"');
    // La forme d'une propriété de style, pas le mot : le commentaire du fichier
    // explique justement pourquoi l'empilement ne dépend plus d'elle.
    expect(sheet).not.toMatch(/elevation:/);
    expect(sheet).not.toMatch(/zIndex:/);
  });

  it.each(Object.entries(homes))("sur %s, l'accueil l'ouvre par son état", (_name, home) => {
    expect(home).toContain("setCandidatesDeliveryId(delivery.id)");
    expect(home).toContain("<CandidatesSheet visible={Boolean(candidatesDeliveryId)}");
  });

  it("un échec de chargement ne s'y lit pas comme une absence de candidat", () => {
    expect(sheet).toContain("candidatesQuery.isLoading");
    expect(sheet).toContain("Liste des candidatures indisponible");
    expect(sheet).toContain("En attente de candidatures");
    expect(sheet).toContain("candidatesQuery.refetch()");
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
