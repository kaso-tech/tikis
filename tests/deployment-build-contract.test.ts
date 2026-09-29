import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };
const projectConfig = JSON.parse(readFileSync(".project-config.json", "utf8")) as { build_command?: string };

describe("contrat de build WebDev backend", () => {
  it("utilise la commande de déploiement dédiée au backend", () => {
    expect(projectConfig.build_command).toBe("pnpm run build:deploy");
  });

  it("installe la console admin avant de compiler l’API", () => {
    const command = packageJson.scripts?.["build:deploy"] ?? "";
    expect(command).toContain("npm --prefix admin ci --ignore-scripts");
    expect(command).toContain("npm --prefix admin run build");
    expect(command).toContain("pnpm run build:server");
  });

  it("n’exécute pas l’export Expo Web dans le service backend", () => {
    expect(packageJson.scripts?.["build:deploy"] ?? "").not.toContain("build:web");
  });
});
