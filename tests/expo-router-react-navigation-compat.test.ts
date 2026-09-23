import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Depuis le SDK 56, expo-router n'est plus construit sur react-navigation (il vendorise sa propre
// implémentation) : toute importation directe de @react-navigation/* dans le code de l'app (hors
// node_modules) fait planter Metro au démarrage avec « As of SDK 56, expo-router is no longer
// compatible with react-navigation » — voir node_modules/@expo/cli/build/src/start/server/metro/
// withMetroMultiPlatform.js. Ce test protège contre la régression exacte rencontrée : @react-navigation/*
// laissés en dépendance directe (et deux fichiers qui les importaient encore) après la migration SDK 57.
describe("compatibilité expo-router / react-navigation (SDK 56+)", () => {
  it("aucun fichier de l'app n'importe @react-navigation/* directement", () => {
    const output = execSync(
      "git grep -l \"@react-navigation\" -- '*.ts' '*.tsx' ':!node_modules' || true",
      { cwd: process.cwd(), encoding: "utf8" },
    ).trim();
    expect(output).toBe("");
  });

  it("package.json ne déclare plus @react-navigation/* comme dépendance directe", () => {
    const packageJson = readFileSync("package.json", "utf8");
    expect(packageJson).not.toContain("@react-navigation/");
  });

  it("expo-router expose son propre useFocusEffect, celui à utiliser à la place de @react-navigation/native", () => {
    const trackedMarker = readFileSync("components/tikis/tracked-marker.tsx", "utf8");
    expect(trackedMarker).toContain('import { useFocusEffect } from "expo-router"');
  });
});
