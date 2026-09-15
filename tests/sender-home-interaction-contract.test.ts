import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const homeSource = readFileSync(join(process.cwd(), "components/tikis/screens/home-screen.native.tsx"), "utf8");
const tabsSource = readFileSync(join(process.cwd(), "app/(tabs)/_layout.tsx"), "utf8");

describe("interactions de l’accueil expéditeur", () => {
  it("maintient la carte de fond passive et le panneau au-dessus pour les comptes expéditeur", () => {
    expect(homeSource).toContain('pointerEvents="none"');
    expect(homeSource).toContain("zoomEnabled={false}");
    expect(homeSource).toContain("scrollEnabled={false}");
    expect(homeSource).toContain('sheet: { position: "absolute"');
    expect(homeSource).toContain("zIndex: 2, elevation: 2");
    expect(tabsSource).toContain("zIndex: 10, elevation: 10");
  });
});
