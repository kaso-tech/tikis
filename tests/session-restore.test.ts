import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TIKIS_SESSION_TTL_SECONDS } from "../server/tikis-session";
import { TIKIS_PROFILE_COOKIE_MAX_AGE_MS } from "../server/_core/cookies";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const hook = read("hooks/use-session-restore.ts");
const index = read("app/index.tsx");
const store = read("lib/tikis-store.tsx");

// Le jeton vivait déjà trente jours et survivait à la fermeture de l'application, mais le profil
// n'existait que dans l'état React : chaque relance repartait de `null` et réaffichait le parcours
// d'authentification, jeton valide ou non. C'est ce trou-là que ces tests gardent fermé.
describe("session rendue au démarrage", () => {
  it("l'accueil interroge la session avant de décider d'afficher l'authentification", () => {
    expect(index).toContain("useSessionRestore()");
    // Afficher le parcours d'authentification pendant la vérification le ferait clignoter à chaque
    // ouverture — exactement le symptôme à supprimer.
    expect(index).toContain('restore !== "absent"');
  });

  it("redemande le profil au serveur, et ne s'en remet qu'à lui", () => {
    expect(hook).toContain("profiles.status.fetch()");
    // `signInProfile` : l'autre entrée du store pousserait la notification de bienvenue à chaque
    // relance. Assertion sur l'appel et non sur le nom seul, que le commentaire du hook cite.
    expect(hook).toContain("signInProfile(restored)");
    expect(hook).not.toContain("registerProfile(");
  });

  it("évite l'appel réseau en natif quand aucun jeton n'est stocké", () => {
    expect(hook).toContain("getTikisSessionToken()");
    expect(hook).toContain('Platform.OS !== "web"');
  });

  it("n'efface pas le jeton quand la restauration échoue", () => {
    // Une coupure réseau au lancement ne doit pas coûter sa session : seul le serveur décide, et
    // se reconnecter remplacera de toute façon un jeton périmé.
    expect(hook).not.toContain("clearTikisSessionToken");
  });

  it("le store reste la seule source du profil en mémoire, sans persistance parallèle", () => {
    // Si un jour le profil était aussi écrit sur le disque, il pourrait survivre à une session
    // révoquée côté serveur : la restauration doit rester un aller-retour serveur.
    expect(store).not.toContain("AsyncStorage");
    expect(store).not.toContain("SecureStore");
  });
});

describe("durée de session", () => {
  it("le cookie web expire en même temps que le jeton qu'il transporte", () => {
    expect(TIKIS_PROFILE_COOKIE_MAX_AGE_MS).toBe(TIKIS_SESSION_TTL_SECONDS * 1000);
  });

  it("la fenêtre des sessions listées couvre toute la durée de vie du jeton", () => {
    // Une session encore valide mais sortie de la liste ne serait plus révocable, alors que
    // l'appareil correspondant continuerait d'accéder au compte.
    const sessions = read("server/sessions.ts");
    expect(sessions).toContain("ACTIVE_SESSION_WINDOW_DAYS = TIKIS_SESSION_TTL_SECONDS / (24 * 60 * 60)");
  });
});
