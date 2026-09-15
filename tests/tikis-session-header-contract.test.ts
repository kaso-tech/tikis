import { describe, expect, it } from "vitest";
import { getTikisSessionTokenFromHeaders, shouldAuthenticateManusRequest } from "../server/_core/context";

describe("contrat d’en-tête de session Tikis", () => {
  it("accepte l’en-tête courant envoyé par le client tRPC", () => {
    expect(getTikisSessionTokenFromHeaders({ "x-tikis-session": "session-courante" })).toBe("session-courante");
  });

  it("conserve la compatibilité avec l’en-tête historique", () => {
    expect(getTikisSessionTokenFromHeaders({ "x-tikis-profile-session": ["session-historique"] })).toBe("session-historique");
  });

  it("priorise l’en-tête courant lorsqu’ils sont tous deux présents", () => {
    expect(getTikisSessionTokenFromHeaders({ "x-tikis-session": "session-courante", "x-tikis-profile-session": "session-historique" })).toBe("session-courante");
  });

  it("n’initialise pas l’authentification Manus pour une requête Tikis anonyme", () => {
    expect(shouldAuthenticateManusRequest({ "x-tikis-session": "session-tikis" })).toBe(false);
  });

  it("préserve l’authentification Manus pour un bearer ou son cookie interne", () => {
    expect(shouldAuthenticateManusRequest({ authorization: "Bearer manus-token" })).toBe(true);
    expect(shouldAuthenticateManusRequest({ cookie: "app_session_id=manus-cookie" })).toBe(true);
  });
});
