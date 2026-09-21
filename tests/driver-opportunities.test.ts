import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { driverOpportunityPrice, sortDriverOpportunities } from "../shared/driver-opportunities";

type Row = Parameters<typeof sortDriverOpportunities>[0][number];

const open = (id: string, price: number, createdAt: string): Row & { id: string } => ({
  id,
  status: "open",
  offeredPrice: price,
  estimatedPrice: 1_000,
  createdAt,
} as never);

describe("ordre des courses chez le livreur", () => {
  it("remonte les annonces les mieux payées, ce que promet la majoration à l'expéditeur", () => {
    const sorted = sortDriverOpportunities([
      open("a", 1_500, "2026-09-20T10:00:00Z"),
      open("b", 4_000, "2026-09-20T08:00:00Z"),
      open("c", 3_000, "2026-09-20T12:00:00Z"),
    ]);
    expect(sorted.map((row) => (row as { id: string }).id)).toEqual(["b", "c", "a"]);
  });

  it("garde la course engagée au-dessus, quel que soit le prix des annonces", () => {
    const sorted = sortDriverOpportunities([
      open("riche", 50_000, "2026-09-20T10:00:00Z"),
      { id: "en-cours", status: "active", offeredPrice: 900, estimatedPrice: 900, createdAt: "2026-09-19T10:00:00Z" } as never,
      { id: "candidature", status: "open", ownCandidateStatus: "applied", offeredPrice: 800, estimatedPrice: 800, createdAt: "2026-09-19T09:00:00Z" } as never,
    ]);
    expect(sorted.map((row) => (row as { id: string }).id)).toEqual(["en-cours", "candidature", "riche"]);
  });

  it("départage deux annonces au même prix par la plus récente", () => {
    const sorted = sortDriverOpportunities([
      open("vieille", 2_000, "2026-09-18T10:00:00Z"),
      open("recente", 2_000, "2026-09-20T10:00:00Z"),
    ]);
    expect(sorted.map((row) => (row as { id: string }).id)).toEqual(["recente", "vieille"]);
  });

  it("retombe sur l'estimation quand l'expéditeur n'a pas fixé de prix", () => {
    expect(driverOpportunityPrice({ offeredPrice: undefined, estimatedPrice: 2_500 })).toBe(2_500);
    expect(driverOpportunityPrice({ offeredPrice: 0, estimatedPrice: 2_500 })).toBe(2_500);
    expect(driverOpportunityPrice({ offeredPrice: 3_100, estimatedPrice: 2_500 })).toBe(3_100);
  });

  it("n'altère pas la liste reçue", () => {
    const rows = [open("a", 1_000, "2026-09-20T10:00:00Z"), open("b", 9_000, "2026-09-20T10:00:00Z")];
    const before = rows.map((row) => (row as { id: string }).id);
    sortDriverOpportunities(rows);
    expect(rows.map((row) => (row as { id: string }).id)).toEqual(before);
  });
});

describe("qui applique ce classement", () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

  it("le serveur ordonne la liste du livreur une fois les candidatures connues", () => {
    const routers = read("server/routers.ts");
    expect(routers).toContain("sortDriverOpportunities(compatible.map(");
  });

  it("l'accueil web s'y réfère au lieu de garder sa propre copie", () => {
    const web = read("components/tikis/screens/home-screen.web.tsx");
    expect(web).toContain("sortDriverOpportunities(deliveries.filter(matches))");
    expect(web).not.toContain("driverSortPriority");
  });
});
