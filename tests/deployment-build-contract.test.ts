import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };
const projectConfig = JSON.parse(readFileSync(".project-config.json", "utf8")) as { build_command?: string };
const serverEntry = readFileSync("server/_core/index.ts", "utf8");

describe("contrat de build WebDev backend", () => {
  it("utilise la commande de déploiement dédiée au backend", () => {
    expect(projectConfig.build_command).toBe("pnpm run build:deploy");
  });

  it("produit les artefacts web, admin et API attendus en publication", () => {
    const command = packageJson.scripts?.["build:deploy"] ?? "";
    expect(command).toContain("pnpm run build:web");
    expect(command).toContain("npm --prefix admin ci --ignore-scripts");
    expect(command).toContain("npm --prefix admin run build");
    expect(command).toContain("pnpm run build:server");
  });

  it("compile l’export Expo Web avant le serveur", () => {
    const command = packageJson.scripts?.["build:deploy"] ?? "";
    expect(command.indexOf("pnpm run build:web")).toBeLessThan(command.indexOf("pnpm run build:server"));
  });

  it("répond sainement à la racine lorsque le bundle Expo Web est absent", () => {
    expect(serverEntry).toContain('res.status(200).json({ ok: true, service: "Tikisse API" })');
  });
});
