import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeDriverEarningsProjection } from "../server/analytics";
import { netDriverEarning } from "../shared/tikis-domain";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const NOW = new Date("2026-09-23T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

describe("la projection de gains et l'historique racontent la même chose", () => {
  it("additionne les gains nets de l'historique, pas le prix brut des courses", () => {
    // Deux courses de 2 000 FCFA commissionnées à 10 % : 3 600 nets, pas 4 000 bruts.
    const history = [
      { amount: netDriverEarning(2000, 200), createdAt: daysAgo(1) },
      { amount: netDriverEarning(2000, 200), createdAt: daysAgo(2) },
    ];
    const projection = computeDriverEarningsProjection(history, NOW);
    expect(projection.totalLast7Days).toBe(3600);
    expect(projection.averagePerDay).toBe(Math.round(3600 / 7));
    expect(projection.projection30Days).toBe(Math.round(3600 / 7) * 30);
  });

  it("compte les courses publiées sans offre, au lieu de les valoir zéro", () => {
    // L'ancienne requête faisait SUM(offeredPrice) : une course sans offre (NULL) ne comptait pas.
    // L'historique, lui, retombe sur le prix estimé — la projection le suit désormais.
    const history = [{ amount: netDriverEarning(1500, 150), createdAt: daysAgo(3) }];
    expect(computeDriverEarningsProjection(history, NOW).totalLast7Days).toBe(1350);
  });

  it("sépare la semaine écoulée de la précédente pour la tendance", () => {
    const history = [
      { amount: 3000, createdAt: daysAgo(2) },
      { amount: 1000, createdAt: daysAgo(9) },
      { amount: 1000, createdAt: daysAgo(10) },
    ];
    const projection = computeDriverEarningsProjection(history, NOW);
    expect(projection.totalLast7Days).toBe(3000);
    expect(projection.trendPct).toBe(50);
  });

  it("classe les meilleurs jours sur trente jours, en additionnant les courses d'un même jour", () => {
    const history = [
      { amount: 1000, createdAt: "2026-09-20T08:00:00Z" },
      { amount: 1500, createdAt: "2026-09-20T17:00:00Z" },
      { amount: 2000, createdAt: "2026-09-18T10:00:00Z" },
      { amount: 9999, createdAt: daysAgo(31) }, // hors fenêtre
    ];
    expect(computeDriverEarningsProjection(history, NOW).topDays).toEqual([
      { date: "2026-09-20", amount: 2500 },
      { date: "2026-09-18", amount: 2000 },
    ]);
  });

  it("vaut zéro partout sans aucune course, sans inventer de tendance", () => {
    const projection = computeDriverEarningsProjection([], NOW);
    expect(projection).toEqual({ totalLast7Days: 0, averagePerDay: 0, projection30Days: 0, trendPct: null, topDays: [] });
  });

  it("le routeur nourrit la projection avec l'historique lui-même, pas une seconde requête", () => {
    const routers = read("server/routers.ts");
    expect(routers).toContain("computeDriverEarningsProjection(await db.getDriverCompletedDeliveryEarnings(profile.phone))");
    // Plus aucune agrégation SQL propre à la projection : c'est elle qui divergeait.
    expect(read("server/analytics.ts")).not.toContain("drizzle-orm");
  });
});

describe("l'écran Gains ne se contredit plus", () => {
  const screen = read("app/(tabs)/earnings.tsx");

  it("l'onglet de la semaine dit ce qu'il filtre", () => {
    // Il s'intitulait « 7 derniers jours » mais comptait depuis lundi — un lundi, la seule journée.
    // La carte de projection, juste au-dessus, emploie ce libellé pour une vraie fenêtre glissante.
    expect(screen).toContain('week: { label: "Cette semaine"');
    expect(screen).toContain("next.setDate(next.getDate() - diff);");
  });

  it("regroupe par jour civil local et relit la clé comme telle", () => {
    expect(screen).toContain("const key = localDayKey(entry.createdAt);");
    expect(screen).toContain("dateFromDayKey(day.dateKey).toLocaleDateString");
    expect(screen).toContain("dateFromDayKey(bestDay.dateKey).toLocaleDateString");
    expect(screen).not.toContain("toISOString().slice(0, 10)");
  });

  it("« Dernière course » ne dépend ni de la période ni du filtre affichés", () => {
    expect(screen).toContain("earningsHistory.filter(isDeliveryEarning).map((entry) => new Date(entry.createdAt).getTime())");
    expect(screen).not.toContain("history[0] ? new Date(history[0].createdAt) : null");
  });

  it("la projection, une estimation, passe avant le titre de l'historique", () => {
    expect(screen.indexOf("<DriverEarningsProjection")).toBeLessThan(screen.indexOf("styles.sectionHeader}>"));
  });
});
