import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const securitySource = readFileSync(new URL("../server/_core/security.ts", import.meta.url), "utf8");

describe("console admin sur domaine dédié", () => {
  it("autorise explicitement la console Tikisse en CORS", () => {
    expect(securitySource).toContain('"https://console.tikisse.com"');
    expect(securitySource).toContain("X-Tikisse-Admin");
  });
});
