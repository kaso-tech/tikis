import { afterEach, describe, expect, it, vi } from "vitest";
import { isSupabasePhoneAuthEnabled } from "../lib/supabase-tracking";

describe("mode Supabase Phone", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reste en simulation tant que l’activation explicite n’est pas présente", () => {
    vi.stubEnv("EXPO_PUBLIC_ENABLE_SUPABASE_PHONE_AUTH", "");
    expect(isSupabasePhoneAuthEnabled()).toBe(false);
  });

  it("n’active Supabase Phone que pour la valeur true explicite", () => {
    vi.stubEnv("EXPO_PUBLIC_ENABLE_SUPABASE_PHONE_AUTH", "true");
    expect(isSupabasePhoneAuthEnabled()).toBe(true);
    vi.stubEnv("EXPO_PUBLIC_ENABLE_SUPABASE_PHONE_AUTH", "TRUE");
    expect(isSupabasePhoneAuthEnabled()).toBe(false);
  });
});
