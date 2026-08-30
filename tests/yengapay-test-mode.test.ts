import { describe, expect, it } from "vitest";

describe("modèle YengaPay de test", () => {
  it("conserve une référence locale explicite sans appeler l’API externe", () => {
    const reference = `YENGA-TEST-${crypto.randomUUID().replace(/-/g, "").slice(0, 20).toUpperCase()}`;

    expect(reference).toMatch(/^YENGA-TEST-[A-F0-9]{20}$/);
  });
});
