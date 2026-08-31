import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isDeliveryCompletedToday } from "../shared/tikis-domain";

const nativeSource = readFileSync(join(process.cwd(), "components/tikis/screens/home-screen.native.tsx"), "utf8");
const webSource = readFileSync(join(process.cwd(), "components/tikis/screens/home-screen.web.tsx"), "utf8");

describe("onglets de l’accueil livreur", () => {
  it.each([nativeSource, webSource])("déclare les onglets dans l’ordre métier", (source) => {
    const blockStart = source.indexOf("const DRIVER_FILTERS");
    const blockEnd = source.indexOf("function matchesFilter", blockStart);
    const block = source.slice(blockStart, blockEnd);
    expect(block).toContain('{ key: "open", label: "Disponibles" }');
    expect(block).toContain('{ key: "pending", label: "À confirmer" }');
    expect(block).toContain('{ key: "active", label: "En cours" }');
    expect(block).toContain('{ key: "completed", label: "Terminées" }');
    expect(block.indexOf("Disponibles")).toBeLessThan(block.indexOf("À confirmer"));
    expect(block.indexOf("À confirmer")).toBeLessThan(block.indexOf("En cours"));
    expect(block.indexOf("En cours")).toBeLessThan(block.indexOf("Terminées"));
    expect(source).toContain("isDriver ? isDeliveryCompletedToday(delivery) : status === \"completed\"");
  });

  it("limite l’onglet Terminées du livreur à la journée courante", () => {
    const now = new Date(2026, 7, 31, 12, 0, 0);
    expect(isDeliveryCompletedToday({ status: "completed", completedAt: new Date(2026, 7, 31, 8, 30, 0).toISOString() }, now)).toBe(true);
    expect(isDeliveryCompletedToday({ status: "completed", completedAt: new Date(2026, 7, 30, 23, 59, 0).toISOString() }, now)).toBe(false);
    expect(isDeliveryCompletedToday({ status: "active", completedAt: now.toISOString() }, now)).toBe(false);
  });
});
