import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "components/tikis/auth-flow.tsx"), "utf8");

describe("parcours de connexion et d’inscription", () => {
  it("commence au numéro : l’écran de bienvenue est fondu dedans", () => {
    expect(source).toContain('type Stage = "phone" | "otp" | "role" | "vehicles" | "name";');
    expect(source).toContain('useState<Stage>("phone")');
    expect(source).not.toContain("WelcomeScreen");
    // La promesse, la marque et le texte légal vivent désormais sur l'écran du numéro.
    expect(source).toContain("Votre numéro suffit.");
    expect(source).toContain('router.push("/legal/terms"');
  });

  it("ne dit « inscription » qu’une fois le numéro vérifié", () => {
    // Le bandeau annonçait « INSCRIPTION · Étape 1 sur 5 » à quelqu'un qui se
    // connectait : on ne sait qu'après le code lequel des deux parcours c'est.
    expect(source).toContain('"CRÉATION DU COMPTE" : "VÉRIFICATION DU NUMÉRO"');
    expect(source).toContain('"Connexion ou inscription"');
    expect(source).not.toMatch(/Étape \$\{step\} sur 5/);
  });

  it("compte sur le total du rôle, et ne le promet pas avant de le connaître", () => {
    // L'étape 4 était celle des engins : un expéditeur passait de 3 à 5.
    expect(source).toContain('selectedRole === null ? null : selectedRole === "driver" ? 3 : 2');
    expect(source).toContain("total ? `Étape ${step} sur ${total}` : `Étape ${step}`");
  });

  it("récapitule le compte avant de le créer", () => {
    expect(source).toContain("NUMÉRO VÉRIFIÉ");
    expect(source).toContain("TYPE DE COMPTE — DÉFINITIF");
    expect(source).toContain("onEditRole");
    expect(source).toContain("onEditVehicles");
  });

  it("laisse les six cases du code tenir dans la largeur", () => {
    // `flex: 1` seul laissait la largeur intrinsèque de l'<input> l'emporter :
    // 287 px par case sur le web, soit 1 762 px pour un écran de 390.
    expect(source).toContain("otpInput: { flex: 1, minWidth: 0,");
  });

  it("montre les points de progression restants", () => {
    // Ils étaient de la couleur exacte du fond.
    expect(source).not.toContain('stepDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#F0F3F8" }');
  });

  it("signale le mode simulation comme un avertissement, pas comme une information", () => {
    expect(source).toContain("simulationWarning");
    expect(source).toContain("aucun SMS n’est envoyé");
  });

  it("n’offre plus un sélecteur de langue qui ne traduit rien", () => {
    // Il ne changeait que les quatre chaînes de l'écran de bienvenue ; les cinq
    // écrans suivants restaient en français.
    expect(source).not.toContain("welcomeCopy");
    expect(source).not.toContain("onLanguageChange");
  });
});
