import { describe, expect, it } from "vitest";
import { isLegacyJwtKey, supabaseKeyHeaders } from "../server/supabase-keys";

describe("clés d'API Supabase, deux formats", () => {
  it("clé historique (JWT) : apikey et Authorization", () => {
    const key = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sig";
    expect(isLegacyJwtKey(key)).toBe(true);
    expect(supabaseKeyHeaders(key, { "Content-Type": "application/json" })).toEqual({ apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" });
  });

  it("nouvelle clé sb_secret_… : apikey seulement", () => {
    expect(isLegacyJwtKey("sb_secret_abc")).toBe(false);
    expect(supabaseKeyHeaders("sb_secret_abc")).toEqual({ apikey: "sb_secret_abc" });
  });

  it("plus aucun appel serveur ne place la clé de service dans Authorization à la main", async () => {
    const { readFileSync } = await import("node:fs");
    for (const file of ["server/storage.ts", "server/supabase-realtime.ts", "server/supabase-admin-auth.ts"]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/Bearer \$\{(secret|serviceKey|config\.serviceKey)\}/);
    }
  });
});
