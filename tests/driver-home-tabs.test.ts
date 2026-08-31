import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const nativeSource = readFileSync(join(process.cwd(), "components/tikis/screens/home-screen.native.tsx"), "utf8");
const webSource = readFileSync(join(process.cwd(), "components/tikis/screens/home-screen.web.tsx"), "utf8");

describe("onglets de l’accueil livreur", () => {
  it.each([nativeSource, webSource])("déclare les onglets dans l’ordre métier", (source) => {
    const blockStart = source.indexOf("const DRIVER_FILTERS");
    const blockEnd = source.indexOf("function matchesFilter", blockStart);
    const block = source.slice(blockStart, blockEnd);
    expect(block).toContain('{ key: "open", label: "Disponibles" }');
    expect(block).toContain('{ key: "applied", label: "Postulées" }');
    expect(block).toContain('{ key: "pending", label: "À confirmer" }');
    expect(block).toContain('{ key: "active", label: "En cours" }');
    expect(block).not.toContain('{ key: "completed", label: "Terminées" }');
    expect(block.indexOf("Disponibles")).toBeLessThan(block.indexOf("Postulées"));
    expect(block.indexOf("Postulées")).toBeLessThan(block.indexOf("À confirmer"));
    expect(block.indexOf("À confirmer")).toBeLessThan(block.indexOf("En cours"));
    expect(source).toContain('if (filter === "applied") return isDriver && delivery.ownCandidateStatus === "applied";');
  });

  it.each([nativeSource, webSource])("réserve les livraisons terminées à l’expéditeur sur cet écran", (source) => {
    expect(source).toContain('if (filter === "completed") return !isDriver && status === "completed";');
  });
});
