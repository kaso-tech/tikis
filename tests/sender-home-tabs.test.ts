import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isDeliveryCompletedWithinLast24Hours, type Delivery } from "../shared/tikis-domain";

const nativeSource = readFileSync(join(process.cwd(), "components/tikis/screens/home-screen.native.tsx"), "utf8");
const webSource = readFileSync(join(process.cwd(), "components/tikis/screens/home-screen.web.tsx"), "utf8");

function completedDelivery(completedAt: string): Pick<Delivery, "status" | "completedAt"> {
  return { status: "completed", completedAt };
}

describe("onglets de l’accueil expéditeur", () => {
  it("retient uniquement les livraisons terminées depuis moins de vingt-quatre heures", () => {
    const now = new Date("2026-08-31T12:00:00.000Z");
    expect(isDeliveryCompletedWithinLast24Hours(completedDelivery("2026-08-30T12:00:01.000Z"), now)).toBe(true);
    expect(isDeliveryCompletedWithinLast24Hours(completedDelivery("2026-08-30T12:00:00.000Z"), now)).toBe(false);
    expect(isDeliveryCompletedWithinLast24Hours(completedDelivery("2026-08-31T12:01:00.000Z"), now)).toBe(false);
  });

  it.each([nativeSource, webSource])("présente Publiées, Attribuées, En cours et Terminées sans onglets obsolètes", (source) => {
    const blockStart = source.indexOf("const SENDER_FILTERS");
    const blockEnd = source.indexOf("const DRIVER_FILTERS", blockStart);
    const block = source.slice(blockStart, blockEnd);
    expect(block).toContain('{ key: "open", label: "Publiées" }');
    expect(block).toContain('{ key: "pending", label: "Attribuées" }');
    expect(block).toContain('{ key: "active", label: "En cours" }');
    expect(block).toContain('{ key: "completed", label: "Terminées" }');
    expect(block).not.toContain('label: "Toutes"');
    expect(block).not.toContain('label: "À confirmer"');
    expect(source).toContain('isDeliveryCompletedWithinLast24Hours(delivery)');
  });

  it.each([nativeSource, webSource])("anime le contenu du filtre avec une transition brève et accessible", (source) => {
    expect(source).toContain("const filterTransition = useRef(new Animated.Value(1)).current;");
    expect(source).toContain("function selectFilter(nextFilter: FilterKey)");
    expect(source).toContain("duration: 180");
    expect(source).toContain("styles.tabContent");
  });
});
