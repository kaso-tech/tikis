import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const analyticsSource = readFileSync(join(process.cwd(), "server/analytics.ts"), "utf8");

describe("requête analytics de tendance sender", () => {
  it("réutilise une clé mensuelle entièrement qualifiée dans SELECT, GROUP BY et ORDER BY", () => {
    expect(analyticsSource).toContain("const completedMonthKey = sql<string>`DATE_FORMAT(\\`tikis_deliveries\\`.\\`completedAt\\`, '%Y-%m')`;");
    expect(analyticsSource).toContain("monthKey: completedMonthKey");
    expect(analyticsSource).toContain(".groupBy(completedMonthKey)");
    expect(analyticsSource).toContain(".orderBy(completedMonthKey)");
    expect(analyticsSource).not.toContain(".groupBy(sql`YEAR(${tikisDeliveries.completedAt})`, sql`MONTH(${tikisDeliveries.completedAt})`)");
  });
});
