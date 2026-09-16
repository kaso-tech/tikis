import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const trackingSource = readFileSync(
  resolve(process.cwd(), "components/tikis/live-tracking-screen.native.tsx"),
  "utf8",
);

describe("contrat d’animation du suivi", () => {
  it("n’associe pas mass au modèle Animated.spring tension/friction", () => {
    const animation = trackingSource.match(
      /Animated\.spring\(sheetBaseHeight,\s*\{([\s\S]*?)\}\)\.start\(\);/,
    )?.[1];

    expect(animation).toContain("tension: 220");
    expect(animation).toContain("friction: 22");
    expect(animation).not.toMatch(/mass\s*:/);
  });
});
