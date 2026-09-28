import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const packageJson = readFileSync(join(root, "package.json"), "utf8");
const server = readFileSync(join(root, "server/_core/index.ts"), "utf8");
const metroConfig = readFileSync(join(root, "metro.config.js"), "utf8");

describe("hébergement web public", () => {
  it("exporte Expo Web dans le build de production", () => {
    expect(packageJson).toContain('"build:web": "NATIVEWIND_FORCE_WRITE_FILE_SYSTEM=false expo export --platform web --output-dir web-build --clear"');
    expect(packageJson).toContain('"build": "pnpm build:web && pnpm build:admin && pnpm build:server"');
    expect(metroConfig).toContain('process.env.NATIVEWIND_FORCE_WRITE_FILE_SYSTEM !== "false"');
  });

  it("sert l’export à la racine sans intercepter l’API ou la console admin", () => {
    expect(server).toContain('const webDistPath = path.resolve(process.cwd(), "web-build")');
    expect(server).toContain('app.use(express.static(webDistPath, { extensions: ["html"] }))');
    expect(server).toContain('req.path.startsWith("/api/")');
    expect(server).toContain('req.path.startsWith("/admin/")');
    expect(server).toContain('res.sendFile(webIndexPath)');
    expect(server).toContain('const port = parseInt(process.env.PORT || "3000")');
    expect(server).not.toContain("findAvailablePort");
  });
});
