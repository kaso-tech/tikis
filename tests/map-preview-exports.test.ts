import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("map-preview", () => {
  it("expose MapPreview dans chaque variante de plateforme", () => {
    const nativeSource = readFileSync(resolve(process.cwd(), "components/tikis/map-preview.native.tsx"), "utf8");
    const webSource = readFileSync(resolve(process.cwd(), "components/tikis/map-preview.web.tsx"), "utf8");

    expect(nativeSource).toContain("export { MapPreviewLeaflet as MapPreview };");
    expect(webSource).toContain("export { MapPreviewLeaflet as MapPreview };");
  });
});
