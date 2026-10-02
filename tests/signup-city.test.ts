import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveSignupCity } from "../server/geography";

function mapboxReplies(names: string[]) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ suggestions: names.map((name) => ({ name })) }), { status: 200 })));
}

describe("ville saisie à l'inscription", () => {
  beforeEach(() => { vi.stubEnv("MAPBOX_SECRET_ACCESS_TOKEN", "sk.test"); });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("retient le nom officiel de la ville trouvée dans le pays", async () => {
    mapboxReplies(["Ouagadougou", "Ouahigouya"]);
    await expect(resolveSignupCity("ouagadougou", "BF")).resolves.toBe("Ouagadougou");
  });

  it("refuse une ville absente des résultats du pays", async () => {
    mapboxReplies(["Ouahigouya"]);
    await expect(resolveSignupCity("Ouaga 2000 bis", "BF")).rejects.toThrow("Choisissez votre ville dans la liste proposée.");
  });

  it("garde le texte saisi si le service de cartes ne répond pas : l'inscription n'échoue pas", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("indisponible", { status: 503 })));
    await expect(resolveSignupCity("Koudougou", "BF")).resolves.toBe("Koudougou");
  });
});
