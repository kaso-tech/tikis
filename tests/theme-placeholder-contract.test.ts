import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("contrat du token placeholder", () => {
  it("expose un placeholder typé et centralisé dans la palette", () => {
    const source = readFileSync("lib/use-theme-colors.ts", "utf8");

    expect(source).toContain("placeholder: string;");
    expect(source).toContain("placeholder: base.muted,");
  });
});

