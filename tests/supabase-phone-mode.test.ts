import { afterEach, describe, expect, it, vi } from "vitest";
import { isSupabasePhoneAuthEnabled } from "../lib/supabase-tracking";

describe("mode Supabase Phone", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reste en mode réel grâce à la configuration publique de secours", () => {
    vi.stubEnv("EXPO_PUBLIC_ENABLE_SUPABASE_PHONE_AUTH", "");
    expect(isSupabasePhoneAuthEnabled()).toBe(true);
  });

  it("conserve le mode réel même si une ancienne valeur d’activation est mal formée", () => {
    vi.stubEnv("EXPO_PUBLIC_ENABLE_SUPABASE_PHONE_AUTH", "true");
    expect(isSupabasePhoneAuthEnabled()).toBe(true);
    vi.stubEnv("EXPO_PUBLIC_ENABLE_SUPABASE_PHONE_AUTH", "TRUE");
    expect(isSupabasePhoneAuthEnabled()).toBe(true);
  });
});
