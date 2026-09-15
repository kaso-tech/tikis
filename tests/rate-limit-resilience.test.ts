import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Le rate-limit distribué protège le service : il ne doit jamais être ce qui le fait tomber.
 *
 * `protectedGeographyProcedure` l'appelle avant chaque endpoint géographique (recherche d'adresse,
 * géocodage inverse, itinéraire, enregistrement de lieu). Tant que la table `tikis_rate_limits`
 * (migration manuelle 0036) n'est pas appliquée — ou pendant n'importe quel incident SQL — chaque
 * écriture du compteur lève. Sans ce repli, l'expéditeur perdait d'un coup la recherche d'adresse,
 * l'itinéraire et la création de livraison, pour une panne du seul compteur de requêtes.
 */
const originalDatabaseUrl = process.env.DATABASE_URL;

beforeAll(() => {
  // Port fermé : le pool mysql2 est paresseux, la construction réussit et c'est la requête qui
  // échoue (ECONNREFUSED) — exactement le cas « la base répond mais la requête ne passe pas ».
  process.env.DATABASE_URL = "mysql://tikis:tikis@127.0.0.1:1/tikis";
});

afterAll(() => {
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
});

describe("résilience du rate-limit distribué", () => {
  it("laisse passer la requête quand le compteur est inaccessible, au lieu de lever", async () => {
    const { checkDistributedRateLimit } = await import("../server/db");
    await expect(checkDistributedRateLimit("geo", "+22670000000", 60_000, 30)).resolves.toBe(true);
  }, 20_000);
});
