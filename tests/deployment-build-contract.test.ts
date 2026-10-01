import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };
const serverEntry = readFileSync("server/_core/index.ts", "utf8");

describe("contrat de build de déploiement", () => {
  it("`pnpm build` (commande par défaut des hébergeurs) lance le build de déploiement", () => {
    expect(packageJson.scripts?.build).toBe("pnpm run build:deploy");
  });

  it("produit les artefacts web, admin et API attendus en publication", () => {
    const command = packageJson.scripts?.["build:deploy"] ?? "";
    expect(command).toContain("CI=1 EXPO_NO_INTERACTIVE=1");
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

  it("Railway : migrations avant la mise en service, contrôle de santé, redémarrage automatique", () => {
    const railway = JSON.parse(readFileSync("railway.json", "utf8")) as { build: { buildCommand: string }; deploy: { preDeployCommand: string[]; startCommand: string; healthcheckPath: string; restartPolicyType: string } };
    expect(railway.build.buildCommand).toBe("pnpm run build");
    expect(railway.deploy.preDeployCommand).toEqual(["pnpm run db:migrate"]);
    expect(railway.deploy.startCommand).toBe("pnpm start");
    expect(railway.deploy.healthcheckPath).toBe("/api/health");
    expect(railway.deploy.restartPolicyType).toBe("ON_FAILURE");
  });

  it("les migrations de déploiement n'utilisent que des dépendances d'exécution (pas drizzle-kit)", () => {
    expect(packageJson.scripts?.["db:migrate"]).toContain("scripts/db-migrate.mjs");
    const migrator = readFileSync("scripts/db-migrate.mjs", "utf8");
    expect(migrator).toContain('from "drizzle-orm/postgres-js/migrator"');
    expect(migrator).not.toContain("drizzle-kit\"");
    expect(migrator).toContain("process.exitCode = 1");
  });
});
