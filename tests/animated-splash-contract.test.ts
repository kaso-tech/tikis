/**
 * Écran de démarrage animé : le relais avec l'écran natif doit se faire sans saut, et le splash ne
 * doit jamais rester bloqué ni s'effacer avant que l'application ait décidé quoi afficher.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const splash = read("components/tikisse/animated-splash.tsx");
const config = read("app.config.ts");
const layout = read("app/_layout.tsx");

function constant(name: string) {
  return new RegExp(`export const ${name} = ([^;]+);`).exec(splash)?.[1]?.replace(/"/g, "");
}

describe("relais avec l'écran natif", () => {
  it("même fond et même taille de logo que l'écran natif, en mode clair comme sombre", () => {
    const background = constant("SPLASH_BACKGROUND");
    const size = constant("SPLASH_LOGO_SIZE");
    const nativeSplash = config.slice(config.indexOf('"expo-splash-screen"'));
    expect(nativeSplash).toContain(`imageWidth: ${size},`);
    expect(nativeSplash).toContain(`backgroundColor: "${background}",`);
    expect(nativeSplash.match(new RegExp(`backgroundColor: "${background}"`, "g"))).toHaveLength(2);
  });

  it("même image que l'écran natif", () => {
    expect(config).toContain('image: "./assets/images/tikisse-logo.png"');
    expect(read("assets/images/tikisse-logo.png").length).toBeGreaterThan(0);
    expect(splash).toContain('require("../../assets/images/tikisse-logo.png")');
  });

  it("l'écran natif reste affiché jusqu'au premier dessin du splash animé, avec un filet de sécurité", () => {
    expect(layout).toContain("SplashScreen.preventAutoHideAsync()");
    expect(splash).toContain("onLayout={onLayout}");
    expect(splash).toContain("SplashScreen.hideAsync()");
    expect(layout).toMatch(/setTimeout\(\(\) => void SplashScreen\.hideAsync\(\)/);
  });

  it("natif seulement : sur le web, chaque chargement de page le rejouerait", () => {
    expect(layout).toContain('Platform.OS !== "web" ? <AnimatedSplash /> : null');
  });
});

describe("sortie du splash", () => {
  it("attend que l'application soit prête, avec un plafond", () => {
    expect(splash).toContain("const ready = appReady || timedOut;");
    expect(splash).toMatch(/const MAX_WAIT = \d+;/);
  });

  it("chaque point d'entrée signale qu'il est prêt", () => {
    expect(read("app/index.tsx")).toContain('if (restore !== "checking") markAppReady();');
    expect(read("app/(tabs)/_layout.tsx")).toContain("markAppReady();");
    expect(read("components/tikisse/app-status-gate.tsx")).toContain("if (blocked) markAppReady();");
  });

  it("respecte « Réduire les animations »", () => {
    expect(splash).toContain("useReducedMotion()");
  });
});
