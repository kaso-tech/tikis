import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const analyticsSource = readFileSync(join(process.cwd(), "server/analytics.ts"), "utf8");

describe("requête analytics de tendance sender", () => {
  it("groupe la tendance par une clé mensuelle unique compatible only_full_group_by", () => {
    expect(analyticsSource).toContain("DATE_FORMAT(${tikisDeliveries.completedAt}, '%Y-%m')");
    expect(analyticsSource).toContain(".groupBy(sql`DATE_FORMAT(${tikisDeliveries.completedAt}, '%Y-%m')`)");
    expect(analyticsSource).not.toContain(".groupBy(sql`YEAR(${tikisDeliveries.completedAt})`, sql`MONTH(${tikisDeliveries.completedAt})`)");
  });
});
