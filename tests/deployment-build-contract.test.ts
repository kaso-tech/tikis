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
    expect(command).toContain("npm --prefix admin ci --include=dev --ignore-scripts");
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

  it("Render : Francfort, offre toujours allumée, migrations avant la mise en service, contrôle de santé", () => {
    const render = readFileSync("render.yaml", "utf8");
    expect(render).toContain("region: frankfurt");
    expect(render).toMatch(/plan: (starter|standard|pro)/);
    expect(render).toContain("buildCommand: corepack enable && pnpm install --frozen-lockfile --prod=false && pnpm run build");
    expect(render).toContain("preDeployCommand: pnpm run db:migrate");
    expect(render).toContain("startCommand: pnpm start");
    expect(render).toContain("healthCheckPath: /api/health");
    // Les EXPO_PUBLIC_* sont intégrées au build de la version web, fait sur Render.
    for (const key of ["EXPO_PUBLIC_API_BASE_URL", "EXPO_PUBLIC_SUPABASE_URL", "EXPO_PUBLIC_SUPABASE_ANON_KEY"]) expect(render).toContain(`key: ${key}`);
    // Aucun secret écrit en clair dans le fichier : saisis dans Render (sync: false) ou générés.
    for (const key of ["DATABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "TIKISSE_SESSION_SECRET", "TIKISSE_ADMIN_TOTP_KEY", "YENGAPAY_API_KEY", "YENGAPAY_WEBHOOK_SECRET"]) {
      expect(render).toMatch(new RegExp(`key: ${key}(\\s+#[^\\n]*)?\\n\\s+sync: false`));
    }
  });

  it("les migrations de déploiement n'utilisent que des dépendances d'exécution (pas drizzle-kit)", () => {
    expect(packageJson.scripts?.["db:migrate"]).toContain("scripts/db-migrate.mjs");
    const migrator = readFileSync("scripts/db-migrate.mjs", "utf8");
    expect(migrator).toContain('from "drizzle-orm/postgres-js/migrator"');
    expect(migrator).not.toContain("drizzle-kit\"");
    expect(migrator).toContain("process.exitCode = 1");
  });
});
