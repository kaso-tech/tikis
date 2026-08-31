import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sources = [
  readFileSync(join(process.cwd(), "components/tikis/screens/home-screen.native.tsx"), "utf8"),
  readFileSync(join(process.cwd(), "components/tikis/screens/home-screen.web.tsx"), "utf8"),
];

describe("pulsation des badges de statut", () => {
  it.each(sources)("mémorise l’état précédent et n’anime que les statuts modifiés", (source) => {
    expect(source).toContain("const previousDeliveryStatuses = useRef<Record<string, DeliveryStatus> | null>(null);");
    expect(source).toContain("const changedFilters = new Set<FilterKey>();");
    expect(source).toContain("if (previousStatuses[delivery.id] === delivery.status) return;");
    expect(source).toContain("changedFilters.forEach(pulseBadge);");
  });

  it.each(sources)("effectue une pulsation discrète et réversible sur le badge concerné", (source) => {
    expect(source).toContain("const badgeScales = useRef<Record<FilterKey, Animated.Value>>");
    expect(source).toContain("Animated.sequence([");
    expect(source).toContain("toValue: 1.14, duration: 110");
    expect(source).toContain("toValue: 1, duration: 170");
    expect(source).toContain("transform: [{ scale: badgeScales[item.key] }]");
  });
});
