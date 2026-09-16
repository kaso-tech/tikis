import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const trackingSource = readFileSync(
  resolve(process.cwd(), "components/tikis/live-tracking-screen.native.tsx"),
  "utf8",
);

describe("contrat d’animation du suivi", () => {
  it("réinitialise panY avec une animation temporelle compatible", () => {
    expect(trackingSource).toMatch(
      /Animated\.timing\(panY,\s*\{\s*toValue: 0,\s*duration: 200,\s*useNativeDriver: false\s*\}\)\.start\(\);/,
    );
    expect(trackingSource).not.toMatch(/mass\s*:/);
  });

  it("anime la hauteur du panneau sans option physique incompatible", () => {
    expect(trackingSource).toMatch(
      /Animated\.timing\(sheetBaseHeight,\s*\{[\s\S]*?useNativeDriver: false,[\s\S]*?\}\)\.start\(\);/,
    );
    expect(trackingSource).not.toMatch(/Animated\.spring\([^)]*mass\s*:/);
  });
});
