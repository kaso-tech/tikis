import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PRIMARY = "#9A6201";

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
 * Elle a été écrite pour l'orange #FF9800 (69fec0b), qui ne donnait que 2,16:1 en texte sur blanc, sous le
 * seuil lisible de 4,5:1. Avant elle, l'app gardait 93 textes, tous les champs de saisie et les deux
 * variantes du bouton principal sous ce seuil : impression de saturation, doublée d'un vrai problème de
 * lecture en plein soleil, là où ces livreurs travaillent.
 *
 * La marque a changé trois fois depuis, et chaque passage a montré ce que la règle protège :
 *   · turquoise #01A7BD — 2,89:1 en texte sur blanc, même défaut qu'avec l'orange ;
 *   · brun #9A6201 (celui d'aujourd'hui) — 5,10:1, le seul de la série qui tiendrait en texte.
 *
 * Ce dernier point est le piège : la règle ne dépend pas du contraste de la couleur du moment, mais du
 * choix de sobriété. Le brun pourrait se lire ; il ne se lit pas pour autant. Ce que le brun change, en
 * revanche, c'est le texte POSÉ dessus : étant sombre, il demande du blanc (5,10:1) là où l'orange et le
 * turquoise demandaient de l'encre — #111111 n'y donne que 3,71:1. Un remplacement mécanique aurait laissé
 * tout l'aplat de l'app sous le seuil, dans l'autre sens.
 */
describe("sobriété de la palette", () => {
  it("aucun écran ne pose la couleur de marque comme couleur de texte", () => {
    const fautifs = ecrans.filter((f) => readFileSync(join(process.cwd(), f), "utf8").includes(`color: "${PRIMARY}"`));
    expect(fautifs).toEqual([]);
  });

  it("les icônes restées dans la couleur de marque sont toutes justifiées", () => {
    // Trois cas seulement : l'étoile de notation (convention universelle), l'icône d'ouverture des
    // écrans d'authentification (size 30, seul accent de sa page), et une icône qui marque un état
    // sélectionné ou distingue collecte et destination — la couleur y porte du sens, pas du décor.
    // Le piège à éviter : la forme ternaire `color={actif ? PRIMARY : …}`, qu'une recherche sur
    // `color="<PRIMARY>"` laisse passer entièrement.
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

  it("le solde se lit sur une carte sombre, pas sur un aplat de la couleur de marque", () => {
    // Le solde du Wallet était le pire cas de la passe précédente : blanc à 55 % d'opacité sur
    // l'orange, soit 1,51:1. Un solde est une information, pas une action : carte sombre.
    for (const fichier of ["app/(tabs)/wallet.tsx", "app/(tabs)/earnings.tsx"]) {
      const source = readFileSync(join(process.cwd(), fichier), "utf8");
      expect(source).toMatch(/balanceCard: \{[^}]*backgroundColor: "#111111"/);
      expect(source).not.toContain('color: "rgba(255,255,255,0.55)"');
    }
  });

  it("la couleur de marque reste présente, en aplat et en bordure", () => {
    // La sobriété n'est pas l'effacement : la couleur doit continuer à marquer l'action et la sélection.
    const aplats = ecrans.filter((f) => {
      const source = readFileSync(join(process.cwd(), f), "utf8");
      return source.includes(`backgroundColor: "${PRIMARY}"`) || source.includes(`borderColor: "${PRIMARY}"`);
    });
    expect(aplats.length).toBeGreaterThan(8);
  });

  it("le texte posé sur l'aplat de marque reste lisible, quelle que soit la couleur", () => {
    /**
     * Le garde-fou qui manquait, et que ce quatrième changement de couleur a révélé.
     *
     * Les assertions précédentes figeaient une valeur (« le texte sur l'aplat est #111111 »), vraie de
     * l'orange et du turquoise, tous deux clairs. Le brun est sombre : l'encre n'y donne que 3,71:1, et
     * c'est le blanc qui s'y lit. Une valeur figée ne protège donc rien — on calcule.
     */
    const luminance = (hex: string) => {
      const canaux = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * canaux[0] + 0.7152 * canaux[1] + 0.0722 * canaux[2];
    };
    const contraste = (a: string, b: string) => {
      const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };

    // Chaque entrée : un texte réellement posé sur l'aplat de marque, relu depuis sa source.
    const surLAplat: [fichier: string, motif: RegExp][] = [
      ["components/tikis/ui.tsx", /primary: \{ background: "#[0-9A-F]{6}", foreground: "(#[0-9A-F]{6})"/],
      ["app/(tabs)/profile.tsx", /avatarText: \{ color: "(#[0-9A-F]{6})"/],
      ["app/(tabs)/earnings.tsx", /flowTabTextActive: \{ color: "(#[0-9A-F]{6})" \}/],
      ["app/(tabs)/earnings.tsx", /periodTabTextActive: \{ color: "(#[0-9A-F]{6})" \}/],
      ["components/tikis/screens/home-screen.native.tsx", /chipCountText: \{ color: "(#[0-9A-F]{6})"/],
      ["components/tikis/screens/home-screen.web.tsx", /chipCountText: \{ color: "(#[0-9A-F]{6})"/],
      ["components/tikis/auth-flow.tsx", /vehicleTitleActive: \{ color: "(#[0-9A-F]{6})" \}/],
      ["components/tikis/auth-flow.tsx", /vehicleTextActive: \{ color: "(#[0-9A-F]{6})" \}/],
    ];

    const illisibles = surLAplat.flatMap(([fichier, motif]) => {
      const trouve = motif.exec(readFileSync(join(process.cwd(), fichier), "utf8"));
      if (!trouve) return [`${fichier} → motif introuvable : ${motif}`];
      const ratio = contraste(trouve[1], PRIMARY);
      return ratio >= 4.5 ? [] : [`${fichier} → ${trouve[1]} sur ${PRIMARY} = ${ratio.toFixed(2)}:1`];
    });
    expect(illisibles).toEqual([]);
  });
});
