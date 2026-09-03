import { describe, expect, it } from "vitest";
import { isValidExpoPushTokenShape } from "../server/_test-helpers/push-token-shape";

describe("validation des push tokens Expo", () => {
  it("accepte le format ExponentPushToken[...] officiel", () => {
    expect(isValidExpoPushTokenShape("ExponentPushToken[ABCDEFGHIJKLMNOPQRSTUVWXYZ]")).toBe(true);
  });

  it("accepte un token alphanumérique nu (compatibilité legacy)", () => {
    expect(isValidExpoPushTokenShape("ABCDEFGHIJKLMNOPQRSTUVWXYZ123456")).toBe(true);
  });

  it("rejette les chaînes trop courtes", () => {
    expect(isValidExpoPushTokenShape("short")).toBe(false);
  });

  it("rejette les chaînes avec espaces ou caractères spéciaux non autorisés", () => {
    expect(isValidExpoPushTokenShape("ExponentPushToken[bad token!]")).toBe(false);
    expect(isValidExpoPushTokenShape("token avec espaces ici et la")).toBe(false);
  });

  it("rejette une chaîne vide", () => {
    expect(isValidExpoPushTokenShape("")).toBe(false);
  });

  it("rejette les chaînes > 200 chars", () => {
    expect(isValidExpoPushTokenShape("a".repeat(201))).toBe(false);
  });
});
