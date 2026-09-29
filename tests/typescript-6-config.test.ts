import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const tsconfig = JSON.parse(readFileSync("tsconfig.json", "utf8")) as {
  compilerOptions?: { ignoreDeprecations?: string };
};

describe("compatibilité TypeScript 6", () => {
  it("autorise la configuration Expo héritée qui conserve baseUrl", () => {
    expect(tsconfig.compilerOptions?.ignoreDeprecations).toBe("6.0");
  });
});
