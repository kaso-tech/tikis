import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const nativeSource = readFileSync(join(process.cwd(), "components/tikis/screens/home-screen.native.tsx"), "utf8");
const webSource = readFileSync(join(process.cwd(), "components/tikis/screens/home-screen.web.tsx"), "utf8");

describe("onglets de l’accueil livreur", () => {
  it.each([nativeSource, webSource])("déclare les quatre onglets dans l’ordre métier", (source) => {
    const blockStart = source.indexOf("const DRIVER_FILTERS");
    const blockEnd = source.indexOf("function matchesFilter", blockStart);
    const block = source.slice(blockStart, blockEnd);
    expect(block).toContain('{ key: "open", label: "Publiées" }');
    expect(block).toContain('{ key: "pending", label: "Attribuées" }');
    expect(block).toContain('{ key: "active", label: "En cours" }');
    expect(block).toContain('{ key: "completed", label: "Terminées" }');
    expect(block.indexOf("Publiées")).toBeLessThan(block.indexOf("Attribuées"));
    expect(block.indexOf("Attribuées")).toBeLessThan(block.indexOf("En cours"));
    expect(block.indexOf("En cours")).toBeLessThan(block.indexOf("Terminées"));
    expect(source).toContain('if (filter === "completed") return isDriver ? isDeliveryCompletedToday(delivery) : isDeliveryCompletedWithinLast24Hours(delivery);');
  });

  it.each([nativeSource, webSource])("affiche un compteur et le style bouton sur chaque onglet", (source) => {
    expect(source).toContain("const filterCounts = useMemo");
    expect(source).toContain("accessibilityRole=\"tab\"");
    expect(source).toContain("styles.chipCount");
    expect(source).toContain('backgroundColor: "#F7EFE5"');
    expect(source).toContain('color: "#9A6201"');
  });
});
