import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const nativeHome = readFileSync(join(process.cwd(), "components/tikis/screens/home-screen.native.tsx"), "utf8");
const webHome = readFileSync(join(process.cwd(), "components/tikis/screens/home-screen.web.tsx"), "utf8");
const homeResolver = readFileSync(join(process.cwd(), "components/tikis/screens/home-screen.tsx"), "utf8");

describe("contrat de suivi cartographique", () => {
  it("charge la carte native sur iOS et Android plutôt que la variante web", () => {
    expect(homeResolver).toContain('Platform.OS === "web"');
    expect(homeResolver).toContain('require("./home-screen.native").HomeScreen');
  });

  it("publie la position GPS du livreur et trace un segment distinct vers la collecte", () => {
    expect(nativeHome).toContain("deliveries.updateLivePosition.useMutation");
    expect(nativeHome).toContain('strokeColor="#176C52"');
    expect(nativeHome).toContain('strokeColor="#9A6201"');
  });

  it("affiche le suivi expéditeur dans la variante web avec un segment d’approche", () => {
    expect(webHome).toContain("useLiveDeliveryPosition");
    expect(webHome).toContain("approachLine");
    expect(webHome).toContain('backgroundColor: "#176C52"');
  });
});
