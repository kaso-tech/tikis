import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const config = readFileSync(join(process.cwd(), "app.config.ts"), "utf8");
const packageJson = readFileSync(join(process.cwd(), "package.json"), "utf8");

describe("les champs exigés par les stores sont renseignés", () => {
  it("porte un numéro de build iOS et un versionCode Android, distincts de version", () => {
    expect(config).toContain('buildNumber: "1"');
    expect(config).toContain("versionCode: 1");
  });

  it("déclare une politique de runtimeVersion, pas une valeur oubliée", () => {
    expect(config).toContain('runtimeVersion: { policy: "appVersion" }');
  });
});

describe("aucune permission n'est demandée pour une capacité jamais utilisée", () => {
  it("les plugins expo-audio et expo-video ont disparu de la configuration", () => {
    // Ni l'un ni l'autre n'était importé nulle part dans l'app : le micro était demandé
    // pour rien, motif de rejet App Store.
    expect(config).not.toContain("expo-audio");
    expect(config).not.toContain("expo-video");
  });

  it("expo-audio et expo-video ne sont plus des dépendances", () => {
    expect(packageJson).not.toContain('"expo-audio"');
    expect(packageJson).not.toContain('"expo-video"');
  });

  it("expo-image-picker ne demande plus caméra ni microphone : seule la galerie est utilisée", () => {
    expect(config).toContain("cameraPermission: false");
    expect(config).toContain("microphonePermission: false");
  });
});
