import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const homeSource = readFileSync(join(process.cwd(), "components/tikis/screens/home-screen.native.tsx"), "utf8");
const tabsSource = readFileSync(join(process.cwd(), "app/(tabs)/_layout.tsx"), "utf8");

describe("interactions de l’accueil expéditeur", () => {
  it("isole la carte et réserve la capture de gestes à la poignée du panneau", () => {
    expect(homeSource).toContain('pointerEvents="none"');
    expect(homeSource).toContain("zoomEnabled={false}");
    expect(homeSource).toContain("scrollEnabled={false}");
    expect(homeSource).toContain('<View pointerEvents="auto" style={styles.mapTouchBlocker} />');
    expect(homeSource).toContain('<View {...panResponder.panHandlers} style={styles.sheetDragHandle}');
    expect(homeSource).not.toContain('<View {...panResponder.panHandlers} style={styles.sheetHeader}>');
    expect(homeSource).toContain('sheet: { position: "absolute"');
    expect(homeSource).toContain("zIndex: 2, elevation: 2");
    expect(tabsSource).toContain("zIndex: 10, elevation: 10");
  });
});
