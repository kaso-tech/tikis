import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { getTikisseSessionTokenFromHeaders } from "../server/_core/context";

describe("contrat d’en-tête de session Tikisse", () => {
  it("accepte l’en-tête courant envoyé par le client tRPC", () => {
    expect(getTikisseSessionTokenFromHeaders({ "x-tikisse-session": "session-courante" })).toBe("session-courante");
  });

  it("conserve la compatibilité avec l’en-tête historique", () => {
    expect(getTikisseSessionTokenFromHeaders({ "x-tikisse-profile-session": ["session-historique"] })).toBe("session-historique");
  });

  it("priorise l’en-tête courant lorsqu’ils sont tous deux présents", () => {
    expect(getTikisseSessionTokenFromHeaders({ "x-tikisse-session": "session-courante", "x-tikisse-profile-session": "session-historique" })).toBe("session-courante");
  });

  it("accepte encore l’ancien nom d’en-tête (renommage Tikis → Tikisse) : l’app mobile ne se met pas à jour instantanément", () => {
    expect(getTikisseSessionTokenFromHeaders({ "x-tikis-session": "session-avant-renommage" })).toBe("session-avant-renommage");
  });

  it("priorise le nouveau nom d’en-tête sur l’ancien lorsqu’ils sont tous deux présents", () => {
    expect(getTikisseSessionTokenFromHeaders({ "x-tikisse-session": "session-courante", "x-tikis-session": "session-avant-renommage" })).toBe("session-courante");
  });

  it("plus aucune authentification Manus : ni utilisateur dans le contexte, ni jeton porté par le client", () => {
    const context = readFileSync("server/_core/context.ts", "utf8");
    expect(context).not.toMatch(/sdk|Manus|user:/);
    expect(readFileSync("lib/trpc.ts", "utf8")).not.toContain("Authorization");
  });
});
