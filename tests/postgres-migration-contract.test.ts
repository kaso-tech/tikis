/**
 * Base PostgreSQL (Supabase) : les règles que le passage depuis MySQL a posées, et qu'un ajout ultérieur ne
 * doit pas défaire sans bruit.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sources(path);
    return /\.(ts|tsx|mjs)$/.test(name) ? [path] : [];
  });
}

const schema = read("drizzle/schema.ts");
const tables = [...schema.matchAll(/pgTable\("([a-z_]+)"/g)].map((match) => match[1]!);
const migrations = readdirSync(join(process.cwd(), "drizzle/migrations")).filter((file) => file.endsWith(".sql")).map((file) => read(`drizzle/migrations/${file}`)).join("\n");
const serverCode = [...sources("server"), ...sources("scripts"), "drizzle/schema.ts", "drizzle.config.ts"];

describe("plus rien de MySQL", () => {
  it("ni pilote, ni dialecte, ni syntaxe d'upsert MySQL", () => {
    expect(JSON.parse(read("package.json")).dependencies.mysql2).toBeUndefined();
    expect(read("drizzle.config.ts")).toContain('dialect: "postgresql"');
    for (const path of serverCode) {
      const source = readFileSync(path, "utf8");
      expect(source, path).not.toMatch(/drizzle-orm\/mysql|mysql2|onDuplicateKeyUpdate|mysqlTable|ER_DUP_ENTRY/);
    }
  });

  it("connexion compatible avec le pooler Supabase en mode transaction", () => {
    expect(read("server/db.ts")).toContain("prepare: false");
  });
});

describe("sécurité de la base Supabase", () => {
  it("chaque table a la RLS activée par une migration : l'API publique ne lit rien avec la clé anon", () => {
    expect(tables.length).toBeGreaterThan(30);
    for (const table of tables) expect(migrations, table).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
  });

  it("journal d'audit et grand livre sont immuables en base", () => {
    expect(migrations).toContain("CREATE TRIGGER tikisse_admin_audit_log_immutable BEFORE UPDATE OR DELETE");
    expect(migrations).toContain("CREATE TRIGGER tikisse_wallet_ledger_immutable BEFORE UPDATE OR DELETE");
    // Seule la pseudonymisation d'un compte supprimé (server/admin-deletions.ts) modifie une écriture.
    expect(migrations).toContain(`NEW."profilePhone" LIKE 'del-%'`);
    expect(read("server/admin-deletions.ts")).toContain("const pseudonym = `del-");
  });
});

describe("types de résultats PostgreSQL", () => {
  it("COUNT et SUM écrits à la main sont convertis en nombres (PostgreSQL les rend en texte)", () => {
    for (const path of sources("server")) {
      const source = readFileSync(path, "utf8");
      for (const match of source.matchAll(/sql<number>`[^`]*`(\.mapWith\(Number\))?/g)) {
        expect(match[1], `${path} : ${match[0]}`).toBeDefined();
      }
    }
  });
});
