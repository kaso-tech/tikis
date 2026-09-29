import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const LEGACY_TOKENS = [
  "#9A6201", "#D7A447", "#F0F3F8", "#171108", "#231A10", "#FBF7F0", "#C8BCAA",
  "#4A3823", "#667085", "#E3E3E3", "#A43740", "#176C52", "#A65300", "#2C5BA8",
];

const BRAND_SOURCES = ["app", "components", "lib", "constants", "theme.config.js", "app.config.ts"];

function contrast(first: string, second: string) {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
      .map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

describe("charte officielle Tikisse mobile", () => {
  it("définit la palette brun profond, terre cuite et or dans le thème global", () => {
    const theme = read("theme.config.js");
    expect(theme).toContain("primary: { light: '#A95000', dark: '#F8A008' }");
    expect(theme).toContain("background: { light: '#EEEDF3', dark: '#401000' }");
    expect(theme).toContain("foreground: { light: '#241510', dark: '#FFF9F2' }");
    expect(theme).toContain("border: { light: '#E7D9CF', dark: '#7A4A2D' }");
  });

  it("conserve un contraste accessible sur le bouton principal", () => {
    expect(contrast("#A95000", "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
    expect(read("components/tikisse/ui.tsx")).toContain('primary: { background: "#A95000", foreground: "#FFFFFF", border: "#A95000" }');
  });

  it("utilise le logo officiel pour les icônes, le splash et l’en-tête", () => {
    for (const asset of ["icon.png", "splash-icon.png", "favicon.png", "android-icon-foreground.png"]) {
      expect(existsSync(join(process.cwd(), "assets/images", asset))).toBe(true);
    }
    expect(read("app.config.ts")).toContain('icon: "./assets/images/icon.png"');
    expect(read("app.config.ts")).toContain('image: "./assets/images/splash-icon.png"');
    expect(read("components/tikisse/app-chrome.tsx")).toContain('source={require("../../assets/images/icon.png")}');
    expect(read("components/tikisse/auth-flow.tsx")).toContain('source={require("@/assets/images/icon.png")}');
  });

  it("aligne le splash et l’icône Android sur le brun profond du logo", () => {
    expect(read("components/tikisse/animated-splash.tsx")).toContain('SPLASH_BACKGROUND = "#401000"');
    const config = read("app.config.ts");
    expect(config).toContain('backgroundColor: "#401000"');
    expect(config).toContain('color: "#A95000"');
  });

  it("ne conserve aucun ancien token de la charte dans les sources d’interface", () => {
    const collect = (path: string): string[] => {
      const source = join(process.cwd(), path);
      const stat = statSync(source);
      if (!stat.isDirectory()) return [read(path)];
      return readdirSync(source).flatMap((entry) => collect(join(path, entry)));
    };
    const content = BRAND_SOURCES.flatMap(collect).join("\n").toUpperCase();
    for (const token of LEGACY_TOKENS) expect(content).not.toContain(token);
  });
});
